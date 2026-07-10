use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

use super::*;

impl AppDb {
    pub fn suggest_todo_worktree_name(&self, todo_id: i64) -> AppResult<String> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let display_id: String = conn.query_row(
            "SELECT display_id FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        let project_id = todo_effective_project_id(&conn, todo_id)?;
        let working_directory = effective_project_dir_and_notes(&conn, project_id)?.0;
        let existing_names = conn
            .prepare("SELECT worktree_name FROM todos WHERE worktree_name IS NOT NULL")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        drop(conn);

        let base = worktree_branch_name(&display_id)?;
        let project_path = expand_home_alias(&working_directory);
        Ok(next_available_worktree_name(
            &base,
            project_path.parent(),
            &existing_names,
        ))
    }

    pub fn enable_todo_worktree(
        &self,
        todo_id: i64,
        worktree_name: &str,
    ) -> AppResult<TodoWorktreeSummary> {
        let worktree_name = worktree_branch_name(worktree_name)?;
        let (todo_id, project_id, existing_name, main_branch, project_working_directory) = {
            let conn = self.conn.lock().expect("database lock is not poisoned");
            let (todo_id, existing_name) = conn.query_row(
                "SELECT id, worktree_name FROM todos WHERE id = ?1",
                params![todo_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )?;
            let project_id = todo_effective_project_id(&conn, todo_id)?;
            let main_branch: String = conn.query_row(
                "SELECT main_branch FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )?;
            let project_working_directory = effective_project_dir_and_notes(&conn, project_id)?.0;
            (
                todo_id,
                project_id,
                existing_name,
                main_branch,
                project_working_directory,
            )
        };
        let _ = (todo_id, project_id);
        if existing_name.is_some() {
            return Err(AppError::InvalidInput(
                "todo already has a worktree".to_string(),
            ));
        }
        let main_branch = git_branch_ref("main branch", &main_branch)?;
        let project_path = expand_home_alias(&project_working_directory);
        if !project_path.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "project folder does not exist: {}",
                project_path.display()
            )));
        }
        let parent = project_path.parent().ok_or_else(|| {
            AppError::InvalidInput("project working directory has no parent".to_string())
        })?;
        let worktree_path = parent.join(&worktree_name);
        if worktree_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "worktree path already exists: {}",
                worktree_path.display()
            )));
        }

        let output = Command::new("git")
            .arg("-C")
            .arg(&project_path)
            .arg("worktree")
            .arg("add")
            .arg("-b")
            .arg(&worktree_name)
            .arg(&worktree_path)
            .arg(&main_branch)
            .output()
            .map_err(AppError::from)?;
        if !output.status.success() {
            return Err(AppError::InvalidInput(format!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        let path = worktree_path.display().to_string();
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let changed = tx.execute(
            "UPDATE todos
                SET worktree_name = ?1,
                    worktree_path = ?2,
                    worktree_created_at = ?3,
                    updated_at = ?3
              WHERE id = ?4 AND worktree_name IS NULL",
            params![worktree_name, path, now_string(), todo_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(
                "todo already has a worktree".to_string(),
            ));
        }
        insert_event_tx(
            &tx,
            todo_id,
            "worktree_created",
            &Actor::system("Boomerang"),
            None,
            json!({}),
            json!({
                "worktree_name": worktree_name,
                "worktree_path": path,
                "branch": worktree_name,
                "main_branch": main_branch,
            }),
            None,
            None,
        )?;
        tx.commit()?;

        Ok(TodoWorktreeSummary {
            todo_id,
            name: worktree_name.clone(),
            path,
            branch: worktree_name,
            main_branch,
        })
    }

    pub fn todo_working_directory(&self, todo_id: i64) -> AppResult<String> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let worktree_path: Option<String> = conn.query_row(
            "SELECT worktree_path FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        if let Some(path) = worktree_path {
            return Ok(path);
        }
        let project_id = todo_effective_project_id(&conn, todo_id)?;
        Ok(effective_project_dir_and_notes(&conn, project_id)?.0)
    }
    pub fn todo_worktree_target(&self, todo_id: i64) -> AppResult<TodoWorktreeTarget> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let (todo_id, display_id, title, worktree_name, worktree_path) = conn.query_row(
            "SELECT id, display_id, title, worktree_name, worktree_path
             FROM todos
             WHERE id = ?1",
            params![todo_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )?;
        let project_id = todo_effective_project_id(&conn, todo_id)?;
        let (project_name, main_branch, terminal_wsl_enabled): (String, String, bool) = conn
            .query_row(
                "SELECT name, main_branch, terminal_wsl_enabled FROM projects WHERE id = ?1",
                params![project_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        let project_working_directory = effective_project_dir_and_notes(&conn, project_id)?.0;
        let worktree_name = worktree_name
            .ok_or_else(|| AppError::InvalidInput("todo does not have a worktree".to_string()))?;
        let worktree_path = worktree_path.ok_or_else(|| {
            AppError::InvalidInput("todo does not have a worktree path".to_string())
        })?;

        Ok(TodoWorktreeTarget {
            todo_id,
            display_id,
            title,
            project_id,
            project_name,
            project_working_directory,
            worktree_name,
            worktree_path,
            main_branch,
            terminal_wsl_enabled,
        })
    }

    pub fn todo_worktree_status(&self, todo_id: i64) -> AppResult<TodoWorktreeStatusSummary> {
        let target = self.todo_worktree_target(todo_id)?;
        let output = Command::new("git")
            .arg("-C")
            .arg(expand_home_alias(&target.worktree_path))
            .arg("status")
            .arg("--porcelain")
            .output()
            .map_err(AppError::from)?;
        if !output.status.success() {
            return Err(AppError::InvalidInput(format!(
                "git status failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        Ok(TodoWorktreeStatusSummary {
            todo_id,
            dirty: !output.stdout.is_empty(),
        })
    }

    pub fn delete_todo_worktree(&self, todo_id: i64) -> AppResult<()> {
        let target = self.todo_worktree_target(todo_id)?;
        let project_path = expand_home_alias(&target.project_working_directory);
        let worktree_path = expand_home_alias(&target.worktree_path);
        let output = Command::new("git")
            .arg("-C")
            .arg(&project_path)
            .arg("worktree")
            .arg("remove")
            .arg("--force")
            .arg(&worktree_path)
            .output()
            .map_err(AppError::from)?;
        if !output.status.success() {
            return Err(AppError::InvalidInput(format!(
                "git worktree remove failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();
        let changed = tx.execute(
            "UPDATE todos
                SET worktree_name = NULL,
                    worktree_path = NULL,
                    worktree_created_at = NULL,
                    worktree_merged_at = NULL,
                    updated_at = ?1
              WHERE id = ?2",
            params![now, todo_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!("todo not found: {todo_id}")));
        }
        insert_event_tx(
            &tx,
            todo_id,
            "worktree_deleted",
            &Actor::system("Boomerang"),
            None,
            json!({
                "worktree_name": target.worktree_name,
                "worktree_path": target.worktree_path,
            }),
            json!({}),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }
}

pub(super) fn worktree_branch_name(value: &str) -> AppResult<String> {
    let value = required_text("worktree name", value)?;
    if value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(AppError::InvalidInput(
            "worktree name cannot contain path separators or traversal".to_string(),
        ));
    }
    if value.starts_with('.') || value.ends_with('.') {
        return Err(AppError::InvalidInput(
            "worktree name cannot start or end with a dot".to_string(),
        ));
    }
    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(AppError::InvalidInput(
            "worktree name can only contain letters, numbers, dots, dashes, and underscores"
                .to_string(),
        ));
    }

    Ok(value)
}

pub(super) fn git_branch_ref(label: &str, value: &str) -> AppResult<String> {
    let value = required_text(label, value)?;
    if value.contains('\\') || value.contains("..") || value.contains('~') || value.contains('^') {
        return Err(AppError::InvalidInput(format!(
            "{label} is not a valid git ref"
        )));
    }
    if value.starts_with('/')
        || value.ends_with('/')
        || value.ends_with('.')
        || value.contains("//")
    {
        return Err(AppError::InvalidInput(format!(
            "{label} is not a valid git ref"
        )));
    }
    if !value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/')
    }) {
        return Err(AppError::InvalidInput(format!(
            "{label} is not a valid git ref"
        )));
    }

    Ok(value)
}

fn next_available_worktree_name(
    base: &str,
    parent: Option<&Path>,
    existing_names: &HashSet<String>,
) -> String {
    for suffix in 0.. {
        let candidate = if suffix == 0 {
            base.to_string()
        } else {
            format!("{base}-{suffix}")
        };
        let path_exists = parent
            .map(|directory| directory.join(&candidate).exists())
            .unwrap_or(false);
        if !path_exists && !existing_names.contains(&candidate) {
            return candidate;
        }
    }

    unreachable!("unbounded suffix search returns before integer exhaustion")
}
