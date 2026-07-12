use super::*;
#[tauri::command]
pub fn suggest_todo_worktree_name(
    state: State<'_, AppDb>,
    input: SuggestTodoWorktreeNameCommand,
) -> Result<WorktreeNameSuggestion, String> {
    suggest_todo_worktree_name_in_db(&state, input)
}

#[tauri::command]
pub fn enable_todo_worktree(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: EnableTodoWorktreeCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = enable_todo_worktree_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "worktree_created")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn todo_worktree_status(
    state: State<'_, AppDb>,
    input: TodoWorktreeCommand,
) -> Result<TodoWorktreeStatusSummary, String> {
    todo_worktree_status_in_db(&state, input)
}

#[tauri::command]
pub fn delete_todo_worktree(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: TodoWorktreeCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = delete_todo_worktree_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "worktree_deleted")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn open_todo_worktree_folder(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: TodoWorktreeCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let target = state
        .todo_worktree_target(input.todo_id)
        .map_err(command_error)?;
    let path = expand_home_alias(&target.worktree_path);
    if !path.is_dir() {
        return Err(format!(
            "worktree folder does not exist: {}",
            path.display()
        ));
    }
    let project = state
        .get_project(target.project_id)
        .map_err(command_error)?;
    open_folder_with_app(&app, &project.project_folder_open_app, &path, None, None)?;
    Ok(ProjectActionsDirectorySummary {
        exists: path.is_dir(),
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn open_todo_worktree_diff(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: TodoWorktreeCommand,
) -> Result<ExecutionTerminalSummary, String> {
    let target = state
        .todo_worktree_target(input.todo_id)
        .map_err(command_error)?;
    let process = build_worktree_diff_process_command(
        &target.worktree_path,
        &target.main_branch,
        WorktreeCommandPlatform::current(target.terminal_wsl_enabled),
    )?;
    let pty_id = pty.spawn_process(
        &app,
        PtySpawnSpec {
            program: process.program,
            args: process.args,
            cwd: process.cwd,
            env: vec![
                (
                    "BOOMERANG_PROJECT_ID".to_string(),
                    target.project_id.to_string(),
                ),
                (
                    "BOOMERANG_PROJECT_NAME".to_string(),
                    target.project_name.clone(),
                ),
                (
                    "BOOMERANG_PROJECT_DIR".to_string(),
                    target.worktree_path.clone(),
                ),
                ("BOOMERANG_TODO_ID".to_string(), target.todo_id.to_string()),
                (
                    "BOOMERANG_TODO_DISPLAY_ID".to_string(),
                    target.display_id.clone(),
                ),
            ],
            wsl_enabled: target.terminal_wsl_enabled,
            cols: 100,
            rows: 30,
        },
    )?;
    let terminal = state
        .record_execution_terminal(target.todo_id, pty_id, "terminal", "Open Diff")
        .map_err(command_error)?;
    emit_todo_changed(&app, target.todo_id, "worktree_diff_started")?;
    Ok(terminal)
}

#[tauri::command]
pub fn commit_and_merge_todo_worktree(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: TodoWorktreeCommand,
) -> Result<ExecutionTerminalSummary, String> {
    let target = state
        .todo_worktree_target(input.todo_id)
        .map_err(command_error)?;
    let message = format!("{} {}", target.display_id, target.title);
    let process = build_worktree_merge_process_command(
        &target.project_working_directory,
        &target.worktree_path,
        &target.worktree_name,
        &target.main_branch,
        &message,
        WorktreeCommandPlatform::current(target.terminal_wsl_enabled),
    )?;
    let pty_id = pty.spawn_process(
        &app,
        PtySpawnSpec {
            program: process.program,
            args: process.args,
            cwd: process.cwd,
            env: vec![
                (
                    "BOOMERANG_PROJECT_ID".to_string(),
                    target.project_id.to_string(),
                ),
                (
                    "BOOMERANG_PROJECT_NAME".to_string(),
                    target.project_name.clone(),
                ),
                (
                    "BOOMERANG_PROJECT_DIR".to_string(),
                    target.worktree_path.clone(),
                ),
                ("BOOMERANG_TODO_ID".to_string(), target.todo_id.to_string()),
                (
                    "BOOMERANG_TODO_DISPLAY_ID".to_string(),
                    target.display_id.clone(),
                ),
            ],
            wsl_enabled: target.terminal_wsl_enabled,
            cols: 100,
            rows: 30,
        },
    )?;
    let terminal = state
        .record_execution_terminal(target.todo_id, pty_id, "worktree_merge", "Commit & Merge")
        .map_err(command_error)?;
    emit_todo_changed(&app, target.todo_id, "worktree_merge_started")?;
    Ok(terminal)
}
