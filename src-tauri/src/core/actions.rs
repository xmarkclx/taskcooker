use std::collections::HashMap;

use super::*;

pub(super) fn native_open_folder_action() -> ProjectActionSummary {
    ProjectActionSummary {
        file_name: "boomerang:open-folder".to_string(),
        path: None,
        title: "Open Folder".to_string(),
        description: "Open this project folder.".to_string(),
        icon: Some("Folder".to_string()),
        icon_configured: false,
        runtime: "native".to_string(),
        arguments: vec![],
        validation_error: None,
    }
}

impl AppDb {
    pub fn project_action_file_path(&self, project_id: i64, file_name: &str) -> AppResult<PathBuf> {
        let file_name = script_action_file_name(file_name)?;
        let action = self
            .list_project_actions(project_id)?
            .into_iter()
            .find(|action| action.file_name == file_name)
            .ok_or_else(|| AppError::InvalidInput(format!("action not found: {file_name}")))?;
        let path = action
            .path
            .map(PathBuf::from)
            .ok_or_else(|| AppError::InvalidInput(format!("action has no path: {file_name}")))?;
        if !path.is_file() {
            return Err(AppError::InvalidInput(format!(
                "action file does not exist: {}",
                path.display()
            )));
        }

        Ok(path)
    }

    pub fn delete_project_action(&self, project_id: i64, file_name: &str) -> AppResult<()> {
        let path = self.project_action_file_path(project_id, file_name)?;
        fs::remove_file(&path).map_err(|err| {
            AppError::InvalidInput(format!(
                "cannot delete action file {}: {err}",
                path.display()
            ))
        })?;
        Ok(())
    }
}

pub(super) fn project_action_recent_runs(
    db: &AppDb,
    project_id: i64,
) -> AppResult<HashMap<String, String>> {
    let conn = db.conn.lock().expect("database lock is not poisoned");
    let mut stmt = conn.prepare(
        "SELECT action_file_name, MAX(last_activity_at)
         FROM action_runs
         WHERE project_id = ?1
         GROUP BY action_file_name",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(AppError::from)
}

pub(super) fn script_action_from_path(
    file_name: &str,
    path: &Path,
    runtime: &str,
) -> ProjectActionSummary {
    let content = fs::read_to_string(path).unwrap_or_default();
    let mut title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name)
        .replace(['-', '_'], " ");
    let mut description = String::new();
    let mut icon = None;
    let mut icon_configured = false;
    let mut arguments = vec![];
    let mut validation_error = None;

    for line in content.lines().take(40) {
        let line = line.trim_start();
        let Some(metadata) = line.strip_prefix('#') else {
            continue;
        };
        let metadata = metadata.trim();

        if let Some(value) = metadata.strip_prefix("title:") {
            title = value.trim().to_string();
        } else if let Some(value) = metadata.strip_prefix("description:") {
            description = value.trim().to_string();
        } else if let Some(value) = metadata.strip_prefix("icon:") {
            icon = Some(value.trim().to_string());
            icon_configured = true;
        } else if let Some(value) = metadata.strip_prefix("arg:") {
            match parse_action_argument(value.trim()) {
                Ok(argument) => arguments.push(argument),
                Err(err) => validation_error = Some(err.to_string()),
            }
        }
    }

    ProjectActionSummary {
        file_name: file_name.to_string(),
        path: Some(path.display().to_string()),
        title,
        description,
        icon,
        icon_configured,
        runtime: runtime.to_string(),
        arguments,
        validation_error,
    }
}

pub(super) fn parse_action_argument(value: &str) -> AppResult<ProjectActionArgument> {
    let mut parts = value.split_whitespace();
    let name = parts
        .next()
        .ok_or_else(|| AppError::InvalidInput("action arg is missing a name".to_string()))?;
    let kind = parts
        .next()
        .ok_or_else(|| AppError::InvalidInput("action arg is missing a kind".to_string()))?;
    if !matches!(kind, "string" | "boolean" | "choice") {
        return Err(AppError::InvalidInput(format!(
            "unknown action arg kind: {kind}"
        )));
    }
    let required_label = parts.next().unwrap_or("optional");
    let required = match required_label {
        "required" => true,
        "optional" => false,
        other => {
            return Err(AppError::InvalidInput(format!(
                "unknown action arg requirement: {other}"
            )))
        }
    };
    let label = quoted_value(value).unwrap_or_else(|| name.to_string());
    let choices = value
        .split_whitespace()
        .find_map(|part| part.strip_prefix("choices="))
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|choice| !choice.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();

    Ok(ProjectActionArgument {
        name: name.to_string(),
        kind: kind.to_string(),
        required,
        label,
        choices,
    })
}

pub(super) fn quoted_value(value: &str) -> Option<String> {
    let start = value.find('"')?;
    let rest = &value[start + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

pub(super) struct ActionRuntime {
    pub(super) extension: &'static str,
    pub(super) shebang: &'static str,
}

pub(super) fn action_runtime(runtime: &str) -> AppResult<ActionRuntime> {
    match runtime {
        "shell" => Ok(ActionRuntime {
            extension: "sh",
            shebang: "#!/usr/bin/env bash",
        }),
        "python" => Ok(ActionRuntime {
            extension: "py",
            shebang: "#!/usr/bin/env python3",
        }),
        other => Err(AppError::InvalidInput(format!(
            "unknown action runtime: {other}"
        ))),
    }
}

pub(super) fn action_run_state(state: &str) -> AppResult<String> {
    match state.trim() {
        "starting" | "running" | "succeeded" | "failed" | "closed" => Ok(state.trim().to_string()),
        other => Err(AppError::InvalidInput(format!(
            "unknown action run state: {other}"
        ))),
    }
}

pub(super) fn action_file_name(file_name: &str, expected_extension: &str) -> AppResult<String> {
    let trimmed = required_text("action file name", file_name)?;
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(AppError::InvalidInput(
            "action file name cannot contain path separators or traversal".to_string(),
        ));
    }
    if trimmed.starts_with('.') {
        return Err(AppError::InvalidInput(
            "action file name cannot be hidden".to_string(),
        ));
    }

    let path = Path::new(&trimmed);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if extension != expected_extension {
        return Err(AppError::InvalidInput(format!(
            "action file must use .{expected_extension}"
        )));
    }

    Ok(trimmed)
}

pub(super) fn script_action_file_name(file_name: &str) -> AppResult<String> {
    if file_name == "boomerang:open-folder" {
        return Err(AppError::InvalidInput(
            "native project actions cannot be deleted or edited".to_string(),
        ));
    }

    let trimmed = required_text("action file name", file_name)?;
    let extension = Path::new(&trimmed)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !matches!(extension, "sh" | "py") {
        return Err(AppError::InvalidInput(
            "action file must use .sh or .py".to_string(),
        ));
    }

    action_file_name(&trimmed, extension)
}

pub(super) fn project_action_directory(project: &Project) -> PathBuf {
    let actions_directory = PathBuf::from(&project.actions_directory);
    if actions_directory.is_absolute() {
        return actions_directory;
    }

    expand_home_alias(&project.working_directory).join(actions_directory)
}

pub fn expand_home_alias(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }

    PathBuf::from(path)
}

pub fn home_aliased_path(path: &Path) -> String {
    let Ok(home) = env::var("HOME") else {
        return path.display().to_string();
    };
    let home = PathBuf::from(home);
    if let Ok(stripped) = path.strip_prefix(&home) {
        return format!("~/{}", stripped.display());
    }

    path.display().to_string()
}

pub fn todo_artifact_path(app_data_dir: &Path, project_id: i64, display_id: &str) -> PathBuf {
    app_data_dir
        .join("artifacts")
        .join(format!("project-{project_id}"))
        .join(format!("{display_id}.md"))
}

pub(super) fn action_run_by_id_locked(conn: &Connection, id: i64) -> AppResult<ActionRunSummary> {
    conn.query_row(
        "SELECT id, project_id, todo_id, action_file_name, action_title, runtime,
                CAST(pty_id AS INTEGER), command, working_directory, state, exit_code,
                started_at, ended_at
         FROM action_runs
         WHERE id = ?1",
        params![id],
        |row| {
            Ok(ActionRunSummary {
                id: row.get(0)?,
                project_id: row.get(1)?,
                todo_id: row.get(2)?,
                action_file_name: row.get(3)?,
                action_title: row.get(4)?,
                runtime: row.get(5)?,
                pty_id: row.get(6)?,
                command: row.get(7)?,
                working_directory: row.get(8)?,
                state: row.get(9)?,
                exit_code: row.get(10)?,
                started_at: row.get(11)?,
                ended_at: row.get(12)?,
            })
        },
    )
    .map_err(AppError::from)
}
