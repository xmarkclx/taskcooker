use boomerang_tasks_lib::core::AppDb;
use boomerang_tasks_lib::{remote, server};
use serde_json::json;

#[test]
fn remote_invoke_posts_commands_without_browser_headers() {
    let db = AppDb::open_in_memory().expect("database opens");
    let server = server::spawn(db, 0).expect("server starts");

    let data = remote::invoke_remote_command(
        &format!("http://127.0.0.1:{}", server.port),
        "app_snapshot",
        None,
    )
    .expect("remote invoke succeeds");

    assert_eq!(
        data["projects"].as_array().expect("projects array").len(),
        0
    );
}

#[test]
fn remote_invoke_surfaces_server_errors() {
    let db = AppDb::open_in_memory().expect("database opens");
    let server = server::spawn(db, 0).expect("server starts");

    let err = remote::invoke_remote_command(
        &format!("http://127.0.0.1:{}", server.port),
        "not_real",
        Some(json!({})),
    )
    .expect_err("unknown command fails");

    assert!(err.contains("not supported"), "{err}");
}
