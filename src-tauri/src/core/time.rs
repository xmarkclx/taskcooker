use super::*;

pub(super) fn time_seconds_for_todo(
    conn: &Connection,
    todo_id: i64,
    now: DateTime<Utc>,
) -> AppResult<i64> {
    let mut stmt = conn.prepare(
        "SELECT started_at, ended_at, duration_seconds FROM time_logs WHERE todo_id = ?1",
    )?;
    let rows = stmt.query_map(params![todo_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let mut total = 0;
    for row in rows {
        let (started_at, ended_at, duration_seconds) = row?;
        total += if let Some(ended_at) = ended_at {
            duration_seconds.max(seconds_between(&started_at, &ended_at).unwrap_or(0))
        } else {
            seconds_between_now(&started_at, now).unwrap_or(duration_seconds)
        };
    }
    Ok(total.max(0))
}

pub(super) fn rolled_up_time_seconds(
    conn: &Connection,
    todo_id: i64,
    now: DateTime<Utc>,
) -> AppResult<i64> {
    let mut total = time_seconds_for_todo(conn, todo_id, now)?;
    let mut stmt = conn.prepare("SELECT id FROM todos WHERE parent_id = ?1 ORDER BY id ASC")?;
    let child_ids = stmt
        .query_map(params![todo_id], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for child_id in child_ids {
        total += rolled_up_time_seconds(conn, child_id, now)?;
    }
    Ok(total)
}

pub(super) fn state_age_label(
    conn: &Connection,
    todo_id: i64,
    now: DateTime<Utc>,
) -> AppResult<Option<String>> {
    let entered_at: Option<String> = conn
        .query_row(
            "SELECT created_at FROM events
             WHERE todo_id = ?1 AND event_type = 'state_changed'
             ORDER BY id DESC
             LIMIT 1",
            params![todo_id],
            |row| row.get(0),
        )
        .optional()?;

    Ok(entered_at
        .and_then(|value| seconds_between_now(&value, now))
        .map(format_compact_age))
}

pub(super) fn todo_stale(
    conn: &Connection,
    todo_id: i64,
    state: &TodoState,
    updated_at: &str,
    now: DateTime<Utc>,
) -> AppResult<bool> {
    let latest_event_at: Option<String> = conn
        .query_row(
            "SELECT created_at FROM events
             WHERE todo_id = ?1
             ORDER BY id DESC
             LIMIT 1",
            params![todo_id],
            |row| row.get(0),
        )
        .optional()?;

    Ok(todo_stale_from_activity(
        state,
        latest_event_at.as_deref().or(Some(updated_at)),
        now,
    ))
}

pub(super) fn todo_stale_from_activity(
    state: &TodoState,
    latest_activity_at: Option<&str>,
    now: DateTime<Utc>,
) -> bool {
    if !matches!(
        state,
        TodoState::Blocked
            | TodoState::Delegated
            | TodoState::Waiting
            | TodoState::ReadyToTest
            | TodoState::NeedsFeedback
    ) {
        return false;
    }

    latest_activity_at
        .and_then(|value| seconds_between_now(value, now))
        .is_some_and(|seconds| seconds >= STALE_TODO_SECONDS)
}

pub(super) fn seconds_between(start: &str, end: &str) -> Option<i64> {
    let start = DateTime::parse_from_rfc3339(start)
        .ok()?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(end).ok()?.with_timezone(&Utc);
    Some((end - start).num_seconds().max(0))
}

pub(super) fn seconds_between_now(start: &str, now: DateTime<Utc>) -> Option<i64> {
    let start = DateTime::parse_from_rfc3339(start)
        .ok()?
        .with_timezone(&Utc);
    Some((now - start).num_seconds().max(0))
}

pub(super) fn elapsed_label_since(start: &str) -> Option<String> {
    seconds_between_now(start, Utc::now()).map(format_compact_age)
}

pub(super) fn format_compact_age(seconds: i64) -> String {
    let days = seconds / 86_400;
    let hours = (seconds % 86_400) / 3_600;
    let minutes = (seconds % 3_600) / 60;

    if days > 0 {
        if hours > 0 {
            format!("{days}d {hours}h")
        } else {
            format!("{days}d")
        }
    } else if hours > 0 {
        if minutes > 0 {
            format!("{hours}h {minutes}m")
        } else {
            format!("{hours}h")
        }
    } else {
        format!("{}m", minutes.max(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todo_staleness_uses_latest_activity_for_waiting_states_only() {
        let now = DateTime::parse_from_rfc3339("2026-06-20T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        assert!(todo_stale_from_activity(
            &TodoState::Delegated,
            Some("2026-06-19T11:59:59Z"),
            now
        ));
        assert!(!todo_stale_from_activity(
            &TodoState::Delegated,
            Some("2026-06-19T12:30:00Z"),
            now
        ));
        assert!(!todo_stale_from_activity(
            &TodoState::Doing,
            Some("2026-06-18T12:00:00Z"),
            now
        ));
    }
}
