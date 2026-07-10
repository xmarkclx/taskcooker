//! Headless command server for thin-client / WSL integration (B-171).
//!
//! `taskcooker-server` runs on the machine where projects actually live (e.g. a
//! Linux box or WSL). It opens the same SQLite database the desktop app uses and
//! exposes the existing data-plane command surface over loopback HTTP so a remote
//! TaskCooker client — reached over an SSH tunnel — behaves "as if running here",
//! with all projects, todos, artifacts and settings already present.
//!
//! Auth/transport model: the listener binds loopback only and the client reaches
//! it through an SSH port-forward, so SSH owns network authentication and
//! transport encryption (matches the SSH-tunnel-only decision for B-171).
//!
//! Browser hardening: while the tunnel is up, the forwarded loopback port on the
//! *client* is reachable by any local process — including a malicious browser tab.
//! To prevent cross-origin command execution and DNS rebinding we mirror the
//! existing `mcp.rs` model: requests carrying an `Origin` header (i.e. anything a
//! browser issues cross-origin) are rejected, and the `Host` header must be
//! loopback. The legitimate client therefore speaks raw HTTP from the client's
//! Rust side (a Tauri command), **not** a webview `fetch` — so no CORS is emitted.
//!
//! This first slice covers the pure-DB data plane. The interactive plane
//! (terminals and actions) is routed in later passes; unmapped commands
//! return a clear "not supported over remote yet" error rather than failing
//! silently.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};

use crate::commands::*;
use crate::core::AppDb;

/// Name advertised on `GET /health` so a client can confirm it is talking to a
/// TaskCooker server rather than some other loopback service.
pub const SERVER_NAME: &str = "taskcooker-server";

struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// A browser issues an `Origin` header on every cross-origin request. The only
/// legitimate client speaks raw HTTP (no Origin), so any Origin means a browser
/// is trying to reach us and must be refused.
fn is_browser_request(request: &HttpRequest) -> bool {
    request.header("origin").is_some()
}

/// Block DNS-rebinding: the `Host` must resolve to loopback by name. An attacker
/// page pointing a custom hostname at 127.0.0.1 would carry its own hostname here.
fn host_is_loopback(request: &HttpRequest) -> bool {
    match request.header("host") {
        // Some minimal HTTP/1.0 clients omit Host; our Rust client always sends it.
        None => true,
        Some(host) => {
            let host_only = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
            host_only.eq_ignore_ascii_case("localhost") || host_only == "127.0.0.1"
        }
    }
}

/// A running server with a handle so tests (and a future in-app host) can stop it.
pub struct RunningServer {
    pub port: u16,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl RunningServer {
    /// Block until the server thread exits. The accept loop only exits on
    /// [`RunningServer::stop`], so the CLI uses this to run forever.
    pub fn wait(mut self) {
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }

    /// Signal the accept loop to stop and join the thread.
    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Bind a loopback listener on `port` (0 picks a free port) and serve in a
/// background thread. Returns the actual bound port.
pub fn spawn(db: AppDb, port: u16) -> std::io::Result<RunningServer> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_for_thread = shutdown.clone();
    let db = Arc::new(db);
    let handle = thread::Builder::new()
        .name(format!("{SERVER_NAME}-{port}"))
        .spawn(move || accept_loop(listener, db, shutdown_for_thread))?;

    Ok(RunningServer {
        port,
        shutdown,
        handle: Some(handle),
    })
}

fn accept_loop(listener: TcpListener, db: Arc<AppDb>, shutdown: Arc<AtomicBool>) {
    for stream in listener.incoming() {
        if shutdown.load(Ordering::SeqCst) {
            return;
        }
        match stream {
            Ok(mut stream) => handle_stream(&db, &mut stream),
            Err(ref err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return,
        }
    }
}

fn handle_stream(db: &AppDb, stream: &mut TcpStream) {
    // The non-blocking listener yields blocking accepted streams, but make reads
    // blocking explicitly so a partial request does not spin.
    let _ = stream.set_nonblocking(false);
    let request = match read_http_request(stream) {
        Ok(request) => request,
        Err(err) => {
            let _ = write_json(
                stream,
                400,
                json!({ "ok": false, "error": err.to_string() }),
            );
            return;
        }
    };

    // Browser hardening (see module docs): refuse cross-origin browser requests
    // and non-loopback Host headers so a malicious page on the client machine
    // cannot drive commands through the forwarded port (CSRF / DNS rebinding).
    if is_browser_request(&request) || !host_is_loopback(&request) {
        let _ = write_json(
            stream,
            403,
            json!({ "ok": false, "error": "browser / cross-origin requests are not allowed" }),
        );
        return;
    }

    let path = request.path.split('?').next().unwrap_or("").to_string();
    match (request.method.as_str(), path.as_str()) {
        ("GET", "/health") => {
            let _ = write_json(
                stream,
                200,
                json!({
                    "ok": true,
                    "name": SERVER_NAME,
                    "version": env!("CARGO_PKG_VERSION"),
                }),
            );
        }
        ("POST", "/command") => {
            let response = handle_command(db, &request.body);
            let status = if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                200
            } else {
                400
            };
            let _ = write_json(stream, status, response);
        }
        _ => {
            let _ = write_json(stream, 404, json!({ "ok": false, "error": "not found" }));
        }
    }
}

fn handle_command(db: &AppDb, body: &str) -> Value {
    let request: Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(err) => return json!({ "ok": false, "error": format!("invalid JSON body: {err}") }),
    };
    let command = match request.get("command").and_then(Value::as_str) {
        Some(command) => command,
        None => return json!({ "ok": false, "error": "missing \"command\"" }),
    };
    let args = request.get("args").cloned().unwrap_or(Value::Null);

    match dispatch(db, command, &args) {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn input_value(args: &Value) -> Value {
    args.get("input").cloned().unwrap_or(Value::Null)
}

/// Maps a command name + args to the matching `core`/`commands` helper. Each arm
/// reuses the exact same `*_in_db` / `*_from_db` function the Tauri command
/// wrapper calls, so remote and local behaviour stay identical.
fn dispatch(db: &AppDb, command: &str, args: &Value) -> Result<Value, String> {
    macro_rules! arm {
        ($ty:ty, $helper:path) => {{
            let parsed: $ty = serde_json::from_value(input_value(args))
                .map_err(|err| format!("invalid args for {command}: {err}"))?;
            let out = $helper(db, parsed)?;
            serde_json::to_value(out).map_err(|err| err.to_string())
        }};
    }
    macro_rules! arm_noarg {
        ($call:expr) => {{
            let out = $call;
            serde_json::to_value(out).map_err(|err| err.to_string())
        }};
    }

    match command {
        // Read plane
        "app_snapshot" => {
            let project_id = args.get("projectId").and_then(Value::as_i64);
            let todo_id = args.get("todoId").and_then(Value::as_i64);
            arm_noarg!(app_snapshot_from_db(db, project_id, todo_id)?)
        }
        "app_settings" => arm_noarg!(load_app_settings_from_db(db)?),

        // App + layout settings
        "update_app_settings" => arm!(UpdateAppSettingsCommand, update_app_settings_in_db),
        "regenerate_mcp_token" => arm_noarg!(regenerate_mcp_token_in_db(db)?),
        "set_task_details_rail_hidden" => {
            arm!(
                SetTaskDetailsRailHiddenCommand,
                set_task_details_rail_hidden_in_db
            )
        }
        "set_task_list_width" => arm!(SetTaskListWidthCommand, set_task_list_width_in_db),
        "set_task_list_accordion_state" => {
            arm!(
                SetTaskListAccordionStateCommand,
                set_task_list_accordion_state_in_db
            )
        }
        "set_task_detail_description_width" => arm!(
            SetTaskDetailDescriptionWidthCommand,
            set_task_detail_description_width_in_db
        ),
        "set_markdown_toc_hidden" => {
            arm!(SetMarkdownTocHiddenCommand, set_markdown_toc_hidden_in_db)
        }
        "set_markdown_toc_width" => arm!(SetMarkdownTocWidthCommand, set_markdown_toc_width_in_db),
        "set_markdown_editor_mode" => {
            arm!(SetMarkdownEditorModeCommand, set_markdown_editor_mode_in_db)
        }

        // Projects
        "create_project" => arm!(CreateProjectCommand, create_project_in_db),
        "record_project_use" => arm!(RecordProjectUseCommand, record_project_use_in_db),
        "update_project_notes" => arm!(UpdateProjectNotesCommand, update_project_notes_in_db),
        "update_project_settings" => {
            arm!(UpdateProjectSettingsCommand, update_project_settings_in_db)
        }
        "update_project_prompt_settings" => arm!(
            UpdateProjectPromptSettingsCommand,
            update_project_prompt_settings_in_db
        ),
        "link_project" => arm!(LinkProjectCommand, link_project_in_db),
        "unlink_project" => arm!(UnlinkProjectCommand, unlink_project_in_db),
        "reorder_project_link" => arm!(ReorderProjectLinkCommand, reorder_project_link_in_db),
        "update_project_status" => arm!(UpdateProjectStatusCommand, update_project_status_in_db),

        // Todos
        "create_todo" => arm!(CreateTodoCommand, create_todo_in_db),
        "create_subtask" => arm!(CreateSubtaskCommand, create_subtask_in_db),
        "reorder_todo" => arm!(ReorderTodoCommand, reorder_todo_in_db),
        "update_todo_state" => arm!(UpdateTodoStateCommand, update_todo_state_in_db),
        "update_todos_state" => arm!(UpdateTodosStateCommand, update_todos_state_in_db),
        "update_todo_priority" => arm!(UpdateTodoPriorityCommand, update_todo_priority_in_db),
        "update_todo_context_project" => arm!(
            UpdateTodoContextProjectCommand,
            update_todo_context_project_in_db
        ),
        "set_todo_starred" => arm!(SetTodoStarredCommand, set_todo_starred_in_db),
        "update_todo_title" => arm!(UpdateTodoTitleCommand, update_todo_title_in_db),
        "update_todo_deadline" => arm!(UpdateTodoDeadlineCommand, update_todo_deadline_in_db),
        "update_todo_description" => {
            arm!(UpdateTodoDescriptionCommand, update_todo_description_in_db)
        }
        "update_todo_journal" => arm!(UpdateTodoJournalCommand, update_todo_journal_in_db),
        "set_todo_tags" => arm!(SetTodoTagsCommand, set_todo_tags_in_db),
        "add_todo_dependency" => arm!(AddTodoDependencyCommand, add_todo_dependency_in_db),
        "remove_todo_dependency" => arm!(RemoveTodoDependencyCommand, remove_todo_dependency_in_db),
        "record_prompt_copied" => arm!(RecordPromptCopiedCommand, record_prompt_copied_in_db),

        // Messages
        "message_todo" => arm!(MessageTodoCommand, message_todo_in_db),
        "delete_message" => arm!(DeleteMessageCommand, delete_message_in_db),
        "clear_todo_messages" => arm!(ClearTodoMessagesCommand, clear_todo_messages_in_db),
        "mark_todo_messages_read" => {
            arm!(MarkTodoMessagesReadCommand, mark_todo_messages_read_in_db)
        }

        // Artifacts (files live on the server)
        "update_todo_artifact" => arm!(UpdateTodoArtifactCommand, update_todo_artifact_in_db),

        // Timers / time logs
        "start_timer" => arm!(StartTimerCommand, start_timer_in_db),
        "stop_timer" => arm_noarg!(stop_timer_in_db(db)?),
        "add_manual_time_log" => arm!(AddManualTimeLogCommand, add_manual_time_log_in_db),
        "update_time_log_duration" => {
            arm!(UpdateTimeLogDurationCommand, update_time_log_duration_in_db)
        }
        "delete_time_log" => arm!(DeleteTimeLogCommand, delete_time_log_in_db),

        other => Err(format!(
            "command \"{other}\" is not supported over a remote connection yet"
        )),
    }
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut start = String::new();
    reader.read_line(&mut start)?;
    let mut start_parts = start.split_whitespace();
    let method = start_parts.next().unwrap_or_default().to_string();
    let path = start_parts.next().unwrap_or_default().to_string();
    let mut content_length = 0usize;

    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim().to_string();
            if name == "content-length" {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((name, value));
        }
    }

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;
    Ok(HttpRequest {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

fn write_json(stream: &mut TcpStream, status: u16, body: Value) -> std::io::Result<()> {
    let body = body.to_string();
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}
