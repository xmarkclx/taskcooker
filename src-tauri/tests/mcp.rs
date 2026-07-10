use std::net::TcpListener;

use boomerang_tasks_lib::core::{Todo, TodoState};
use boomerang_tasks_lib::mcp::{
    bind_loopback_listener_with_fallback, build_review_notification, mcp_origin_is_allowed,
    mcp_token_is_authorized, mcp_tool_names, review_notification_request,
    review_notification_response_opens_task,
};
use notify_rust::{CloseReason, NotificationResponse};

#[test]
fn mcp_requires_the_exact_bearer_or_header_token() {
    assert!(mcp_token_is_authorized(
        &[("authorization", "Bearer secret-token")],
        "secret-token"
    ));
    assert!(mcp_token_is_authorized(
        &[("x-boomerang-token", "secret-token")],
        "secret-token"
    ));
    assert!(!mcp_token_is_authorized(&[], "secret-token"));
    assert!(!mcp_token_is_authorized(
        &[("authorization", "Bearer wrong")],
        "secret-token"
    ));
}

#[test]
fn mcp_rejects_browser_origin_requests() {
    assert!(mcp_origin_is_allowed(&[]));
    assert!(mcp_origin_is_allowed(&[(
        "authorization",
        "Bearer secret-token"
    )]));
    assert!(!mcp_origin_is_allowed(&[(
        "origin",
        "http://localhost:5173"
    )]));
    assert!(!mcp_origin_is_allowed(&[(
        "Origin",
        "https://example.test"
    )]));
}

#[test]
fn mcp_exposes_the_required_v1_tools() {
    assert_eq!(
        mcp_tool_names(),
        vec![
            "list_projects",
            "list_todos",
            "get_todo",
            "update_todo_state",
            "message_todo",
            "list_actions",
            "create_action",
            "run_action",
        ],
    );
}

#[test]
fn mcp_listener_falls_back_when_saved_port_is_busy() {
    let busy = TcpListener::bind(("127.0.0.1", 0)).expect("busy listener binds");
    let busy_port = busy.local_addr().unwrap().port();

    let (_listener, actual_port, changed) =
        bind_loopback_listener_with_fallback(busy_port).expect("fallback listener binds");

    assert!(changed);
    assert_ne!(actual_port, busy_port);
}

#[test]
fn review_notifications_target_the_task_window_on_default_activation() {
    let todo = Todo {
        id: 68,
        project_id: 2,
        seq: 48,
        display_id: "B-48".to_string(),
        title: "Double clicking on a notification should open the task".to_string(),
        description_markdown: String::new(),
        state: TodoState::ReadyToTest,
        starred: false,
        parent_id: None,
        context_project_id: None,
        worktree_name: None,
        worktree_path: None,
    };

    let request = review_notification_request(
        &todo,
        TodoState::ReadyToTest,
        "Agent CLI",
        Some("Ready for review."),
        "Boomerang Tasks",
        "test",
    )
    .expect("review state creates a notification");

    assert_eq!(
        request.title,
        "Ready to Test: Double clicking on a notification should open the task"
    );
    assert_eq!(request.body, "Ready for review.");
    assert_eq!(request.project_task_window.label, "project-2-test");
    assert_eq!(request.project_task_window.route, "/?projectId=2&todoId=68");
}

#[test]
fn review_notifications_default_activation_opens_the_project_task_window() {
    let todo = Todo {
        id: 68,
        project_id: 2,
        seq: 48,
        display_id: "B-48".to_string(),
        title: "Double clicking on a notification should open the task".to_string(),
        description_markdown: String::new(),
        state: TodoState::ReadyToTest,
        starred: false,
        parent_id: None,
        context_project_id: None,
        worktree_name: None,
        worktree_path: None,
    };

    let request = review_notification_request(
        &todo,
        TodoState::ReadyToTest,
        "Agent CLI",
        None,
        "Boomerang Tasks",
        "test",
    )
    .expect("review state creates a notification");
    let notification = build_review_notification(&request);

    assert!(notification.actions.is_empty());
    assert!(review_notification_response_opens_task(
        &NotificationResponse::Default
    ));
    assert!(!review_notification_response_opens_task(
        &NotificationResponse::Closed(CloseReason::Dismissed)
    ));
}

#[test]
fn review_notifications_without_messages_do_not_add_sender_body() {
    let todo = Todo {
        id: 69,
        project_id: 2,
        seq: 49,
        display_id: "B-49".to_string(),
        title: "Review notification title is enough".to_string(),
        description_markdown: String::new(),
        state: TodoState::NeedsFeedback,
        starred: false,
        parent_id: None,
        context_project_id: None,
        worktree_name: None,
        worktree_path: None,
    };

    let request = review_notification_request(
        &todo,
        TodoState::NeedsFeedback,
        "Agent CLI",
        None,
        "Boomerang Tasks",
        "test",
    )
    .expect("review state creates a notification");

    assert_eq!(
        request.title,
        "Needs Feedback: Review notification title is enough"
    );
    assert_eq!(request.body, "");
}
