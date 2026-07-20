use super::*;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TodoArtifactLocation {
    pub(super) host_path: PathBuf,
    pub(super) markdown_path: String,
}

fn host_home_directory() -> Option<PathBuf> {
    if cfg!(windows) {
        if let Some(home) = env::var_os("USERPROFILE") {
            return Some(PathBuf::from(home));
        }
    }

    env::var_os("HOME").map(PathBuf::from)
}

fn todo_artifact_location_for_roots(
    app_data_dir: &Path,
    host_home: Option<&Path>,
    wsl_home: Option<&Path>,
    use_wsl: bool,
    project_id: i64,
    display_id: &str,
) -> AppResult<TodoArtifactLocation> {
    let native_path = todo_artifact_path(app_data_dir, project_id, display_id);
    if !use_wsl {
        return Ok(TodoArtifactLocation {
            markdown_path: home_aliased_path(&native_path),
            host_path: native_path,
        });
    }

    let host_home = host_home.ok_or_else(|| {
        AppError::InvalidInput("cannot resolve the Windows user home directory".to_string())
    })?;
    let relative_path = native_path.strip_prefix(host_home).map_err(|_| {
        AppError::InvalidInput(format!(
            "app data directory is outside the Windows user home: {}",
            app_data_dir.display()
        ))
    })?;
    let wsl_home = wsl_home.ok_or_else(|| {
        AppError::InvalidInput("cannot resolve the default WSL home directory".to_string())
    })?;

    Ok(TodoArtifactLocation {
        host_path: wsl_home.join(relative_path),
        markdown_path: format!(
            "~/{}",
            relative_path
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        ),
    })
}

fn resolve_wsl_home_directory() -> Result<PathBuf, String> {
    if !cfg!(windows) {
        return Err("WSL artifact storage is only available on Windows".to_string());
    }

    let output = Command::new("wsl.exe")
        .args(["--exec", "sh", "-lc", r#"wslpath -w "$HOME""#])
        .output()
        .map_err(|err| format!("cannot resolve the default WSL home directory: {err}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "cannot resolve the default WSL home directory: {}",
            detail.trim()
        ));
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Err("cannot resolve the default WSL home directory: empty path".to_string());
    }
    Ok(PathBuf::from(path))
}

impl AppDb {
    pub(super) fn todo_artifact_location(
        &self,
        project_id: i64,
        display_id: &str,
        terminal_wsl_enabled: bool,
    ) -> AppResult<TodoArtifactLocation> {
        let use_wsl = terminal_wsl_enabled && cfg!(windows);
        let wsl_home = if use_wsl {
            match self.wsl_home_dir.get_or_init(resolve_wsl_home_directory) {
                Ok(path) => Some(path.as_path()),
                Err(message) => return Err(AppError::InvalidInput(message.clone())),
            }
        } else {
            None
        };
        let host_home = host_home_directory();
        todo_artifact_location_for_roots(
            &self.app_data_dir,
            host_home.as_deref(),
            wsl_home,
            use_wsl,
            project_id,
            display_id,
        )
    }

    pub fn update_todo_artifact(
        &self,
        todo_id: i64,
        artifact_markdown: &str,
        actor: Actor,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let (project_id, display_id, before_artifact, terminal_wsl_enabled): (
            i64,
            String,
            String,
            bool,
        ) = tx.query_row(
            "SELECT t.project_id, t.display_id, t.artifact_markdown, p.terminal_wsl_enabled
               FROM todos t
               JOIN projects p ON p.id = t.project_id
              WHERE t.id = ?1",
            params![todo_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        let location =
            self.todo_artifact_location(project_id, &display_id, terminal_wsl_enabled)?;
        let path = &location.host_path;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, artifact_markdown)?;
        let now = now_string();

        tx.execute(
            "UPDATE todos
                SET artifact_markdown = ?1, artifact_updated_at = ?2, updated_at = ?2
              WHERE id = ?3",
            params![artifact_markdown, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "artifact_changed",
            &actor,
            None,
            json!({ "length": before_artifact.len() }),
            json!({ "length": artifact_markdown.len(), "path": location.markdown_path }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Root directory under which every project's artifact files live. Used by the
    /// filesystem watcher to detect external edits.
    pub fn artifacts_root(&self) -> PathBuf {
        self.app_data_dir.join("artifacts")
    }

    /// Resolves the todo id for an artifact file identified by its project id and
    /// display id (the file name without extension). Returns `None` if no such todo
    /// exists, e.g. for a stray file under the artifacts directory.
    pub fn todo_id_for_artifact(&self, project_id: i64, display_id: &str) -> Option<i64> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        conn.query_row(
            "SELECT id FROM todos WHERE project_id = ?1 AND display_id = ?2",
            params![project_id, display_id],
            |row| row.get(0),
        )
        .ok()
    }

    pub fn ensure_todo_artifact_file(&self, todo_id: i64) -> AppResult<PathBuf> {
        let (project_id, display_id, terminal_wsl_enabled): (i64, String, bool) = {
            let conn = self.conn.lock().expect("database lock is not poisoned");
            conn.query_row(
                "SELECT t.project_id, t.display_id, p.terminal_wsl_enabled
                   FROM todos t
                   JOIN projects p ON p.id = t.project_id
                  WHERE t.id = ?1",
                params![todo_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?
        };
        let path = self
            .todo_artifact_location(project_id, &display_id, terminal_wsl_enabled)?
            .host_path;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if !path.exists() {
            fs::write(&path, "")?;
        }
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_project_artifacts_resolve_under_wsl_home_with_a_linux_prompt_path() {
        let windows_home = Path::new(r"C:\Users\mark");
        let app_data_dir = windows_home
            .join("AppData")
            .join("Roaming")
            .join("com.marklopez.boomerangtasks");
        let wsl_home = Path::new(r"\\wsl.localhost\Ubuntu\home\mark");

        let location = todo_artifact_location_for_roots(
            &app_data_dir,
            Some(windows_home),
            Some(wsl_home),
            true,
            6,
            "F2-15",
        )
        .expect("WSL artifact location");

        assert_eq!(
            location.host_path,
            wsl_home
                .join("AppData")
                .join("Roaming")
                .join("com.marklopez.boomerangtasks")
                .join("artifacts")
                .join("project-6")
                .join("F2-15.md")
        );
        assert_eq!(
            location.markdown_path,
            "~/AppData/Roaming/com.marklopez.boomerangtasks/artifacts/project-6/F2-15.md"
        );
    }
}
