use super::*;

impl AppDb {
    pub fn record_execution_terminal(
        &self,
        todo_id: i64,
        pty_id: i64,
        kind: &str,
        label: &str,
    ) -> AppResult<ExecutionTerminalSummary> {
        let _todo = self.get_todo(todo_id)?;
        let kind = normalized_execution_terminal_kind(kind)?;
        let label = required_text("execution terminal label", label)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let now = now_string();
        conn.execute(
            "INSERT INTO execution_terminals
                (pty_id, todo_id, label, kind, state, exit_code, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'running', NULL, ?5, ?5)",
            params![pty_id, todo_id, label, kind, now],
        )?;

        execution_terminal_by_pty_locked(&conn, pty_id).map_err(AppError::from)
    }

    pub fn finish_execution_terminal_for_pty(
        &self,
        pty_id: i64,
        exit_code: i64,
    ) -> AppResult<Option<ExecutionTerminalSummary>> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let terminal_context = conn
            .query_row(
                "SELECT todo_id, kind FROM execution_terminals WHERE pty_id = ?1",
                params![pty_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((todo_id, kind)) = terminal_context else {
            return Ok(None);
        };

        let now = now_string();
        let state = if exit_code == 0 { "exited" } else { "failed" };
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE execution_terminals
             SET state = ?1,
                 exit_code = ?2,
                 updated_at = ?3
             WHERE pty_id = ?4",
            params![state, exit_code, now, pty_id],
        )?;
        if kind == "worktree_merge" && exit_code == 0 {
            let worktree_path = tx
                .query_row(
                    "SELECT worktree_path FROM todos WHERE id = ?1",
                    params![todo_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
            let affected = if let Some(worktree_path) = worktree_path.as_deref() {
                tx.prepare("SELECT id, worktree_merged_at FROM todos WHERE worktree_path = ?1")?
                    .query_map(params![worktree_path], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                Vec::new()
            };
            tx.execute(
                "UPDATE todos
                    SET worktree_merged_at = ?1,
                        updated_at = ?1
                  WHERE worktree_path = ?2",
                params![now, worktree_path],
            )?;
            for (affected_todo_id, previous_merged_at) in affected {
                insert_event_tx(
                    &tx,
                    affected_todo_id,
                    "worktree_merged",
                    &Actor::system("Boomerang"),
                    None,
                    json!({ "worktree_merged_at": previous_merged_at }),
                    json!({ "worktree_merged_at": now }),
                    None,
                    None,
                )?;
            }
        }
        tx.commit()?;

        execution_terminal_by_pty_locked(&conn, pty_id)
            .map(Some)
            .map_err(AppError::from)
    }

    pub fn close_execution_terminal_for_pty(
        &self,
        pty_id: i64,
    ) -> AppResult<Option<ExecutionTerminalSummary>> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let terminal = execution_terminal_by_pty_locked(&conn, pty_id).optional()?;
        if terminal.is_some() {
            conn.execute(
                "DELETE FROM execution_terminals WHERE pty_id = ?1",
                params![pty_id],
            )?;
        }

        Ok(terminal)
    }

    pub fn rename_execution_terminal(
        &self,
        pty_id: i64,
        label: &str,
    ) -> AppResult<Option<ExecutionTerminalSummary>> {
        let label = required_text("execution terminal label", label)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let exists = conn
            .query_row(
                "SELECT 1 FROM execution_terminals WHERE pty_id = ?1",
                params![pty_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        if !exists {
            return Ok(None);
        }

        let now = now_string();
        conn.execute(
            "UPDATE execution_terminals
             SET label = ?1,
                 updated_at = ?2
             WHERE pty_id = ?3",
            params![label, now, pty_id],
        )?;

        execution_terminal_by_pty_locked(&conn, pty_id)
            .map(Some)
            .map_err(AppError::from)
    }
}

fn execution_terminal_by_pty_locked(
    conn: &Connection,
    pty_id: i64,
) -> rusqlite::Result<ExecutionTerminalSummary> {
    conn.query_row(
        "SELECT todo_id, pty_id, label, kind, state, exit_code
         FROM execution_terminals
         WHERE pty_id = ?1",
        params![pty_id],
        |row| {
            Ok(ExecutionTerminalSummary {
                todo_id: row.get(0)?,
                pty_id: row.get(1)?,
                label: row.get(2)?,
                kind: row.get(3)?,
                state: row.get(4)?,
                exit_code: row.get(5)?,
            })
        },
    )
}

fn normalized_execution_terminal_kind(kind: &str) -> AppResult<String> {
    let normalized = kind.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "terminal" | "codex" | "claude" | "omp" | "worktree_merge" => Ok(normalized),
        other => Err(AppError::InvalidInput(format!(
            "unknown execution terminal kind: {other}"
        ))),
    }
}
