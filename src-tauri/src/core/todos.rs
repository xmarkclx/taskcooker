use super::*;

impl AppDb {
    pub fn delete_todos(&self, todo_ids: &[i64]) -> AppResult<()> {
        let todo_ids = unique_todo_ids(todo_ids)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;

        for todo_id in todo_ids {
            let parent_id: Option<i64> = tx
                .query_row(
                    "SELECT parent_id FROM todos WHERE id = ?1",
                    params![todo_id],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();

            tx.execute(
                "UPDATE todos SET parent_id = ?1 WHERE parent_id = ?2",
                params![parent_id, todo_id],
            )?;
            tx.execute(
                "DELETE FROM dependencies WHERE todo_id = ?1 OR depends_on_todo_id = ?1",
                params![todo_id],
            )?;
            tx.execute("DELETE FROM events WHERE todo_id = ?1", params![todo_id])?;
            tx.execute("DELETE FROM time_logs WHERE todo_id = ?1", params![todo_id])?;
            let deleted = tx.execute("DELETE FROM todos WHERE id = ?1", params![todo_id])?;
            if deleted == 0 {
                return Err(AppError::InvalidInput(format!("todo {todo_id} not found")));
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_todos(&self, todo_ids: &[i64]) -> AppResult<Vec<Todo>> {
        let todo_ids = unique_todo_ids(todo_ids)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        todo_ids
            .into_iter()
            .map(|todo_id| todo_by_id_locked(&conn, todo_id))
            .collect()
    }

    pub fn set_todo_panel_visibility(
        &self,
        todo_id: i64,
        description_panel_hidden: bool,
        execution_panel_hidden: bool,
    ) -> AppResult<AppSnapshot> {
        if todo_id <= 0 {
            return Err(AppError::InvalidInput("todo id is required".to_string()));
        }

        {
            let conn = self.conn.lock().expect("database lock is not poisoned");
            let changed = conn.execute(
                "UPDATE todos
                    SET description_panel_hidden = ?1,
                        execution_panel_hidden = ?2
                  WHERE id = ?3",
                params![description_panel_hidden, execution_panel_hidden, todo_id],
            )?;
            if changed == 0 {
                return Err(AppError::InvalidInput(format!("todo {todo_id} not found")));
            }
        }

        self.app_snapshot(None, Some(todo_id))
    }

    pub fn set_todo_toc_visibility(
        &self,
        todo_id: i64,
        description_toc_hidden: bool,
        artifact_toc_hidden: bool,
    ) -> AppResult<AppSnapshot> {
        if todo_id <= 0 {
            return Err(AppError::InvalidInput("todo id is required".to_string()));
        }

        {
            let conn = self.conn.lock().expect("database lock is not poisoned");
            let changed = conn.execute(
                "UPDATE todos
                    SET description_toc_hidden = ?1,
                        artifact_toc_hidden = ?2
                  WHERE id = ?3",
                params![description_toc_hidden, artifact_toc_hidden, todo_id],
            )?;
            if changed == 0 {
                return Err(AppError::InvalidInput(format!("todo {todo_id} not found")));
            }
        }

        self.app_snapshot(None, Some(todo_id))
    }

    pub fn record_todo_omp_session_id(&self, todo_id: i64, session_id: &str) -> AppResult<()> {
        self.record_todo_provider_session_id(todo_id, "omp", session_id)
    }

    pub fn record_todo_provider_session_id(
        &self,
        todo_id: i64,
        provider: &str,
        session_id: &str,
    ) -> AppResult<()> {
        let provider = normalized_provider_state_key(provider)?;
        let session_id = required_text("provider session id", session_id)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let previous_session_id = tx
            .query_row(
                "SELECT session_id FROM todo_provider_state WHERE todo_id = ?1 AND provider = ?2",
                params![todo_id, provider],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let exists = tx
            .query_row(
                "SELECT 1 FROM todos WHERE id = ?1",
                params![todo_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        if !exists {
            return Err(AppError::InvalidInput(format!("todo {todo_id} not found")));
        }
        let now = now_string();
        tx.execute(
            "INSERT INTO todo_provider_state (todo_id, provider, session_id, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(todo_id, provider) DO UPDATE SET
                session_id = excluded.session_id,
                updated_at = excluded.updated_at",
            params![todo_id, provider, session_id, now],
        )?;
        tx.execute(
            "UPDATE todos SET updated_at = ?1 WHERE id = ?2",
            params![now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "provider_session_saved",
            &Actor::system("Boomerang"),
            Some(&session_id),
            json!({ "provider": provider, "sessionId": previous_session_id }),
            json!({ "provider": provider, "sessionId": session_id }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todos_state(&self, input: UpdateTodosState) -> AppResult<()> {
        let todo_ids = unique_todo_ids(&input.todo_ids)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let after_state = input.state.as_label();
        let now = now_string();

        for todo_id in todo_ids {
            let before_state: String = tx.query_row(
                "SELECT state FROM todos WHERE id = ?1",
                params![todo_id],
                |row| row.get(0),
            )?;

            tx.execute(
                "UPDATE todos SET state = ?1, updated_at = ?2 WHERE id = ?3",
                params![after_state, now, todo_id],
            )?;
            insert_event_tx(
                &tx,
                todo_id,
                "state_changed",
                &input.actor,
                input.conversation_id.as_deref(),
                json!({ "state": before_state.as_str() }),
                json!({ "state": after_state }),
                input.message.as_deref(),
                input.link.as_deref(),
            )?;
            insert_marked_done_event_if_needed(
                &tx,
                todo_id,
                &input.actor,
                input.conversation_id.as_deref(),
                before_state.as_str(),
                after_state,
                input.message.as_deref(),
                input.link.as_deref(),
            )?;
        }

        tx.commit()?;
        Ok(())
    }
}

fn normalized_provider_state_key(provider: &str) -> AppResult<String> {
    let provider = required_text("provider", provider)?.to_ascii_lowercase();
    match provider.as_str() {
        "omp" | "codex" | "claude" => Ok(provider),
        other => Err(AppError::InvalidInput(format!(
            "unknown provider session state: {other}"
        ))),
    }
}
