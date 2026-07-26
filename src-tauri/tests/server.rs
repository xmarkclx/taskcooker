//! Integration tests for the headless `taskcooker-server` command host (B-171).

use std::io::{Read, Write};
use std::net::TcpStream;

use boomerang_tasks_lib::core::AppDb;
use boomerang_tasks_lib::server;
use serde_json::{json, Value};

struct HttpResponse {
    status: u16,
    body: Value,
    raw_body: String,
}

fn send(port: u16, raw: &str) -> HttpResponse {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect to server");
    stream.write_all(raw.as_bytes()).expect("write request");
    let mut buf = String::new();
    stream.read_to_string(&mut buf).expect("read response");
    let status = buf
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    let raw_body = buf
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default();
    let body = serde_json::from_str(&raw_body).unwrap_or(Value::Null);
    HttpResponse {
        status,
        body,
        raw_body,
    }
}

fn get(port: u16, path: &str) -> HttpResponse {
    send(
        port,
        &format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"),
    )
}

fn post_command(port: u16, command: &Value) -> HttpResponse {
    let body = command.to_string();
    send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
}

fn start() -> server::RunningServer {
    let db = AppDb::open_in_memory().expect("database opens");
    server::spawn(db, server::ServeOptions::loopback(0)).expect("server starts")
}

fn start_with_token(token: &str) -> server::RunningServer {
    let db = AppDb::open_in_memory().expect("database opens");
    let mut options = server::ServeOptions::loopback(0);
    options.token = Some(token.to_string());
    server::spawn(db, options).expect("server starts")
}

fn write_ui_fixture(dir: &std::path::Path) {
    std::fs::write(dir.join("index.html"), "<html>taskcooker-ui</html>").expect("write index");
    std::fs::create_dir_all(dir.join("assets")).expect("create assets dir");
    std::fs::write(dir.join("assets").join("app.js"), "console.log(1)").expect("write asset");
}

fn start_with_ui(token: &str, dir: &std::path::Path) -> server::RunningServer {
    let db = AppDb::open_in_memory().expect("database opens");
    let mut options = server::ServeOptions::loopback(0);
    options.token = Some(token.to_string());
    options.ui = Some(server::ui_assets_from_directory(dir.to_path_buf()));
    server::spawn(db, options).expect("server starts")
}

#[test]
fn health_reports_server_identity() {
    let server = start();
    let response = get(server.port, "/health");
    assert_eq!(response.status, 200);
    assert_eq!(response.body["ok"], json!(true));
    assert_eq!(response.body["name"], json!(server::SERVER_NAME));
}

#[test]
fn command_round_trip_creates_and_reads_a_project() {
    let server = start();

    let create = post_command(
        server.port,
        &json!({
            "command": "create_project",
            "args": { "input": {
                "name": "Remote Workspace",
                "workingDirectory": "~/p/remote-workspace",
                "displayIdPrefix": "RW",
            }},
        }),
    );
    assert_eq!(create.status, 200, "body: {}", create.raw_body);
    assert_eq!(create.body["ok"], json!(true));

    let snapshot = post_command(server.port, &json!({ "command": "app_snapshot" }));
    assert_eq!(snapshot.status, 200);
    let names: Vec<&str> = snapshot.body["data"]["projects"]
        .as_array()
        .expect("projects array")
        .iter()
        .filter_map(|project| project["name"].as_str())
        .collect();
    assert!(
        names.contains(&"Remote Workspace"),
        "expected created project in snapshot, got {names:?}"
    );
}

#[test]
fn project_git_reads_are_supported_over_the_command_server() {
    let server = start();
    let missing_project_directory = tempfile::tempdir()
        .expect("temp dir")
        .path()
        .join("missing-project")
        .display()
        .to_string();

    let create = post_command(
        server.port,
        &json!({
            "command": "create_project",
            "args": { "input": {
                "name": "Project Without Git",
                "workingDirectory": missing_project_directory,
                "displayIdPrefix": "PWG",
            }},
        }),
    );
    assert_eq!(create.status, 200, "body: {}", create.raw_body);
    let project_id = create.body["data"]["projects"][0]["id"]
        .as_i64()
        .expect("created project id");

    let repository = post_command(
        server.port,
        &json!({
            "command": "get_project_git_repository",
            "args": { "input": { "projectId": project_id } },
        }),
    );

    assert_eq!(repository.status, 200, "body: {}", repository.raw_body);
    assert_eq!(repository.body, json!({ "ok": true, "data": null }));
}

#[test]
fn unknown_command_is_rejected_clearly() {
    let server = start();
    let response = post_command(
        server.port,
        &json!({ "command": "definitely_not_a_command" }),
    );
    assert_eq!(response.status, 400);
    assert_eq!(response.body["ok"], json!(false));
    assert!(response.body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("not supported"));
}

#[test]
fn browser_origin_requests_are_blocked() {
    let server = start();
    let port = server.port;
    let response = send(
        port,
        &format!(
            "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(response.status, 403, "browser origin must be refused");
}

#[test]
fn non_loopback_bind_without_token_is_refused() {
    let db = AppDb::open_in_memory().expect("database opens");
    let options = server::ServeOptions {
        bind: "0.0.0.0".parse().expect("address parses"),
        port: 0,
        token: None,
        ui: None,
        interactive: None,
        subscribe: None,
    };
    let err = match server::spawn(db, options) {
        Ok(_) => panic!("must refuse tokenless network bind"),
        Err(err) => err,
    };
    assert!(
        err.to_string().contains("token"),
        "error should mention the missing token: {err}"
    );
}

#[test]
fn token_mode_requires_bearer_token_on_commands() {
    let server = start_with_token("secret-token");
    let port = server.port;

    let denied = post_command(port, &json!({ "command": "app_snapshot" }));
    assert_eq!(denied.status, 401, "tokenless command must be refused");

    let body = json!({ "command": "app_snapshot" }).to_string();
    let allowed = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer secret-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(allowed.status, 200, "body: {}", allowed.raw_body);
    assert_eq!(allowed.body["ok"], json!(true));

    let wrong = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer other-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(wrong.status, 401, "wrong token must be refused");
}

#[test]
fn token_mode_keeps_health_open_and_allows_network_hosts() {
    let server = start_with_token("secret-token");
    let port = server.port;

    let health = get(port, "/health");
    assert_eq!(health.status, 200, "health stays open for reachability");

    // A direct LAN/Tailscale client sends its target host, not loopback.
    let body = json!({ "command": "app_snapshot" }).to_string();
    let response = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 100.64.0.7:{port}\r\nAuthorization: Bearer secret-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(response.status, 200, "body: {}", response.raw_body);
}

#[test]
fn token_mode_still_blocks_browser_origins() {
    let server = start_with_token("secret-token");
    let port = server.port;
    let body = json!({ "command": "app_snapshot" }).to_string();
    let response = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nAuthorization: Bearer secret-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(response.status, 403, "browser origin must be refused");
}

#[test]
fn ui_mode_serves_index_assets_and_spa_fallback() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_ui_fixture(dir.path());
    let server = start_with_ui("secret-token", dir.path());
    let port = server.port;

    let index = get(port, "/");
    assert_eq!(index.status, 200);
    assert!(index.raw_body.contains("taskcooker-ui"), "{}", index.raw_body);

    let asset = get(port, "/assets/app.js");
    assert_eq!(asset.status, 200);
    assert!(asset.raw_body.contains("console.log"));

    // Extension-less paths are client-side routes and fall back to the shell.
    let route = get(port, "/tasks/T-34");
    assert_eq!(route.status, 200);
    assert!(route.raw_body.contains("taskcooker-ui"));

    // Missing real files (with an extension) are a plain 404.
    let missing = get(port, "/nope.png");
    assert_eq!(missing.status, 404);
}

#[test]
fn ui_mode_blocks_path_traversal() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_ui_fixture(dir.path());
    // Plant a sibling secret next to (not inside) the UI directory.
    let sibling = dir.path().parent().expect("parent dir").join("t34-secret.txt");
    std::fs::write(&sibling, "top secret").expect("write sibling");
    let server = start_with_ui("secret-token", dir.path());

    let response = get(server.port, "/../t34-secret.txt");
    assert_ne!(response.status, 200, "traversal must not be served");
    assert!(!response.raw_body.contains("top secret"));
    let _ = std::fs::remove_file(sibling);
}

#[test]
fn ui_mode_allows_same_origin_browser_commands_only() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_ui_fixture(dir.path());
    let server = start_with_ui("secret-token", dir.path());
    let port = server.port;
    let body = json!({ "command": "app_snapshot" }).to_string();

    // Same-origin browser fetch (Origin matches Host) with the token: allowed.
    let same_origin = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nAuthorization: Bearer secret-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(same_origin.status, 200, "body: {}", same_origin.raw_body);

    // Same-origin without the token still fails auth.
    let no_token = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(no_token.status, 401);

    // Cross-origin stays blocked even with a valid token.
    let cross_origin = send(
        port,
        &format!(
            "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nAuthorization: Bearer secret-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    );
    assert_eq!(cross_origin.status, 403);
}

#[test]
fn ui_mode_requires_a_token() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_ui_fixture(dir.path());
    let db = AppDb::open_in_memory().expect("database opens");
    let mut options = server::ServeOptions::loopback(0);
    options.ui = Some(server::ui_assets_from_directory(dir.path().to_path_buf()));
    let err = match server::spawn(db, options) {
        Ok(_) => panic!("must refuse tokenless UI serving"),
        Err(err) => err,
    };
    assert!(err.to_string().contains("token"), "{err}");
}

#[test]
fn stream_delivers_subscribed_events_with_token_auth() {
    use std::sync::Mutex;

    type Callback = Box<dyn Fn(String) + Send + Sync>;
    let subscribers: std::sync::Arc<Mutex<Vec<(String, Callback)>>> =
        std::sync::Arc::new(Mutex::new(Vec::new()));
    let subscribers_for_server = subscribers.clone();
    let subscribe: server::EventSubscribe = std::sync::Arc::new(move |name, callback| {
        subscribers_for_server
            .lock()
            .expect("subscriber lock")
            .push((name.to_string(), callback));
        Box::new(|| {})
    });

    let db = AppDb::open_in_memory().expect("database opens");
    let mut options = server::ServeOptions::loopback(0);
    options.token = Some("secret-token".to_string());
    options.subscribe = Some(subscribe);
    let running = server::spawn(db, options).expect("server starts");
    let port = running.port;

    // Tokenless stream requests are refused.
    let denied = send(
        port,
        &format!(
            "GET /stream?events=todos:changed HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(denied.status, 401);

    // An authorized stream receives events pushed after it connects.
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .expect("read timeout");
    write!(
        stream,
        "GET /stream?events=todos:changed,pty%3Adata%3A7 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer secret-token\r\nConnection: close\r\n\r\n"
    )
    .expect("write request");

    // Wait for both subscriptions to land, then push one event through.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        {
            let subscribers = subscribers.lock().expect("subscriber lock");
            if subscribers.len() == 2 {
                assert!(subscribers.iter().any(|(name, _)| name == "pty:data:7"));
                for (name, callback) in subscribers.iter() {
                    if name == "todos:changed" {
                        callback("{\"todoId\":42}".to_string());
                    }
                }
                break;
            }
        }
        assert!(
            std::time::Instant::now() < deadline,
            "subscriptions never registered"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    let mut received = String::new();
    let mut chunk = [0u8; 1024];
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !received.contains("data: {\"todoId\":42}") {
        assert!(
            std::time::Instant::now() < deadline,
            "event frame never arrived; got: {received}"
        );
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => received.push_str(&String::from_utf8_lossy(&chunk[..read])),
            Err(err) => panic!("stream read failed: {err}; got: {received}"),
        }
    }
    assert!(received.contains("Content-Type: text/event-stream"));
    assert!(received.contains("event: todos:changed"));
    assert!(received.contains("data: {\"todoId\":42}"));
}

#[test]
fn non_loopback_host_is_blocked() {
    let server = start();
    let port = server.port;
    let response = send(
        port,
        &format!(
            "GET /health HTTP/1.1\r\nHost: attacker.example:{port}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(response.status, 403, "non-loopback Host must be refused");
}
