use super::*;

pub(super) fn required_text(label: &str, value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} is required")));
    }

    Ok(trimmed.to_string())
}

pub(super) fn valid_duration_seconds(value: i64) -> AppResult<i64> {
    if value <= 0 {
        return Err(AppError::InvalidInput(
            "duration must be greater than zero".to_string(),
        ));
    }
    if value > 30 * 24 * 60 * 60 {
        return Err(AppError::InvalidInput(
            "duration must be 30 days or less".to_string(),
        ));
    }

    Ok(value)
}

pub(super) fn display_id_prefix(value: &str) -> AppResult<String> {
    let prefix = required_text("display id prefix", value)?.to_uppercase();
    if !prefix
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
    {
        return Err(AppError::InvalidInput(
            "display id prefix must use only letters and numbers".to_string(),
        ));
    }

    Ok(prefix)
}

pub(super) fn task_description_mode_label(value: &str) -> AppResult<String> {
    match value.trim().to_lowercase().as_str() {
        "none" => Ok("none".to_string()),
        "task" => Ok("task".to_string()),
        "ancestry" => Ok("ancestry".to_string()),
        other => Err(AppError::InvalidInput(format!(
            "unknown task description mode: {other}"
        ))),
    }
}

pub(super) fn theme_label(value: &str) -> AppResult<String> {
    match value.trim().to_lowercase().as_str() {
        "system" => Ok("system".to_string()),
        "light" => Ok("light".to_string()),
        "dark" => Ok("dark".to_string()),
        other => Err(AppError::InvalidInput(format!("unknown theme: {other}"))),
    }
}

pub(super) fn task_titler_label(value: &str) -> AppResult<String> {
    match value.trim().to_lowercase().as_str() {
        "codex-spark" => Ok("codex-spark".to_string()),
        "local-fallback" => Ok("local-fallback".to_string()),
        other => Err(AppError::InvalidInput(format!(
            "unknown task titler: {other}"
        ))),
    }
}

pub(super) fn markdown_editor_mode_label(value: &str) -> AppResult<String> {
    match value.trim().to_lowercase().as_str() {
        "rich" => Ok("rich".to_string()),
        "raw" => Ok("raw".to_string()),
        other => Err(AppError::InvalidInput(format!(
            "unknown markdown editor mode: {other}"
        ))),
    }
}

pub(super) fn agent_provider_label(value: &str) -> AppResult<String> {
    match value.trim().to_lowercase().as_str() {
        "claude" => Ok("Claude".to_string()),
        "codex" => Ok("Codex".to_string()),
        other => Err(AppError::InvalidInput(format!(
            "unknown agent provider: {other}"
        ))),
    }
}

pub(super) fn priority_label(value: &str) -> AppResult<&'static str> {
    match normalize_state_key(value).as_str() {
        "none" => Ok("None"),
        "low" => Ok("Low"),
        "medium" => Ok("Medium"),
        "high" => Ok("High"),
        "urgent" => Ok("Urgent"),
        other => Err(AppError::InvalidInput(format!(
            "unknown todo priority: {other}"
        ))),
    }
}

pub(super) fn normalize_deadline(deadline: Option<&str>) -> AppResult<Option<String>> {
    let Some(deadline) = deadline.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    DateTime::parse_from_rfc3339(deadline)
        .map_err(|_| AppError::InvalidInput("deadline must be an RFC3339 timestamp".to_string()))?;
    Ok(Some(deadline.to_string()))
}

pub(super) fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.to_ascii_lowercase()))
        .collect::<Vec<_>>();
    normalized.sort_by_key(|tag| tag.to_ascii_lowercase());
    normalized
}

pub(super) fn normalize_state_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '-' | '_'))
        .flat_map(char::to_lowercase)
        .collect()
}
