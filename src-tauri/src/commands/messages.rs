use tauri::{AppHandle, State};

use crate::core::{AppDb, AppSnapshot};

use super::{command_error, emit_todo_changed, MarkTodoMessagesReadCommand};

#[tauri::command]
pub fn mark_todo_messages_read(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: MarkTodoMessagesReadCommand,
) -> Result<AppSnapshot, String> {
    let todo_id = input.todo_id;
    let snapshot = mark_todo_messages_read_in_db(&state, input)?;
    emit_todo_changed(&app, todo_id, "messages_read")?;
    Ok(snapshot)
}

pub fn mark_todo_messages_read_in_db(
    db: &AppDb,
    input: MarkTodoMessagesReadCommand,
) -> Result<AppSnapshot, String> {
    db.mark_todo_messages_read(input.todo_id)
        .map_err(command_error)?;
    db.app_snapshot(None, Some(input.todo_id))
        .map_err(command_error)
}
