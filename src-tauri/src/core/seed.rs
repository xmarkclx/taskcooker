use super::*;

pub(super) fn seed_demo_data_tx(tx: &Transaction<'_>) -> AppResult<()> {
    let now = "2026-06-20T10:00:00Z";
    tx.execute(
        "INSERT INTO projects
            (name, working_directory, display_id_prefix, actions_directory, last_seq,
             notes_markdown, notes_updated_at, ai_default_include_project_notes,
             created_at, updated_at)
         VALUES ('tmatrix', '~/p/tmatrix', 'T', '.boomerang/actions', 133,
             '# tmatrix notes\n\nUse stable MCP tokens across launches.', ?1, 0, ?1, ?1)",
        params![now],
    )?;
    let project_id = tx.last_insert_rowid();

    let auth = insert_seed_todo_tx(
        tx,
        project_id,
        104,
        "T-104",
        "Set up auth middleware",
        TodoState::Done,
        "Medium",
        None,
        None,
        now,
    )?;
    let selected = insert_seed_todo_tx(
        tx,
        project_id,
        128,
        "T-128",
        "Wire up MCP server",
        TodoState::ReadyToTest,
        "High",
        None,
        None,
        "2026-06-20T09:40:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        133,
        "T-133",
        "Create project action",
        TodoState::Doing,
        "Medium",
        None,
        None,
        "2026-06-20T09:55:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        131,
        "T-131",
        "Resolve auth token scope",
        TodoState::NeedsFeedback,
        "Urgent",
        None,
        None,
        "2026-06-20T04:55:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        8,
        "LIFE-8",
        "Draft deadline UI states",
        TodoState::Doing,
        "High",
        Some("2026-06-18T10:00:00Z"),
        None,
        "2026-06-19T10:00:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        103,
        "T-103",
        "Export palette tokens",
        TodoState::Delegated,
        "Low",
        Some("2026-06-20T18:40:00Z"),
        None,
        "2026-06-18T10:00:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        97,
        "T-097",
        "Set up SQLite migrations",
        TodoState::Done,
        "Medium",
        None,
        None,
        "2026-06-17T10:00:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        129,
        "T-129",
        "Define the five MCP tools",
        TodoState::Done,
        "Medium",
        None,
        Some(selected),
        "2026-06-20T09:00:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        130,
        "T-130",
        "Generate connection token",
        TodoState::Done,
        "Medium",
        None,
        Some(selected),
        "2026-06-20T09:05:00Z",
    )?;
    insert_seed_todo_tx(
        tx,
        project_id,
        132,
        "T-132",
        "Wire settings on/off toggle",
        TodoState::ToDo,
        "Medium",
        None,
        Some(selected),
        "2026-06-20T09:10:00Z",
    )?;

    tx.execute(
        "INSERT INTO dependencies (todo_id, depends_on_todo_id, created_at)
         VALUES (?1, ?2, ?3)",
        params![selected, auth, now],
    )?;
    for tag in ["AI", "Backend"] {
        tx.execute(
            "INSERT INTO todo_tags (todo_id, name) VALUES (?1, ?2)",
            params![selected, tag],
        )?;
    }
    tx.execute(
        "INSERT INTO time_logs
            (todo_id, started_at, ended_at, duration_seconds, source, created_at, updated_at)
         VALUES (?1, '2026-06-20T09:47:16Z', NULL, 764, 'timer', ?2, ?2)",
        params![selected, now],
    )?;
    tx.execute(
        "INSERT INTO agent_sessions
            (id, todo_id, provider, state, working_directory, last_activity,
             started_at, ended_at, created_at, updated_at)
         VALUES ('session-1', ?1, 'Claude', 'running', '~/p/tmatrix',
             'asked for token rotation decision', '2026-06-20T09:48:00Z',
             NULL, ?2, ?2)",
        params![selected, now],
    )?;
    insert_event_tx(
        tx,
        selected,
        "message_received",
        &Actor {
            actor_type: "ai".to_string(),
            actor_name: "Codex".to_string(),
        },
        Some("codex-demo"),
        json!({}),
        json!({ "state": "Ready to Test" }),
        Some("Implementation done and tests pass. Should the token rotate on every app launch, or only on manual regenerate?"),
        Some("codex://threads/codex-demo"),
    )?;
    insert_event_tx(
        tx,
        selected,
        "message_received",
        &Actor {
            actor_type: "human".to_string(),
            actor_name: "Mark".to_string(),
        },
        Some("codex-demo"),
        json!({}),
        json!({}),
        Some("Only on manual regenerate. Keep it stable across launches."),
        None,
    )?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn insert_seed_todo_tx(
    tx: &Transaction<'_>,
    project_id: i64,
    seq: i64,
    display_id: &str,
    title: &str,
    state: TodoState,
    priority: &str,
    deadline: Option<&str>,
    parent_id: Option<i64>,
    updated_at: &str,
) -> AppResult<i64> {
    tx.execute(
        "INSERT INTO todos
            (project_id, seq, display_id, title, description_markdown, state,
             priority, deadline, parent_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            project_id,
            seq,
            display_id,
            title,
            demo_description_for(display_id),
            state.as_label(),
            priority,
            deadline,
            parent_id,
            updated_at
        ],
    )?;
    let todo_id = tx.last_insert_rowid();
    insert_event_tx(
        tx,
        todo_id,
        "created",
        &Actor::system("Boomerang"),
        None,
        json!({}),
        json!({ "state": state.as_label(), "title": title }),
        None,
        None,
    )?;
    if matches!(state, TodoState::ReadyToTest | TodoState::NeedsFeedback) {
        insert_event_tx(
            tx,
            todo_id,
            "state_changed",
            &Actor::system("Boomerang"),
            None,
            json!({ "state": "Delegated" }),
            json!({ "state": state.as_label() }),
            None,
            None,
        )?;
    }
    Ok(todo_id)
}

pub(super) fn demo_description_for(display_id: &str) -> &'static str {
    if display_id == "T-128" {
        "# Goal\n\nEmbed the MCP server in the Tauri app over loopback HTTP/SSE.\n\n- [x] Define the five MCP tools\n- [ ] Wire the settings on/off toggle\n\n```text\nbind 127.0.0.1:8787\nauth Bearer <token>\n```"
    } else {
        ""
    }
}
