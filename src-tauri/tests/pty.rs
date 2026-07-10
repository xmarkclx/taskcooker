use boomerang_tasks_lib::pty::provider_session_id_from_pty_output;

#[test]
fn provider_session_ids_are_parsed_from_status_output() {
    assert_eq!(
        provider_session_id_from_pty_output("Claude", "Session ID: claude-session-123\n"),
        Some("claude-session-123".to_string()),
    );
    assert_eq!(
        provider_session_id_from_pty_output(
            "Codex",
            "\u{1b}[32mSession:\u{1b}[0m codex-session-456\n"
        ),
        Some("codex-session-456".to_string()),
    );
    assert_eq!(
        provider_session_id_from_pty_output("Codex", "Working directory: /tmp/tmatrix\n"),
        None,
    );
}
