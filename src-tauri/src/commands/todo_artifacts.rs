use super::*;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn update_todo_artifact(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodoArtifactCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = update_todo_artifact_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "artifact_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn open_todo_artifact(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: OpenTodoArtifactCommand,
) -> Result<(), String> {
    let path = state
        .ensure_todo_artifact_file(input.todo_id)
        .map_err(command_error)?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(command_error)?;
    Ok(())
}
