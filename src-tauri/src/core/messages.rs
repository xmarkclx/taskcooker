use rusqlite::{params, OptionalExtension};

use super::*;

impl AppDb {
    /// Full message history for one task. The app snapshot only carries the
    /// unread/pending slice, so per-todo readers (CLI/MCP `get`) use this.
    pub fn todo_messages(&self, todo_id: i64) -> AppResult<Vec<MessageSummary>> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        read_models::todo_message_summaries(&conn, todo_id)
    }

    pub fn mark_todo_messages_read(&self, todo_id: i64) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let exists: Option<i64> = tx
            .query_row(
                "SELECT id FROM todos WHERE id = ?1",
                params![todo_id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(AppError::InvalidInput(format!("todo not found: {todo_id}")));
        }
        let last_read_event_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(id), 0)
             FROM events
             WHERE todo_id = ?1 AND message IS NOT NULL",
            params![todo_id],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO todo_message_reads (todo_id, last_read_event_id, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(todo_id) DO UPDATE SET
                last_read_event_id = excluded.last_read_event_id,
                updated_at = excluded.updated_at",
            params![todo_id, last_read_event_id, now_string()],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_project(db: &AppDb) -> Project {
        db.create_project(NewProject {
            name: "Messages Project".to_string(),
            working_directory: "/tmp/messages-project".to_string(),
            display_id_prefix: "M".to_string(),
            actions_directory: "actions".to_string(),
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("create project")
    }

    #[test]
    fn snapshot_messages_only_ship_unread_and_pending_rows() {
        let db = AppDb::open_in_memory().expect("db");
        let project = seed_project(&db);
        let todo = db.create_todo(project.id, "Messages todo").expect("todo");

        db.message_todo(
            todo.id,
            Actor {
                actor_type: "agent".to_string(),
                actor_name: "Agent CLI".to_string(),
            },
            "agent update",
            None,
            None,
        )
        .expect("agent message");
        db.message_todo(
            todo.id,
            Actor {
                actor_type: "human".to_string(),
                actor_name: "Mark".to_string(),
            },
            "human reply",
            None,
            None,
        )
        .expect("human message");

        let snapshot = db
            .app_snapshot(Some(project.id), Some(todo.id))
            .expect("snapshot");
        let agent_message = snapshot
            .messages
            .iter()
            .find(|message| message.actor_type == "agent")
            .expect("unread agent message is shipped");
        assert_eq!(agent_message.unread, Some(true));
        let human_message = snapshot
            .messages
            .iter()
            .find(|message| message.actor_type == "human")
            .expect("pending human message is shipped");
        assert_eq!(
            human_message.delivery.as_deref(),
            Some(read_models::PENDING_HUMAN_MESSAGE_DELIVERY)
        );

        db.mark_todo_messages_read(todo.id).expect("mark read");
        let snapshot = db
            .app_snapshot(Some(project.id), Some(todo.id))
            .expect("snapshot after read");
        assert!(
            snapshot
                .messages
                .iter()
                .all(|message| message.actor_type == "human"),
            "read agent messages must be dropped from the snapshot payload"
        );
        assert_eq!(snapshot.messages.len(), 1);

        // The CLI/MCP `get` path must keep seeing the full history.
        let history = db.todo_messages(todo.id).expect("todo messages");
        assert_eq!(history.len(), 2);
        assert_eq!(
            history
                .iter()
                .map(|message| message.actor_type.as_str())
                .collect::<Vec<_>>(),
            vec!["agent", "human"]
        );
    }
}
