use super::*;

pub(super) fn dependency_path(
    tx: &Transaction<'_>,
    start: i64,
    target: i64,
) -> AppResult<Option<Vec<i64>>> {
    find_path(
        tx,
        start,
        target,
        "SELECT depends_on_todo_id FROM dependencies WHERE todo_id = ?1",
    )
}

pub(super) fn subproject_path(
    tx: &Transaction<'_>,
    start: i64,
    target: i64,
) -> AppResult<Option<Vec<i64>>> {
    find_path(
        tx,
        start,
        target,
        "SELECT child_project_id FROM project_links WHERE parent_project_id = ?1",
    )
}

pub(super) fn child_path(
    tx: &Transaction<'_>,
    start: i64,
    target: i64,
) -> AppResult<Option<Vec<i64>>> {
    find_path(
        tx,
        start,
        target,
        "SELECT id FROM todos WHERE parent_id = ?1",
    )
}

pub(super) fn find_path(
    tx: &Transaction<'_>,
    start: i64,
    target: i64,
    sql: &str,
) -> AppResult<Option<Vec<i64>>> {
    fn visit(
        tx: &Transaction<'_>,
        current: i64,
        target: i64,
        sql: &str,
        seen: &mut HashSet<i64>,
    ) -> AppResult<Option<Vec<i64>>> {
        if current == target {
            return Ok(Some(vec![current]));
        }
        if !seen.insert(current) {
            return Ok(None);
        }

        let mut stmt = tx.prepare(sql)?;
        let next_ids = stmt
            .query_map(params![current], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        for next_id in next_ids {
            if let Some(mut path) = visit(tx, next_id, target, sql, seen)? {
                path.insert(0, current);
                return Ok(Some(path));
            }
        }

        Ok(None)
    }

    visit(tx, start, target, sql, &mut HashSet::new())
}

pub(super) fn display_path(tx: &Transaction<'_>, ids: &[i64]) -> AppResult<String> {
    let labels = ids
        .iter()
        .map(|id| {
            tx.query_row(
                "SELECT display_id FROM todos WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(labels.join(" -> "))
}

pub(super) fn project_id_for_todo(tx: &Transaction<'_>, todo_id: i64) -> AppResult<i64> {
    tx.query_row(
        "SELECT project_id FROM todos WHERE id = ?1",
        params![todo_id],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

pub(super) fn project_id_for_todo_conn(conn: &Connection, todo_id: i64) -> AppResult<Option<i64>> {
    conn.query_row(
        "SELECT project_id FROM todos WHERE id = ?1",
        params![todo_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(AppError::from)
}
