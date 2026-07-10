use super::*;

impl AppDb {
    pub fn update_todo_artifact(
        &self,
        todo_id: i64,
        artifact_markdown: &str,
        actor: Actor,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let (project_id, display_id, before_artifact): (i64, String, String) = tx.query_row(
            "SELECT project_id, display_id, artifact_markdown FROM todos WHERE id = ?1",
            params![todo_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let path = todo_artifact_path(&self.app_data_dir, project_id, &display_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, artifact_markdown)?;
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
            json!({ "length": artifact_markdown.len(), "path": home_aliased_path(&path) }),
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
        let (project_id, display_id): (i64, String) = {
            let conn = self.conn.lock().expect("database lock is not poisoned");
            conn.query_row(
                "SELECT project_id, display_id FROM todos WHERE id = ?1",
                params![todo_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
        };
        let path = todo_artifact_path(&self.app_data_dir, project_id, &display_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if !path.exists() {
            fs::write(&path, "")?;
        }
        Ok(path)
    }
}
