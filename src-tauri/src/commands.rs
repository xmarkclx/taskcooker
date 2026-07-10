use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::core::{
    current_binary_path, expand_home_alias, home_aliased_path, todo_artifact_path,
    ActionRunSummary, Actor, AppDb, AppSettingsSummary, AppSnapshot, ExecutionTerminalSummary,
    NewActionRun, NewAgentSession, NewProject, ProjectActionSummary,
    ProjectActionsDirectorySummary, ProjectPromptSettingsUpdate, ProjectSettingsUpdate,
    TodoWorktreeStatusSummary, UpdateTodoStarred, UpdateTodoState, UpdateTodosState,
    WorktreeNameSuggestion,
};
use crate::mcp::McpServerState;
use crate::pty::{PtySpawnSpec, PtyState};

const SLOWDOWN_PROFILE_LOG_MAX_BYTES: u64 = 100 * 1024 * 1024;
const SLOWDOWN_PROFILE_MAX_RECORDS_PER_APPEND: usize = 500;
const PROVIDER_LOAD_POLL_ATTEMPTS: usize = 120;
const PROVIDER_SESSION_POLL_ATTEMPTS: usize = 15;
const PROVIDER_POLL_INTERVAL: Duration = Duration::from_secs(1);
const PROVIDER_PROMPT_SUBMIT_DELAY: Duration = Duration::from_millis(1_000);
const CLAUDE_STATUS_CLOSE_DELAY: Duration = Duration::from_millis(1_000);
const PROVIDER_COMMAND_ENTER_DELAY: Duration = Duration::from_millis(250);

mod bulk_todos;
mod file_paths;
mod messages;
mod models;
mod project_actions;
mod project_backgrounds;
mod project_git;
mod task_titles;
mod todo_artifacts;
mod todo_panels;
mod working_directories;
mod worktrees;
pub use bulk_todos::*;
pub use file_paths::*;
pub use messages::*;
pub use models::*;
pub use project_actions::*;
pub use project_backgrounds::*;
pub use project_git::*;
pub use task_titles::{create_todo_in_db, TaskTitleGenerationRequest};
use task_titles::{
    create_todo_in_db_with_pending_title_generation, manual_title_generation_request,
    spawn_background_task_title_generation,
};
pub use todo_artifacts::*;
pub use todo_panels::*;
pub use working_directories::*;
pub use worktrees::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoChangedPayload {
    todo_id: i64,
    change_type: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectChangedPayload {
    project_id: i64,
    change_type: &'static str,
}

// Snapshot builds walk every todo (N+1 sub-queries plus artifact file reads)
// and serialize ~MBs of JSON; `async` keeps that off the main thread so
// event-driven refetches never stall the UI event loop (B-252).
#[tauri::command(async)]
pub fn app_snapshot(state: State<'_, AppDb>) -> Result<AppSnapshot, String> {
    app_snapshot_from_db(&state, None, None)
}

#[tauri::command]
pub fn app_settings(state: State<'_, AppDb>) -> Result<AppSettingsSummary, String> {
    load_app_settings_from_db(&state)
}

#[tauri::command]
pub fn update_app_settings(
    app: AppHandle,
    state: State<'_, AppDb>,
    mcp: State<'_, McpServerState>,
    input: UpdateAppSettingsCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = update_app_settings_in_db(&state, input)?;
    let settings = mcp.apply_settings(app.clone(), &*state, &settings)?;
    emit_settings_changed(&app, "settings_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn append_slowdown_profile_records(
    app: AppHandle,
    input: AppendSlowdownProfileRecordsCommand,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(command_error)?;
    let log_path = slowdown_profile_log_path(&app_data_dir);
    let records = if input.records.len() > SLOWDOWN_PROFILE_MAX_RECORDS_PER_APPEND {
        &input.records[input.records.len() - SLOWDOWN_PROFILE_MAX_RECORDS_PER_APPEND..]
    } else {
        input.records.as_slice()
    };
    append_slowdown_profile_jsonl_with_rotation(
        &log_path,
        &slowdown_profile_previous_log_path(&app_data_dir),
        records,
        SLOWDOWN_PROFILE_LOG_MAX_BYTES,
    )
}

pub fn slowdown_profile_log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs").join("slowdown-profile.jsonl")
}

pub fn slowdown_profile_previous_log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("logs")
        .join("slowdown-profile.previous.jsonl")
}

pub fn append_slowdown_profile_jsonl_with_rotation(
    log_path: &Path,
    previous_log_path: &Path,
    records: &[Value],
    max_bytes: u64,
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    if max_bytes == 0 {
        return Err("slowdown profile max bytes must be greater than zero".to_string());
    }
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(command_error)?;
    }

    let mut new_bytes = Vec::new();
    for record in records {
        serde_json::to_writer(&mut new_bytes, record).map_err(command_error)?;
        new_bytes.push(b'\n');
    }
    if new_bytes.len() as u64 > max_bytes {
        new_bytes = trim_jsonl_bytes_to_cap(&new_bytes, max_bytes as usize);
    }
    if new_bytes.is_empty() {
        return Ok(());
    }

    let current_bytes = fs::metadata(log_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if current_bytes + new_bytes.len() as u64 <= max_bytes {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .map_err(command_error)?;
        file.write_all(&new_bytes).map_err(command_error)?;
        return Ok(());
    }

    match fs::remove_file(previous_log_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(command_error(error)),
    }
    if log_path.exists() {
        fs::rename(log_path, previous_log_path).map_err(command_error)?;
    }
    fs::write(log_path, new_bytes).map_err(command_error)?;
    Ok(())
}

#[tauri::command]
pub fn open_external_terminal(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: OpenExternalTerminalCommand,
) -> Result<(), String> {
    let settings = state.app_settings().map_err(command_error)?;
    if !settings.terminal_tmux_enabled {
        return Err("tmux external terminals are disabled".to_string());
    }
    let app_data_dir = app.path().app_data_dir().map_err(command_error)?;
    pty.open_external_terminal(
        input.pty_id,
        &app_data_dir,
        &settings.external_terminal_openers,
    )
}

fn trim_jsonl_bytes_to_cap(bytes: &[u8], max_bytes: usize) -> Vec<u8> {
    if bytes.len() <= max_bytes {
        return bytes.to_vec();
    }
    if max_bytes == 0 {
        return Vec::new();
    }

    let start = bytes.len() - max_bytes;
    let tail = &bytes[start..];
    match tail.iter().position(|byte| *byte == b'\n') {
        Some(index) => tail[index + 1..].to_vec(),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn regenerate_mcp_token(
    app: AppHandle,
    state: State<'_, AppDb>,
) -> Result<AppSettingsSummary, String> {
    let settings = regenerate_mcp_token_in_db(&state)?;
    emit_settings_changed(&app, "mcp_token_regenerated")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_task_details_rail_hidden(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTaskDetailsRailHiddenCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_task_details_rail_hidden_in_db(&state, input)?;
    emit_settings_changed(&app, "task_details_rail_visibility_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_task_list_width(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTaskListWidthCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_task_list_width_in_db(&state, input)?;
    emit_settings_changed(&app, "task_list_width_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_task_list_accordion_state(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTaskListAccordionStateCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_task_list_accordion_state_in_db(&state, input)?;
    emit_settings_changed(&app, "task_list_accordion_state_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_task_detail_description_width(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTaskDetailDescriptionWidthCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_task_detail_description_width_in_db(&state, input)?;
    emit_settings_changed(&app, "task_detail_description_width_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_markdown_toc_hidden(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetMarkdownTocHiddenCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_markdown_toc_hidden_in_db(&state, input)?;
    emit_settings_changed(&app, "markdown_toc_visibility_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_markdown_toc_width(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetMarkdownTocWidthCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_markdown_toc_width_in_db(&state, input)?;
    emit_settings_changed(&app, "markdown_toc_width_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn set_markdown_editor_mode(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetMarkdownEditorModeCommand,
) -> Result<AppSettingsSummary, String> {
    let settings = set_markdown_editor_mode_in_db(&state, input)?;
    emit_settings_changed(&app, "markdown_editor_mode_changed")?;
    Ok(settings)
}

#[tauri::command]
pub fn update_todo_state(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoStateCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_state_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "state_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_todo_priority(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoPriorityCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_priority_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "priority_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_todo_context_project(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoContextProjectCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_context_project_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "context_project_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn set_todo_starred(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTodoStarredCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = set_todo_starred_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "starred_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_todo_title(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoTitleCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_title_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "title_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_todo_deadline(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoDeadlineCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_deadline_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "deadline_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn set_todo_tags(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTodoTagsCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = set_todo_tags_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "tags_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn message_todo(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: MessageTodoCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let message = input.message.clone();
    let conversation_id = input.conversation_id.clone();
    let snapshot = message_todo_in_db(&state, input)?;
    if let Some(session) = snapshot.sessions.iter().find(|session| {
        session.todo_id == todo_id
            && session.state == "running"
            && session.pty_id.is_some()
            && conversation_id
                .as_ref()
                .map(|id| id == &session.id || id == &session.conversation_id)
                .unwrap_or(true)
    }) {
        if let Some(pty_id) = session.pty_id {
            let _ = pty.write_text(
                pty_id,
                &format!("\r\n[Reply from TaskCooker]\r\n{}\r\n", message.trim()),
            );
        }
    }
    emit_todo_changed(&app, todo_id, "message_received")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn delete_message(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: DeleteMessageCommand,
) -> Result<AppSnapshot, String> {
    let snapshot = delete_message_in_db(&state, input)?;
    emit_todo_changed(&app, snapshot.selected_todo_id, "message_deleted")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn clear_todo_messages(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ClearTodoMessagesCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = clear_todo_messages_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "messages_cleared")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn record_prompt_copied(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: RecordPromptCopiedCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = record_prompt_copied_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "prompt_copied")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_todo_description(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoDescriptionCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_description_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "description_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_todo_journal(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoJournalCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_journal_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "journal_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_project_notes(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateProjectNotesCommand,
) -> Result<AppSnapshot, String> {
    let project_id = input.project_id;
    let snapshot = update_project_notes_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "notes_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn record_project_use(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: RecordProjectUseCommand,
) -> Result<(), String> {
    let project_id = input.project_id;
    record_project_use_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "project_used")?;
    Ok(())
}

#[tauri::command]
pub fn update_project_settings(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateProjectSettingsCommand,
) -> Result<AppSnapshot, String> {
    let project_id = input.project_id;
    let snapshot = update_project_settings_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "settings_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_project_prompt_settings(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateProjectPromptSettingsCommand,
) -> Result<AppSnapshot, String> {
    let project_id = input.project_id;
    let snapshot = update_project_prompt_settings_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "prompt_settings_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn start_agent_session(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: StartAgentSessionCommand,
) -> Result<AppSnapshot, String> {
    let todo = state.get_todo(input.todo_id).map_err(command_error)?;
    let project = state.get_project(todo.project_id).map_err(command_error)?;
    let settings = state.app_settings().map_err(command_error)?;
    let working_directory = state
        .todo_working_directory(todo.id)
        .map_err(command_error)?;
    let working_directory = expand_home_alias(&working_directory).display().to_string();
    let terminal_wsl_active = project_terminal_wsl_active(project.terminal_wsl_enabled);
    let process_working_directory = if terminal_wsl_active {
        "."
    } else {
        working_directory.as_str()
    };
    let conversation_id = format!("boomerang-{}", uuid::Uuid::new_v4());
    let process = build_agent_process_command(
        &settings,
        &input.provider,
        process_working_directory,
        &conversation_id,
        &input.prompt,
    )?;
    let provider_session_id: Option<String> = None;
    let pty_id = pty.spawn_process(
        &app,
        PtySpawnSpec {
            program: process.program.clone(),
            args: process.args.clone(),
            cwd: working_directory.clone(),
            env: vec![
                ("BOOMERANG_PROJECT_ID".to_string(), project.id.to_string()),
                ("BOOMERANG_PROJECT_NAME".to_string(), project.name.clone()),
                (
                    "BOOMERANG_PROJECT_DIR".to_string(),
                    working_directory.clone(),
                ),
                ("BOOMERANG_TODO_ID".to_string(), todo.id.to_string()),
                (
                    "BOOMERANG_TODO_DISPLAY_ID".to_string(),
                    todo.display_id.clone(),
                ),
            ],
            wsl_enabled: project.terminal_wsl_enabled,
            cols: 100,
            rows: 28,
        },
    )?;
    let session = state
        .create_agent_session(NewAgentSession {
            todo_id: todo.id,
            conversation_id,
            provider: input.provider,
            provider_session_id,
            pty_id,
            command: process.display,
            working_directory,
        })
        .map_err(command_error)?;
    emit_todo_changed(&app, todo.id, "agent_session_started")?;
    state
        .app_snapshot(Some(project.id), Some(todo.id))
        .map_err(|err| format!("session {} created but snapshot failed: {err}", session.id))
}

// `async` so the PTY spawn (openpty + fork/exec) and DB writes run off the
// main thread instead of freezing the UI event loop while the shell launches.
#[tauri::command(async)]
pub fn start_execution_terminal(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: StartExecutionTerminalCommand,
) -> Result<ExecutionTerminalSummary, String> {
    start_execution_terminal_from_app(&app, &state, &pty, input)
}

pub fn start_execution_terminal_from_app(
    app: &AppHandle,
    state: &AppDb,
    pty: &PtyState,
    input: StartExecutionTerminalCommand,
) -> Result<ExecutionTerminalSummary, String> {
    let todo = state.get_todo(input.todo_id).map_err(command_error)?;
    let project = state.get_project(todo.project_id).map_err(command_error)?;
    let settings = state.app_settings().map_err(command_error)?;
    let working_directory = state
        .todo_working_directory(todo.id)
        .map_err(command_error)?;
    let terminal_wsl_active = project_terminal_wsl_active(project.terminal_wsl_enabled);
    let working_directory_path = expand_home_alias(&working_directory);
    if !terminal_wsl_active && !working_directory_path.is_dir() {
        return Err(format!(
            "project folder does not exist: {}",
            working_directory_path.display()
        ));
    }
    let working_directory = working_directory_path.display().to_string();
    let kind = normalized_execution_terminal_kind(&input.kind)?;
    let conversation_id = if matches!(kind.as_str(), "terminal" | "omp" | "codex" | "claude") {
        None
    } else {
        Some(format!("boomerang-{}", uuid::Uuid::new_v4()))
    };
    let provider_session_id: Option<String> = None;
    let agent_prompt = agent_prompt_for_execution(
        &kind,
        &todo.display_id,
        &todo.title,
        input.prompt.as_deref().unwrap_or_default(),
    );
    let process_working_directory = if terminal_wsl_active {
        "."
    } else {
        working_directory.as_str()
    };
    let process = if kind == "terminal" && terminal_wsl_active {
        wsl_default_shell_process_command(&working_directory)
    } else if matches!(kind.as_str(), "omp" | "codex" | "claude") {
        build_execution_process_command(
            &settings,
            &kind,
            process_working_directory,
            input
                .resume_session_id
                .is_none()
                .then_some(agent_prompt.as_str()),
            input.resume_session_id.as_deref(),
        )?
    } else if let Some(conversation_id) = conversation_id.as_deref() {
        build_agent_process_command(
            &settings,
            &kind,
            process_working_directory,
            conversation_id,
            &agent_prompt,
        )?
    } else {
        build_execution_process_command(&settings, &kind, process_working_directory, None, None)?
    };
    let mut env = vec![
        ("BOOMERANG_PROJECT_ID".to_string(), project.id.to_string()),
        ("BOOMERANG_PROJECT_NAME".to_string(), project.name.clone()),
        (
            "BOOMERANG_PROJECT_DIR".to_string(),
            working_directory.clone(),
        ),
        ("BOOMERANG_TODO_ID".to_string(), todo.id.to_string()),
        (
            "BOOMERANG_TODO_DISPLAY_ID".to_string(),
            todo.display_id.clone(),
        ),
        (
            "BOOMERANG_MCP_PORT".to_string(),
            settings.mcp_port.to_string(),
        ),
        (
            "BOOMERANG_MCP_TOKEN".to_string(),
            settings.mcp_token.clone(),
        ),
        ("BOOMERANG_BIN".to_string(), current_binary_path()),
    ];
    if let Some(conversation_id) = conversation_id.as_deref() {
        env.push((
            "BOOMERANG_CONVERSATION_ID".to_string(),
            conversation_id.to_string(),
        ));
    }
    if let Some(provider_session_id) = provider_session_id.as_deref() {
        env.push((
            "BOOMERANG_PROVIDER_SESSION_ID".to_string(),
            provider_session_id.to_string(),
        ));
    }
    let pty_id = pty.spawn_process(
        app,
        PtySpawnSpec {
            program: process.program.clone(),
            args: process.args.clone(),
            cwd: working_directory.clone(),
            env,
            wsl_enabled: project.terminal_wsl_enabled,
            cols: 100,
            rows: 30,
        },
    )?;

    let terminal = state
        .record_execution_terminal(todo.id, pty_id, &kind, execution_terminal_label(&kind))
        .map_err(command_error)?;
    if let Some(conversation_id) = conversation_id {
        state
            .create_agent_session(NewAgentSession {
                todo_id: todo.id,
                conversation_id,
                provider: kind.clone(),
                provider_session_id,
                pty_id,
                command: process.display,
                working_directory,
            })
            .map_err(command_error)?;
    }
    if kind == "omp" && input.resume_session_id.is_none() {
        spawn_omp_session_bootstrap(app.clone(), todo.id, pty_id, agent_prompt);
    } else if (kind == "codex" || kind == "claude") && input.resume_session_id.is_none() {
        spawn_provider_status_bootstrap(app.clone(), todo.id, pty_id, kind.clone(), agent_prompt);
    }
    emit_todo_changed(app, todo.id, "execution_terminal_started")?;
    Ok(terminal)
}

pub fn agent_prompt_for_execution(
    _kind: &str,
    _display_id: &str,
    _title: &str,
    prompt: &str,
) -> String {
    prompt.to_string()
}

fn spawn_omp_session_bootstrap(app: AppHandle, todo_id: i64, pty_id: i64, prompt: String) {
    let _ = thread::Builder::new()
        .name(format!("boomerang-omp-session-bootstrap-{pty_id}"))
        .spawn(move || {
            let mut session_requested = false;
            for _ in 0..PROVIDER_LOAD_POLL_ATTEMPTS {
                thread::sleep(PROVIDER_POLL_INTERVAL);
                let Some(pty) = app.try_state::<PtyState>() else {
                    return;
                };
                let Ok(scrollback) = pty.scrollback(pty_id) else {
                    return;
                };
                let Ok(bytes) = STANDARD.decode(scrollback.data.as_bytes()) else {
                    continue;
                };
                let text = String::from_utf8_lossy(&bytes);
                if !omp_loaded_from_output(&text) {
                    continue;
                }

                let _ = pty.write_text(pty_id, omp_session_command_input());
                session_requested = true;
                break;
            }

            for _ in 0..PROVIDER_SESSION_POLL_ATTEMPTS {
                thread::sleep(PROVIDER_POLL_INTERVAL);
                let Some(pty) = app.try_state::<PtyState>() else {
                    return;
                };
                let Ok(scrollback) = pty.scrollback(pty_id) else {
                    return;
                };
                let Ok(bytes) = STANDARD.decode(scrollback.data.as_bytes()) else {
                    continue;
                };
                let text = String::from_utf8_lossy(&bytes);
                let Some(session_id) = omp_session_id_from_output(&text) else {
                    continue;
                };

                if let Some(db) = app.try_state::<AppDb>() {
                    if db
                        .record_todo_provider_session_id(todo_id, "omp", &session_id)
                        .is_ok()
                    {
                        let _ = app.emit(
                            "todos:changed",
                            serde_json::json!({
                                "todoId": todo_id,
                                "changeType": "provider_session_saved",
                            }),
                        );
                    }
                }
                if let Some(pty) = app.try_state::<PtyState>() {
                    write_provider_prompt_submit(&pty, pty_id, &prompt);
                }
                return;
            }
            if session_requested {
                if let Some(pty) = app.try_state::<PtyState>() {
                    write_provider_session_discovery_timeout(&pty, pty_id, "omp", &prompt, true);
                }
            }
        });
}

fn spawn_provider_status_bootstrap(
    app: AppHandle,
    todo_id: i64,
    pty_id: i64,
    provider: String,
    prompt: String,
) {
    let thread_name = format!("boomerang-{provider}-status-bootstrap-{pty_id}");
    let _ = thread::Builder::new().name(thread_name).spawn(move || {
        let mut status_requested = false;
        let mut first_load_prompt_acknowledged = false;
        for _ in 0..PROVIDER_LOAD_POLL_ATTEMPTS {
            thread::sleep(PROVIDER_POLL_INTERVAL);
            let Some(pty) = app.try_state::<PtyState>() else {
                return;
            };
            let Ok(scrollback) = pty.scrollback(pty_id) else {
                return;
            };
            let Ok(bytes) = STANDARD.decode(scrollback.data.as_bytes()) else {
                continue;
            };
            let text = String::from_utf8_lossy(&bytes);
            if !first_load_prompt_acknowledged {
                if let Some(input) = provider_first_load_prompt_ack_input(&provider, &text) {
                    let _ = pty.write_text(pty_id, input);
                    first_load_prompt_acknowledged = true;
                    continue;
                }
            }
            if !managed_cli_loaded_from_output(&text) {
                continue;
            }

            thread::sleep(Duration::from_millis(500));
            for input in provider_status_command_writes() {
                let _ = pty.write_text(pty_id, input);
                if input != "\r" {
                    thread::sleep(PROVIDER_COMMAND_ENTER_DELAY);
                }
            }
            status_requested = true;
            break;
        }

        for _ in 0..PROVIDER_SESSION_POLL_ATTEMPTS {
            thread::sleep(PROVIDER_POLL_INTERVAL);
            let Some(pty) = app.try_state::<PtyState>() else {
                return;
            };
            let Ok(scrollback) = pty.scrollback(pty_id) else {
                return;
            };
            let Ok(bytes) = STANDARD.decode(scrollback.data.as_bytes()) else {
                continue;
            };
            let text = String::from_utf8_lossy(&bytes);
            let session_id = match provider.as_str() {
                "claude" => claude_status_session_id_from_output(&text),
                "codex" => codex_status_session_id_from_output(&text),
                _ => None,
            };
            let Some(session_id) = session_id else {
                continue;
            };

            if let Some(db) = app.try_state::<AppDb>() {
                if db
                    .record_todo_provider_session_id(todo_id, &provider, &session_id)
                    .is_ok()
                {
                    let _ = app.emit(
                        "todos:changed",
                        serde_json::json!({
                            "todoId": todo_id,
                            "changeType": "provider_session_saved",
                        }),
                    );
                }
            }
            if provider == "claude" {
                let _ = pty.write_text(pty_id, claude_status_close_input());
                thread::sleep(CLAUDE_STATUS_CLOSE_DELAY);
            }
            write_provider_prompt_submit(&pty, pty_id, &prompt);
            return;
        }
        if status_requested {
            if let Some(pty) = app.try_state::<PtyState>() {
                write_provider_session_discovery_timeout(&pty, pty_id, &provider, &prompt, true);
            }
        }
    });
}

fn write_provider_prompt_submit(pty: &PtyState, pty_id: i64, prompt: &str) {
    for input in provider_prompt_submit_writes(prompt) {
        let _ = pty.write_text(pty_id, &input);
        if input != "\r" {
            thread::sleep(PROVIDER_PROMPT_SUBMIT_DELAY);
        }
    }
}

fn write_provider_session_discovery_timeout(
    pty: &PtyState,
    pty_id: i64,
    provider: &str,
    prompt: &str,
    discovery_command_sent: bool,
) {
    for input in provider_session_discovery_timeout_writes(provider, prompt, discovery_command_sent)
    {
        let _ = pty.write_text(pty_id, &input);
        if input == claude_status_close_input() {
            thread::sleep(CLAUDE_STATUS_CLOSE_DELAY);
        } else if input != "\r" {
            thread::sleep(PROVIDER_PROMPT_SUBMIT_DELAY);
        }
    }
}

// `async` keeps the process kill off the main thread. Returns no snapshot:
// the caller already removed the tab optimistically, and the emitted
// `todos:changed` event drives the (coalesced) refetch for every window, so
// rebuilding and shipping a full snapshot here was pure duplicate work (B-252).
#[tauri::command(async)]
pub fn close_execution_terminal(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: CloseExecutionTerminalCommand,
) -> Result<(), String> {
    let terminal = state
        .close_execution_terminal_for_pty(input.pty_id)
        .map_err(command_error)?;
    let _ = pty.close(input.pty_id);
    if let Some(terminal) = terminal {
        emit_todo_changed(&app, terminal.todo_id, "execution_terminal_closed")?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_execution_terminal(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: RenameExecutionTerminalCommand,
) -> Result<AppSnapshot, String> {
    let terminal = state
        .rename_execution_terminal(input.pty_id, &input.label)
        .map_err(command_error)?;
    if let Some(terminal) = terminal {
        emit_todo_changed(&app, terminal.todo_id, "execution_terminal_renamed")?;
        state
            .app_snapshot(None, Some(terminal.todo_id))
            .map_err(command_error)
    } else {
        app_snapshot_from_db(&state, None, None)
    }
}

#[tauri::command]
pub fn stop_agent_session(
    app: AppHandle,
    state: State<'_, AppDb>,
    pty: State<'_, PtyState>,
    input: StopAgentSessionCommand,
) -> Result<AppSnapshot, String> {
    let pty_id = state
        .agent_session_pty_id(&input.session_id)
        .map_err(command_error)?;
    let todo_id = state
        .stop_agent_session(
            &input.session_id,
            Actor {
                actor_type: "human".to_string(),
                actor_name: "Mark".to_string(),
            },
        )
        .map_err(command_error)?;
    if let Some(pty_id) = pty_id {
        let _ = pty.close(pty_id);
    }
    emit_todo_changed(&app, todo_id, "agent_session_stopped")?;
    state.app_snapshot(None, Some(todo_id)).map_err(|err| {
        format!(
            "session {} stopped but snapshot failed: {err}",
            input.session_id
        )
    })
}

#[tauri::command]
pub fn save_editor_image(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SaveEditorImageCommand,
) -> Result<SaveEditorImageResult, String> {
    let project = state.get_project(input.project_id).map_err(command_error)?;
    let extension = image_extension(&input.mime_type, &input.file_name)?;
    let base64_data = input
        .base64_data
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(input.base64_data.as_str());
    let bytes = STANDARD
        .decode(base64_data.trim())
        .map_err(|err| format!("image data is not valid base64: {err}"))?;
    if bytes.is_empty() {
        return Err("image data is empty".to_string());
    }
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("image is larger than 20 MB".to_string());
    }

    let app_data_dir = app.path().app_data_dir().map_err(command_error)?;
    let mut directory = app_data_dir
        .join("attachments")
        .join(format!("project-{}", project.id));
    match input.scope.as_str() {
        "project-notes" => {
            directory = directory.join("project-notes");
        }
        "todo-description" | "todo-artifact" | "message" => {
            let todo_id = input
                .todo_id
                .ok_or_else(|| "todoId is required for todo attachments".to_string())?;
            let todo = state.get_todo(todo_id).map_err(command_error)?;
            if todo.project_id != project.id {
                return Err("todo does not belong to project".to_string());
            }
            directory = if input.scope == "todo-artifact" {
                todo_artifact_attachment_directory(&app_data_dir, project.id, &todo.display_id)
            } else {
                todo_attachment_directory(&app_data_dir, project.id, &todo.display_id)
            };
        }
        other => return Err(format!("unknown attachment scope: {other}")),
    }

    fs::create_dir_all(&directory).map_err(|err| {
        format!(
            "cannot create attachment directory {}: {err}",
            directory.display()
        )
    })?;
    let path = directory.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    fs::write(&path, bytes)
        .map_err(|err| format!("cannot write attachment {}: {err}", path.display()))?;

    Ok(SaveEditorImageResult {
        absolute_path: path.display().to_string(),
        markdown_path: home_aliased_path(&path),
    })
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: CreateProjectCommand,
) -> Result<AppSnapshot, String> {
    let snapshot = create_project_in_db(&state, input)?;
    emit_project_changed(&app, snapshot.selected_project_id, "project_created")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn link_project(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: LinkProjectCommand,
) -> Result<AppSnapshot, String> {
    let parent_project_id = input.parent_project_id;
    let snapshot = link_project_in_db(&state, input)?;
    emit_project_changed(&app, parent_project_id, "project_linked")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn unlink_project(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UnlinkProjectCommand,
) -> Result<AppSnapshot, String> {
    let parent_project_id = input.parent_project_id;
    let snapshot = unlink_project_in_db(&state, input)?;
    emit_project_changed(&app, parent_project_id, "project_unlinked")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn reorder_project_link(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ReorderProjectLinkCommand,
) -> Result<AppSnapshot, String> {
    let parent_project_id = input.parent_project_id;
    let snapshot = reorder_project_link_in_db(&state, input)?;
    emit_project_changed(&app, parent_project_id, "project_link_reordered")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_project_status(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateProjectStatusCommand,
) -> Result<AppSnapshot, String> {
    let project_id = input.project_id;
    let snapshot = update_project_status_in_db(&state, input)?;
    emit_project_changed(&app, project_id, "project_status_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn create_todo(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: CreateTodoCommand,
) -> Result<AppSnapshot, String> {
    let (snapshot, pending_title_generation) =
        create_todo_in_db_with_pending_title_generation(&state, input)?;
    emit_todo_changed(&app, snapshot.selected_todo_id, "todo_created")?;
    if let Some(pending) = pending_title_generation {
        spawn_background_task_title_generation(app, pending);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn generate_todo_title(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: GenerateTodoTitleCommand,
) -> Result<(), String> {
    let pending = manual_title_generation_request(&state, input.todo_id)?;
    spawn_background_task_title_generation(app, pending);
    Ok(())
}

#[tauri::command]
pub fn reorder_todo(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ReorderTodoCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = reorder_todo_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "todo_reordered")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn link_todo(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: LinkTodoCommand,
) -> Result<AppSnapshot, String> {
    let target_parent_todo_id = input.target_parent_todo_id;
    let snapshot = link_todo_in_db(&state, input)?;
    emit_todo_changed(&app, target_parent_todo_id, "todo_linked")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn delete_todo(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: DeleteTodoCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let app_data_dir = app.path().app_data_dir().map_err(command_error)?;
    let snapshot = delete_todo_with_attachment_cleanup(&state, input, &app_data_dir)?;
    emit_todo_changed(&app, todo_id, "todo_deleted")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn start_timer(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: StartTimerCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = start_timer_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "timer_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn stop_timer(app: AppHandle, state: State<'_, AppDb>) -> Result<AppSnapshot, String> {
    let (snapshot, stopped_todo_id) = stop_timer_with_changed_todo(&state)?;
    if let Some(todo_id) = stopped_todo_id {
        emit_todo_changed(&app, todo_id, "timer_changed")?;
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn add_todo_dependency(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: AddTodoDependencyCommand,
) -> Result<AppSnapshot, String> {
    let snapshot = add_todo_dependency_in_db(&state, input)?;
    emit_todo_changed(&app, snapshot.selected_todo_id, "dependency_added")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn remove_todo_dependency(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: RemoveTodoDependencyCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = remove_todo_dependency_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "dependency_removed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn create_subtask(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: CreateSubtaskCommand,
) -> Result<AppSnapshot, String> {
    let parent_id = input.parent_todo_id;
    let snapshot = create_subtask_in_db(&state, input)?;
    emit_todo_changed(&app, parent_id, "subtask_created")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn add_manual_time_log(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: AddManualTimeLogCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = add_manual_time_log_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "time_log_added")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn update_time_log_duration(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTimeLogDurationCommand,
) -> Result<AppSnapshot, String> {
    let snapshot = update_time_log_duration_in_db(&state, input)?;
    emit_todo_changed(&app, snapshot.selected_todo_id, "time_log_updated")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn delete_time_log(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: DeleteTimeLogCommand,
) -> Result<AppSnapshot, String> {
    let snapshot = delete_time_log_in_db(&state, input)?;
    emit_todo_changed(&app, snapshot.selected_todo_id, "time_log_deleted")?;
    Ok(snapshot)
}

pub fn app_snapshot_from_db(
    db: &AppDb,
    project_id: Option<i64>,
    todo_id: Option<i64>,
) -> Result<AppSnapshot, String> {
    db.app_snapshot(project_id, todo_id).map_err(command_error)
}

pub fn load_app_settings_from_db(db: &AppDb) -> Result<AppSettingsSummary, String> {
    db.app_settings().map_err(command_error)
}

pub fn update_app_settings_in_db(
    db: &AppDb,
    input: UpdateAppSettingsCommand,
) -> Result<AppSettingsSummary, String> {
    db.update_app_settings(
        input.mcp_enabled,
        &input.theme,
        &input.claude_path,
        &input.codex_path,
        &input.task_titler,
        input.deep_link_fallback,
        input.home_project_id,
        input.project_accent_border_width,
        input.slowdown_profiler_enabled,
        input.terminal_tmux_enabled,
        &input.external_terminal_openers,
        &input.folder_open_app,
        &input.app_context_markdown,
        &input.markdown_editor_font_family,
        &input.markdown_editor_font_size,
        &input.markdown_editor_max_image_height,
    )
    .map_err(command_error)
}

pub fn regenerate_mcp_token_in_db(db: &AppDb) -> Result<AppSettingsSummary, String> {
    db.regenerate_mcp_token().map_err(command_error)
}

pub fn set_task_details_rail_hidden_in_db(
    db: &AppDb,
    input: SetTaskDetailsRailHiddenCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_task_details_rail_hidden(input.hidden)
        .map_err(command_error)
}

pub fn set_task_list_width_in_db(
    db: &AppDb,
    input: SetTaskListWidthCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_task_list_width(input.width).map_err(command_error)
}

pub fn set_task_list_accordion_state_in_db(
    db: &AppDb,
    input: SetTaskListAccordionStateCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_task_list_accordion_state(
        input.collapsed_project_ids,
        input.collapsed_subproject_ids,
        input.collapsed_todo_ids,
    )
    .map_err(command_error)
}

pub fn set_task_detail_description_width_in_db(
    db: &AppDb,
    input: SetTaskDetailDescriptionWidthCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_task_detail_description_width(input.width)
        .map_err(command_error)
}

pub fn set_markdown_editor_mode_in_db(
    db: &AppDb,
    input: SetMarkdownEditorModeCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_markdown_editor_mode(&input.mode)
        .map_err(command_error)
}

pub fn set_markdown_toc_hidden_in_db(
    db: &AppDb,
    input: SetMarkdownTocHiddenCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_markdown_toc_hidden(input.hidden)
        .map_err(command_error)
}

pub fn set_markdown_toc_width_in_db(
    db: &AppDb,
    input: SetMarkdownTocWidthCommand,
) -> Result<AppSettingsSummary, String> {
    db.set_markdown_toc_width(&input.target, input.width)
        .map_err(command_error)
}

pub fn create_project_in_db(
    db: &AppDb,
    input: CreateProjectCommand,
) -> Result<AppSnapshot, String> {
    let name = required_command_text("project name", &input.name)?;
    let working_directory = if input.inherit_parent && input.parent_project_id.is_some() {
        String::new()
    } else {
        required_command_text("working directory", &input.working_directory)?
    };
    let display_id_prefix = required_command_text("display id prefix", &input.display_id_prefix)?
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    if display_id_prefix.is_empty() {
        return Err("display id prefix is required".to_string());
    }
    if db
        .display_id_prefix_exists(&display_id_prefix)
        .map_err(command_error)?
    {
        return Err(format!(
            "display id prefix already exists: {display_id_prefix}"
        ));
    }

    let project = db
        .create_project(NewProject {
            name,
            working_directory,
            display_id_prefix,
            actions_directory: "actions".to_string(),
            parent_project_id: input.parent_project_id,
            inherit_parent: input.inherit_parent,
        })
        .map_err(command_error)?;
    db.app_snapshot(Some(project.id), None)
        .map_err(command_error)
}

pub fn link_project_in_db(db: &AppDb, input: LinkProjectCommand) -> Result<AppSnapshot, String> {
    db.link_project(input.parent_project_id, input.child_project_id)
        .map_err(command_error)?;
    db.app_snapshot(Some(input.parent_project_id), None)
        .map_err(command_error)
}

pub fn unlink_project_in_db(
    db: &AppDb,
    input: UnlinkProjectCommand,
) -> Result<AppSnapshot, String> {
    db.unlink_project(input.parent_project_id, input.child_project_id)
        .map_err(command_error)?;
    db.app_snapshot(Some(input.parent_project_id), None)
        .map_err(command_error)
}

pub fn reorder_project_link_in_db(
    db: &AppDb,
    input: ReorderProjectLinkCommand,
) -> Result<AppSnapshot, String> {
    db.reorder_project_link(
        input.parent_project_id,
        input.child_project_id,
        input.new_index,
    )
    .map_err(command_error)?;
    db.app_snapshot(Some(input.parent_project_id), None)
        .map_err(command_error)
}

pub fn update_project_status_in_db(
    db: &AppDb,
    input: UpdateProjectStatusCommand,
) -> Result<AppSnapshot, String> {
    db.update_project_status(input.project_id, &input.status)
        .map_err(command_error)?;
    db.app_snapshot(Some(input.project_id), None)
        .map_err(command_error)
}

pub fn build_agent_process_command(
    settings: &AppSettingsSummary,
    provider: &str,
    cwd: &str,
    conversation_id: &str,
    prompt: &str,
) -> Result<ProcessCommandSpec, String> {
    let cwd = required_command_text("working directory", cwd)?;
    let conversation_id = required_command_text("conversation id", conversation_id)?;
    let prompt = required_command_text("prompt", prompt)?;
    let provider_key = provider.trim().to_lowercase();
    let prompt = agent_prompt_with_session_context(&prompt, &conversation_id, None);

    let (program, mut args) = match provider_key.as_str() {
        "claude" => {
            let args = vec!["--dangerously-skip-permissions".to_string()];
            (
                required_command_text("Claude path", &settings.claude_path)?,
                args,
            )
        }
        "codex" => {
            let mut args = vec!["--yolo".to_string()];
            args.push("--cd".to_string());
            args.push(cwd.to_string());
            (
                required_command_text("Codex path", &settings.codex_path)?,
                args,
            )
        }
        other => return Err(format!("unknown agent provider: {other}")),
    };
    args.push(prompt);

    Ok(ProcessCommandSpec {
        display: shell_join(&program, &args),
        program,
        args,
        cwd,
    })
}

pub fn build_execution_process_command(
    settings: &AppSettingsSummary,
    kind: &str,
    cwd: &str,
    prompt: Option<&str>,
    resume_session_id: Option<&str>,
) -> Result<ProcessCommandSpec, String> {
    let cwd = required_command_text("working directory", cwd)?;
    let kind = normalized_execution_terminal_kind(kind)?;

    let (program, args) = match kind.as_str() {
        "terminal" => default_shell_process(&cwd)?,
        "codex" => {
            let mut args = vec!["--yolo".to_string()];
            if let Some(resume_session_id) = resume_session_id {
                args.push("resume".to_string());
                args.push(required_command_text(
                    "Codex session id",
                    resume_session_id,
                )?);
            } else {
                let _ = required_command_text("prompt", prompt.unwrap_or_default())?;
                args.push("--cd".to_string());
                args.push(cwd.clone());
            }
            (
                required_command_text("Codex path", &settings.codex_path)?,
                args,
            )
        }
        "claude" => {
            let mut args = vec!["--dangerously-skip-permissions".to_string()];
            if let Some(resume_session_id) = resume_session_id {
                args.push("--resume".to_string());
                args.push(required_command_text(
                    "Claude session id",
                    resume_session_id,
                )?);
            } else {
                let _ = required_command_text("prompt", prompt.unwrap_or_default())?;
            }
            (
                required_command_text("Claude path", &settings.claude_path)?,
                args,
            )
        }
        "omp" => {
            let mut args = vec!["--yolo".to_string()];
            if let Some(resume_session_id) = resume_session_id {
                args.push("--resume".to_string());
                args.push(required_command_text("OMP session id", resume_session_id)?);
            } else {
                let _ = required_command_text("prompt", prompt.unwrap_or_default())?;
            }
            ("omp".to_string(), args)
        }
        other => return Err(format!("unknown execution terminal kind: {other}")),
    };

    Ok(ProcessCommandSpec {
        display: shell_join(&program, &args),
        program,
        args,
        cwd,
    })
}

pub fn build_worktree_diff_process_command(
    worktree_dir: &str,
    main_branch: &str,
) -> Result<ProcessCommandSpec, String> {
    let worktree_dir = required_command_text("worktree directory", worktree_dir)?;
    let main_branch = required_command_text("main branch", main_branch)?;
    let worktree_dir = expand_home_alias(&worktree_dir).display().to_string();
    let diff_range = format!("{main_branch}..HEAD");
    let script = [
        "set -euo pipefail".to_string(),
        format!(
            "echo {}",
            shell_script_arg(&format!("Diff range: {diff_range}"))
        ),
        format!(
            "git -C {} diff {}",
            shell_script_arg(&worktree_dir),
            shell_script_arg(&diff_range)
        ),
    ]
    .join("\n");

    Ok(ProcessCommandSpec {
        display: script.clone(),
        program: "bash".to_string(),
        args: vec!["-lc".to_string(), script],
        cwd: worktree_dir,
    })
}

pub fn build_worktree_merge_process_command(
    project_dir: &str,
    worktree_dir: &str,
    worktree_branch: &str,
    main_branch: &str,
    commit_message: &str,
) -> Result<ProcessCommandSpec, String> {
    let project_dir = required_command_text("project directory", project_dir)?;
    let worktree_dir = required_command_text("worktree directory", worktree_dir)?;
    let worktree_branch = required_command_text("worktree branch", worktree_branch)?;
    let main_branch = required_command_text("main branch", main_branch)?;
    let commit_message = required_command_text("commit message", commit_message)?;
    let project_dir = expand_home_alias(&project_dir).display().to_string();
    let worktree_dir = expand_home_alias(&worktree_dir).display().to_string();
    let no_upstream_message =
        format!("No upstream configured for {main_branch}; using local {main_branch}.");
    let script = [
        "set -euo pipefail".to_string(),
        format!("git -C {} add -A", shell_script_arg(&worktree_dir)),
        format!(
            "if ! git -C {} diff --cached --quiet; then git -C {} commit -m {}; else echo \"No staged changes to commit.\"; fi",
            shell_script_arg(&worktree_dir),
            shell_script_arg(&worktree_dir),
            shell_script_arg(&commit_message)
        ),
        format!("git -C {} fetch --all --prune", shell_script_arg(&project_dir)),
        format!(
            "git -C {} checkout {}",
            shell_script_arg(&project_dir),
            shell_script_arg(&main_branch)
        ),
        format!(
            "if git -C {} rev-parse --abbrev-ref --symbolic-full-name '@{{u}}' >/dev/null 2>&1; then git -C {} pull --ff-only; else echo {}; fi",
            shell_script_arg(&project_dir),
            shell_script_arg(&project_dir),
            shell_script_arg(&no_upstream_message)
        ),
        format!(
            "git -C {} rebase {}",
            shell_script_arg(&worktree_dir),
            shell_script_arg(&main_branch)
        ),
        format!(
            "git -C {} merge --squash --ff {}",
            shell_script_arg(&project_dir),
            shell_script_arg(&worktree_branch)
        ),
        format!(
            "if ! git -C {} diff --cached --quiet; then git -C {} commit -m {}; else echo \"No squash changes to commit.\"; fi",
            shell_script_arg(&project_dir),
            shell_script_arg(&project_dir),
            shell_script_arg(&commit_message)
        ),
    ]
    .join("\n");

    Ok(ProcessCommandSpec {
        display: script.clone(),
        program: "bash".to_string(),
        args: vec!["-lc".to_string(), script],
        cwd: project_dir,
    })
}

fn shell_script_arg(value: &str) -> String {
    if value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '/' | '.' | ':' | '=')
    }) {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn agent_prompt_with_session_context(
    prompt: &str,
    conversation_id: &str,
    provider_session_id: Option<&str>,
) -> String {
    let mut next = prompt.trim().to_string();
    next.push_str("\n\nBoomerang session context:\n");
    next.push_str(&format!("- Boomerang conversation ID: {conversation_id}\n"));
    if let Some(provider_session_id) = provider_session_id {
        next.push_str(&format!("- Provider session ID: {provider_session_id}\n"));
    }
    next
}

pub fn omp_session_command_input() -> &'static str {
    "/session\r"
}

pub fn provider_status_command_writes() -> [&'static str; 2] {
    ["/status", "\r"]
}

pub fn claude_status_close_input() -> &'static str {
    "\u{1b}"
}

pub fn provider_first_load_prompt_ack_input(provider: &str, output: &str) -> Option<&'static str> {
    if provider.eq_ignore_ascii_case("codex") && codex_first_load_trust_prompt_from_output(output) {
        Some("\r")
    } else {
        None
    }
}

pub fn codex_first_load_trust_prompt_from_output(output: &str) -> bool {
    let normalized = strip_ansi_sequences(output)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

    normalized.contains("do you trust the contents of this directory?")
        && normalized.contains("working with untrusted contents")
}

pub fn provider_prompt_submit_writes(prompt: &str) -> Vec<String> {
    vec![prompt.to_string(), "\r".to_string()]
}

pub fn provider_session_discovery_timeout_writes(
    provider: &str,
    prompt: &str,
    discovery_command_sent: bool,
) -> Vec<String> {
    if !discovery_command_sent {
        return Vec::new();
    }

    let mut writes = Vec::new();
    if provider.eq_ignore_ascii_case("claude") {
        writes.push(claude_status_close_input().to_string());
    }
    writes.extend(provider_prompt_submit_writes(prompt));
    writes
}

pub fn omp_loaded_from_output(output: &str) -> bool {
    managed_cli_loaded_from_output(output)
}

fn managed_cli_loaded_from_output(output: &str) -> bool {
    // ╰ closes the banner/input box Codex and OMP draw. Claude Code 2.x draws
    // no box at all in projects with existing history; its readiness signal is
    // the ❯ composer caret (Codex uses › and never emits ❯).
    strip_ansi_sequences(output).contains(['╰', '❯'])
}

pub fn omp_session_id_from_output(output: &str) -> Option<String> {
    let output = strip_ansi_sequences(output);
    let mut in_session_info = false;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("Session Info") {
            in_session_info = true;
            continue;
        }
        if !in_session_info {
            continue;
        }
        if trimmed.eq_ignore_ascii_case("Provider") {
            break;
        }
        let Some((label, value)) = trimmed.split_once(':') else {
            continue;
        };
        let label = label.trim().to_ascii_lowercase();
        if label != "id" && label != "session id" {
            continue;
        }
        let session_id = value
            .split_whitespace()
            .next()
            .map(|value| {
                value.trim_matches(|character: char| character == '"' || character == '\'')
            })
            .filter(|value| is_omp_session_id(value))?;
        return Some(session_id.to_string());
    }

    None
}

pub fn codex_status_session_id_from_output(output: &str) -> Option<String> {
    session_id_from_labeled_output(output, &["session"])
}

pub fn claude_status_session_id_from_output(output: &str) -> Option<String> {
    session_id_from_labeled_output(output, &["session id"])
}

fn session_id_from_labeled_output(output: &str, labels: &[&str]) -> Option<String> {
    let output = strip_ansi_sequences(output);
    // Split on \r as well as \n: Claude Code 2.x draws its /status screen as a
    // full-screen dialog whose stream carries no \n at all.
    for line in output.split(['\n', '\r']) {
        let Some((label, value)) = line.trim().split_once(':') else {
            continue;
        };
        let label = label
            .trim()
            .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != ' ')
            .trim()
            .to_ascii_lowercase();
        if !labels.iter().any(|candidate| *candidate == label) {
            continue;
        }
        let session_id = value
            .split_whitespace()
            .next()
            .map(|value| {
                value.trim_matches(|character: char| character == '"' || character == '\'')
            })
            .filter(|value| is_provider_session_id(value))?;
        return Some(session_id.to_string());
    }

    None
}

fn is_omp_session_id(value: &str) -> bool {
    is_provider_session_id(value)
}

fn is_provider_session_id(value: &str) -> bool {
    value.len() >= 16
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn strip_ansi_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\u{1b}' {
            output.push(character);
            continue;
        }

        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    output
}

fn normalized_execution_terminal_kind(kind: &str) -> Result<String, String> {
    let normalized = kind.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "terminal" | "codex" | "claude" | "omp" | "worktree_merge" => Ok(normalized),
        other => Err(format!("unknown execution terminal kind: {other}")),
    }
}

fn execution_terminal_label(kind: &str) -> &'static str {
    match kind {
        "codex" => "Codex CLI",
        "claude" => "Claude Code CLI",
        "omp" => "OMP",
        "worktree_merge" => "Commit & Merge",
        _ => "Terminal",
    }
}

fn default_shell_process(cwd: &str) -> Result<(String, Vec<String>), String> {
    let _cwd = required_command_text("working directory", cwd)?;
    #[cfg(target_os = "windows")]
    {
        let program = crate::pty::windows_terminal_shell_path();
        let shell_name = program
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase())
            .unwrap_or_default();
        let args = if shell_name == "pwsh.exe" || shell_name == "powershell.exe" {
            vec!["-NoLogo".to_string()]
        } else {
            vec![]
        };
        Ok((
            required_command_text("shell path", &program.display().to_string())?,
            args,
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let program = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Ok((required_command_text("shell path", &program)?, vec![]))
    }
}

fn project_terminal_wsl_active(terminal_wsl_enabled: bool) -> bool {
    terminal_wsl_enabled && cfg!(windows)
}

fn wsl_default_shell_process_command(cwd: &str) -> ProcessCommandSpec {
    ProcessCommandSpec {
        program: String::new(),
        args: vec![],
        cwd: cwd.to_string(),
        display: "wsl default shell".to_string(),
    }
}

fn shell_join(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string())
        .chain(args.iter().map(|arg| {
            if arg.chars().all(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '-' | '_' | '/' | '.' | ':' | '=')
            }) {
                arg.clone()
            } else {
                format!("{arg:?}")
            }
        }))
        .collect::<Vec<_>>()
        .join(" ")
}

fn required_command_text(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }

    Ok(trimmed.to_string())
}

fn image_extension(mime_type: &str, file_name: &str) -> Result<&'static str, String> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Ok("png"),
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        _ => match Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("png") => Ok("png"),
            Some("jpg") | Some("jpeg") => Ok("jpg"),
            Some("gif") => Ok("gif"),
            Some("webp") => Ok("webp"),
            _ => Err(format!("unsupported image type: {mime_type}")),
        },
    }
}

fn todo_attachment_directory(app_data_dir: &Path, project_id: i64, display_id: &str) -> PathBuf {
    app_data_dir
        .join("attachments")
        .join(format!("project-{project_id}"))
        .join(display_id)
}

fn todo_artifact_attachment_directory(
    app_data_dir: &Path,
    project_id: i64,
    display_id: &str,
) -> PathBuf {
    app_data_dir
        .join("attachments")
        .join(format!("project-{project_id}"))
        .join("artifacts")
        .join(display_id)
}

pub fn update_todo_state_in_db(
    db: &AppDb,
    input: UpdateTodoStateCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_state(UpdateTodoState {
        todo_id: input.todo_id,
        state: input.state,
        actor: Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
        message: input.message,
        conversation_id: input.conversation_id,
        link: input.link,
    })
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_todo_priority_in_db(
    db: &AppDb,
    input: UpdateTodoPriorityCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_priority(
        input.todo_id,
        &input.priority,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_todo_context_project_in_db(
    db: &AppDb,
    input: UpdateTodoContextProjectCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_context_project(
        input.todo_id,
        input.context_project_id,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn set_todo_starred_in_db(
    db: &AppDb,
    input: SetTodoStarredCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_starred(UpdateTodoStarred {
        todo_id: input.todo_id,
        starred: input.starred,
        actor: Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    })
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_todo_title_in_db(
    db: &AppDb,
    input: UpdateTodoTitleCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_title(
        input.todo_id,
        &input.title,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_todo_deadline_in_db(
    db: &AppDb,
    input: UpdateTodoDeadlineCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_deadline(
        input.todo_id,
        input.deadline.as_deref(),
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn set_todo_tags_in_db(db: &AppDb, input: SetTodoTagsCommand) -> Result<AppSnapshot, String> {
    db.set_todo_tags(
        input.todo_id,
        input.tags,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn reorder_todo_in_db(db: &AppDb, input: ReorderTodoCommand) -> Result<AppSnapshot, String> {
    db.reorder_todo_with_project(
        input.todo_id,
        input.new_project_id,
        input.new_parent_id,
        input.new_index,
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn link_todo_in_db(db: &AppDb, input: LinkTodoCommand) -> Result<AppSnapshot, String> {
    db.link_todo_under_parent(
        input.source_todo_id,
        input.target_parent_todo_id,
        input.position,
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.target_parent_todo_id))
        .map_err(command_error)
}

pub fn delete_todo_with_attachment_cleanup(
    db: &AppDb,
    input: DeleteTodoCommand,
    app_data_dir: &Path,
) -> Result<AppSnapshot, String> {
    let todo = db.get_todo(input.todo_id).map_err(command_error)?;
    let attachment_dir = todo_attachment_directory(app_data_dir, todo.project_id, &todo.display_id);
    let artifact_attachment_dir =
        todo_artifact_attachment_directory(app_data_dir, todo.project_id, &todo.display_id);
    let artifact_path = todo_artifact_path(app_data_dir, todo.project_id, &todo.display_id);
    if attachment_dir.exists() {
        fs::remove_dir_all(&attachment_dir).map_err(|err| {
            format!(
                "cannot remove attachment directory {}: {err}",
                attachment_dir.display()
            )
        })?;
    }
    if artifact_attachment_dir.exists() {
        fs::remove_dir_all(&artifact_attachment_dir).map_err(|err| {
            format!(
                "cannot remove artifact attachment directory {}: {err}",
                artifact_attachment_dir.display()
            )
        })?;
    }
    if artifact_path.exists() {
        fs::remove_file(&artifact_path)
            .map_err(|err| format!("cannot remove artifact {}: {err}", artifact_path.display()))?;
    }

    db.delete_todo(input.todo_id).map_err(command_error)?;
    db.app_snapshot(Some(todo.project_id), None)
        .map_err(command_error)
}

pub fn message_todo_in_db(db: &AppDb, input: MessageTodoCommand) -> Result<AppSnapshot, String> {
    db.message_todo(
        input.todo_id,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
        &input.message,
        input.conversation_id.as_deref(),
        input.link.as_deref(),
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn delete_message_in_db(
    db: &AppDb,
    input: DeleteMessageCommand,
) -> Result<AppSnapshot, String> {
    let event_id = message_event_id(&input.message_id)?;
    let todo_id = db.delete_message_event(event_id).map_err(command_error)?;
    db.app_snapshot(None, Some(todo_id)).map_err(command_error)
}

pub fn clear_todo_messages_in_db(
    db: &AppDb,
    input: ClearTodoMessagesCommand,
) -> Result<AppSnapshot, String> {
    db.clear_todo_messages(input.todo_id)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn record_prompt_copied_in_db(
    db: &AppDb,
    input: RecordPromptCopiedCommand,
) -> Result<AppSnapshot, String> {
    db.record_prompt_copied(
        input.todo_id,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn stop_agent_session_in_db(
    db: &AppDb,
    input: StopAgentSessionCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = db
        .stop_agent_session(
            &input.session_id,
            Actor {
                actor_type: "human".to_string(),
                actor_name: "Mark".to_string(),
            },
        )
        .map_err(command_error)?;
    db.app_snapshot(None, Some(todo_id)).map_err(command_error)
}

pub fn update_todo_description_in_db(
    db: &AppDb,
    input: UpdateTodoDescriptionCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_description(
        input.todo_id,
        &input.description_markdown,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_todo_journal_in_db(
    db: &AppDb,
    input: UpdateTodoJournalCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_journal(
        input.todo_id,
        &input.journal_markdown,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_todo_artifact_in_db(
    db: &AppDb,
    input: UpdateTodoArtifactCommand,
) -> Result<AppSnapshot, String> {
    db.update_todo_artifact(
        input.todo_id,
        &input.artifact_markdown,
        Actor {
            actor_type: "human".to_string(),
            actor_name: input.actor_name.unwrap_or_else(|| "Mark".to_string()),
        },
    )
    .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_project_notes_in_db(
    db: &AppDb,
    input: UpdateProjectNotesCommand,
) -> Result<AppSnapshot, String> {
    db.update_project_notes(input.project_id, &input.notes_markdown)
        .map_err(command_error)?;
    db.app_snapshot(Some(input.project_id), None)
        .map_err(command_error)
}

pub fn record_project_use_in_db(db: &AppDb, input: RecordProjectUseCommand) -> Result<(), String> {
    db.record_project_use(input.project_id)
        .map_err(command_error)
}

pub fn update_project_settings_in_db(
    db: &AppDb,
    input: UpdateProjectSettingsCommand,
) -> Result<AppSnapshot, String> {
    let project_id = input.project_id;
    db.update_project_settings(ProjectSettingsUpdate {
        project_id,
        name: input.name,
        client: input.client,
        working_directory: input.working_directory,
        display_id_prefix: input.display_id_prefix,
        actions_directory: input.actions_directory,
        project_folder_open_app: input.project_folder_open_app,
        main_branch: input.main_branch,
        terminal_wsl_enabled: input.terminal_wsl_enabled,
        ai_default_include_project_notes: input.ai_default_include_project_notes,
        ai_default_provider: input.ai_default_provider,
        inherit_parent: input.inherit_parent,
    })
    .map_err(command_error)?;
    db.app_snapshot(Some(project_id), None)
        .map_err(command_error)
}

pub fn update_project_prompt_settings_in_db(
    db: &AppDb,
    input: UpdateProjectPromptSettingsCommand,
) -> Result<AppSnapshot, String> {
    let project_id = input.project_id;
    db.update_project_prompt_settings(ProjectPromptSettingsUpdate {
        project_id,
        ai_task_description_mode: input.ai_task_description_mode,
        ai_default_include_project_notes: input.ai_default_include_project_notes,
    })
    .map_err(command_error)?;
    db.app_snapshot(Some(project_id), None)
        .map_err(command_error)
}

pub fn suggest_todo_worktree_name_in_db(
    db: &AppDb,
    input: SuggestTodoWorktreeNameCommand,
) -> Result<WorktreeNameSuggestion, String> {
    db.suggest_todo_worktree_name(input.todo_id)
        .map(|name| WorktreeNameSuggestion { name })
        .map_err(command_error)
}

pub fn enable_todo_worktree_in_db(
    db: &AppDb,
    input: EnableTodoWorktreeCommand,
) -> Result<AppSnapshot, String> {
    let worktree = db
        .enable_todo_worktree(input.todo_id, &input.worktree_name)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(worktree.todo_id))
        .map_err(command_error)
}

pub fn todo_worktree_status_in_db(
    db: &AppDb,
    input: TodoWorktreeCommand,
) -> Result<TodoWorktreeStatusSummary, String> {
    db.todo_worktree_status(input.todo_id)
        .map_err(command_error)
}

pub fn delete_todo_worktree_in_db(
    db: &AppDb,
    input: TodoWorktreeCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    db.delete_todo_worktree(todo_id).map_err(command_error)?;
    db.app_snapshot(None, Some(todo_id)).map_err(command_error)
}

pub fn list_project_actions_from_db(
    db: &AppDb,
    input: ListProjectActionsCommand,
) -> Result<Vec<ProjectActionSummary>, String> {
    db.list_project_actions(input.project_id)
        .map_err(command_error)
}

pub fn get_project_actions_directory_from_db(
    db: &AppDb,
    input: ProjectActionsDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    db.project_actions_directory(input.project_id)
        .map_err(command_error)
}

pub fn create_project_actions_directory_in_db(
    db: &AppDb,
    input: ProjectActionsDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    db.create_project_actions_directory(input.project_id)
        .map_err(command_error)
}

pub fn create_project_action_in_db(
    db: &AppDb,
    input: CreateProjectActionCommand,
) -> Result<Vec<ProjectActionSummary>, String> {
    db.create_project_action(
        input.project_id,
        &input.file_name,
        &input.runtime,
        &input.title,
        &input.description,
    )
    .map_err(command_error)?;
    db.list_project_actions(input.project_id)
        .map_err(command_error)
}

pub fn delete_project_action_in_db(
    db: &AppDb,
    input: ProjectActionFileCommand,
) -> Result<Vec<ProjectActionSummary>, String> {
    db.delete_project_action(input.project_id, &input.file_name)
        .map_err(command_error)?;
    db.list_project_actions(input.project_id)
        .map_err(command_error)
}

pub fn run_project_action_in_db(
    db: &AppDb,
    input: RunProjectActionCommand,
) -> Result<ActionRunSummary, String> {
    let action = db
        .list_project_actions(input.project_id)
        .map_err(command_error)?
        .into_iter()
        .find(|item| item.file_name == input.file_name)
        .ok_or_else(|| format!("action not found: {}", input.file_name))?;
    project_action_argument_values(&action, input.arguments.as_ref())?;

    db.record_action_run(NewActionRun {
        project_id: input.project_id,
        todo_id: input.todo_id,
        file_name: input.file_name,
        pty_id: None,
        command: None,
        state: "succeeded".to_string(),
        exit_code: Some(0),
    })
    .map_err(command_error)
}

pub fn project_action_argument_values(
    action: &ProjectActionSummary,
    arguments: Option<&Value>,
) -> Result<Vec<String>, String> {
    let Some(arguments) = arguments else {
        if let Some(required) = action.arguments.iter().find(|argument| argument.required) {
            return Err(format!(
                "missing required action argument: {}",
                required.name
            ));
        }
        return Ok(vec![]);
    };

    let object = arguments
        .as_object()
        .ok_or_else(|| "action arguments must be an object".to_string())?;
    let known_names = action
        .arguments
        .iter()
        .map(|argument| argument.name.as_str())
        .collect::<HashSet<_>>();
    for name in object.keys() {
        if !known_names.contains(name.as_str()) {
            return Err(format!("unknown action argument: {name}"));
        }
    }

    let mut values = vec![];
    for argument in &action.arguments {
        let value = object.get(&argument.name);
        if value.is_none() {
            if argument.required {
                return Err(format!(
                    "missing required action argument: {}",
                    argument.name
                ));
            }
            continue;
        }

        let value = value.expect("checked is_some");
        let rendered = match argument.kind.as_str() {
            "string" => {
                let text = value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                match text {
                    Some(text) => text.to_string(),
                    None if argument.required => {
                        return Err(format!(
                            "missing required action argument: {}",
                            argument.name
                        ))
                    }
                    None => continue,
                }
            }
            "boolean" => match value {
                Value::Bool(value) => value.to_string(),
                Value::String(value) if value == "true" || value == "false" => value.clone(),
                _ => return Err(format!("action argument {} must be boolean", argument.name)),
            },
            "choice" => {
                let choice = value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        format!("missing required action argument: {}", argument.name)
                    })?;
                if !argument.choices.iter().any(|item| item == choice) {
                    return Err(format!(
                        "invalid choice for action argument {}: {}",
                        argument.name, choice
                    ));
                }
                choice.to_string()
            }
            other => return Err(format!("unknown action argument kind: {other}")),
        };
        values.push(rendered);
    }

    Ok(values)
}

pub fn project_action_environment(
    project_id: i64,
    project_name: &str,
    project_dir: &str,
    action_file: &str,
    action_title: &str,
    todo_context: Option<(i64, &str)>,
) -> Vec<(String, String)> {
    let mut env = vec![
        ("BOOMERANG_PROJECT_ID".to_string(), project_id.to_string()),
        (
            "BOOMERANG_PROJECT_NAME".to_string(),
            project_name.to_string(),
        ),
        ("BOOMERANG_PROJECT_DIR".to_string(), project_dir.to_string()),
        ("BOOMERANG_ACTION_FILE".to_string(), action_file.to_string()),
        (
            "BOOMERANG_ACTION_TITLE".to_string(),
            action_title.to_string(),
        ),
    ];

    if let Some((todo_id, display_id)) = todo_context {
        env.push(("BOOMERANG_TODO_ID".to_string(), todo_id.to_string()));
        env.push((
            "BOOMERANG_TODO_DISPLAY_ID".to_string(),
            display_id.to_string(),
        ));
    }

    env
}

fn action_working_directory(
    db: &AppDb,
    project: &crate::core::Project,
    todo_id: Option<i64>,
) -> Result<String, String> {
    let Some(todo_id) = todo_id else {
        return Ok(project.working_directory.clone());
    };
    let todo = db.get_todo(todo_id).map_err(command_error)?;
    if todo.project_id != project.id {
        return Err("todo does not belong to action project".to_string());
    }
    db.todo_working_directory(todo_id).map_err(command_error)
}

fn run_project_action_with_pty(
    app: &AppHandle,
    db: &AppDb,
    pty: &PtyState,
    input: RunProjectActionCommand,
) -> Result<ActionRunSummary, String> {
    let project = db.get_project(input.project_id).map_err(command_error)?;
    let actions = db
        .list_project_actions(input.project_id)
        .map_err(command_error)?;
    let action = actions
        .into_iter()
        .find(|item| item.file_name == input.file_name)
        .ok_or_else(|| format!("action not found: {}", input.file_name))?;
    if let Some(error) = action.validation_error {
        return Err(format!("action is invalid: {error}"));
    }
    let path = action
        .path
        .clone()
        .ok_or_else(|| format!("action has no script path: {}", action.file_name))?;
    let action_argument_values = project_action_argument_values(&action, input.arguments.as_ref())?;
    let working_directory = action_working_directory(db, &project, input.todo_id)?;
    let working_directory = expand_home_alias(&working_directory).display().to_string();
    let (program, mut args) = match action.runtime.as_str() {
        "shell" => ("bash".to_string(), vec![path.clone()]),
        "python" => ("python3".to_string(), vec![path.clone()]),
        other => return Err(format!("cannot run action runtime in PTY: {other}")),
    };
    args.extend(action_argument_values);
    let command = shell_join(&program, &args);
    let todo_context = match input.todo_id {
        Some(todo_id) => {
            let todo = db.get_todo(todo_id).map_err(command_error)?;
            if todo.project_id != project.id {
                return Err("todo does not belong to action project".to_string());
            }
            Some((todo_id, todo.display_id))
        }
        None => None,
    };
    let env = project_action_environment(
        project.id,
        &project.name,
        &working_directory,
        &action.file_name,
        &action.title,
        todo_context
            .as_ref()
            .map(|(todo_id, display_id)| (*todo_id, display_id.as_str())),
    );
    let pty_id = pty.spawn_process(
        app,
        PtySpawnSpec {
            program,
            args,
            cwd: working_directory,
            env,
            wsl_enabled: project.terminal_wsl_enabled,
            cols: 100,
            rows: 28,
        },
    )?;

    db.record_action_run(NewActionRun {
        project_id: input.project_id,
        todo_id: input.todo_id,
        file_name: action.file_name,
        pty_id: Some(pty_id),
        command: Some(command),
        state: "running".to_string(),
        exit_code: None,
    })
    .map_err(command_error)
}

pub fn start_timer_in_db(db: &AppDb, input: StartTimerCommand) -> Result<AppSnapshot, String> {
    db.start_timer(input.todo_id).map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn stop_timer_in_db(db: &AppDb) -> Result<AppSnapshot, String> {
    stop_timer_with_changed_todo(db).map(|(snapshot, _)| snapshot)
}

pub fn add_todo_dependency_in_db(
    db: &AppDb,
    input: AddTodoDependencyCommand,
) -> Result<AppSnapshot, String> {
    db.add_dependency(input.todo_id, input.depends_on_todo_id)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn remove_todo_dependency_in_db(
    db: &AppDb,
    input: RemoveTodoDependencyCommand,
) -> Result<AppSnapshot, String> {
    db.remove_dependency(input.todo_id, input.depends_on_todo_id)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn create_subtask_in_db(
    db: &AppDb,
    input: CreateSubtaskCommand,
) -> Result<AppSnapshot, String> {
    db.create_subtask(input.parent_todo_id, &input.title)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(input.parent_todo_id))
        .map_err(command_error)
}

pub fn add_manual_time_log_in_db(
    db: &AppDb,
    input: AddManualTimeLogCommand,
) -> Result<AppSnapshot, String> {
    db.add_manual_time_log(input.todo_id, input.duration_seconds)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}

pub fn update_time_log_duration_in_db(
    db: &AppDb,
    input: UpdateTimeLogDurationCommand,
) -> Result<AppSnapshot, String> {
    let log = db
        .update_time_log_duration(input.time_log_id, input.duration_seconds)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(log.todo_id))
        .map_err(command_error)
}

pub fn delete_time_log_in_db(
    db: &AppDb,
    input: DeleteTimeLogCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = db
        .delete_time_log(input.time_log_id)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(todo_id)).map_err(command_error)
}

fn stop_timer_with_changed_todo(db: &AppDb) -> Result<(AppSnapshot, Option<i64>), String> {
    let stopped = db.stop_running_timer().map_err(command_error)?;
    let stopped_todo_id = stopped.as_ref().map(|log| log.todo_id);
    let snapshot = db
        .app_snapshot(None, stopped_todo_id)
        .map_err(command_error)?;
    Ok((snapshot, stopped_todo_id))
}

fn emit_todo_changed(
    app: &AppHandle,
    todo_id: i64,
    change_type: &'static str,
) -> Result<(), String> {
    app.emit(
        "todos:changed",
        TodoChangedPayload {
            todo_id,
            change_type,
        },
    )
    .map_err(command_error)
}

fn emit_project_changed(
    app: &AppHandle,
    project_id: i64,
    change_type: &'static str,
) -> Result<(), String> {
    app.emit(
        "projects:changed",
        ProjectChangedPayload {
            project_id,
            change_type,
        },
    )
    .map_err(command_error)
}

fn emit_settings_changed(app: &AppHandle, change_type: &'static str) -> Result<(), String> {
    app.emit(
        "settings:changed",
        serde_json::json!({ "changeType": change_type }),
    )
    .map_err(command_error)
}

pub fn configured_project_folder_open_app(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

pub fn build_folder_open_process_command(
    folder_open_app: &str,
    path: &str,
    remote_host: Option<&str>,
    remote_path: Option<&str>,
) -> Result<ProcessCommandSpec, String> {
    let program = required_command_text("folder open app", folder_open_app)?;
    let path = required_command_text("folder path", path)?;
    let mut args = Vec::new();
    if let Some(remote_host) = remote_host {
        let remote_host = required_command_text("remote host", remote_host)?;
        let remote_path = required_command_text("remote path", remote_path.unwrap_or(&path))?;
        args.push("--remote".to_string());
        args.push(format!("ssh-remote+{remote_host}"));
        args.push(remote_path);
    } else {
        args.push(path.to_string());
    }

    Ok(ProcessCommandSpec {
        cwd: path.to_string(),
        display: shell_join(&program, &args),
        program,
        args,
    })
}

pub fn build_folder_open_command(
    folder_open_app: &str,
    path: &str,
    remote_host: Option<&str>,
    remote_path: Option<&str>,
) -> Result<FolderOpenCommandSpec, String> {
    let path = required_command_text("folder path", path)?;
    if remote_host.is_some() {
        return build_folder_open_process_command(folder_open_app, &path, remote_host, remote_path)
            .map(FolderOpenCommandSpec::Process);
    }

    Ok(FolderOpenCommandSpec::System {
        path,
        app: configured_project_folder_open_app(folder_open_app),
    })
}

fn open_folder_with_app(
    app: &AppHandle,
    folder_open_app: &str,
    path: &Path,
    remote_host: Option<&str>,
    remote_path: Option<&str>,
) -> Result<(), String> {
    let path = path.display().to_string();
    match build_folder_open_command(folder_open_app, &path, remote_host, remote_path)? {
        FolderOpenCommandSpec::System {
            path,
            app: open_app,
        } => {
            app.opener()
                .open_path(path, open_app)
                .map_err(command_error)?;
        }
        FolderOpenCommandSpec::Process(process) => {
            Command::new(&process.program)
                .args(&process.args)
                .current_dir(&process.cwd)
                .spawn()
                .map_err(command_error)?;
        }
    }
    Ok(())
}

fn message_event_id(message_id: &str) -> Result<i64, String> {
    let value = required_command_text("message id", message_id)?;
    let numeric = value
        .strip_prefix("m-")
        .or_else(|| value.strip_prefix("M-"))
        .unwrap_or(&value);
    numeric
        .parse::<i64>()
        .map_err(|_| format!("invalid message id: {message_id}"))
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_open_command_uses_system_opener_for_local_project_app() {
        let command =
            build_folder_open_command("Cursor", "/Users/markcl/p/local", None, None).unwrap();

        assert_eq!(
            command,
            FolderOpenCommandSpec::System {
                path: "/Users/markcl/p/local".to_string(),
                app: Some("Cursor".to_string()),
            }
        );
    }

    #[test]
    fn provider_prompt_submit_delay_gives_codex_time_to_commit_pasted_prompt() {
        assert!(PROVIDER_PROMPT_SUBMIT_DELAY >= Duration::from_millis(1_000));
    }

    #[test]
    fn claude_status_session_id_is_parsed_from_carriage_return_only_dialog() {
        // Claude Code 2.x renders /status as a full-screen dialog using cursor
        // positioning and bare \r line starts — the stream contains no \n.
        let output = "\u{1b}[2J\u{1b}[H Settings Status  Config   Usage   Stats\r\
            Version: 2.1.191\r\
            Session name: /rename to add a name\r\
            Session ID: 127bca84-55e3-4cf0-9b15-0e82552a4556\r\
            cwd: /Users/markcl/p/B-219";

        assert_eq!(
            claude_status_session_id_from_output(output).as_deref(),
            Some("127bca84-55e3-4cf0-9b15-0e82552a4556"),
        );
    }

    #[test]
    fn codex_status_session_id_is_parsed_from_bordered_status_output() {
        let output = "│  Model:                       gpt-5.5 xhigh\u{1b}[0m │\r\n\
            │  Session:                     019f30ec-070a-7600-98b5-4b1ac9f67e6f │\r\n";

        assert_eq!(
            codex_status_session_id_from_output(output).as_deref(),
            Some("019f30ec-070a-7600-98b5-4b1ac9f67e6f"),
        );
    }

    #[test]
    fn claude_compact_header_without_box_corner_counts_as_loaded() {
        // Claude Code 2.x draws no ╰-cornered box in projects with existing
        // history — only the ❯ composer caret signals the input is ready.
        let compact_header = "\u{1b}[38;5;180m▗ ▗   ▖ ▖\u{1b}[0m Claude Code v2.1.191\r\
            ~/p/B-219\r\
            ❯ Try \"fix typecheck errors\"\r\
            ⏵⏵ bypass permissions on (shift+tab to cycle)";
        let codex_banner = "╭──────────────╮\r\n│ >_ OpenAI Codex │\r\n╰──────────────╯";
        let startup_spinner = "Loading Claude Code…";

        assert!(managed_cli_loaded_from_output(compact_header));
        assert!(managed_cli_loaded_from_output(codex_banner));
        assert!(!managed_cli_loaded_from_output(startup_spinner));
    }

    #[test]
    fn provider_status_command_enter_is_sent_separately_from_command_text() {
        // Codex's paste-burst heuristic treats an Enter arriving in the same
        // chunk as the command text as a literal newline, leaving "/status"
        // sitting unsubmitted in the composer.
        assert_eq!(provider_status_command_writes(), ["/status", "\r"]);
    }

    #[test]
    fn codex_first_load_trust_prompt_is_detected_from_terminal_output() {
        let output = "\u{1b}[?25lDo you trust the contents of this directory?\r\n\
            Working with untrusted contents comes with higher risk of prompt injection.\r\n\
            \u{1b}[32mPress Enter to continue\u{1b}[0m";

        assert!(codex_first_load_trust_prompt_from_output(output));
        assert!(!codex_first_load_trust_prompt_from_output(
            "Welcome to Codex\n╰────────────────────────╯",
        ));
    }

    #[test]
    fn only_codex_first_load_trust_prompt_gets_enter_acknowledgement() {
        let output = "Do you trust the contents of this directory?\n\
            Working with untrusted contents comes with higher risk of prompt injection.";

        assert_eq!(
            provider_first_load_prompt_ack_input("codex", output),
            Some("\r"),
        );
        assert_eq!(provider_first_load_prompt_ack_input("claude", output), None);
        assert_eq!(
            provider_first_load_prompt_ack_input("codex", "Session: 019f"),
            None
        );
    }
}
