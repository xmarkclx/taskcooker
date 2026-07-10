use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use super::time::{
    elapsed_label_since, rolled_up_time_seconds, seconds_between_now, state_age_label,
    time_seconds_for_todo, todo_stale,
};
use super::*;

pub(super) fn todo_by_id_locked(conn: &Connection, todo_id: i64) -> AppResult<Todo> {
    conn.query_row(
        "SELECT id, project_id, seq, display_id, title, description_markdown, state,
                starred, parent_id, worktree_name, worktree_path, context_project_id
         FROM todos
         WHERE id = ?1",
        params![todo_id],
        todo_from_row,
    )
    .map_err(AppError::from)
}

pub(super) fn project_summaries(conn: &Connection) -> AppResult<Vec<ProjectSummary>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.client, p.working_directory, p.display_id_prefix,
                p.actions_directory, p.project_folder_open_app, p.main_branch,
                p.terminal_wsl_enabled, p.background_image_path, p.notes_markdown,
                p.ai_default_include_project_notes, p.ai_task_description_mode,
                p.ai_default_provider,
                COALESCE(SUM(CASE WHEN t.state NOT IN ('Done', 'Archived') THEN 1 ELSE 0 END), 0),
                p.status, p.inherit_parent
         FROM projects p
         LEFT JOIN todos t ON t.project_id = p.id
         GROUP BY p.id, p.name, p.client, p.working_directory, p.display_id_prefix,
                  p.actions_directory, p.project_folder_open_app, p.main_branch,
                  p.terminal_wsl_enabled, p.background_image_path, p.notes_markdown,
                  p.ai_default_include_project_notes, p.ai_task_description_mode,
                  p.ai_default_provider, p.status, p.inherit_parent
         ORDER BY COALESCE(p.last_used_at, p.updated_at, p.created_at) DESC, p.id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ProjectSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            client: row.get(2)?,
            working_directory: row.get(3)?,
            display_id_prefix: row.get(4)?,
            actions_directory: row.get(5)?,
            project_folder_open_app: row.get(6)?,
            main_branch: row.get(7)?,
            terminal_wsl_enabled: row.get(8)?,
            background_image_path: row.get(9)?,
            notes_markdown: row.get(10)?,
            ai_default_include_project_notes: row.get(11)?,
            ai_task_description_mode: row.get(12)?,
            ai_default_provider: row.get(13)?,
            active_todo_count: row.get::<_, i64>(14)?,
            status: row.get::<_, String>(15)?,
            inherit_parent: row.get::<_, bool>(16)?,
            subprojects: Vec::new(),
        })
    })?;
    let mut summaries = collect_rows(rows)?;
    for summary in &mut summaries {
        let (effective_dir, effective_notes, _owner) =
            effective_project_dir_and_notes(conn, summary.id)?;
        summary.working_directory = effective_dir;
        summary.notes_markdown = effective_notes;

        let mut link_stmt = conn.prepare(
            "SELECT child_project_id, kind FROM project_links
             WHERE parent_project_id = ?1 ORDER BY position ASC, child_project_id ASC",
        )?;
        summary.subprojects = link_stmt
            .query_map(params![summary.id], |row| {
                Ok(ProjectLinkSummary {
                    child_project_id: row.get(0)?,
                    kind: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
    }
    Ok(summaries)
}

pub(super) fn todo_summaries(
    conn: &Connection,
    project_id: i64,
    app_data_dir: &Path,
) -> AppResult<Vec<TodoSummary>> {
    let now = Utc::now();
    let mut stmt = conn.prepare(
        "WITH RECURSIVE linked_visible_todos(id) AS (
            SELECT source_todo_id
            FROM todo_links
            WHERE ?1 != 0 AND target_project_id = ?1
            UNION
            SELECT child.id
            FROM todos child
            JOIN linked_visible_todos parent ON child.parent_id = parent.id
         )
         SELECT t.id, t.project_id, t.parent_id, t.position, t.display_id, t.title,
                t.description_markdown, t.journal_markdown, t.artifact_markdown, t.state, t.priority,
                t.starred, t.deadline, t.worktree_name, t.worktree_path, t.worktree_merged_at,
                COALESCE((SELECT session_id FROM todo_provider_state WHERE todo_id = t.id AND provider = 'omp'), t.omp_session_id),
                (SELECT session_id FROM todo_provider_state WHERE todo_id = t.id AND provider = 'codex'),
                (SELECT session_id FROM todo_provider_state WHERE todo_id = t.id AND provider = 'claude'),
                p.working_directory, t.created_at, t.updated_at, t.description_panel_hidden,
                t.execution_panel_hidden, t.description_toc_hidden, t.artifact_toc_hidden,
                t.context_project_id
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         WHERE (?1 = 0 OR t.project_id = ?1 OR t.id IN (SELECT id FROM linked_visible_todos))
         ORDER BY t.id ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        let state_label: String = row.get(9)?;
        let state = TodoState::from_label(&state_label).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(err))
        })?;

        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, String>(8)?,
            state,
            row.get::<_, String>(10)?,
            row.get::<_, bool>(11)?,
            row.get::<_, Option<String>>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, Option<String>>(14)?,
            row.get::<_, Option<String>>(15)?,
            row.get::<_, Option<String>>(16)?,
            row.get::<_, Option<String>>(17)?,
            row.get::<_, Option<String>>(18)?,
            row.get::<_, String>(19)?,
            row.get::<_, String>(20)?,
            row.get::<_, String>(21)?,
            row.get::<_, bool>(22)?,
            row.get::<_, bool>(23)?,
            row.get::<_, bool>(24)?,
            row.get::<_, bool>(25)?,
            row.get::<_, Option<i64>>(26)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;

    // Resolve inherited contexts in memory: a todo runs in its own context
    // project, else the nearest ancestor's. Parent chains never leave the
    // todo's project, so the fetched rows always contain the whole chain.
    let context_info: HashMap<i64, (Option<i64>, Option<i64>)> =
        rows.iter().map(|row| (row.0, (row.2, row.26))).collect();
    let resolve_context_project = |todo_id: i64| -> Option<i64> {
        let mut current = todo_id;
        let mut visited = HashSet::new();
        visited.insert(current);
        while let Some((parent_id, context_project_id)) = context_info.get(&current) {
            if context_project_id.is_some() {
                return *context_project_id;
            }
            match parent_id {
                Some(parent) if visited.insert(*parent) => current = *parent,
                _ => return None,
            }
        }
        None
    };

    rows.into_iter()
        .map(
            |(
                id,
                project_id,
                parent_id,
                position,
                display_id,
                title,
                description_markdown,
                journal_markdown,
                artifact_markdown,
                state,
                priority,
                starred,
                deadline,
                worktree_name,
                worktree_path,
                worktree_merged_at,
                omp_session_id,
                codex_session_id,
                claude_session_id,
                _project_working_directory,
                created_at,
                updated_at,
                description_panel_hidden,
                execution_panel_hidden,
                description_toc_hidden,
                artifact_toc_hidden,
                context_project_id,
            )| {
                let own_time_seconds = time_seconds_for_todo(conn, id, now)?;
                let dependencies = dependency_summaries(conn, id)?;
                let stale = todo_stale(conn, id, &state, &updated_at, now)?;
                let artifact_path = todo_artifact_path(app_data_dir, project_id, &display_id);
                let artifact_markdown =
                    fs::read_to_string(&artifact_path).unwrap_or(artifact_markdown);
                let effective_context_project_id = resolve_context_project(id);
                let (effective_dir, _notes, _owner) = effective_project_dir_and_notes(
                    conn,
                    effective_context_project_id.unwrap_or(project_id),
                )?;
                let active_working_directory = worktree_path
                    .clone()
                    .unwrap_or_else(|| effective_dir.clone());
                Ok(TodoSummary {
                    id,
                    project_id,
                    parent_id,
                    context_project_id,
                    effective_context_project_id,
                    position,
                    display_id,
                    title,
                    description_markdown,
                    journal_markdown,
                    artifact_markdown,
                    artifact_markdown_path: home_aliased_path(&artifact_path),
                    description_panel_hidden,
                    execution_panel_hidden,
                    description_toc_hidden,
                    artifact_toc_hidden,
                    state,
                    starred,
                    priority,
                    deadline,
                    worktree_name,
                    worktree_path,
                    worktree_merged_at,
                    omp_session_id,
                    codex_session_id,
                    claude_session_id,
                    active_working_directory,
                    created_at,
                    updated_at,
                    tags: tags_for_todo(conn, id)?,
                    own_time_seconds,
                    rolled_up_time_seconds: rolled_up_time_seconds(conn, id, now)?,
                    state_age_label: state_age_label(conn, id, now)?,
                    stale,
                    dependency: dependencies.first().cloned(),
                    dependencies,
                    subtasks: subtask_summaries(conn, id)?,
                    linked_tasks: linked_task_summaries(conn, id)?,
                    time_logs: time_log_summaries(conn, id)?,
                    events: Vec::new(),
                })
            },
        )
        .collect()
}

pub(super) fn tags_for_todo(conn: &Connection, todo_id: i64) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM todo_tags WHERE todo_id = ?1 ORDER BY name")?;
    let rows = stmt.query_map(params![todo_id], |row| row.get(0))?;
    collect_rows(rows)
}

pub(super) fn dependency_summaries(
    conn: &Connection,
    todo_id: i64,
) -> AppResult<Vec<TodoDependencySummary>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.display_id, t.title, t.state
         FROM dependencies d
         JOIN todos t ON t.id = d.depends_on_todo_id
         WHERE d.todo_id = ?1
         ORDER BY t.display_id",
    )?;
    let rows = stmt.query_map(params![todo_id], |row| {
        let state_label: String = row.get(3)?;
        let state = TodoState::from_label(&state_label).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(err))
        })?;
        Ok(TodoDependencySummary {
            id: row.get(0)?,
            display_id: row.get(1)?,
            title: row.get(2)?,
            state,
        })
    })?;
    collect_rows(rows)
}

pub(super) fn subtask_summaries(
    conn: &Connection,
    parent_id: i64,
) -> AppResult<Vec<SubtaskSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, display_id, title, state FROM todos WHERE parent_id = ?1 ORDER BY position ASC, seq ASC",
    )?;
    let rows = stmt.query_map(params![parent_id], |row| {
        let state_label: String = row.get(3)?;
        let state = TodoState::from_label(&state_label).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(err))
        })?;
        Ok(SubtaskSummary {
            id: row.get(0)?,
            display_id: row.get(1)?,
            title: row.get(2)?,
            done: state == TodoState::Done,
            state,
        })
    })?;
    collect_rows(rows)
}

pub(super) fn linked_task_summaries(
    conn: &Connection,
    parent_id: i64,
) -> AppResult<Vec<LinkedTaskSummary>> {
    let mut stmt = conn.prepare(
        "SELECT source.id, source.display_id, source.title, source.state,
                source.project_id, link.target_project_id, link.target_parent_todo_id,
                link.position
         FROM todo_links link
         JOIN todos source ON source.id = link.source_todo_id
         WHERE link.target_parent_todo_id = ?1
         ORDER BY link.position ASC, link.id ASC",
    )?;
    let rows = stmt.query_map(params![parent_id], |row| {
        let state_label: String = row.get(3)?;
        let state = TodoState::from_label(&state_label).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(err))
        })?;
        Ok(LinkedTaskSummary {
            id: row.get(0)?,
            display_id: row.get(1)?,
            title: row.get(2)?,
            done: state == TodoState::Done,
            state,
            source_project_id: row.get(4)?,
            target_project_id: row.get(5)?,
            parent_todo_id: row.get(6)?,
            position: row.get(7)?,
        })
    })?;
    collect_rows(rows)
}

pub(super) fn time_log_summaries(
    conn: &Connection,
    todo_id: i64,
) -> AppResult<Vec<TimeLogSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, ended_at, duration_seconds, source
         FROM time_logs
         WHERE todo_id = ?1
         ORDER BY started_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![todo_id], |row| {
        let ended_at: Option<String> = row.get(2)?;
        Ok(TimeLogSummary {
            id: row.get(0)?,
            started_at: row.get(1)?,
            running: ended_at.is_none(),
            ended_at,
            duration_seconds: row.get(3)?,
            source: row.get(4)?,
        })
    })?;
    collect_rows(rows)
}

pub(super) fn event_summaries(conn: &Connection, todo_id: i64) -> AppResult<Vec<EventSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, event_type, actor_type, actor_name, before_json, after_json,
                message, link, created_at
         FROM events
         WHERE todo_id = ?1
         ORDER BY id DESC
         LIMIT 50",
    )?;
    let rows = stmt.query_map(params![todo_id], |row| {
        let event_id: i64 = row.get(0)?;
        let before_json: String = row.get(4)?;
        let after_json: String = row.get(5)?;
        Ok(EventSummary {
            id: format!("M-{event_id}"),
            event_type: row.get(1)?,
            actor_type: row.get(2)?,
            actor_name: row.get(3)?,
            before: serde_json::from_str(&before_json).unwrap_or_else(|_| json!({})),
            after: serde_json::from_str(&after_json).unwrap_or_else(|_| json!({})),
            message: row.get(6)?,
            link: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    collect_rows(rows)
}

pub(super) fn running_timer_summary(conn: &Connection) -> AppResult<Option<RunningTimerSummary>> {
    let now = Utc::now();
    conn.query_row(
        "SELECT l.todo_id, t.project_id, t.display_id, t.title, l.started_at, l.duration_seconds
         FROM time_logs l
         JOIN todos t ON t.id = l.todo_id
         WHERE l.ended_at IS NULL
         ORDER BY l.id DESC
         LIMIT 1",
        [],
        |row| {
            let started_at: String = row.get(4)?;
            let duration_seconds: i64 = row.get(5)?;
            Ok(RunningTimerSummary {
                todo_id: row.get(0)?,
                project_id: row.get(1)?,
                display_id: row.get(2)?,
                title: row.get(3)?,
                elapsed_seconds: seconds_between_now(&started_at, now).unwrap_or(duration_seconds),
            })
        },
    )
    .optional()
    .map_err(AppError::from)
}

pub(super) fn agent_session_summaries(
    conn: &Connection,
    project_id: i64,
) -> AppResult<Vec<AgentSessionSummary>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.todo_id, s.conversation_id, s.provider, s.provider_session_id,
                s.pty_id, s.command, s.state, s.working_directory, s.last_activity,
                s.started_at,
                CASE
                    WHEN s.state = 'running' THEN 0
                    ELSE (
                        SELECT COUNT(*)
                        FROM events e
                        WHERE e.todo_id = s.todo_id
                          AND e.actor_type = 'human'
                          AND e.message IS NOT NULL
                          AND e.created_at >= COALESCE(s.ended_at, s.created_at)
                          AND (e.conversation_id = s.conversation_id OR e.conversation_id = s.id)
                    )
                END AS pending_reply_count
         FROM agent_sessions s
         JOIN todos t ON t.id = s.todo_id
         WHERE (?1 = 0 OR t.project_id = ?1)
         ORDER BY s.updated_at DESC, s.id ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        let state: String = row.get(7)?;
        let started_at: String = row.get(10)?;
        let provider: String = row.get(3)?;
        let provider_session_id: Option<String> = row.get(4)?;
        let working_directory: String = row.get(8)?;
        Ok(AgentSessionSummary {
            id: row.get(0)?,
            todo_id: row.get(1)?,
            conversation_id: row.get(2)?,
            provider,
            provider_session_id,
            pty_id: row.get(5)?,
            command: row.get(6)?,
            state,
            pending_reply_count: row.get(11)?,
            elapsed_label: elapsed_label_since(&started_at).unwrap_or_else(|| "0m".to_string()),
            working_directory,
            last_activity: row.get(9)?,
        })
    })?;
    collect_rows(rows)
}

pub(super) fn execution_terminal_summaries(
    conn: &Connection,
    project_id: i64,
) -> AppResult<Vec<ExecutionTerminalSummary>> {
    let mut stmt = conn.prepare(
        "SELECT e.todo_id, e.pty_id, e.label, e.kind, e.state, e.exit_code
         FROM execution_terminals e
         JOIN todos t ON t.id = e.todo_id
         WHERE (?1 = 0 OR t.project_id = ?1)
         ORDER BY e.created_at ASC, e.pty_id ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(ExecutionTerminalSummary {
            todo_id: row.get(0)?,
            pty_id: row.get(1)?,
            label: row.get(2)?,
            kind: row.get(3)?,
            state: row.get(4)?,
            exit_code: row.get(5)?,
        })
    })?;
    collect_rows(rows)
}

pub(super) const PENDING_HUMAN_MESSAGE_DELIVERY: &str = "Pending for next session";

/// Messages shipped with the app snapshot. The UI consumes only two slices of
/// message data — unread agent messages (task-list unread chips) and human
/// replies still waiting for a session to pick them up (prompt building) — so
/// everything else is filtered out to keep the payload small: the snapshot is
/// refetched by every open window on every `todos:changed` burst, and full
/// message history stays available through `todo_message_summaries`.
pub(super) fn snapshot_message_summaries(conn: &Connection) -> AppResult<Vec<MessageSummary>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.todo_id, e.actor_name, e.actor_type, e.created_at, e.message,
                e.conversation_id, e.link, COALESCE(r.last_read_event_id, 0)
         FROM events e
         JOIN todos t ON t.id = e.todo_id
         LEFT JOIN todo_message_reads r ON r.todo_id = e.todo_id
         WHERE e.message IS NOT NULL
           AND (e.actor_type = 'human' OR e.id > COALESCE(r.last_read_event_id, 0))
         ORDER BY e.id ASC",
    )?;
    let rows = stmt.query_map([], |row| message_summary_from_row(conn, row))?;
    let mut messages = collect_rows(rows)?;
    messages.retain(|message| {
        if message.actor_type == "human" {
            message.delivery.as_deref() == Some(PENDING_HUMAN_MESSAGE_DELIVERY)
        } else {
            message.unread == Some(true)
        }
    });
    Ok(messages)
}

/// Full message history for one task — the per-todo read used by the CLI and
/// MCP `get` paths, which need everything, not the slimmed snapshot slice.
pub(super) fn todo_message_summaries(
    conn: &Connection,
    todo_id: i64,
) -> AppResult<Vec<MessageSummary>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.todo_id, e.actor_name, e.actor_type, e.created_at, e.message,
                e.conversation_id, e.link, COALESCE(r.last_read_event_id, 0)
         FROM events e
         LEFT JOIN todo_message_reads r ON r.todo_id = e.todo_id
         WHERE e.todo_id = ?1 AND e.message IS NOT NULL
         ORDER BY e.id ASC",
    )?;
    let rows = stmt.query_map(params![todo_id], |row| message_summary_from_row(conn, row))?;
    collect_rows(rows)
}

fn message_summary_from_row(
    conn: &Connection,
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<MessageSummary> {
    let event_id: i64 = row.get(0)?;
    let todo_id: i64 = row.get(1)?;
    let actor_type: String = row.get(3)?;
    let conversation_id: Option<String> = row.get(6)?;
    let last_read_event_id: i64 = row.get(8)?;
    Ok(MessageSummary {
        id: format!("m-{event_id}"),
        todo_id,
        actor_name: row.get(2)?,
        actor_type: actor_type.clone(),
        created_label: "just now".to_string(),
        body: row.get(5)?,
        conversation_id: conversation_id.clone(),
        delivery: if actor_type == "human" {
            Some(human_message_delivery(
                conn,
                todo_id,
                conversation_id.as_deref(),
            )?)
        } else {
            None
        },
        link: row.get(7)?,
        unread: if actor_type == "human" {
            None
        } else {
            Some(event_id > last_read_event_id)
        },
    })
}

pub(super) fn human_message_delivery(
    conn: &Connection,
    todo_id: i64,
    conversation_id: Option<&str>,
) -> rusqlite::Result<String> {
    let mut query =
        "SELECT provider FROM agent_sessions WHERE todo_id = ?1 AND state = 'running'".to_string();
    if conversation_id.is_some() {
        query.push_str(" AND (id = ?2 OR conversation_id = ?2)");
    }
    query.push_str(" ORDER BY updated_at DESC LIMIT 1");

    let provider = if let Some(conversation_id) = conversation_id {
        conn.query_row(&query, params![todo_id, conversation_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()?
    } else {
        conn.query_row(&query, params![todo_id], |row| row.get::<_, String>(0))
            .optional()?
    };

    Ok(provider
        .map(|provider| format!("Sent to {provider} session"))
        .unwrap_or_else(|| PENDING_HUMAN_MESSAGE_DELIVERY.to_string()))
}

pub(super) fn todo_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    let state_label: String = row.get(6)?;
    let state = TodoState::from_label(&state_label).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(err))
    })?;

    Ok(Todo {
        id: row.get(0)?,
        project_id: row.get(1)?,
        seq: row.get(2)?,
        display_id: row.get(3)?,
        title: row.get(4)?,
        description_markdown: row.get(5)?,
        state,
        starred: row.get(7)?,
        parent_id: row.get(8)?,
        worktree_name: row.get(9)?,
        worktree_path: row.get(10)?,
        context_project_id: row.get(11)?,
    })
}

pub(super) fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Event> {
    let before_json: String = row.get(6)?;
    let after_json: String = row.get(7)?;

    Ok(Event {
        id: row.get(0)?,
        todo_id: row.get(1)?,
        event_type: row.get(2)?,
        actor_type: row.get(3)?,
        actor_name: row.get(4)?,
        conversation_id: row.get(5)?,
        before: serde_json::from_str(&before_json).unwrap_or_else(|_| json!({})),
        after: serde_json::from_str(&after_json).unwrap_or_else(|_| json!({})),
        message: row.get(8)?,
        link: row.get(9)?,
        created_at: row.get(10)?,
    })
}

pub(super) fn time_log_by_id_locked(conn: &Connection, id: i64) -> AppResult<TimeLog> {
    conn.query_row(
        "SELECT id, todo_id, started_at, ended_at, duration_seconds, source
         FROM time_logs
         WHERE id = ?1",
        params![id],
        time_log_from_row,
    )
    .map_err(AppError::from)
}

pub(super) fn time_log_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeLog> {
    Ok(TimeLog {
        id: row.get(0)?,
        todo_id: row.get(1)?,
        started_at: row.get(2)?,
        ended_at: row.get(3)?,
        duration_seconds: row.get(4)?,
        source: row.get(5)?,
    })
}

pub(super) fn open_time_logs(tx: &Transaction<'_>) -> AppResult<Vec<TimeLog>> {
    let mut stmt = tx.prepare(
        "SELECT id, todo_id, started_at, ended_at, duration_seconds, source
         FROM time_logs
         WHERE ended_at IS NULL
         ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], time_log_from_row)?;
    collect_rows(rows)
}
