use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::core::expand_home_alias;

use super::models::OpenFilePathCommand;

#[tauri::command]
pub fn open_file_path(app: AppHandle, input: OpenFilePathCommand) -> Result<(), String> {
    let path = resolve_openable_file_path(input)?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(|err| err.to_string())
}

pub fn resolve_openable_file_path(input: OpenFilePathCommand) -> Result<PathBuf, String> {
    let raw_path = input.path.trim();
    if raw_path.is_empty() {
        return Err("File path is required.".to_string());
    }
    if raw_path.chars().any(char::is_control) {
        return Err("File path contains unsupported control characters.".to_string());
    }

    let path = expand_home_alias(raw_path);
    if !raw_path.starts_with("~/") && !path.is_absolute() {
        return Err("Only absolute paths and ~/ paths can be opened.".to_string());
    }

    Ok(path)
}
