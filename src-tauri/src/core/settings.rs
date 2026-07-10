use super::*;

/// Default MCP port seeded into a fresh database. Debug builds (`npm run tauri
/// dev`) use a different port from release builds so a dev instance and the
/// installed app can run their MCP servers side by side without colliding.
#[cfg(debug_assertions)]
pub(super) const DEFAULT_MCP_PORT: i64 = 8788;
#[cfg(not(debug_assertions))]
pub(super) const DEFAULT_MCP_PORT: i64 = 8787;
pub(super) const DEFAULT_TASK_LIST_WIDTH: i64 = 300;
pub(super) const MIN_TASK_LIST_WIDTH: i64 = 260;
pub(super) const MAX_TASK_LIST_WIDTH: i64 = 520;
pub(super) const DEFAULT_TASK_DETAIL_DESCRIPTION_WIDTH: i64 = 420;
pub(super) const MIN_TASK_DETAIL_DESCRIPTION_WIDTH: i64 = 320;
pub(super) const MAX_TASK_DETAIL_DESCRIPTION_WIDTH: i64 = 760;
pub(super) const DEFAULT_MARKDOWN_TOC_WIDTH: i64 = 180;
pub(super) const MIN_MARKDOWN_TOC_WIDTH: i64 = 120;
pub(super) const MAX_MARKDOWN_TOC_WIDTH: i64 = 360;
pub(super) const DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY: &str = "sans-serif";
pub(super) const DEFAULT_MARKDOWN_EDITOR_FONT_SIZE: &str = "12px";
pub(super) const DEFAULT_MARKDOWN_EDITOR_MAX_IMAGE_HEIGHT: &str = "none";
pub(super) const DEFAULT_PROJECT_ACCENT_BORDER_WIDTH: i64 = 4;
pub(super) const MIN_PROJECT_ACCENT_BORDER_WIDTH: i64 = 1;
pub(super) const MAX_PROJECT_ACCENT_BORDER_WIDTH: i64 = 12;
pub const DEFAULT_EXTERNAL_TERMINAL_OPENERS: &str = "open -na Ghostty.app --args --title={title} --working-directory={cwd} --command={tmuxCommand}, open -a Terminal.app {commandFile}";

pub(super) fn new_connection_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn ensure_app_settings_locked(conn: &Connection) -> AppResult<()> {
    let now = now_string();
    conn.execute(
        "INSERT OR IGNORE INTO app_settings
            (id, mcp_enabled, mcp_port, mcp_token,
             theme, claude_path, codex_path, task_titler,
             deep_link_fallback, task_details_rail_hidden,
             task_list_collapsed_project_ids, task_list_collapsed_subproject_ids,
             task_list_collapsed_todo_ids, task_list_width,
             task_detail_description_width, markdown_editor_mode,
             markdown_editor_font_family, markdown_editor_font_size,
             markdown_editor_max_image_height,
             markdown_toc_hidden, markdown_description_toc_width,
             markdown_artifact_toc_width, project_accent_border_width,
             slowdown_profiler_enabled, terminal_tmux_enabled, external_terminal_openers,
             folder_open_app, app_context_markdown, created_at, updated_at)
         VALUES (1, 1, ?3, ?1, 'system', 'claude', 'codex', 'codex-spark', 1, 0, '[]', '[]', '[]', ?4, ?5, 'rich', ?9, ?10, ?11, 0, ?6, ?6, ?7, 1, 0, ?8, 'code', '', ?2, ?2)",
        params![
            new_connection_token(),
            now,
            DEFAULT_MCP_PORT,
            DEFAULT_TASK_LIST_WIDTH,
            DEFAULT_TASK_DETAIL_DESCRIPTION_WIDTH,
            DEFAULT_MARKDOWN_TOC_WIDTH,
            DEFAULT_PROJECT_ACCENT_BORDER_WIDTH,
            DEFAULT_EXTERNAL_TERMINAL_OPENERS,
            DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY,
            DEFAULT_MARKDOWN_EDITOR_FONT_SIZE,
            DEFAULT_MARKDOWN_EDITOR_MAX_IMAGE_HEIGHT
        ],
    )?;
    let token: String = conn.query_row(
        "SELECT mcp_token FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    if token.trim().is_empty() {
        conn.execute(
            "UPDATE app_settings SET mcp_token = ?1, updated_at = ?2 WHERE id = 1",
            params![new_connection_token(), now],
        )?;
    }
    Ok(())
}

pub(super) fn app_settings_locked(conn: &Connection) -> AppResult<AppSettingsSummary> {
    conn.query_row(
        "SELECT mcp_enabled, mcp_port, mcp_token, theme, claude_path,
                codex_path, task_titler, deep_link_fallback, home_project_id,
                task_details_rail_hidden,
                task_list_collapsed_project_ids, task_list_collapsed_subproject_ids,
                task_list_collapsed_todo_ids, task_list_width, task_detail_description_width,
                markdown_editor_mode, markdown_editor_font_family,
                CASE
                    WHEN typeof(markdown_editor_font_size) IN ('integer', 'real')
                        THEN CAST(markdown_editor_font_size AS TEXT) || 'px'
                    ELSE CAST(markdown_editor_font_size AS TEXT)
                END AS markdown_editor_font_size,
                markdown_editor_max_image_height,
                markdown_toc_hidden,
                markdown_description_toc_width, markdown_artifact_toc_width,
                project_accent_border_width, slowdown_profiler_enabled,
                terminal_tmux_enabled, external_terminal_openers, folder_open_app,
                app_context_markdown
         FROM app_settings
         WHERE id = 1",
        [],
        |row| {
            Ok(AppSettingsSummary {
                mcp_enabled: row.get(0)?,
                mcp_port: row.get(1)?,
                mcp_token: row.get(2)?,
                theme: row.get(3)?,
                claude_path: row.get(4)?,
                codex_path: row.get(5)?,
                task_titler: row.get(6)?,
                deep_link_fallback: row.get(7)?,
                home_project_id: row.get(8)?,
                task_details_rail_hidden: row.get(9)?,
                task_list_collapsed_project_ids: collapsed_ids_from_json(row.get(10)?),
                task_list_collapsed_subproject_ids: collapsed_ids_from_json(row.get(11)?),
                task_list_collapsed_todo_ids: collapsed_ids_from_json(row.get(12)?),
                task_list_width: row.get(13)?,
                task_detail_description_width: row.get(14)?,
                markdown_editor_mode: row.get(15)?,
                markdown_editor_font_family: row.get(16)?,
                markdown_editor_font_size: row.get(17)?,
                markdown_editor_max_image_height: row.get(18)?,
                markdown_toc_hidden: row.get(19)?,
                markdown_description_toc_width: row.get(20)?,
                markdown_artifact_toc_width: row.get(21)?,
                project_accent_border_width: row.get(22)?,
                slowdown_profiler_enabled: row.get(23)?,
                terminal_tmux_enabled: row.get(24)?,
                external_terminal_openers: row.get(25)?,
                folder_open_app: row.get(26)?,
                app_context_markdown: row.get(27)?,
            })
        },
    )
    .map_err(AppError::from)
}

fn collapsed_ids_from_json(raw: String) -> Vec<i64> {
    serde_json::from_str::<Vec<i64>>(&raw)
        .map(normalize_collapsed_ids)
        .unwrap_or_default()
}

fn normalize_collapsed_ids(mut ids: Vec<i64>) -> Vec<i64> {
    ids.retain(|id| *id > 0);
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn collapsed_ids_to_json(ids: Vec<i64>) -> AppResult<String> {
    serde_json::to_string(&normalize_collapsed_ids(ids))
        .map_err(|err| AppError::InvalidInput(format!("invalid task list accordion state: {err}")))
}

impl AppDb {
    pub fn set_task_details_rail_hidden(&self, hidden: bool) -> AppResult<AppSettingsSummary> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET task_details_rail_hidden = ?1,
                    updated_at = ?2
              WHERE id = 1",
            params![hidden, now],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_task_list_width(&self, width: i64) -> AppResult<AppSettingsSummary> {
        let width = width.clamp(MIN_TASK_LIST_WIDTH, MAX_TASK_LIST_WIDTH);
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET task_list_width = ?1,
                    updated_at = ?2
              WHERE id = 1",
            params![width, now],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_task_list_accordion_state(
        &self,
        collapsed_project_ids: Vec<i64>,
        collapsed_subproject_ids: Vec<i64>,
        collapsed_todo_ids: Vec<i64>,
    ) -> AppResult<AppSettingsSummary> {
        let collapsed_project_ids = collapsed_ids_to_json(collapsed_project_ids)?;
        let collapsed_subproject_ids = collapsed_ids_to_json(collapsed_subproject_ids)?;
        let collapsed_todo_ids = collapsed_ids_to_json(collapsed_todo_ids)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET task_list_collapsed_project_ids = ?1,
                    task_list_collapsed_subproject_ids = ?2,
                    task_list_collapsed_todo_ids = ?3,
                    updated_at = ?4
              WHERE id = 1",
            params![
                collapsed_project_ids,
                collapsed_subproject_ids,
                collapsed_todo_ids,
                now
            ],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_task_detail_description_width(&self, width: i64) -> AppResult<AppSettingsSummary> {
        let width = width.clamp(
            MIN_TASK_DETAIL_DESCRIPTION_WIDTH,
            MAX_TASK_DETAIL_DESCRIPTION_WIDTH,
        );
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET task_detail_description_width = ?1,
                    updated_at = ?2
              WHERE id = 1",
            params![width, now],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_markdown_editor_mode(&self, mode: &str) -> AppResult<AppSettingsSummary> {
        let mode = markdown_editor_mode_label(mode)?;
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET markdown_editor_mode = ?1,
                    updated_at = ?2
              WHERE id = 1",
            params![mode, now],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_markdown_toc_hidden(&self, hidden: bool) -> AppResult<AppSettingsSummary> {
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            "UPDATE app_settings
                SET markdown_toc_hidden = ?1,
                    updated_at = ?2
              WHERE id = 1",
            params![hidden, now],
        )?;
        app_settings_locked(&conn)
    }

    pub fn set_markdown_toc_width(
        &self,
        target: &str,
        width: i64,
    ) -> AppResult<AppSettingsSummary> {
        let column = match target {
            "description" => "markdown_description_toc_width",
            "artifact" => "markdown_artifact_toc_width",
            other => {
                return Err(AppError::InvalidInput(format!(
                    "unknown markdown TOC width target: {other}"
                )))
            }
        };
        let width = width.clamp(MIN_MARKDOWN_TOC_WIDTH, MAX_MARKDOWN_TOC_WIDTH);
        let conn = self.conn.lock().expect("database lock is not poisoned");
        ensure_app_settings_locked(&conn)?;
        let now = now_string();
        conn.execute(
            &format!(
                "UPDATE app_settings
                    SET {column} = ?1,
                        updated_at = ?2
                  WHERE id = 1"
            ),
            params![width, now],
        )?;
        app_settings_locked(&conn)
    }
}
