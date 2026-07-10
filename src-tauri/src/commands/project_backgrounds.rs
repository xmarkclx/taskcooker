use super::*;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn choose_project_background_image(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectBackgroundImageCommand,
) -> Result<AppSnapshot, String> {
    let project = state.get_project(input.project_id).map_err(command_error)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose Task Header Background")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"]);
    let project_directory = expand_home_alias(&project.working_directory);
    if project_directory.is_dir() {
        dialog = dialog.set_directory(project_directory);
    }

    let Some(selected) = dialog.blocking_pick_file() else {
        return state
            .app_snapshot(Some(input.project_id), None)
            .map_err(command_error);
    };
    let source_path = selected
        .into_path()
        .map_err(|err| format!("cannot use selected image path: {err}"))?;
    let app_data_dir = app.path().app_data_dir().map_err(command_error)?;
    let snapshot = set_project_background_image_from_path_in_db(
        &state,
        &app_data_dir,
        input.project_id,
        &source_path,
    )?;
    emit_project_changed(&app, input.project_id, "background_image_changed")?;
    Ok(snapshot)
}

#[tauri::command]
pub fn clear_project_background_image(
    app: AppHandle,
    state: State<'_, AppDb>,
    input: ProjectBackgroundImageCommand,
) -> Result<AppSnapshot, String> {
    state
        .update_project_background_image(input.project_id, "")
        .map_err(command_error)?;
    let snapshot = state
        .app_snapshot(Some(input.project_id), None)
        .map_err(command_error)?;
    emit_project_changed(&app, input.project_id, "background_image_changed")?;
    Ok(snapshot)
}

pub fn set_project_background_image_from_path_in_db(
    db: &AppDb,
    app_data_dir: &Path,
    project_id: i64,
    source_path: &Path,
) -> Result<AppSnapshot, String> {
    db.get_project(project_id).map_err(command_error)?;
    let source_path = source_path.canonicalize().map_err(|err| {
        format!(
            "cannot read selected image {}: {err}",
            source_path.display()
        )
    })?;
    if !source_path.is_file() {
        return Err(format!(
            "selected background image is not a file: {}",
            source_path.display()
        ));
    }
    let file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("background");
    let extension = image_extension("", file_name)?;
    let metadata = fs::metadata(&source_path).map_err(|err| {
        format!(
            "cannot inspect selected image {}: {err}",
            source_path.display()
        )
    })?;
    if metadata.len() == 0 {
        return Err("selected background image is empty".to_string());
    }
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("selected background image is larger than 20 MB".to_string());
    }

    let directory = app_data_dir
        .join("attachments")
        .join(format!("project-{project_id}"))
        .join("background");
    fs::create_dir_all(&directory).map_err(|err| {
        format!(
            "cannot create background image directory {}: {err}",
            directory.display()
        )
    })?;
    let destination = directory.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    fs::copy(&source_path, &destination).map_err(|err| {
        format!(
            "cannot copy background image {} to {}: {err}",
            source_path.display(),
            destination.display()
        )
    })?;

    db.update_project_background_image(project_id, &destination.display().to_string())
        .map_err(command_error)?;
    db.app_snapshot(Some(project_id), None)
        .map_err(command_error)
}
