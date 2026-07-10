use super::*;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn list_project_actions(
    state: State<'_, AppDb>,
    input: ListProjectActionsCommand,
) -> Result<Vec<ProjectActionSummary>, String> {
    list_project_actions_from_db(&state, input)
}

#[tauri::command]
pub fn get_project_actions_directory(
    state: State<'_, AppDb>,
    input: ProjectActionsDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    get_project_actions_directory_from_db(&state, input)
}

#[tauri::command]
pub fn create_project_actions_directory(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectActionsDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let project_id = input.project_id;
    let summary = create_project_actions_directory_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "actions_directory_created")?;
    Ok(summary)
}

#[tauri::command]
pub fn open_project_actions_directory(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectActionsDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let summary = get_project_actions_directory_from_db(&state, input)?;
    if !summary.exists {
        return Err(format!(
            "actions directory does not exist: {}",
            summary.path
        ));
    }
    app.opener()
        .open_path(summary.path.clone(), None::<String>)
        .map_err(command_error)?;
    Ok(summary)
}

#[tauri::command]
pub fn open_project_folder(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectActionsDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let project = state.get_project(input.project_id).map_err(command_error)?;
    let path = expand_home_alias(&project.working_directory);
    if !path.is_dir() {
        return Err(format!("project folder does not exist: {}", path.display()));
    }
    open_folder_with_app(
        &app,
        &project.project_folder_open_app,
        &path,
        input.remote_host.as_deref(),
        input.remote_path.as_deref(),
    )?;
    Ok(ProjectActionsDirectorySummary {
        exists: path.is_dir(),
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn create_project_action(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: CreateProjectActionCommand,
) -> Result<Vec<ProjectActionSummary>, String> {
    let project_id = input.project_id;
    let actions = create_project_action_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "actions_changed")?;
    Ok(actions)
}

#[tauri::command]
pub fn open_project_action(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectActionFileCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let project = state.get_project(input.project_id).map_err(command_error)?;
    let path = state
        .project_action_file_path(input.project_id, &input.file_name)
        .map_err(command_error)?;
    app.opener()
        .open_path(
            path.display().to_string(),
            configured_project_folder_open_app(&project.project_folder_open_app),
        )
        .map_err(command_error)?;
    Ok(ProjectActionsDirectorySummary {
        exists: path.is_file(),
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn delete_project_action(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectActionFileCommand,
) -> Result<Vec<ProjectActionSummary>, String> {
    let project_id = input.project_id;
    let actions = delete_project_action_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "actions_changed")?;
    Ok(actions)
}

#[tauri::command]
pub fn run_project_action(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: RunProjectActionCommand,
) -> Result<ActionRunSummary, String> {
    if input.file_name == "boomerang:open-folder" {
        let project = state.get_project(input.project_id).map_err(command_error)?;
        let working_directory = action_working_directory(&state, &project, input.todo_id)?;
        let path = expand_home_alias(&working_directory);
        if !path.is_dir() {
            return Err(format!("project folder does not exist: {}", path.display()));
        }
        open_folder_with_app(&app, &project.project_folder_open_app, &path, None, None)?;
    }

    let project_id = input.project_id;
    let run = if input.file_name == "boomerang:open-folder" {
        run_project_action_in_db(&state, input)?
    } else {
        run_project_action_with_pty(&app, &state, &pty, input)?
    };
    emit_project_changed(&app, project_id, "action_run_created")?;
    Ok(run)
}
