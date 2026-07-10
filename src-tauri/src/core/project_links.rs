use super::*;

impl AppDb {
    pub fn create_project(&self, input: NewProject) -> AppResult<Project> {
        if input.inherit_parent && input.parent_project_id.is_none() {
            return Err(AppError::InvalidInput(
                "inherit_parent requires a parent project".to_string(),
            ));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();

        if let Some(parent_id) = input.parent_project_id {
            let parent_exists: i64 = tx.query_row(
                "SELECT COUNT(*) FROM projects WHERE id = ?1",
                params![parent_id],
                |row| row.get(0),
            )?;
            if parent_exists == 0 {
                return Err(AppError::InvalidInput(format!(
                    "parent project not found: {parent_id}"
                )));
            }
        }

        let inherit_parent_int = if input.inherit_parent { 1 } else { 0 };
        tx.execute(
            "INSERT INTO projects
                (name, working_directory, display_id_prefix, actions_directory,
                 project_folder_open_app, created_at, updated_at, last_used_at, status, inherit_parent)
             VALUES (?1, ?2, ?3, ?4, 'cursor', ?5, ?5, ?5, 'Active', ?6)",
            params![
                input.name,
                input.working_directory,
                input.display_id_prefix,
                input.actions_directory,
                now,
                inherit_parent_int
            ],
        )?;
        let project_id = tx.last_insert_rowid();

        if let Some(parent_id) = input.parent_project_id {
            let position = next_project_link_position(&tx, parent_id)?;
            tx.execute(
                "INSERT INTO project_links (parent_project_id, child_project_id, kind, created_at, position)
                 VALUES (?1, ?2, 'subproject', ?3, ?4)",
                params![parent_id, project_id, now, position],
            )?;
        }

        let project = self.project_by_id_locked(&*tx, project_id)?;
        tx.commit()?;
        Ok(project)
    }

    pub fn record_project_use(&self, project_id: i64) -> AppResult<()> {
        if project_id <= 0 {
            return Err(AppError::InvalidInput("project id is required".to_string()));
        }

        let conn = self.conn.lock().expect("database lock is not poisoned");
        let changed = conn.execute(
            "UPDATE projects SET last_used_at = ?1 WHERE id = ?2",
            params![now_string(), project_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!(
                "project not found: {project_id}"
            )));
        }

        Ok(())
    }

    pub fn get_project(&self, project_id: i64) -> AppResult<Project> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        self.project_by_id_locked(&conn, project_id)
    }

    pub fn display_id_prefix_exists(&self, prefix: &str) -> AppResult<bool> {
        let prefix = display_id_prefix(prefix)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let count: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM projects
             WHERE UPPER(display_id_prefix) = UPPER(?1)",
            params![prefix],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn update_project_notes(&self, project_id: i64, notes_markdown: &str) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();

        let owner_id = effective_project_dir_and_notes(&*tx, project_id)?.2;

        let changed = tx.execute(
            "UPDATE projects
                SET notes_markdown = ?1, notes_updated_at = ?2, updated_at = ?2
              WHERE id = ?3",
            params![notes_markdown, now, owner_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!(
                "project not found: {owner_id}"
            )));
        }

        tx.commit()?;
        Ok(())
    }

    pub fn update_project_background_image(
        &self,
        project_id: i64,
        background_image_path: &str,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();

        let changed = tx.execute(
            "UPDATE projects
                SET background_image_path = ?1, updated_at = ?2
              WHERE id = ?3",
            params![background_image_path.trim(), now, project_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!(
                "project not found: {project_id}"
            )));
        }

        tx.commit()?;
        Ok(())
    }

    pub fn update_project_settings(&self, input: ProjectSettingsUpdate) -> AppResult<()> {
        let name = required_text("project name", &input.name)?;
        let client = input.client.trim().to_string();
        let mut working_directory = input.working_directory;
        let display_id_prefix = display_id_prefix(&input.display_id_prefix)?;
        let actions_directory = required_text("actions directory", &input.actions_directory)?;
        let project_folder_open_app =
            required_text("project folder open app", &input.project_folder_open_app)?;
        let main_branch = git_branch_ref("main branch", &input.main_branch)?;

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();

        let previous: Option<(bool,)> = tx
            .query_row(
                "SELECT inherit_parent FROM projects WHERE id = ?1",
                params![input.project_id],
                |row| Ok((row.get(0)?,)),
            )
            .optional()?;
        let previous_inherit = previous.map(|(v,)| v).unwrap_or(false);

        let new_inherit = input.inherit_parent;
        let mut clear_notes = false;

        // Turning inherit OFF on an inheriting subproject: materialize the effective
        // folder into the child's own working_directory column, and start a blank
        // notes document (parent keeps its notes).
        if previous_inherit && !new_inherit {
            let (effective_dir, _, _) = effective_project_dir_and_notes(&*tx, input.project_id)?;
            working_directory = effective_dir;
            clear_notes = true;
        }

        // Turning inherit ON: requires that this project is a subproject (has a
        // subproject edge). Clear its own working_directory; it resolves from the
        // parent chain at read time.
        if !previous_inherit && new_inherit {
            let subproject_edge: i64 = tx.query_row(
                "SELECT COUNT(*) FROM project_links WHERE child_project_id = ?1 AND kind = 'subproject'",
                params![input.project_id],
                |row| row.get(0),
            )?;
            if subproject_edge == 0 {
                return Err(AppError::InvalidInput(
                    "inherit_parent requires a subproject edge".to_string(),
                ));
            }
            working_directory = String::new();
        }

        // Staying inherited (or turning ON): the directory field is hidden and may
        // be empty; validate only when the project owns its own directory.
        if !new_inherit {
            working_directory = required_text("working directory", &working_directory)?;
        }

        let changed = tx.execute(
            "UPDATE projects
                SET name = ?1,
                    client = ?2,
                    working_directory = ?3,
                    display_id_prefix = ?4,
                    actions_directory = ?5,
                    project_folder_open_app = ?6,
                    main_branch = ?7,
                    terminal_wsl_enabled = ?8,
                    inherit_parent = ?9,
                    notes_markdown = CASE WHEN ?11 = 1 THEN '' ELSE notes_markdown END,
                    notes_updated_at = CASE WHEN ?11 = 1 THEN NULL ELSE notes_updated_at END,
                    updated_at = ?10
              WHERE id = ?12",
            params![
                name,
                client,
                working_directory,
                display_id_prefix,
                actions_directory,
                project_folder_open_app,
                main_branch,
                input.terminal_wsl_enabled,
                if new_inherit { 1 } else { 0 },
                now,
                if clear_notes { 1 } else { 0 },
                input.project_id
            ],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!(
                "project not found: {}",
                input.project_id
            )));
        }

        tx.commit()?;
        Ok(())
    }

    pub fn update_project_prompt_settings(
        &self,
        input: ProjectPromptSettingsUpdate,
    ) -> AppResult<()> {
        let ai_task_description_mode =
            task_description_mode_label(&input.ai_task_description_mode)?;

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();
        let changed = tx.execute(
            "UPDATE projects
                SET ai_task_description_mode = ?1,
                    ai_default_include_project_notes = ?2,
                    updated_at = ?3
              WHERE id = ?4",
            params![
                ai_task_description_mode,
                input.ai_default_include_project_notes,
                now,
                input.project_id
            ],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!(
                "project not found: {}",
                input.project_id
            )));
        }

        tx.commit()?;
        Ok(())
    }

    pub fn link_project(&self, parent_id: i64, child_id: i64) -> AppResult<()> {
        if parent_id == child_id {
            return Err(AppError::InvalidInput(
                "cannot link a project to itself".to_string(),
            ));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;

        let parent_exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![parent_id],
            |row| row.get(0),
        )?;
        if parent_exists == 0 {
            return Err(AppError::InvalidInput(format!(
                "parent project not found: {parent_id}"
            )));
        }
        let child_exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![child_id],
            |row| row.get(0),
        )?;
        if child_exists == 0 {
            return Err(AppError::InvalidInput(format!(
                "child project not found: {child_id}"
            )));
        }

        let duplicate: i64 = tx.query_row(
            "SELECT COUNT(*) FROM project_links WHERE parent_project_id = ?1 AND child_project_id = ?2",
            params![parent_id, child_id],
            |row| row.get(0),
        )?;
        if duplicate > 0 {
            return Err(AppError::InvalidInput(
                "project link already exists".to_string(),
            ));
        }

        let subproject_child: i64 = tx.query_row(
            "SELECT COUNT(*) FROM project_links WHERE child_project_id = ?1 AND kind = 'subproject'",
            params![child_id],
            |row| row.get(0),
        )?;
        if subproject_child > 0 {
            return Err(AppError::InvalidInput(
                "child is already a subproject and cannot be linked elsewhere".to_string(),
            ));
        }

        if subproject_path(&tx, child_id, parent_id)?.is_some() {
            return Err(AppError::InvalidInput(
                "would create a project cycle".to_string(),
            ));
        }

        let position = next_project_link_position(&tx, parent_id)?;
        tx.execute(
            "INSERT INTO project_links (parent_project_id, child_project_id, kind, created_at, position)
             VALUES (?1, ?2, 'link', ?3, ?4)",
            params![parent_id, child_id, now_string(), position],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn reorder_project_link(
        &self,
        parent_id: i64,
        child_id: i64,
        new_index: i64,
    ) -> AppResult<()> {
        if new_index < 0 {
            return Err(AppError::InvalidInput(
                "new index must be non-negative".to_string(),
            ));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let existing: Option<i64> = tx
            .query_row(
                "SELECT child_project_id
                 FROM project_links
                 WHERE parent_project_id = ?1 AND child_project_id = ?2",
                params![parent_id, child_id],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_none() {
            return Err(AppError::InvalidInput("project link not found".to_string()));
        }

        let mut child_ids = ordered_project_link_child_ids(&tx, parent_id)?;
        child_ids.retain(|id| *id != child_id);
        let insertion_index = usize::try_from(new_index)
            .unwrap_or(usize::MAX)
            .min(child_ids.len());
        child_ids.insert(insertion_index, child_id);
        write_project_link_positions(&tx, parent_id, &child_ids)?;
        tx.commit()?;
        Ok(())
    }

    pub fn unlink_project(&self, parent_id: i64, child_id: i64) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;

        let edge: Option<String> = tx
            .query_row(
                "SELECT kind FROM project_links WHERE parent_project_id = ?1 AND child_project_id = ?2",
                params![parent_id, child_id],
                |row| row.get(0),
            )
            .optional()?;
        let kind =
            edge.ok_or_else(|| AppError::InvalidInput("project link not found".to_string()))?;

        if kind == "subproject" {
            let inherit_parent: i64 = tx.query_row(
                "SELECT inherit_parent FROM projects WHERE id = ?1",
                params![child_id],
                |row| row.get(0),
            )?;
            if inherit_parent == 1 {
                let (effective_dir, _, _) = effective_project_dir_and_notes(&*tx, child_id)?;
                tx.execute(
                    "UPDATE projects
                        SET working_directory = ?1,
                            inherit_parent = 0,
                            notes_markdown = '',
                            notes_updated_at = NULL,
                            updated_at = ?3
                      WHERE id = ?2",
                    params![effective_dir, child_id, now_string()],
                )?;
            }
        }

        tx.execute(
            "DELETE FROM project_links WHERE parent_project_id = ?1 AND child_project_id = ?2",
            params![parent_id, child_id],
        )?;
        let child_ids = ordered_project_link_child_ids(&tx, parent_id)?;
        write_project_link_positions(&tx, parent_id, &child_ids)?;

        tx.commit()?;
        Ok(())
    }

    pub fn update_project_status(&self, project_id: i64, status: &str) -> AppResult<()> {
        let normalized = match status.trim().to_ascii_lowercase().as_str() {
            "active" => "Active",
            "blocked" => "Blocked",
            "done" => "Done",
            "archived" => "Archived",
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "invalid project status: {status}"
                )));
            }
        };
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let changed = tx.execute(
            "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![normalized, now_string(), project_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!(
                "project not found: {project_id}"
            )));
        }
        tx.commit()?;
        Ok(())
    }

    pub(super) fn project_by_id_locked(&self, conn: &Connection, id: i64) -> AppResult<Project> {
        let project = conn.query_row(
            "SELECT id, name, client, working_directory, display_id_prefix, actions_directory,
                    project_folder_open_app, main_branch, ai_default_include_project_notes,
                    ai_default_provider, terminal_wsl_enabled
             FROM projects
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    client: row.get(2)?,
                    working_directory: row.get(3)?,
                    display_id_prefix: row.get(4)?,
                    actions_directory: row.get(5)?,
                    project_folder_open_app: row.get(6)?,
                    main_branch: row.get(7)?,
                    ai_default_include_project_notes: row.get(8)?,
                    ai_default_provider: row.get(9)?,
                    terminal_wsl_enabled: row.get(10)?,
                })
            },
        )?;
        let (effective_dir, _, _) = effective_project_dir_and_notes(conn, id)?;
        Ok(Project {
            working_directory: effective_dir,
            ..project
        })
    }
}

fn next_project_link_position(tx: &Transaction<'_>, parent_id: i64) -> AppResult<i64> {
    let position = tx.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1
         FROM project_links
         WHERE parent_project_id = ?1",
        params![parent_id],
        |row| row.get(0),
    )?;
    Ok(position)
}

fn ordered_project_link_child_ids(tx: &Transaction<'_>, parent_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = tx.prepare(
        "SELECT child_project_id
         FROM project_links
         WHERE parent_project_id = ?1
         ORDER BY position ASC, child_project_id ASC",
    )?;
    let child_ids = stmt
        .query_map(params![parent_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(child_ids)
}

fn write_project_link_positions(
    tx: &Transaction<'_>,
    parent_id: i64,
    child_ids: &[i64],
) -> AppResult<()> {
    for (position, child_id) in child_ids.iter().enumerate() {
        tx.execute(
            "UPDATE project_links
             SET position = ?1
             WHERE parent_project_id = ?2 AND child_project_id = ?3",
            params![position as i64, parent_id, child_id],
        )?;
    }
    Ok(())
}

/// Resolves the context project a todo runs in: the todo's own
/// `context_project_id`, else the nearest ancestor todo's, else `None`.
/// Guarded against parent cycles with a visited set + a depth bound.
pub fn todo_resolved_context_project_id(conn: &Connection, todo_id: i64) -> AppResult<Option<i64>> {
    let mut current = todo_id;
    let mut visited = HashSet::new();
    visited.insert(current);

    for _ in 0..100 {
        let row: Option<(Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT context_project_id, parent_id FROM todos WHERE id = ?1",
                params![current],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((context_project_id, parent_id)) = row else {
            return Ok(None);
        };
        if context_project_id.is_some() {
            return Ok(context_project_id);
        }
        match parent_id {
            Some(parent) if visited.insert(parent) => current = parent,
            _ => return Ok(None),
        }
    }

    Ok(None)
}

/// The project whose folder, notes, and actions a todo runs in: its resolved
/// context project when one is set, otherwise its own project.
pub fn todo_effective_project_id(conn: &Connection, todo_id: i64) -> AppResult<i64> {
    if let Some(context_project_id) = todo_resolved_context_project_id(conn, todo_id)? {
        return Ok(context_project_id);
    }
    conn.query_row(
        "SELECT project_id FROM todos WHERE id = ?1",
        params![todo_id],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

/// Resolves the effective working directory, notes markdown, and owning project
/// id for a project. For a project with `inherit_parent = 0`, returns its own
/// values + its own id. For an inheriting subproject, walks up the subproject
/// edge chain to the nearest ancestor with its own config. Guard against cycles
/// with a visited set + a depth bound.
pub fn effective_project_dir_and_notes(
    conn: &Connection,
    project_id: i64,
) -> AppResult<(String, String, i64)> {
    let mut current = project_id;
    let mut visited = HashSet::new();
    visited.insert(current);

    for _ in 0..100 {
        let row: Option<(bool,)> = conn
            .query_row(
                "SELECT inherit_parent FROM projects WHERE id = ?1",
                params![current],
                |row| Ok((row.get(0)?,)),
            )
            .optional()?;
        let inherit_parent = row.map(|(v,)| v).unwrap_or(false);

        if !inherit_parent {
            let (dir, notes): (String, String) = conn.query_row(
                "SELECT working_directory, notes_markdown FROM projects WHERE id = ?1",
                params![current],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            return Ok((dir, notes, current));
        }

        let parent: Option<i64> = conn
            .query_row(
                "SELECT parent_project_id FROM project_links
                 WHERE child_project_id = ?1 AND kind = 'subproject'
                 LIMIT 1",
                params![current],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        let Some(next) = parent else {
            // Inherit flag set but no subproject edge (orphan). Fall back to own config.
            let (dir, notes): (String, String) = conn.query_row(
                "SELECT working_directory, notes_markdown FROM projects WHERE id = ?1",
                params![current],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            return Ok((dir, notes, current));
        };

        if !visited.insert(next) {
            // Cycle detected — fall back to current project's own config.
            let (dir, notes): (String, String) = conn.query_row(
                "SELECT working_directory, notes_markdown FROM projects WHERE id = ?1",
                params![current],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            return Ok((dir, notes, current));
        }

        current = next;
    }

    // Depth bound reached — fall back to current's own config.
    let (dir, notes): (String, String) = conn.query_row(
        "SELECT working_directory, notes_markdown FROM projects WHERE id = ?1",
        params![current],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok((dir, notes, current))
}
