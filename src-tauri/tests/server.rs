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
    server::spawn(db, 0).expect("server starts")
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
