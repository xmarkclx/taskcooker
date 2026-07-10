use super::*;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn get_working_directory(
    input: WorkingDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    working_directory_status(input)
}

#[tauri::command]
pub async fn choose_working_directory(
    app: AppHandle,
    input: ChooseWorkingDirectoryCommand,
) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose Project Working Directory");

    if let Some(directory) = dialog_starting_directory(&input.current_path) {
        dialog = dialog.set_directory(directory);
    }

    dialog
        .blocking_pick_folder()
        .map(|path| {
            path.into_path()
                .map(|path| path.display().to_string())
                .map_err(|err| format!("cannot use selected folder path: {err}"))
        })
        .transpose()
}

#[tauri::command]
pub fn create_working_directory(
    input: WorkingDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let path = required_command_text("working directory", &input.path)?;
    let expanded = expand_home_alias(&path);
    fs::create_dir_all(&expanded).map_err(|err| {
        format!(
            "cannot create working directory {}: {err}",
            expanded.display()
        )
    })?;
    Ok(ProjectActionsDirectorySummary {
        exists: expanded.is_dir(),
        path: expanded.display().to_string(),
    })
}

pub fn working_directory_status(
    input: WorkingDirectoryCommand,
) -> Result<ProjectActionsDirectorySummary, String> {
    let path = required_command_text("working directory", &input.path)?;
    let expanded = expand_home_alias(&path);
    Ok(ProjectActionsDirectorySummary {
        exists: expanded.is_dir(),
        path: expanded.display().to_string(),
    })
}

fn dialog_starting_directory(current_path: &str) -> Option<PathBuf> {
    let path = current_path.trim();
    if path.is_empty() {
        return None;
    }

    let expanded = expand_home_alias(path);
    if expanded.is_dir() {
        return Some(expanded);
    }

    expanded
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
}
