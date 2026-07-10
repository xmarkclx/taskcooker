use super::*;

#[tauri::command]
pub fn update_todos_state(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: UpdateTodosStateCommand,
) -> Result<AppSnapshot, String> {
    let todo_ids = input.todo_ids.clone();
    let snapshot = update_todos_state_in_db(&state, input)?;
    for todo_id in todo_ids {
        emit_todo_changed(&app, todo_id, "state_changed")?;
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn delete_todos(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: DeleteTodosCommand,
) -> Result<AppSnapshot, String> {
    let todo_ids = input.todo_ids.clone();
    let app_data_dir = app.path().app_data_dir().map_err(command_error)?;
    let snapshot = delete_todos_with_attachment_cleanup(&state, input, &app_data_dir)?;
    for todo_id in todo_ids {
        emit_todo_changed(&app, todo_id, "todo_deleted")?;
    }
    Ok(snapshot)
}

pub fn update_todos_state_in_db(
    db: &AppDb,
    input: UpdateTodosStateCommand,
) -> Result<AppSnapshot, String> {
    let selected_todo_id = input.todo_ids.first().copied();
    db.update_todos_state(UpdateTodosState {
        todo_ids: input.todo_ids,
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
    db.app_snapshot(None, selected_todo_id)
        .map_err(command_error)
}

pub fn delete_todos_with_attachment_cleanup(
    db: &AppDb,
    input: DeleteTodosCommand,
    app_data_dir: &Path,
) -> Result<AppSnapshot, String> {
    let todos = db.get_todos(&input.todo_ids).map_err(command_error)?;
    let selected_project_id = todos.first().map(|todo| todo.project_id);
    for todo in &todos {
        let attachment_dir =
            todo_attachment_directory(app_data_dir, todo.project_id, &todo.display_id);
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
            fs::remove_file(&artifact_path).map_err(|err| {
                format!("cannot remove artifact {}: {err}", artifact_path.display())
            })?;
        }
    }

    db.delete_todos(&input.todo_ids).map_err(command_error)?;
    db.app_snapshot(selected_project_id, None)
        .map_err(command_error)
}
