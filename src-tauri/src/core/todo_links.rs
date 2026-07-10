use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::json;

use super::{
    child_path, insert_event_tx, now_string, project_id_for_todo, Actor, AppDb, AppError, AppResult,
};

impl AppDb {
    pub fn link_todo_under_parent(
        &self,
        source_todo_id: i64,
        target_parent_todo_id: i64,
        position: Option<i64>,
    ) -> AppResult<()> {
        if source_todo_id <= 0 || target_parent_todo_id <= 0 {
            return Err(AppError::InvalidInput(
                "source and target task ids are required".to_string(),
            ));
        }
        if source_todo_id == target_parent_todo_id {
            return Err(AppError::InvalidInput(
                "cannot link a task under itself".to_string(),
            ));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        ensure_todo_exists(&tx, source_todo_id)?;
        let target_project_id = project_id_for_todo(&tx, target_parent_todo_id)?;
        if child_path(&tx, source_todo_id, target_parent_todo_id)?.is_some() {
            return Err(AppError::InvalidInput(
                "cannot link a task under its own descendant".to_string(),
            ));
        }

        let group_len: i64 = tx.query_row(
            "SELECT COUNT(*)
             FROM todo_links
             WHERE target_parent_todo_id = ?1",
            params![target_parent_todo_id],
            |row| row.get(0),
        )?;
        let insert_pos = position.unwrap_or(group_len).clamp(0, group_len);
        tx.execute(
            "UPDATE todo_links
                SET position = position + 1
              WHERE target_parent_todo_id = ?1
                AND position >= ?2",
            params![target_parent_todo_id, insert_pos],
        )?;

        let now = now_string();
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO todo_links
                (source_todo_id, target_project_id, target_parent_todo_id, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                source_todo_id,
                target_project_id,
                target_parent_todo_id,
                insert_pos,
                now
            ],
        )?;
        if inserted == 0 {
            return Err(AppError::InvalidInput(
                "task is already linked under this parent".to_string(),
            ));
        }
        insert_event_tx(
            &tx,
            target_parent_todo_id,
            "todo_linked",
            &Actor::system("Boomerang"),
            None,
            json!({}),
            json!({
                "source_todo_id": source_todo_id,
                "target_project_id": target_project_id,
                "target_parent_todo_id": target_parent_todo_id,
                "position": insert_pos,
            }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn ensure_todo_exists(tx: &Transaction<'_>, todo_id: i64) -> AppResult<()> {
    let exists = tx
        .query_row(
            "SELECT 1 FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("todo {todo_id} not found")))
    }
}
