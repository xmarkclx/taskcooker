use std::collections::HashSet;
use std::env;
use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

pub type AppResult<T> = Result<T, AppError>;
const STALE_TODO_SECONDS: i64 = 24 * 60 * 60;

/// File name of the SQLite database inside the app-data directory. Shared by the
/// desktop app, the headless server, and the CLI so they all open the same file.
pub const DATABASE_FILE_NAME: &str = "boomerang.sqlite3";

/// Absolute path to the running BoomerangTasks binary, surfaced in the snapshot
/// so prompts can tell agents exactly which `boomerang` command to invoke.
pub fn current_binary_path() -> String {
    env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "boomerang".to_string())
}

#[derive(Debug)]
pub enum AppError {
    Database(rusqlite::Error),
    InvalidInput(String),
    Io(std::io::Error),
}

impl Display for AppError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(err) => write!(f, "{err}"),
            Self::InvalidInput(message) => write!(f, "{message}"),
            Self::Io(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

#[derive(Debug)]
pub struct AppDb {
    app_data_dir: PathBuf,
    conn: Mutex<Connection>,
}

mod actions;
mod artifacts;
mod execution_terminals;
mod graph;
mod messages;
mod models;
mod project_links;
mod read_models;
pub(super) use project_links::effective_project_dir_and_notes;
pub(super) use project_links::todo_effective_project_id;
mod schema;
mod seed;
mod settings;
mod time;
mod todo_links;
mod todo_order;
mod todos;
mod validation;
mod worktrees;

pub use actions::{expand_home_alias, home_aliased_path, todo_artifact_path};
pub use models::*;

use actions::*;
use graph::*;
use read_models::*;
use schema::migrate;
use seed::seed_demo_data_tx;
use settings::*;
use validation::*;
use worktrees::*;

fn clear_process_execution_terminals(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM execution_terminals", [])?;
    let now = now_string();
    conn.execute(
        "UPDATE agent_sessions
         SET state = 'exited',
             last_activity = 'session ended when TaskCooker closed',
             ended_at = COALESCE(ended_at, ?1),
             updated_at = ?1
         WHERE state = 'running'",
        params![now],
    )?;
    Ok(())
}

fn unique_todo_ids(todo_ids: &[i64]) -> AppResult<Vec<i64>> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for todo_id in todo_ids {
        if *todo_id <= 0 {
            return Err(AppError::InvalidInput("todo id is required".to_string()));
        }
        if seen.insert(*todo_id) {
            unique.push(*todo_id);
        }
    }

    if unique.is_empty() {
        return Err(AppError::InvalidInput(
            "at least one todo id is required".to_string(),
        ));
    }

    Ok(unique)
}

impl AppDb {
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        migrate(&conn)?;
        clear_process_execution_terminals(&conn)?;
        Ok(Self {
            app_data_dir: env::temp_dir().join(format!("boomerang-tasks-{}", uuid::Uuid::new_v4())),
            conn: Mutex::new(conn),
        })
    }

    pub fn open_path(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        let conn = Connection::open(path)?;
        migrate(&conn)?;
        clear_process_execution_terminals(&conn)?;
        Ok(Self {
            app_data_dir: path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf(),
            conn: Mutex::new(conn),
        })
    }

    /// Open an existing database without resetting live process state.
    ///
    /// Unlike [`open_path`], this does **not** clear execution terminals or mark
    /// running agent sessions as exited — that reset is owned by the desktop app
    /// at startup. The `boomerang` CLI uses this so running it never wipes the
    /// terminals/sessions of an app instance that is already open against the same
    /// database file.
    pub fn connect_path(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        let conn = Connection::open(path)?;
        migrate(&conn)?;
        Ok(Self {
            app_data_dir: path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf(),
            conn: Mutex::new(conn),
        })
    }

    /// Directory that holds the database file and related app data.
    pub fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }

    /// Absolute path to the SQLite database file backing this instance.
    pub fn database_path(&self) -> PathBuf {
        self.app_data_dir.join(DATABASE_FILE_NAME)
    }

    pub fn seed_demo_data_if_empty(&self) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let project_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))?;
        if project_count > 0 {
            return Ok(());
        }

        let tx = conn.transaction()?;
        seed_demo_data_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn app_snapshot(
        &self,
        selected_project_id: Option<i64>,
        selected_todo_id: Option<i64>,
    ) -> AppResult<AppSnapshot> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let projects = project_summaries(&conn)?;
        let selected_todo_project_id = selected_todo_id
            .map(|todo_id| project_id_for_todo_conn(&conn, todo_id))
            .transpose()?
            .flatten();
        let selected_project_id = selected_project_id
            .filter(|project_id| {
                *project_id == 0 || projects.iter().any(|project| project.id == *project_id)
            })
            .or(selected_todo_project_id)
            .or_else(|| projects.first().map(|project| project.id))
            .unwrap_or_default();
        let mut todos = todo_summaries(&conn, 0, &self.app_data_dir)?;
        let child_project_ids: HashSet<i64> = if selected_project_id == 0 {
            HashSet::new()
        } else {
            let mut stmt = conn.prepare(
                "SELECT child_project_id FROM project_links WHERE parent_project_id = ?1",
            )?;
            let child_rows =
                stmt.query_map(params![selected_project_id], |row| row.get::<_, i64>(0))?;
            child_rows.collect::<Result<HashSet<_>, _>>()?
        };
        let selection_todos = todos
            .iter()
            .filter(|todo| {
                selected_project_id == 0
                    || todo.project_id == selected_project_id
                    || child_project_ids.contains(&todo.project_id)
            })
            .collect::<Vec<_>>();
        let selected_todo_id = selected_todo_id
            .filter(|todo_id| selection_todos.iter().any(|todo| todo.id == *todo_id))
            .or_else(|| {
                selection_todos
                    .iter()
                    .find(|todo| {
                        matches!(
                            todo.state,
                            TodoState::ReadyToTest | TodoState::NeedsFeedback
                        )
                    })
                    .map(|todo| todo.id)
            })
            .or_else(|| selection_todos.first().map(|todo| todo.id))
            .unwrap_or_default();
        if let Some(todo) = todos.iter_mut().find(|todo| todo.id == selected_todo_id) {
            todo.events = event_summaries(&conn, selected_todo_id)?;
        }

        Ok(AppSnapshot {
            projects,
            selected_project_id,
            selected_todo_id,
            todos,
            running_timer: running_timer_summary(&conn)?,
            sessions: agent_session_summaries(&conn, 0)?,
            execution_terminals: execution_terminal_summaries(&conn, 0)?,
            messages: snapshot_message_summaries(&conn)?,
            boomerang_binary_path: current_binary_path(),
        })
    }

    pub fn create_todo(&self, project_id: i64, title: &str) -> AppResult<Todo> {
        self.create_todo_with_description(project_id, title, "")
    }

    pub fn create_todo_with_description(
        &self,
        project_id: i64,
        title: &str,
        description_markdown: &str,
    ) -> AppResult<Todo> {
        self.create_todo_with_position(project_id, title, description_markdown, None, None)
    }

    pub fn delete_todo(&self, todo_id: i64) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
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
        tx.execute("DELETE FROM todos WHERE id = ?1", params![todo_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_todo(&self, todo_id: i64) -> AppResult<Todo> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        todo_by_id_locked(&conn, todo_id)
    }

    pub fn update_todo_state(&self, input: UpdateTodoState) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_state: String = tx.query_row(
            "SELECT state FROM todos WHERE id = ?1",
            params![input.todo_id],
            |row| row.get(0),
        )?;
        let after_state = input.state.as_label();
        let now = now_string();

        tx.execute(
            "UPDATE todos SET state = ?1, updated_at = ?2 WHERE id = ?3",
            params![after_state, now, input.todo_id],
        )?;
        insert_event_tx(
            &tx,
            input.todo_id,
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
            input.todo_id,
            &input.actor,
            input.conversation_id.as_deref(),
            before_state.as_str(),
            after_state,
            input.message.as_deref(),
            input.link.as_deref(),
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todo_priority(
        &self,
        todo_id: i64,
        priority: &str,
        actor: Actor,
    ) -> AppResult<()> {
        let priority = priority_label(priority)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_priority: String = tx.query_row(
            "SELECT priority FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        let now = now_string();

        tx.execute(
            "UPDATE todos SET priority = ?1, updated_at = ?2 WHERE id = ?3",
            params![priority, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "priority_changed",
            &actor,
            None,
            json!({ "priority": before_priority }),
            json!({ "priority": priority }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todo_context_project(
        &self,
        todo_id: i64,
        context_project_id: Option<i64>,
        actor: Actor,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let (own_project_id, before_context): (i64, Option<i64>) = tx.query_row(
            "SELECT project_id, context_project_id FROM todos WHERE id = ?1",
            params![todo_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        // Picking the todo's own project means "no separate context".
        let context_project_id = context_project_id.filter(|id| *id != own_project_id);
        if let Some(project_id) = context_project_id {
            let exists: Option<i64> = tx
                .query_row(
                    "SELECT id FROM projects WHERE id = ?1",
                    params![project_id],
                    |row| row.get(0),
                )
                .optional()?;
            if exists.is_none() {
                return Err(AppError::InvalidInput(format!(
                    "context project not found: {project_id}"
                )));
            }
        }
        if before_context == context_project_id {
            return Ok(());
        }
        let now = now_string();

        tx.execute(
            "UPDATE todos SET context_project_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![context_project_id, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "context_project_changed",
            &actor,
            None,
            json!({ "context_project_id": before_context }),
            json!({ "context_project_id": context_project_id }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todo_starred(&self, input: UpdateTodoStarred) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_starred: bool = tx.query_row(
            "SELECT starred FROM todos WHERE id = ?1",
            params![input.todo_id],
            |row| row.get(0),
        )?;
        let now = now_string();

        tx.execute(
            "UPDATE todos SET starred = ?1, updated_at = ?2 WHERE id = ?3",
            params![input.starred, now, input.todo_id],
        )?;
        insert_event_tx(
            &tx,
            input.todo_id,
            "starred_changed",
            &input.actor,
            None,
            json!({ "starred": before_starred }),
            json!({ "starred": input.starred }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todo_title(&self, todo_id: i64, title: &str, actor: Actor) -> AppResult<()> {
        self.update_todo_title_guarded(todo_id, None, title, actor)
            .map(|_| ())
    }

    pub fn update_todo_title_if_current(
        &self,
        todo_id: i64,
        expected_title: &str,
        title: &str,
        actor: Actor,
    ) -> AppResult<bool> {
        self.update_todo_title_guarded(todo_id, Some(expected_title), title, actor)
    }

    fn update_todo_title_guarded(
        &self,
        todo_id: i64,
        expected_title: Option<&str>,
        title: &str,
        actor: Actor,
    ) -> AppResult<bool> {
        let title = required_text("title", title)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_title: String = tx.query_row(
            "SELECT title FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        if expected_title.is_some_and(|expected| expected != before_title) {
            tx.commit()?;
            return Ok(false);
        }
        let now = now_string();

        tx.execute(
            "UPDATE todos SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "title_changed",
            &actor,
            None,
            json!({ "title": before_title }),
            json!({ "title": title }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(true)
    }

    pub fn update_todo_deadline(
        &self,
        todo_id: i64,
        deadline: Option<&str>,
        actor: Actor,
    ) -> AppResult<()> {
        let deadline = normalize_deadline(deadline)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_deadline: Option<String> = tx.query_row(
            "SELECT deadline FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        let now = now_string();

        tx.execute(
            "UPDATE todos SET deadline = ?1, updated_at = ?2 WHERE id = ?3",
            params![deadline, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "deadline_changed",
            &actor,
            None,
            json!({ "deadline": before_deadline }),
            json!({ "deadline": deadline }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_todo_tags(&self, todo_id: i64, tags: Vec<String>, actor: Actor) -> AppResult<()> {
        let tags = normalize_tags(tags);
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_tags = tags_for_todo(&tx, todo_id)?;
        let now = now_string();

        tx.execute("DELETE FROM todo_tags WHERE todo_id = ?1", params![todo_id])?;
        for tag in &tags {
            tx.execute(
                "INSERT INTO todo_tags (todo_id, name) VALUES (?1, ?2)",
                params![todo_id, tag],
            )?;
        }
        tx.execute(
            "UPDATE todos SET updated_at = ?1 WHERE id = ?2",
            params![now, todo_id],
        )?;
        let before_set: HashSet<_> = before_tags.iter().cloned().collect();
        let after_set: HashSet<_> = tags.iter().cloned().collect();
        for tag in before_tags.iter().filter(|tag| !after_set.contains(*tag)) {
            insert_event_tx(
                &tx,
                todo_id,
                "tag_removed",
                &actor,
                None,
                json!({ "tag": tag }),
                json!({}),
                None,
                None,
            )?;
        }
        for tag in tags.iter().filter(|tag| !before_set.contains(*tag)) {
            insert_event_tx(
                &tx,
                todo_id,
                "tag_added",
                &actor,
                None,
                json!({}),
                json!({ "tag": tag }),
                None,
                None,
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn message_todo(
        &self,
        todo_id: i64,
        actor: Actor,
        message: &str,
        conversation_id: Option<&str>,
        link: Option<&str>,
    ) -> AppResult<()> {
        self.message_todo_with_state(todo_id, actor, message, None, conversation_id, link)
    }

    pub fn message_todo_with_state(
        &self,
        todo_id: i64,
        actor: Actor,
        message: &str,
        state: Option<TodoState>,
        conversation_id: Option<&str>,
        link: Option<&str>,
    ) -> AppResult<()> {
        let message = message.trim();
        if message.is_empty() {
            return Err(AppError::InvalidInput("message is required".to_string()));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_state = if state.is_some() {
            Some(tx.query_row(
                "SELECT state FROM todos WHERE id = ?1",
                params![todo_id],
                |row| row.get::<_, String>(0),
            )?)
        } else {
            None
        };
        let now = now_string();
        tx.execute(
            "UPDATE todos SET updated_at = ?1 WHERE id = ?2",
            params![now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "message_received",
            &actor,
            conversation_id,
            json!({}),
            json!({}),
            Some(message),
            link,
        )?;
        if let Some(state) = state {
            let after_state = state.as_label();
            let before_state = before_state.unwrap_or_default();
            tx.execute(
                "UPDATE todos SET state = ?1, updated_at = ?2 WHERE id = ?3",
                params![after_state, now, todo_id],
            )?;
            insert_event_tx(
                &tx,
                todo_id,
                "state_changed",
                &actor,
                conversation_id,
                json!({ "state": before_state.as_str() }),
                json!({ "state": after_state }),
                Some(message),
                link,
            )?;
            insert_marked_done_event_if_needed(
                &tx,
                todo_id,
                &actor,
                conversation_id,
                before_state.as_str(),
                after_state,
                Some(message),
                link,
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_message_event(&self, event_id: i64) -> AppResult<i64> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let todo_id: i64 = tx
            .query_row(
                "SELECT todo_id
                 FROM events
                 WHERE id = ?1 AND message IS NOT NULL",
                params![event_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::InvalidInput(format!("message not found: {event_id}")))?;
        tx.execute("DELETE FROM events WHERE id = ?1", params![event_id])?;
        tx.commit()?;
        Ok(todo_id)
    }

    pub fn clear_todo_messages(&self, todo_id: i64) -> AppResult<()> {
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
        tx.execute(
            "DELETE FROM events
             WHERE todo_id = ?1 AND message IS NOT NULL",
            params![todo_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn record_prompt_copied(&self, todo_id: i64, actor: Actor) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let changed = tx.execute(
            "UPDATE todos SET updated_at = ?1 WHERE id = ?2",
            params![now_string(), todo_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput(format!("todo not found: {todo_id}")));
        }
        insert_event_tx(
            &tx,
            todo_id,
            "prompt_copied",
            &actor,
            None,
            json!({}),
            json!({}),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todo_description(
        &self,
        todo_id: i64,
        description_markdown: &str,
        actor: Actor,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_description: String = tx.query_row(
            "SELECT description_markdown FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        let now = now_string();

        tx.execute(
            "UPDATE todos
                SET description_markdown = ?1, updated_at = ?2
              WHERE id = ?3",
            params![description_markdown, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "description_changed",
            &actor,
            None,
            json!({ "length": before_description.len() }),
            json!({ "length": description_markdown.len() }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_todo_journal(
        &self,
        todo_id: i64,
        journal_markdown: &str,
        actor: Actor,
    ) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let before_journal: String = tx.query_row(
            "SELECT journal_markdown FROM todos WHERE id = ?1",
            params![todo_id],
            |row| row.get(0),
        )?;
        let now = now_string();

        tx.execute(
            "UPDATE todos
                SET journal_markdown = ?1, updated_at = ?2
              WHERE id = ?3",
            params![journal_markdown, now, todo_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "journal_changed",
            &actor,
            None,
            json!({ "length": before_journal.len() }),
            json!({ "length": journal_markdown.len() }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_events(&self, todo_id: i64) -> AppResult<Vec<Event>> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, todo_id, event_type, actor_type, actor_name, conversation_id,
                    before_json, after_json, message, link, created_at
             FROM events
             WHERE todo_id = ?1
             ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![todo_id], event_from_row)?;
        collect_rows(rows)
    }

    pub fn add_dependency(&self, todo_id: i64, depends_on_todo_id: i64) -> AppResult<()> {
        if todo_id == depends_on_todo_id {
            return Err(AppError::InvalidInput(
                "would create cycle: self dependency".to_string(),
            ));
        }

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        if let Some(mut path) = dependency_path(&tx, depends_on_todo_id, todo_id)? {
            path.insert(0, todo_id);
            return Err(AppError::InvalidInput(format!(
                "would create cycle: {}",
                display_path(&tx, &path)?
            )));
        }

        tx.execute(
            "INSERT INTO dependencies (todo_id, depends_on_todo_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![todo_id, depends_on_todo_id, now_string()],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "dependency_added",
            &Actor::system("Boomerang"),
            None,
            json!({}),
            json!({ "depends_on_todo_id": depends_on_todo_id }),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn remove_dependency(&self, todo_id: i64, depends_on_todo_id: i64) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let removed = tx.execute(
            "DELETE FROM dependencies WHERE todo_id = ?1 AND depends_on_todo_id = ?2",
            params![todo_id, depends_on_todo_id],
        )?;
        if removed == 0 {
            return Err(AppError::InvalidInput("dependency not found".to_string()));
        }
        insert_event_tx(
            &tx,
            todo_id,
            "dependency_removed",
            &Actor::system("Boomerang"),
            None,
            json!({ "depends_on_todo_id": depends_on_todo_id }),
            json!({}),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_dependencies(&self, todo_id: i64) -> AppResult<Vec<i64>> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let mut stmt = conn.prepare(
            "SELECT depends_on_todo_id FROM dependencies WHERE todo_id = ?1 ORDER BY depends_on_todo_id",
        )?;
        let rows = stmt.query_map(params![todo_id], |row| row.get(0))?;
        collect_rows(rows)
    }

    pub fn set_parent(&self, todo_id: i64, parent_id: Option<i64>) -> AppResult<()> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;

        if let Some(parent_id) = parent_id {
            if todo_id == parent_id {
                return Err(AppError::InvalidInput(
                    "would create parent cycle: self parent".to_string(),
                ));
            }
            if let Some(mut path) = child_path(&tx, todo_id, parent_id)? {
                path.push(todo_id);
                return Err(AppError::InvalidInput(format!(
                    "would create parent cycle: {}",
                    display_path(&tx, &path)?
                )));
            }

            let child_project = project_id_for_todo(&tx, todo_id)?;
            let parent_project = project_id_for_todo(&tx, parent_id)?;
            if child_project != parent_project {
                return Err(AppError::InvalidInput(
                    "parent and child must belong to the same project".to_string(),
                ));
            }
        }

        tx.execute(
            "UPDATE todos SET parent_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![parent_id, now_string(), todo_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn create_subtask(&self, parent_todo_id: i64, title: &str) -> AppResult<Todo> {
        let title = required_text("subtask title", title)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let project_id = project_id_for_todo(&tx, parent_todo_id)?;
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
            "SELECT COUNT(*) FROM todos WHERE parent_id = ?1",
            params![parent_todo_id],
            |row| row.get(0),
        )?;
        let initial_state = TodoState::ToDo.as_label();

        tx.execute(
            "INSERT INTO todos
                (project_id, seq, display_id, title, description_markdown, state, parent_id,
                 position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?8)",
            params![
                project_id,
                seq,
                display_id,
                title,
                initial_state,
                parent_todo_id,
                group_len,
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
            json!({ "state": initial_state, "title": title, "parent_id": parent_todo_id }),
            None,
            None,
        )?;
        tx.commit()?;
        todo_by_id_locked(&conn, todo_id)
    }

    pub fn start_timer(&self, todo_id: i64) -> AppResult<TimeLog> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = Utc::now();
        let now_text = now.to_rfc3339();
        let open_logs = open_time_logs(&tx)?;

        for log in open_logs {
            let started_at = DateTime::parse_from_rfc3339(&log.started_at)
                .map(|date| date.with_timezone(&Utc))
                .unwrap_or(now);
            let duration_seconds = (now - started_at).num_seconds().max(0);
            tx.execute(
                "UPDATE time_logs
                    SET ended_at = ?1, duration_seconds = ?2, updated_at = ?1
                  WHERE id = ?3",
                params![now_text, duration_seconds, log.id],
            )?;
            insert_event_tx(
                &tx,
                log.todo_id,
                "timer_stopped",
                &Actor::system("Boomerang"),
                None,
                json!({ "time_log_id": log.id }),
                json!({ "time_log_id": log.id, "duration_seconds": duration_seconds }),
                None,
                None,
            )?;
        }

        tx.execute(
            "INSERT INTO time_logs
                (todo_id, started_at, ended_at, duration_seconds, source, created_at, updated_at)
             VALUES (?1, ?2, NULL, 0, 'timer', ?2, ?2)",
            params![todo_id, now_text],
        )?;
        let id = tx.last_insert_rowid();
        insert_event_tx(
            &tx,
            todo_id,
            "timer_started",
            &Actor::system("Boomerang"),
            None,
            json!({}),
            json!({ "time_log_id": id }),
            None,
            None,
        )?;
        tx.commit()?;
        time_log_by_id_locked(&conn, id)
    }

    pub fn stop_running_timer(&self) -> AppResult<Option<TimeLog>> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = Utc::now();
        let now_text = now.to_rfc3339();
        let running = tx
            .query_row(
                "SELECT id, todo_id, started_at, ended_at, duration_seconds, source
                 FROM time_logs
                 WHERE ended_at IS NULL
                 ORDER BY id DESC
                 LIMIT 1",
                [],
                time_log_from_row,
            )
            .optional()?;

        let stopped_id = if let Some(log) = running {
            let started_at = DateTime::parse_from_rfc3339(&log.started_at)
                .map(|date| date.with_timezone(&Utc))
                .unwrap_or(now);
            let duration_seconds = (now - started_at).num_seconds().max(0);
            tx.execute(
                "UPDATE time_logs
                    SET ended_at = ?1, duration_seconds = ?2, updated_at = ?1
                  WHERE id = ?3",
                params![now_text, duration_seconds, log.id],
            )?;
            insert_event_tx(
                &tx,
                log.todo_id,
                "timer_stopped",
                &Actor::system("Boomerang"),
                None,
                json!({ "time_log_id": log.id }),
                json!({ "time_log_id": log.id, "duration_seconds": duration_seconds }),
                None,
                None,
            )?;
            Some(log.id)
        } else {
            None
        };

        tx.commit()?;
        stopped_id
            .map(|id| time_log_by_id_locked(&conn, id))
            .transpose()
    }

    pub fn create_agent_session(&self, input: NewAgentSession) -> AppResult<AgentSessionSummary> {
        let provider = agent_provider_label(&input.provider)?;
        let conversation_id = required_text("conversation id", &input.conversation_id)?;
        let command = required_text("agent command", &input.command)?;
        let working_directory = required_text("working directory", &input.working_directory)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let todo_project_id = project_id_for_todo(&tx, input.todo_id)?;
        let now = now_string();
        let session_id = format!("session-{}", uuid::Uuid::new_v4());

        tx.execute(
            "INSERT INTO agent_sessions
                (id, todo_id, conversation_id, provider, provider_session_id,
                 provider_session_name, provider_session_link, pty_id, command,
                 working_directory, state, last_activity, started_at, ended_at,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, ?8, 'running',
                     'session started', ?9, NULL, ?9, ?9)",
            params![
                session_id,
                input.todo_id,
                conversation_id,
                provider,
                input.provider_session_id,
                input.pty_id,
                command,
                working_directory,
                now
            ],
        )?;
        insert_event_tx(
            &tx,
            input.todo_id,
            "ai_session_spawned",
            &Actor::system("Boomerang"),
            Some(&conversation_id),
            json!({}),
            json!({
                "conversation_id": conversation_id,
                "provider": provider,
                "pty_id": input.pty_id,
            }),
            Some("Managed CLI session started."),
            None,
        )?;
        tx.commit()?;

        let sessions = agent_session_summaries(&conn, todo_project_id)?;
        sessions
            .into_iter()
            .find(|session| session.id == session_id)
            .ok_or_else(|| AppError::InvalidInput("agent session was not recorded".to_string()))
    }

    pub fn get_time_log(&self, id: i64) -> AppResult<TimeLog> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        time_log_by_id_locked(&conn, id)
    }

    pub fn add_manual_time_log(&self, todo_id: i64, duration_seconds: i64) -> AppResult<TimeLog> {
        let duration_seconds = valid_duration_seconds(duration_seconds)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = Utc::now();
        let ended_at = now.to_rfc3339();
        let started_at = (now - Duration::seconds(duration_seconds)).to_rfc3339();
        let created_at = now.to_rfc3339();
        project_id_for_todo(&tx, todo_id)?;

        tx.execute(
            "INSERT INTO time_logs
                (todo_id, started_at, ended_at, duration_seconds, source, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'manual', ?5, ?5)",
            params![todo_id, started_at, ended_at, duration_seconds, created_at],
        )?;
        let id = tx.last_insert_rowid();
        insert_event_tx(
            &tx,
            todo_id,
            "time_log_added",
            &Actor::system("Boomerang"),
            None,
            json!({}),
            json!({ "time_log_id": id, "duration_seconds": duration_seconds }),
            None,
            None,
        )?;
        tx.commit()?;
        time_log_by_id_locked(&conn, id)
    }

    pub fn update_time_log_duration(&self, id: i64, duration_seconds: i64) -> AppResult<TimeLog> {
        let duration_seconds = valid_duration_seconds(duration_seconds)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let log = tx.query_row(
            "SELECT id, todo_id, started_at, ended_at, duration_seconds, source
             FROM time_logs
             WHERE id = ?1",
            params![id],
            time_log_from_row,
        )?;
        if log.ended_at.is_none() {
            return Err(AppError::InvalidInput(
                "cannot edit a running time log".to_string(),
            ));
        }
        let started_at = DateTime::parse_from_rfc3339(&log.started_at)
            .map(|date| date.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now() - Duration::seconds(duration_seconds));
        let ended_at = (started_at + Duration::seconds(duration_seconds)).to_rfc3339();
        let now = now_string();

        tx.execute(
            "UPDATE time_logs
                SET ended_at = ?1, duration_seconds = ?2, updated_at = ?3
              WHERE id = ?4",
            params![ended_at, duration_seconds, now, id],
        )?;
        insert_event_tx(
            &tx,
            log.todo_id,
            "time_log_updated",
            &Actor::system("Boomerang"),
            None,
            json!({ "time_log_id": id, "duration_seconds": log.duration_seconds }),
            json!({ "time_log_id": id, "duration_seconds": duration_seconds }),
            None,
            None,
        )?;
        tx.commit()?;
        time_log_by_id_locked(&conn, id)
    }

    pub fn delete_time_log(&self, id: i64) -> AppResult<i64> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let log = tx.query_row(
            "SELECT id, todo_id, started_at, ended_at, duration_seconds, source
             FROM time_logs
             WHERE id = ?1",
            params![id],
            time_log_from_row,
        )?;
        tx.execute("DELETE FROM time_logs WHERE id = ?1", params![id])?;
        insert_event_tx(
            &tx,
            log.todo_id,
            "time_log_deleted",
            &Actor::system("Boomerang"),
            None,
            json!({ "time_log_id": id, "duration_seconds": log.duration_seconds }),
            json!({}),
            None,
            None,
        )?;
        tx.commit()?;
        Ok(log.todo_id)
    }

    pub fn running_timer(&self) -> AppResult<Option<TimeLog>> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        conn.query_row(
            "SELECT id, todo_id, started_at, ended_at, duration_seconds, source
             FROM time_logs
             WHERE ended_at IS NULL
             ORDER BY id DESC
             LIMIT 1",
            [],
            time_log_from_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn list_project_actions(&self, project_id: i64) -> AppResult<Vec<ProjectActionSummary>> {
        let project = self.get_project(project_id)?;
        let mut actions = vec![native_open_folder_action()];
        let actions_dir = project_action_directory(&project);
        let recent_runs = project_action_recent_runs(self, project_id)?;

        if actions_dir.exists() {
            let entries = fs::read_dir(&actions_dir).map_err(|err| {
                AppError::InvalidInput(format!("cannot read actions directory: {err}"))
            })?;
            for entry in entries {
                let entry = entry.map_err(|err| {
                    AppError::InvalidInput(format!("cannot read action directory entry: {err}"))
                })?;
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if file_name.starts_with('.') {
                    continue;
                }
                let runtime = match path.extension().and_then(|value| value.to_str()) {
                    Some("sh") => "shell",
                    Some("py") => "python",
                    _ => continue,
                };
                actions.push(script_action_from_path(file_name, &path, runtime));
            }
        }

        actions.sort_by(|a, b| {
            match (recent_runs.get(&a.file_name), recent_runs.get(&b.file_name)) {
                (Some(a_recent), Some(b_recent)) if a_recent != b_recent => b_recent.cmp(a_recent),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                _ if a.runtime == "native" && b.runtime != "native" => std::cmp::Ordering::Less,
                _ if a.runtime != "native" && b.runtime == "native" => std::cmp::Ordering::Greater,
                _ => a.title.cmp(&b.title),
            }
        });
        Ok(actions)
    }

    pub fn project_actions_directory(
        &self,
        project_id: i64,
    ) -> AppResult<ProjectActionsDirectorySummary> {
        let project = self.get_project(project_id)?;
        let path = project_action_directory(&project);

        Ok(ProjectActionsDirectorySummary {
            exists: path.is_dir(),
            path: path.display().to_string(),
        })
    }

    pub fn create_project_actions_directory(
        &self,
        project_id: i64,
    ) -> AppResult<ProjectActionsDirectorySummary> {
        let project = self.get_project(project_id)?;
        let path = project_action_directory(&project);
        fs::create_dir_all(&path).map_err(|err| {
            AppError::InvalidInput(format!(
                "cannot create actions directory {}: {err}",
                path.display()
            ))
        })?;

        Ok(ProjectActionsDirectorySummary {
            exists: path.is_dir(),
            path: path.display().to_string(),
        })
    }

    pub fn create_project_action(
        &self,
        project_id: i64,
        file_name: &str,
        runtime: &str,
        title: &str,
        description: &str,
    ) -> AppResult<()> {
        let project = self.get_project(project_id)?;
        let runtime = action_runtime(runtime)?;
        let file_name = action_file_name(file_name, runtime.extension)?;
        let title = required_text("action title", title)?;
        let actions_dir = project_action_directory(&project);
        fs::create_dir_all(&actions_dir).map_err(|err| {
            AppError::InvalidInput(format!("cannot create actions directory: {err}"))
        })?;
        let action_path = actions_dir.join(&file_name);
        if action_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "action already exists: {file_name}"
            )));
        }

        let content = format!(
            "{}\n# title: {}\n# description: {}\n\n",
            runtime.shebang,
            title,
            description.trim()
        );
        fs::write(action_path, content)
            .map_err(|err| AppError::InvalidInput(format!("cannot write action: {err}")))?;
        Ok(())
    }

    pub fn record_action_run(&self, input: NewActionRun) -> AppResult<ActionRunSummary> {
        let project = self.get_project(input.project_id)?;
        let action = self
            .list_project_actions(input.project_id)?
            .into_iter()
            .find(|action| action.file_name == input.file_name)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("action not found: {}", input.file_name))
            })?;
        if action.validation_error.is_some() {
            return Err(AppError::InvalidInput(format!(
                "action is invalid: {}",
                input.file_name
            )));
        }
        if let Some(todo_id) = input.todo_id {
            let todo = self.get_todo(todo_id)?;
            if todo.project_id != input.project_id {
                return Err(AppError::InvalidInput(
                    "todo does not belong to action project".to_string(),
                ));
            }
        }
        let state = action_run_state(&input.state)?;
        let todo_id = input.todo_id;
        let action_file_name = action.file_name.clone();
        let action_title = action.title.clone();
        let action_runtime = action.runtime.clone();
        let working_directory = if let Some(todo_id) = todo_id {
            self.todo_working_directory(todo_id)?
        } else {
            project.working_directory.clone()
        };

        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let now = now_string();
        tx.execute(
            "INSERT INTO action_runs
                (project_id, todo_id, action_file_name, action_title, runtime, pty_id,
                 command, working_directory, state, exit_code, last_activity_at,
                 started_at, ended_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11,
                     CASE WHEN ?9 IN ('succeeded', 'failed', 'closed') THEN ?11 ELSE NULL END,
                     ?11, ?11)",
            params![
                input.project_id,
                todo_id,
                action_file_name,
                action_title,
                action_runtime,
                input.pty_id,
                input.command,
                working_directory,
                state,
                input.exit_code,
                now
            ],
        )?;
        let id = tx.last_insert_rowid();
        if let Some(todo_id) = todo_id {
            if let Some(pty_id) = input.pty_id {
                let terminal_state = match state.as_str() {
                    "failed" => "failed",
                    "running" | "starting" => "running",
                    _ => "exited",
                };
                tx.execute(
                    "INSERT INTO execution_terminals
                        (pty_id, todo_id, label, kind, state, exit_code, created_at, updated_at)
                     VALUES (?1, ?2, ?3, 'terminal', ?4, ?5, ?6, ?6)",
                    params![
                        pty_id,
                        todo_id,
                        format!("Action · {action_title}"),
                        terminal_state,
                        input.exit_code,
                        now,
                    ],
                )?;
            }
            insert_event_tx(
                &tx,
                todo_id,
                "action_run_started",
                &Actor::system("Boomerang"),
                None,
                json!({}),
                json!({
                    "action_run_id": id,
                    "action_file_name": action.file_name,
                    "action_title": action.title,
                    "runtime": action.runtime,
                    "state": state,
                }),
                None,
                None,
            )?;
        }
        tx.commit()?;
        action_run_by_id_locked(&conn, id)
    }

    pub fn finish_action_run_for_pty(
        &self,
        pty_id: i64,
        exit_code: i64,
    ) -> AppResult<Option<ActionRunSummary>> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        let run_id = conn
            .query_row(
                "SELECT id FROM action_runs
                 WHERE pty_id = ?1 AND state = 'running'
                 ORDER BY id DESC
                 LIMIT 1",
                params![pty_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(run_id) = run_id else {
            return Ok(None);
        };
        let now = now_string();
        let state = if exit_code == 0 {
            "succeeded"
        } else {
            "failed"
        };
        conn.execute(
            "UPDATE action_runs
             SET state = ?1,
                 exit_code = ?2,
                 ended_at = ?3,
                 last_activity_at = ?3,
                 updated_at = ?3
             WHERE id = ?4",
            params![state, exit_code, now, run_id],
        )?;

        action_run_by_id_locked(&conn, run_id).map(Some)
    }

    pub fn finish_agent_session_for_pty(
        &self,
        pty_id: i64,
        exit_code: i64,
    ) -> AppResult<Option<AgentSessionSummary>> {
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let sessions = {
            let mut stmt = tx.prepare(
                "SELECT id, todo_id, conversation_id, provider
                 FROM agent_sessions
                 WHERE pty_id = ?1 AND state = 'running'
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![pty_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;
            let mut sessions = Vec::new();
            for row in rows {
                sessions.push(row?);
            }
            sessions
        };
        if sessions.is_empty() {
            return Ok(None);
        }

        let (session_id, todo_id, _, _) = sessions
            .first()
            .cloned()
            .ok_or_else(|| AppError::InvalidInput("agent session was not recorded".to_string()))?;
        let project_id = project_id_for_todo(&tx, todo_id)?;
        let now = now_string();
        let state = if exit_code == 0 { "exited" } else { "failed" };
        let last_activity = format!("session exited with code {exit_code}");
        for (session_id, todo_id, conversation_id, provider) in &sessions {
            tx.execute(
                "UPDATE agent_sessions
                 SET state = ?1,
                     last_activity = ?2,
                     ended_at = ?3,
                     updated_at = ?3
                 WHERE id = ?4",
                params![state, last_activity, now, session_id],
            )?;
            insert_event_tx(
                &tx,
                *todo_id,
                "ai_session_exited",
                &Actor::system("Boomerang"),
                Some(conversation_id),
                json!({ "state": "running", "pty_id": pty_id }),
                json!({
                    "state": state,
                    "provider": provider,
                    "pty_id": pty_id,
                    "exit_code": exit_code,
                }),
                Some(&last_activity),
                None,
            )?;
        }
        tx.commit()?;

        let sessions = agent_session_summaries(&conn, project_id)?;
        sessions
            .into_iter()
            .find(|session| session.id == session_id)
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput("agent session was not recorded".to_string()))
    }

    pub fn stop_agent_session(&self, session_id: &str, actor: Actor) -> AppResult<i64> {
        let session_id = required_text("session id", session_id)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let session = tx
            .query_row(
                "SELECT todo_id, conversation_id, provider, pty_id, state
                 FROM agent_sessions
                 WHERE id = ?1",
                params![session_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                AppError::InvalidInput(format!("agent session not found: {session_id}"))
            })?;
        let (todo_id, conversation_id, provider, pty_id, state) = session;
        if state != "running" {
            return Err(AppError::InvalidInput(
                "agent session is not running".to_string(),
            ));
        }

        let last_activity = format!("stopped by {}", actor.actor_name);
        insert_event_tx(
            &tx,
            todo_id,
            "ai_session_stopped",
            &actor,
            Some(&conversation_id),
            json!({ "state": "running", "pty_id": pty_id }),
            json!({
                "state": "stopped",
                "provider": provider,
                "pty_id": pty_id,
            }),
            Some(&last_activity),
            None,
        )?;
        tx.execute(
            "DELETE FROM agent_sessions
             WHERE id = ?1",
            params![session_id],
        )?;
        tx.commit()?;

        Ok(todo_id)
    }

    pub fn agent_session_pty_id(&self, session_id: &str) -> AppResult<Option<i64>> {
        let session_id = required_text("session id", session_id)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        conn.query_row(
            "SELECT pty_id FROM agent_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::InvalidInput(format!("agent session not found: {session_id}")))
    }

    pub fn record_agent_session_provider_session_from_pty(
        &self,
        pty_id: i64,
        provider_session_id: &str,
    ) -> AppResult<Option<AgentSessionSummary>> {
        let provider_session_id = required_text("provider session id", provider_session_id)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let session = tx
            .query_row(
                "SELECT id, todo_id, conversation_id, provider
                 FROM agent_sessions
                 WHERE pty_id = ?1
                   AND state = 'running'
                   AND (provider_session_id IS NULL OR length(trim(provider_session_id)) = 0)
                 ORDER BY updated_at DESC
                 LIMIT 1",
                params![pty_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((session_id, todo_id, conversation_id, provider)) = session else {
            return Ok(None);
        };

        let project_id = project_id_for_todo(&tx, todo_id)?;
        let now = now_string();
        tx.execute(
            "UPDATE agent_sessions
             SET provider_session_id = ?1,
                 last_activity = 'provider session discovered',
                 updated_at = ?2
             WHERE id = ?3",
            params![provider_session_id, now, session_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "ai_session_provider_discovered",
            &Actor::system("Boomerang"),
            Some(&conversation_id),
            json!({}),
            json!({
                "provider": provider,
                "provider_session_id": provider_session_id,
                "pty_id": pty_id,
            }),
            Some("Provider session id discovered from CLI output."),
            None,
        )?;
        tx.commit()?;

        let sessions = agent_session_summaries(&conn, project_id)?;
        sessions
            .into_iter()
            .find(|session| session.id == session_id)
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput("agent session was not recorded".to_string()))
    }

    pub fn record_agent_session_provider_session_for_todo(
        &self,
        todo_id: i64,
        provider_session_id: &str,
    ) -> AppResult<Option<AgentSessionSummary>> {
        let provider_session_id = required_text("provider session id", provider_session_id)?;
        let mut conn = self.conn.lock().expect("database lock is not poisoned");
        let tx = conn.transaction()?;
        let session = tx
            .query_row(
                "SELECT id, conversation_id, provider, pty_id
                 FROM agent_sessions
                 WHERE todo_id = ?1
                   AND (provider_session_id IS NULL OR length(trim(provider_session_id)) = 0)
                 ORDER BY CASE WHEN state = 'running' THEN 0 ELSE 1 END,
                          updated_at DESC
                 LIMIT 1",
                params![todo_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((session_id, conversation_id, provider, pty_id)) = session else {
            return Ok(None);
        };

        let project_id = project_id_for_todo(&tx, todo_id)?;
        let now = now_string();
        tx.execute(
            "UPDATE agent_sessions
             SET provider_session_id = ?1,
                 last_activity = 'provider session reported',
                 updated_at = ?2
             WHERE id = ?3",
            params![provider_session_id, now, session_id],
        )?;
        insert_event_tx(
            &tx,
            todo_id,
            "ai_session_provider_discovered",
            &Actor::system("Boomerang"),
            Some(&conversation_id),
            json!({}),
            json!({
                "provider": provider,
                "provider_session_id": provider_session_id,
                "pty_id": pty_id,
            }),
            Some("Provider session id reported through the Boomerang CLI."),
            None,
        )?;
        tx.commit()?;

        let sessions = agent_session_summaries(&conn, project_id)?;
        sessions
            .into_iter()
            .find(|session| session.id == session_id)
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput("agent session was not recorded".to_string()))
    }

    pub fn app_settings(&self) -> AppResult<AppSettingsSummary> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        app_settings_locked(&conn)
    }

    pub fn update_app_settings(
        &self,
        mcp_enabled: bool,
        theme: &str,
        claude_path: &str,
        codex_path: &str,
        task_titler: &str,
        deep_link_fallback: bool,
        home_project_id: i64,
        project_accent_border_width: i64,
        slowdown_profiler_enabled: bool,
        terminal_tmux_enabled: bool,
        external_terminal_openers: &str,
        folder_open_app: &str,
        app_context_markdown: &str,
        markdown_editor_font_family: &str,
        markdown_editor_font_size: &str,
        markdown_editor_max_image_height: &str,
    ) -> AppResult<AppSettingsSummary> {
        let theme = theme_label(theme)?;
        let claude_path = required_text("Claude path", claude_path)?;
        let codex_path = required_text("Codex path", codex_path)?;
        let task_titler = task_titler_label(task_titler)?;
        let external_terminal_openers =
            required_text("External terminal openers", external_terminal_openers)?;
        let folder_open_app = required_text("folder open app", folder_open_app)?;
        let project_accent_border_width = project_accent_border_width.clamp(
            MIN_PROJECT_ACCENT_BORDER_WIDTH,
            MAX_PROJECT_ACCENT_BORDER_WIDTH,
        );
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET mcp_enabled = ?1,
                    theme = ?2,
                    claude_path = ?3,
                    codex_path = ?4,
                    task_titler = ?5,
                    deep_link_fallback = ?6,
                    home_project_id = ?7,
                    project_accent_border_width = ?8,
                    slowdown_profiler_enabled = ?9,
                    terminal_tmux_enabled = ?10,
                    external_terminal_openers = ?11,
                    folder_open_app = ?12,
                    app_context_markdown = ?13,
                    markdown_editor_font_family = ?14,
                    markdown_editor_font_size = ?15,
                    markdown_editor_max_image_height = ?16,
                    updated_at = ?17
              WHERE id = 1",
            params![
                mcp_enabled,
                theme,
                claude_path,
                codex_path,
                task_titler,
                deep_link_fallback,
                home_project_id.max(0),
                project_accent_border_width,
                slowdown_profiler_enabled,
                terminal_tmux_enabled,
                external_terminal_openers,
                folder_open_app,
                app_context_markdown.trim(),
                markdown_editor_font_family.trim(),
                markdown_editor_font_size.trim(),
                markdown_editor_max_image_height.trim(),
                now
            ],
        )?;
        app_settings_locked(&conn)
    }

    pub fn regenerate_mcp_token(&self) -> AppResult<AppSettingsSummary> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings SET mcp_token = ?1, updated_at = ?2 WHERE id = 1",
            params![new_connection_token(), now],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_mcp_port(&self, port: i64) -> AppResult<AppSettingsSummary> {
        if !(1..=65_535).contains(&port) {
            return Err(AppError::InvalidInput(format!(
                "MCP port must be between 1 and 65535: {port}"
            )));
        }

        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET mcp_port = ?1,
                    updated_at = ?2
              WHERE id = 1",
            params![port, now],
        )?;
        app_settings_locked(&conn)
    }
}

fn insert_event_tx(
    tx: &Transaction<'_>,
    todo_id: i64,
    event_type: &str,
    actor: &Actor,
    conversation_id: Option<&str>,
    before: Value,
    after: Value,
    message: Option<&str>,
    link: Option<&str>,
) -> AppResult<()> {
    tx.execute(
        "INSERT INTO events
            (todo_id, event_type, actor_type, actor_name, conversation_id,
             before_json, after_json, message, link, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            todo_id,
            event_type,
            actor.actor_type,
            actor.actor_name,
            conversation_id,
            before.to_string(),
            after.to_string(),
            message,
            link,
            now_string()
        ],
    )?;
    Ok(())
}

fn insert_marked_done_event_if_needed(
    tx: &Transaction<'_>,
    todo_id: i64,
    actor: &Actor,
    conversation_id: Option<&str>,
    before_state: &str,
    after_state: &str,
    message: Option<&str>,
    link: Option<&str>,
) -> AppResult<()> {
    if before_state == "Done" || after_state != "Done" {
        return Ok(());
    }

    insert_event_tx(
        tx,
        todo_id,
        "marked_done",
        actor,
        conversation_id,
        json!({ "state": before_state }),
        json!({ "state": after_state }),
        message,
        link,
    )
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
) -> AppResult<Vec<T>> {
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn now_string() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_project(db: &AppDb) -> Project {
        db.create_project(NewProject {
            name: "Journal Project".to_string(),
            working_directory: "/tmp/journal-project".to_string(),
            display_id_prefix: "J".to_string(),
            actions_directory: "actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("create project")
    }

    #[test]
    fn todo_journal_round_trips_in_snapshot_without_changing_description() {
        let db = AppDb::open_in_memory().expect("db");
        let project = seed_project(&db);
        let todo = db
            .create_todo_with_description(
                project.id,
                "Keep a private journal",
                "Public prompt body",
            )
            .expect("create todo");

        db.update_todo_journal(
            todo.id,
            "# Private journal\n\nDo not include in prompts.",
            Actor {
                actor_type: "human".to_string(),
                actor_name: "Mark".to_string(),
            },
        )
        .expect("update journal");

        let snapshot = db
            .app_snapshot(Some(project.id), Some(todo.id))
            .expect("snapshot");
        let summary = snapshot
            .todos
            .iter()
            .find(|item| item.id == todo.id)
            .expect("todo summary");

        assert_eq!(summary.description_markdown, "Public prompt body");
        assert_eq!(
            summary.journal_markdown,
            "# Private journal\n\nDo not include in prompts."
        );
        assert_eq!(summary.events[0].event_type, "journal_changed");
    }
}
