use super::*;

#[tauri::command]
pub fn set_todo_panel_visibility(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTodoPanelVisibilityCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = state
        .set_todo_panel_visibility(
            todo_id,
            input.description_panel_hidden,
            input.execution_panel_hidden,
        )
        .map_err(command_error)?;
    emit_todo_changed(&app, todo_id, "panel_visibility_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn set_todo_toc_visibility(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: SetTodoTocVisibilityCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = state
        .set_todo_toc_visibility(
            todo_id,
            input.description_toc_hidden,
            input.artifact_toc_hidden,
        )
        .map_err(command_error)?;
    emit_todo_changed(&app, todo_id, "toc_visibility_changed")?;
    Ok(snapshot)
}
