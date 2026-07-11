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
    if project_terminal_wsl_active(input.terminal_wsl_enabled) {
        return wsl_working_directory_summary(&path, WslDirectoryMode::Create);
    }

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
    if project_terminal_wsl_active(input.terminal_wsl_enabled) {
        return wsl_working_directory_summary(&path, WslDirectoryMode::Status);
    }

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WslDirectoryMode {
    Status,
    Create,
}

fn wsl_working_directory_summary(
    path: &str,
    mode: WslDirectoryMode,
) -> Result<ProjectActionsDirectorySummary, String> {
    let action = match mode {
        WslDirectoryMode::Status => "check",
        WslDirectoryMode::Create => "create",
    };
    let output = Command::new("wsl.exe")
        .args(wsl_working_directory_args(path, mode))
        .output()
        .map_err(|err| format!("cannot {action} WSL working directory {path}: {err}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let resolved_path = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(path)
        .to_string();

    if output.status.success() {
        return Ok(ProjectActionsDirectorySummary {
            exists: true,
            path: resolved_path,
        });
    }

    if mode == WslDirectoryMode::Status && output.status.code() == Some(2) {
        return Ok(ProjectActionsDirectorySummary {
            exists: false,
            path: resolved_path,
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.trim();
    if detail.is_empty() {
        Err(format!(
            "cannot {action} WSL working directory {path}: wsl.exe exited with {}",
            output.status
        ))
    } else {
        Err(format!(
            "cannot {action} WSL working directory {path}: {detail}"
        ))
    }
}

fn wsl_working_directory_args(path: &str, mode: WslDirectoryMode) -> Vec<String> {
    vec![
        "--exec".to_string(),
        "bash".to_string(),
        "-lc".to_string(),
        wsl_working_directory_script(mode).to_string(),
        "bash".to_string(),
        path.to_string(),
    ]
}

fn wsl_working_directory_script(mode: WslDirectoryMode) -> &'static str {
    match mode {
        WslDirectoryMode::Status => {
            r#"path=$1
case "$path" in
  \~) path="$HOME" ;;
  \~/*) path="$HOME/${path#\~/}" ;;
esac
if [ -d "$path" ]; then
  cd "$path" && pwd -P
else
  printf '%s\n' "$path"
  exit 2
fi"#
        }
        WslDirectoryMode::Create => {
            r#"path=$1
case "$path" in
  \~) path="$HOME" ;;
  \~/*) path="$HOME/${path#\~/}" ;;
esac
mkdir -p "$path" || exit 1
cd "$path" && pwd -P"#
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_working_directory_command_passes_the_path_as_an_argument() {
        let args = wsl_working_directory_args("~/projects", WslDirectoryMode::Status);

        assert_eq!(args[0], "--exec");
        assert_eq!(args[1], "bash");
        assert_eq!(args[2], "-lc");
        assert_eq!(args[4], "bash");
        assert_eq!(args[5], "~/projects");
        assert!(args[3].contains("${path#\\~/}"));
        assert!(!args[3].contains("mkdir -p"));
    }

    #[test]
    fn wsl_working_directory_create_command_creates_the_directory_inside_wsl() {
        let args = wsl_working_directory_args("~/projects", WslDirectoryMode::Create);

        assert!(args[3].contains("mkdir -p \"$path\""));
    }
}
