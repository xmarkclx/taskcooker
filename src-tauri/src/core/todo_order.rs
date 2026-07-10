use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::json;

use super::{
    child_path, insert_event_tx, now_string, project_id_for_todo, schema, todo_by_id_locked, Actor,
    AppDb, AppError, AppResult, Todo, TodoState,
};

impl AppDb {
    pub fn create_todo_with_position(
        &self,
        project_id: i64,
        title: &str,
        description_markdown: &str,
        parent_id: Option<i64>,
        position: Option<i64>,
    ) -> AppResult<Todo> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title is required".to_string()));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();
        let (seq, prefix): (i64, String) = tx.query_row(
            "UPDATE projects
                SET last_seq = last_seq + 1, updated_at = ?2
              WHERE id = ?1
              RETURNING last_seq, display_id_prefix",
            params![project_id, now],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let display_id = format!("{prefix}-{seq}");
        let group_len: i64 = tx.query_row(
            "SELECT COUNT(*)
             FROM todos
             WHERE project_id = ?1 AND IFNULL(parent_id, -1) = IFNULL(?2, -1)",
            params![project_id, parent_id],
            |row| row.get(0),
        )?;
        let insert_pos = position.unwrap_or(group_len).clamp(0, group_len);
        let initial_state = TodoState::ToDo.as_label();
        tx.execute(
            "UPDATE todos
                SET position = position + 1
              WHERE project_id = ?1
                AND IFNULL(parent_id, -1) = IFNULL(?2, -1)
                AND position >= ?3",
            params![project_id, parent_id, insert_pos],
        )?;

        tx.execute(
            "INSERT INTO todos
                (project_id, seq, display_id, title, description_markdown, state, parent_id,
                 position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                project_id,
                seq,
                display_id,
                title,
                description_markdown,
                initial_state,
                parent_id,
                insert_pos,
                now
            ],
        )?;
        let todo_id = tx.last_insert_rowid();
        insert_event_tx(
            &tx,
            todo_id,
            "created",
            &Actor::system("Boomerang"),
            None,
            json!({}),
            json!({ "state": initial_state, "title": title, "parent_id": parent_id, "position": insert_pos }),
            None,
            None,
        )?;
        tx.commit()?;
        todo_by_id_locked(&conn, todo_id)
    }

    pub fn debug_reset_positions(&self) -> AppResult<()> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        conn.execute("UPDATE todos SET position = 0", [])?;
        Ok(())
    }

    pub fn debug_backfill_positions(&self) -> AppResult<()> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        schema::backfill_positions(&conn)
    }

    pub fn reorder_todo(
        &self,
        todo_id: i64,
        new_parent_id: Option<i64>,
        new_index: i64,
    ) -> AppResult<()> {
        self.reorder_todo_with_project(todo_id, None, new_parent_id, new_index)
    }

    pub fn reorder_todo_with_project(
        &self,
        todo_id: i64,
        new_project_id: Option<i64>,
        new_parent_id: Option<i64>,
        new_index: i64,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;

        let (project_id, old_parent_id): (i64, Option<i64>) = tx.query_row(
            "SELECT project_id, parent_id FROM todos WHERE id = ?1",
            params![todo_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        let target_project_id = match new_parent_id {
            Some(parent_id) => {
                if parent_id == todo_id {
                    return Err(AppError::InvalidInput(
                        "cannot nest a task under itself".to_string(),
                    ));
                }
                if child_path(&tx, todo_id, parent_id)?.is_some() {
                    return Err(AppError::InvalidInput(
                        "would create parent cycle".to_string(),
                    ));
                }

                let parent_project_id = project_id_for_todo(&tx, parent_id)?;
                if let Some(requested_project_id) = new_project_id {
                    if requested_project_id != parent_project_id {
                        return Err(AppError::InvalidInput(
                            "target project must match the new parent project".to_string(),
                        ));
                    }
                }
                parent_project_id
            }
            None => new_project_id.unwrap_or(project_id),
        };
        ensure_project_exists(&tx, target_project_id)?;

        if let Some(parent_id) = new_parent_id {
            if target_project_id == project_id && project_id_for_todo(&tx, parent_id)? != project_id
            {
                return Err(AppError::InvalidInput(
                    "parent and child must belong to the same project".to_string(),
                ));
            }
        }

        let now = now_string();
        if target_project_id != project_id {
            let subtree_ids = todo_subtree_ids(&tx, todo_id)?;
            for subtree_todo_id in subtree_ids {
                let seq = allocate_project_seq(&tx, target_project_id, &now)?;
                tx.execute(
                    "UPDATE todos
                        SET project_id = ?1, seq = ?2, updated_at = ?3
                      WHERE id = ?4",
                    params![target_project_id, seq, now, subtree_todo_id],
                )?;
            }
        }

        tx.execute(
            "UPDATE todos
                SET parent_id = ?1, position = -1, updated_at = ?2
              WHERE id = ?3",
            params![new_parent_id, now, todo_id],
        )?;

        if old_parent_id != new_parent_id || target_project_id != project_id {
            renumber_group(&tx, project_id, old_parent_id)?;
        }

        let mut stmt = tx.prepare(
            "SELECT id
             FROM todos
             WHERE project_id = ?1
               AND IFNULL(parent_id, -1) = IFNULL(?2, -1)
               AND id <> ?3
             ORDER BY position ASC, id ASC",
        )?;
        let mut ids = stmt
            .query_map(params![target_project_id, new_parent_id, todo_id], |row| {
                row.get(0)
            })?
            .collect::<Result<Vec<i64>, _>>()?;
        drop(stmt);

        let insert_index = new_index.clamp(0, ids.len() as i64) as usize;
        ids.insert(insert_index, todo_id);
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE todos SET position = ?1 WHERE id = ?2",
                params![position as i64, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn ensure_project_exists(tx: &Transaction<'_>, project_id: i64) -> AppResult<()> {
    let exists = tx
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "target project does not exist".to_string(),
        ))
    }
}

fn allocate_project_seq(tx: &Transaction<'_>, project_id: i64, now: &str) -> AppResult<i64> {
    tx.query_row(
        "UPDATE projects
            SET last_seq = last_seq + 1, updated_at = ?2
          WHERE id = ?1
          RETURNING last_seq",
        params![project_id, now],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

fn todo_subtree_ids(tx: &Transaction<'_>, todo_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = tx.prepare(
        "WITH RECURSIVE subtree(id, depth) AS (
            SELECT ?1, 0
            UNION ALL
            SELECT t.id, subtree.depth + 1
            FROM todos t
            JOIN subtree ON t.parent_id = subtree.id
        )
        SELECT id FROM subtree ORDER BY depth ASC, id ASC",
    )?;
    let ids = stmt
        .query_map(params![todo_id], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    Ok(ids)
}

fn renumber_group(tx: &Transaction<'_>, project_id: i64, parent_id: Option<i64>) -> AppResult<()> {
    let mut stmt = tx.prepare(
        "SELECT id
         FROM todos
         WHERE project_id = ?1 AND IFNULL(parent_id, -1) = IFNULL(?2, -1)
         ORDER BY position ASC, id ASC",
    )?;
    let ids = stmt
        .query_map(params![project_id, parent_id], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    drop(stmt);

    for (position, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE todos SET position = ?1 WHERE id = ?2",
            params![position as i64, id],
        )?;
    }
    Ok(())
}
