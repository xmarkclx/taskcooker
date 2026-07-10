use super::*;

pub(super) fn migrate(conn: &Connection) -> AppResult<()> {
    // Let the desktop app, the `boomerang` CLI, and the headless server share one
    // database file. WAL keeps readers working alongside a writer, and a busy
    // timeout makes a writer wait briefly for another process's lock instead of
    // failing immediately with "database is locked". (No-op on in-memory DBs.)
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;

    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            client TEXT NOT NULL DEFAULT '',
            working_directory TEXT NOT NULL,
            display_id_prefix TEXT NOT NULL,
            actions_directory TEXT NOT NULL,
            project_folder_open_app TEXT NOT NULL DEFAULT 'cursor',
            main_branch TEXT NOT NULL DEFAULT 'main',
            terminal_wsl_enabled INTEGER NOT NULL DEFAULT 0,
            background_image_path TEXT NOT NULL DEFAULT '',
            last_seq INTEGER NOT NULL DEFAULT 0,
            notes_markdown TEXT NOT NULL DEFAULT '',
            notes_updated_at TEXT,
            last_used_at TEXT,
            ai_default_include_project_notes INTEGER NOT NULL DEFAULT 0,
            ai_default_provider TEXT,
            ai_task_description_mode TEXT NOT NULL DEFAULT 'task',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            seq INTEGER NOT NULL,
            display_id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description_markdown TEXT NOT NULL DEFAULT '',
            journal_markdown TEXT NOT NULL DEFAULT '',
            artifact_markdown TEXT NOT NULL DEFAULT '',
            artifact_updated_at TEXT,
            description_panel_hidden INTEGER NOT NULL DEFAULT 0,
            execution_panel_hidden INTEGER NOT NULL DEFAULT 0,
            description_toc_hidden INTEGER NOT NULL DEFAULT 1,
            artifact_toc_hidden INTEGER NOT NULL DEFAULT 1,
            state TEXT NOT NULL,
            starred INTEGER NOT NULL DEFAULT 0,
            priority TEXT NOT NULL DEFAULT 'None',
            deadline TEXT,
            worktree_name TEXT,
            worktree_path TEXT,
            worktree_created_at TEXT,
            worktree_merged_at TEXT,
            omp_session_id TEXT,
            parent_id INTEGER REFERENCES todos(id) ON DELETE SET NULL,
            context_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(project_id, seq)
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            conversation_id TEXT,
            before_json TEXT NOT NULL,
            after_json TEXT NOT NULL,
            message TEXT,
            link TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS todo_message_reads (
            todo_id INTEGER PRIMARY KEY REFERENCES todos(id) ON DELETE CASCADE,
            last_read_event_id INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS todo_provider_state (
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            session_id TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (todo_id, provider)
        );

        CREATE TABLE IF NOT EXISTS dependencies (
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            depends_on_todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (todo_id, depends_on_todo_id)
        );

        CREATE TABLE IF NOT EXISTS todo_tags (
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            PRIMARY KEY (todo_id, name)
        );

        CREATE TABLE IF NOT EXISTS time_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_sessions (
            id TEXT PRIMARY KEY,
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            conversation_id TEXT NOT NULL DEFAULT '',
            provider TEXT NOT NULL,
            provider_session_id TEXT,
            provider_session_name TEXT,
            provider_session_link TEXT,
            pty_id INTEGER,
            command TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL,
            working_directory TEXT NOT NULL,
            last_activity TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS action_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            todo_id INTEGER REFERENCES todos(id) ON DELETE SET NULL,
            action_file_name TEXT NOT NULL,
            action_title TEXT NOT NULL,
            runtime TEXT NOT NULL,
            pty_id INTEGER,
            command TEXT,
            working_directory TEXT NOT NULL,
            state TEXT NOT NULL,
            exit_code INTEGER,
            last_activity_at TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS execution_terminals (
            pty_id INTEGER PRIMARY KEY,
            todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            kind TEXT NOT NULL,
            state TEXT NOT NULL,
            exit_code INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mcp_enabled INTEGER NOT NULL DEFAULT 1,
            mcp_port INTEGER NOT NULL DEFAULT 8787,
            mcp_token TEXT NOT NULL,
            theme TEXT NOT NULL DEFAULT 'system',
            claude_path TEXT NOT NULL DEFAULT 'claude',
            codex_path TEXT NOT NULL DEFAULT 'codex',
            task_titler TEXT NOT NULL DEFAULT 'codex-spark',
            deep_link_fallback INTEGER NOT NULL DEFAULT 1,
            home_project_id INTEGER NOT NULL DEFAULT 0,
            task_details_rail_hidden INTEGER NOT NULL DEFAULT 0,
            task_list_collapsed_project_ids TEXT NOT NULL DEFAULT '[]',
            task_list_collapsed_subproject_ids TEXT NOT NULL DEFAULT '[]',
            task_list_collapsed_todo_ids TEXT NOT NULL DEFAULT '[]',
            task_list_width INTEGER NOT NULL DEFAULT 300,
            task_detail_description_width INTEGER NOT NULL DEFAULT 420,
            markdown_editor_mode TEXT NOT NULL DEFAULT 'rich',
            markdown_editor_font_family TEXT NOT NULL DEFAULT 'sans-serif',
            markdown_editor_font_size TEXT NOT NULL DEFAULT '12px',
            markdown_editor_max_image_height TEXT NOT NULL DEFAULT 'none',
            markdown_toc_hidden INTEGER NOT NULL DEFAULT 0,
            markdown_description_toc_width INTEGER NOT NULL DEFAULT 180,
            markdown_artifact_toc_width INTEGER NOT NULL DEFAULT 180,
            project_accent_border_width INTEGER NOT NULL DEFAULT 4,
            slowdown_profiler_enabled INTEGER NOT NULL DEFAULT 1,
            terminal_tmux_enabled INTEGER NOT NULL DEFAULT 0,
            external_terminal_openers TEXT NOT NULL DEFAULT 'open -na Ghostty.app --args --title={title} --working-directory={cwd} --command={tmuxCommand}, open -a Terminal.app {commandFile}',
            folder_open_app TEXT NOT NULL DEFAULT 'code',
            app_context_markdown TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_links (
            parent_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            child_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('subproject','link')),
            created_at TEXT NOT NULL,
            PRIMARY KEY (parent_project_id, child_project_id)
        );

        CREATE TABLE IF NOT EXISTS todo_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            target_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            target_parent_todo_id INTEGER REFERENCES todos(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_links_unique_parent_mount
            ON todo_links(source_todo_id, target_parent_todo_id)
            WHERE target_parent_todo_id IS NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_links_unique_root_mount
            ON todo_links(source_todo_id, target_project_id)
            WHERE target_parent_todo_id IS NULL;
        ",
    )?;
    conn.execute("DROP TABLE IF EXISTS opencode_tabs", [])?;
    drop_column_if_exists(conn, "projects", "opencode_directory")?;
    ensure_column(conn, "projects", "client", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(
        conn,
        "projects",
        "display_id_prefix",
        "TEXT NOT NULL DEFAULT 'T'",
    )?;
    ensure_column(
        conn,
        "projects",
        "actions_directory",
        "TEXT NOT NULL DEFAULT 'actions'",
    )?;
    ensure_column(
        conn,
        "projects",
        "project_folder_open_app",
        "TEXT NOT NULL DEFAULT 'cursor'",
    )?;
    ensure_column(
        conn,
        "projects",
        "main_branch",
        "TEXT NOT NULL DEFAULT 'main'",
    )?;
    ensure_column(
        conn,
        "project_links",
        "position",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "projects",
        "terminal_wsl_enabled",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "projects",
        "background_image_path",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(conn, "projects", "last_seq", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(
        conn,
        "projects",
        "notes_markdown",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(conn, "projects", "notes_updated_at", "TEXT")?;
    ensure_column(conn, "projects", "last_used_at", "TEXT")?;
    conn.execute(
        "UPDATE projects
            SET last_used_at = COALESCE(last_used_at, updated_at, created_at)
          WHERE last_used_at IS NULL",
        [],
    )?;
    ensure_column(
        conn,
        "projects",
        "ai_default_include_project_notes",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(conn, "projects", "ai_default_provider", "TEXT")?;
    ensure_column(
        conn,
        "projects",
        "ai_task_description_mode",
        "TEXT NOT NULL DEFAULT 'task'",
    )?;
    ensure_column(conn, "projects", "status", "TEXT NOT NULL DEFAULT 'Active'")?;
    ensure_column(
        conn,
        "projects",
        "inherit_parent",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "agent_sessions",
        "conversation_id",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(conn, "agent_sessions", "provider_session_id", "TEXT")?;
    ensure_column(conn, "agent_sessions", "provider_session_name", "TEXT")?;
    ensure_column(conn, "agent_sessions", "provider_session_link", "TEXT")?;
    ensure_column(conn, "agent_sessions", "pty_id", "INTEGER")?;
    ensure_column(
        conn,
        "agent_sessions",
        "command",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "mcp_enabled",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "mcp_port",
        "INTEGER NOT NULL DEFAULT 8787",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "mcp_token",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "theme",
        "TEXT NOT NULL DEFAULT 'light'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "claude_path",
        "TEXT NOT NULL DEFAULT 'claude'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "codex_path",
        "TEXT NOT NULL DEFAULT 'codex'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_titler",
        "TEXT NOT NULL DEFAULT 'codex-spark'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "deep_link_fallback",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "home_project_id",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_details_rail_hidden",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_list_collapsed_project_ids",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_list_collapsed_subproject_ids",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_list_collapsed_todo_ids",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_list_width",
        "INTEGER NOT NULL DEFAULT 300",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "task_detail_description_width",
        "INTEGER NOT NULL DEFAULT 420",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_editor_mode",
        "TEXT NOT NULL DEFAULT 'rich'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_editor_font_family",
        "TEXT NOT NULL DEFAULT 'sans-serif'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_editor_font_size",
        "TEXT NOT NULL DEFAULT '12px'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_editor_max_image_height",
        "TEXT NOT NULL DEFAULT 'none'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_toc_hidden",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_description_toc_width",
        "INTEGER NOT NULL DEFAULT 180",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "markdown_artifact_toc_width",
        "INTEGER NOT NULL DEFAULT 180",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "project_accent_border_width",
        "INTEGER NOT NULL DEFAULT 4",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "slowdown_profiler_enabled",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "terminal_tmux_enabled",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "external_terminal_openers",
        "TEXT NOT NULL DEFAULT 'open -na Ghostty.app --args --title={title} --working-directory={cwd} --command={tmuxCommand}, open -a Terminal.app {commandFile}'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "folder_open_app",
        "TEXT NOT NULL DEFAULT 'code'",
    )?;
    ensure_column(
        conn,
        "app_settings",
        "app_context_markdown",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    let position_added =
        ensure_column_added(conn, "todos", "position", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(
        conn,
        "todos",
        "journal_markdown",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "todos",
        "artifact_markdown",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(conn, "todos", "artifact_updated_at", "TEXT")?;
    ensure_column(conn, "todos", "worktree_name", "TEXT")?;
    ensure_column(conn, "todos", "worktree_path", "TEXT")?;
    ensure_column(conn, "todos", "worktree_created_at", "TEXT")?;
    ensure_column(conn, "todos", "worktree_merged_at", "TEXT")?;
    ensure_column(conn, "todos", "omp_session_id", "TEXT")?;
    conn.execute(
        "INSERT OR IGNORE INTO todo_provider_state (todo_id, provider, session_id, updated_at)
         SELECT id, 'omp', omp_session_id, updated_at
           FROM todos
          WHERE omp_session_id IS NOT NULL AND TRIM(omp_session_id) <> ''",
        [],
    )?;
    ensure_column(
        conn,
        "todos",
        "description_panel_hidden",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "todos",
        "execution_panel_hidden",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "todos",
        "description_toc_hidden",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(
        conn,
        "todos",
        "artifact_toc_hidden",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(conn, "todos", "starred", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(
        conn,
        "todos",
        "context_project_id",
        "INTEGER REFERENCES projects(id) ON DELETE SET NULL",
    )?;
    migrate_legacy_inbox_state(conn)?;
    if position_added {
        backfill_positions(conn)?;
    }
    Ok(())
}

pub(super) fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> AppResult<()> {
    ensure_column_added(conn, table, column, definition).map(|_| ())
}

pub(super) fn ensure_column_added(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> AppResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let columns = collect_rows(rows)?;

    if columns.iter().any(|existing| existing == column) {
        return Ok(false);
    }

    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(true)
}

fn drop_column_if_exists(conn: &Connection, table: &str, column: &str) -> AppResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let columns = collect_rows(rows)?;

    if columns.iter().any(|existing| existing == column) {
        conn.execute(&format!("ALTER TABLE {table} DROP COLUMN {column}"), [])?;
    }
    Ok(())
}

pub(super) fn backfill_positions(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        WITH ordered AS (
            SELECT id,
                ROW_NUMBER() OVER (
                    PARTITION BY project_id, IFNULL(parent_id, -1)
                    ORDER BY
                        CASE WHEN state IN ('Ready to Test','Needs Feedback') THEN 0 ELSE 1 END,
                        CASE priority
                            WHEN 'Urgent' THEN 0
                            WHEN 'High' THEN 1
                            WHEN 'Medium' THEN 2
                            WHEN 'Low' THEN 3
                            ELSE 4
                        END,
                        CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
                        deadline ASC,
                        updated_at DESC,
                        id ASC
                ) - 1 AS rn
            FROM todos
        )
        UPDATE todos
           SET position = (SELECT rn FROM ordered WHERE ordered.id = todos.id);
        ",
    )?;
    Ok(())
}

fn migrate_legacy_inbox_state(conn: &Connection) -> AppResult<()> {
    conn.execute("UPDATE todos SET state = 'To Do' WHERE state = 'Inbox'", [])?;
    migrate_legacy_inbox_event_json(conn, "before_json")?;
    migrate_legacy_inbox_event_json(conn, "after_json")?;
    Ok(())
}

fn migrate_legacy_inbox_event_json(conn: &Connection, column: &str) -> AppResult<()> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, {column}
           FROM events
          WHERE {column} LIKE '%\"state\"%'"
    ))?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let rows = collect_rows(rows)?;
    let mut updates = Vec::new();

    for (event_id, json_text) in rows {
        let mut value: Value = serde_json::from_str(&json_text).map_err(|err| {
            AppError::InvalidInput(format!("invalid event JSON during state migration: {err}"))
        })?;
        if replace_legacy_inbox_state(&mut value) {
            updates.push((event_id, value.to_string()));
        }
    }

    for (event_id, json_text) in updates {
        conn.execute(
            &format!("UPDATE events SET {column} = ?1 WHERE id = ?2"),
            params![json_text, event_id],
        )?;
    }

    Ok(())
}

fn replace_legacy_inbox_state(value: &mut Value) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };

    if object.get("state").and_then(Value::as_str) != Some("Inbox") {
        return false;
    }

    object.insert("state".to_string(), Value::String("To Do".to_string()));
    true
}
