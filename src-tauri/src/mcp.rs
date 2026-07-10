use std::io::ErrorKind;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify_rust::{Notification, NotificationResponse};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::app_windows::{
    open_project_task_window, project_task_window_spec, ProjectTaskWindowSpec,
};
use crate::commands::{
    configured_project_folder_open_app, create_todo_in_db, project_action_argument_values,
    project_action_environment, start_execution_terminal_from_app, CreateTodoCommand,
    StartExecutionTerminalCommand,
};
use crate::core::{
    expand_home_alias, Actor, AppDb, AppSettingsSummary, MessageSummary, NewActionRun, Project,
    ProjectSummary, Todo, TodoState, TodoSummary, UpdateTodoState,
};
use crate::pty::{PtySpawnSpec, PtyState};

const MCP_PATH: &str = "/mcp";

#[derive(Default)]
pub struct McpServerState {
    current: Mutex<Option<RunningMcpServer>>,
}

struct RunningMcpServer {
    port: u16,
    shutdown: Arc<AtomicBool>,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

pub fn mcp_tool_names() -> Vec<&'static str> {
    vec![
        "list_projects",
        "list_todos",
        "get_todo",
        "update_todo_state",
        "message_todo",
        "list_actions",
        "create_action",
        "run_action",
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReviewNotificationRequest {
    pub title: String,
    pub body: String,
    pub project_task_window: ProjectTaskWindowSpec,
}

pub fn mcp_token_is_authorized(headers: &[(&str, &str)], token: &str) -> bool {
    let token = token.trim();
    if token.is_empty() {
        return false;
    }

    headers.iter().any(|(name, value)| {
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        (name == "authorization" && value == format!("Bearer {token}"))
            || (name == "x-boomerang-token" && value == token)
    })
}

pub fn mcp_origin_is_allowed(headers: &[(&str, &str)]) -> bool {
    !headers
        .iter()
        .any(|(name, _)| name.trim().eq_ignore_ascii_case("origin"))
}

impl McpServerState {
    pub fn apply_settings(
        &self,
        app: AppHandle,
        db: &AppDb,
        settings: &AppSettingsSummary,
    ) -> Result<AppSettingsSummary, String> {
        if !settings.mcp_enabled {
            self.stop();
            return Ok(settings.clone());
        }

        let port = u16::try_from(settings.mcp_port)
            .map_err(|_| format!("invalid MCP port: {}", settings.mcp_port))?;
        if self.is_running_on(port) {
            return Ok(settings.clone());
        }

        self.stop();
        let (listener, actual_port, port_changed) = bind_loopback_listener_with_fallback(port)?;
        listener
            .set_nonblocking(true)
            .map_err(|err| format!("cannot configure MCP listener: {err}"))?;
        let effective_settings = if port_changed {
            db.set_mcp_port(i64::from(actual_port))
                .map_err(|err| err.to_string())?
        } else {
            settings.clone()
        };
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_for_thread = shutdown.clone();
        let app_for_thread = app.clone();
        thread::Builder::new()
            .name(format!("boomerang-mcp-{actual_port}"))
            .spawn(move || run_server_loop(app_for_thread, listener, shutdown_for_thread))
            .map_err(|err| format!("cannot start MCP server thread: {err}"))?;

        *self
            .current
            .lock()
            .expect("mcp server lock is not poisoned") = Some(RunningMcpServer {
            port: actual_port,
            shutdown,
        });
        if port_changed {
            let _ = app.emit(
                "settings:changed",
                json!({
                    "changeType": "mcp_port_changed",
                    "previousPort": port,
                    "port": actual_port,
                }),
            );
            let _ = app.emit(
                "notifications:show",
                json!({
                    "kind": "warning",
                    "title": "MCP port changed",
                    "body": format!(
                        "Port {port} was already in use, so Boomerang moved MCP to {actual_port}."
                    ),
                }),
            );
        }

        Ok(effective_settings)
    }

    pub fn stop(&self) {
        if let Some(server) = self
            .current
            .lock()
            .expect("mcp server lock is not poisoned")
            .take()
        {
            server.shutdown.store(true, Ordering::Release);
        }
    }

    fn is_running_on(&self, port: u16) -> bool {
        self.current
            .lock()
            .expect("mcp server lock is not poisoned")
            .as_ref()
            .is_some_and(|server| server.port == port)
    }
}

pub fn bind_loopback_listener_with_fallback(
    preferred_port: u16,
) -> Result<(TcpListener, u16, bool), String> {
    match TcpListener::bind(("127.0.0.1", preferred_port)) {
        Ok(listener) => Ok((listener, preferred_port, false)),
        Err(err) if err.kind() == ErrorKind::AddrInUse => {
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|fallback_err| {
                format!(
                    "cannot bind MCP server on 127.0.0.1:{preferred_port}, and fallback failed: {fallback_err}"
                )
            })?;
            let actual_port = listener
                .local_addr()
                .map_err(|addr_err| format!("cannot read fallback MCP listener port: {addr_err}"))?
                .port();
            Ok((listener, actual_port, true))
        }
        Err(err) => Err(format!(
            "cannot bind MCP server on 127.0.0.1:{preferred_port}: {err}"
        )),
    }
}

fn run_server_loop(app: AppHandle, listener: TcpListener, shutdown: Arc<AtomicBool>) {
    while !shutdown.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((mut stream, _)) => handle_stream(&app, &mut stream),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
}

fn handle_stream(app: &AppHandle, stream: &mut TcpStream) {
    let request = match read_http_request(stream) {
        Ok(request) => request,
        Err(err) => {
            let _ = write_json(stream, 400, json!({ "error": err.to_string() }));
            return;
        }
    };

    let header_refs = request
        .headers
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    if !mcp_origin_is_allowed(&header_refs) {
        let _ = write_json(
            stream,
            403,
            json!({ "error": "browser origins are not allowed" }),
        );
        return;
    }
    if request.method == "OPTIONS" {
        let _ = write_json(
            stream,
            403,
            json!({ "error": "browser origins are not allowed" }),
        );
        return;
    }
    if request.path != MCP_PATH {
        let _ = write_json(stream, 404, json!({ "error": "not found" }));
        return;
    }
    if request.method != "POST" {
        let _ = write_json(stream, 405, json!({ "error": "method not allowed" }));
        return;
    }

    let db = app.state::<AppDb>();
    let settings = match db.app_settings() {
        Ok(settings) => settings,
        Err(err) => {
            let _ = write_json(stream, 500, json!({ "error": err.to_string() }));
            return;
        }
    };
    if !settings.mcp_enabled {
        let _ = write_json(stream, 503, json!({ "error": "MCP server disabled" }));
        return;
    }
    if !mcp_token_is_authorized(&header_refs, &settings.mcp_token) {
        let _ = write_json(stream, 401, json!({ "error": "unauthorized" }));
        return;
    }

    let response = match handle_json_rpc(app, &request.body) {
        Ok(response) => response,
        Err(err) => json!({
            "jsonrpc": "2.0",
            "id": null,
            "error": { "code": -32000, "message": err },
        }),
    };
    let _ = write_json(stream, 200, response);
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut start = String::new();
    reader.read_line(&mut start)?;
    let mut start_parts = start.split_whitespace();
    let method = start_parts.next().unwrap_or_default().to_string();
    let path = start_parts.next().unwrap_or_default().to_string();
    let mut headers = vec![];
    let mut content_length = 0usize;

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
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn handle_json_rpc(app: &AppHandle, body: &str) -> Result<Value, String> {
    let request: Value = serde_json::from_str(body).map_err(|err| err.to_string())?;
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let result = match method {
        "tools/list" => json!({
            "tools": mcp_tool_names()
                .into_iter()
                .map(|name| json!({
                    "name": name,
                    "description": tool_description(name),
                    "inputSchema": { "type": "object" },
                }))
                .collect::<Vec<_>>()
        }),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "tools/call requires params.name".to_string())?;
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let tool_result = call_tool(app, name, arguments)?;
            json!({
                "content": [{ "type": "text", "text": tool_result.to_string() }],
                "isError": false,
            })
        }
        "boomerang/create_todo" => create_todo_control(app, request.get("params").cloned())?,
        "boomerang/show_review_notification" => {
            show_review_notification_control(app, request.get("params").cloned())?
        }
        "boomerang/start_execution_terminal" => {
            start_execution_terminal_control(app, request.get("params").cloned())?
        }
        _ => {
            let name = request
                .get("tool")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("unsupported MCP method: {method}"))?;
            let arguments = request
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            call_tool(app, name, arguments)?
        }
    };

    Ok(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    }))
}

fn create_todo_control(app: &AppHandle, params: Option<Value>) -> Result<Value, String> {
    let db = app.state::<AppDb>();
    let arguments = params.unwrap_or_else(|| json!({}));
    let input = create_todo_command(&db, arguments)?;
    let snapshot = create_todo_in_db(&db, input)?;
    emit_todo_changed(app, snapshot.selected_todo_id, "cli_todo_created");
    let todo = snapshot
        .todos
        .into_iter()
        .find(|todo| todo.id == snapshot.selected_todo_id)
        .ok_or_else(|| "created todo not found in snapshot".to_string())?;
    Ok(json!({ "todo": todo }))
}

fn start_execution_terminal_control(
    app: &AppHandle,
    params: Option<Value>,
) -> Result<Value, String> {
    let db = app.state::<AppDb>();
    let pty = app.state::<PtyState>();
    let arguments = params.unwrap_or_else(|| json!({}));
    let todo_id = resolve_todo_id(&db, &arguments)?;
    let kind = required_str(&arguments, "kind")?.to_ascii_lowercase();
    if kind != "codex" && kind != "claude" {
        return Err("kind must be codex or claude".to_string());
    }
    let prompt = build_cli_task_prompt(
        &db,
        todo_id,
        arguments.get("additionalPrompt").and_then(Value::as_str),
    )?;
    let terminal = start_execution_terminal_from_app(
        app,
        &db,
        &pty,
        StartExecutionTerminalCommand {
            todo_id,
            kind,
            prompt: Some(prompt),
            resume_session_id: None,
        },
    )?;
    let snapshot = db
        .app_snapshot(None, Some(todo_id))
        .map_err(|err| err.to_string())?;
    let todo = snapshot
        .todos
        .into_iter()
        .find(|todo| todo.id == todo_id)
        .ok_or_else(|| "todo not found in snapshot".to_string())?;
    Ok(json!({ "terminal": terminal, "todo": todo }))
}

fn show_review_notification_control(
    app: &AppHandle,
    params: Option<Value>,
) -> Result<Value, String> {
    let db = app.state::<AppDb>();
    let arguments = params.unwrap_or_else(|| json!({}));
    let todo_id = resolve_todo_id(&db, &arguments)?;
    let state_label = required_str(&arguments, "state")?;
    let state: TodoState = serde_json::from_value(Value::String(state_label.to_string()))
        .map_err(|err| err.to_string())?;
    let actor_name = arguments
        .get("actorName")
        .and_then(Value::as_str)
        .unwrap_or("Agent CLI");
    let message = arguments.get("message").and_then(Value::as_str);

    notify_review_state(app, &db, todo_id, state, actor_name, message);

    Ok(json!({ "ok": true }))
}

fn create_todo_command(db: &AppDb, arguments: Value) -> Result<CreateTodoCommand, String> {
    let parent_id = resolve_optional_parent_todo_id(db, &arguments)?;
    let project_id = if let Some(parent_id) = parent_id {
        db.get_todo(parent_id)
            .map_err(|err| err.to_string())?
            .project_id
    } else {
        required_project_id(db, &arguments)?
    };

    Ok(CreateTodoCommand {
        project_id,
        title: required_str(&arguments, "title")?.to_string(),
        description_markdown: arguments
            .get("descriptionMarkdown")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        parent_id,
        position: optional_i64(&arguments, "position"),
    })
}

fn resolve_optional_parent_todo_id(db: &AppDb, arguments: &Value) -> Result<Option<i64>, String> {
    if let Some(parent_id) = optional_i64(arguments, "parentTodoId") {
        return Ok(Some(parent_id));
    }
    let Some(parent_task_id) = arguments.get("parentTaskId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let mut parent_arguments = json!({ "taskId": parent_task_id });
    if let Some(project_id) = arguments.get("projectId").cloned() {
        parent_arguments["projectId"] = project_id;
    }
    resolve_todo_id(db, &parent_arguments).map(Some)
}

fn build_cli_task_prompt(
    db: &AppDb,
    todo_id: i64,
    additional_prompt: Option<&str>,
) -> Result<String, String> {
    let snapshot = db
        .app_snapshot(None, Some(todo_id))
        .map_err(|err| err.to_string())?;
    let settings = db.app_settings().map_err(|err| err.to_string())?;
    let todo = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == todo_id)
        .ok_or_else(|| "todo not found in snapshot".to_string())?;
    let project = snapshot
        .projects
        .iter()
        .find(|project| project.id == todo.project_id)
        .ok_or_else(|| "project not found in snapshot".to_string())?;
    Ok(format_cli_task_prompt(
        todo,
        project,
        &snapshot.todos,
        &snapshot.messages,
        &snapshot.boomerang_binary_path,
        settings.mcp_port,
        &settings.mcp_token,
        additional_prompt,
    ))
}

fn format_cli_task_prompt(
    todo: &TodoSummary,
    project: &ProjectSummary,
    todos: &[TodoSummary],
    messages: &[MessageSummary],
    binary_path: &str,
    mcp_port: i64,
    mcp_token: &str,
    additional_prompt: Option<&str>,
) -> String {
    let mut sections = vec![
        format!("Task: {}: {}", todo.display_id, todo.title),
        format!("Project: {}", project.name),
        format!(
            "Working directory: {}",
            if todo.active_working_directory.is_empty() {
                &project.working_directory
            } else {
                &todo.active_working_directory
            }
        ),
        format!("Current state: {}", todo.state.as_label()),
        String::new(),
        "Required Boomerang updates:".to_string(),
        format!("- CRITICAL, NON-NEGOTIABLE, EVERY TURN: whenever you are actively working, {} MUST be Delegated, and the instant you finish replying it MUST be in Review - Ready to Test or Needs Feedback.", todo.display_id),
        format!("- When you finish any work pass, immediately move {} back to Review: set it to Ready to Test if the user can test the result, or Needs Feedback if you need user input.", todo.display_id),
        format!("- When you set {} to Ready to Test, explain what changed.", todo.display_id),
        format!("- If blocked by an external dependency, set {} to Blocked and explain why.", todo.display_id),
        "- Read the task artifacts after the task description/context; use them as the durable summary before making changes.".to_string(),
        String::new(),
        "Use the boomerang CLI for updates. Run these commands from a shell:".to_string(),
        format!(
            "- Set state: \"{}\" state \"Ready to Test\" -m \"what changed\" --todo {} --port {} --token {}",
            binary_path, todo.display_id, mcp_port, mcp_token
        ),
        format!(
            "- Leave a message: \"{}\" message \"your note\" --todo {} --port {} --token {}",
            binary_path, todo.display_id, mcp_port, mcp_token
        ),
        format!(
            "- Read this task and messages: \"{}\" get --todo {} --port {} --token {}",
            binary_path, todo.display_id, mcp_port, mcp_token
        ),
        "Valid states: Icebox, To Do, Doing, Blocked, Delegated, Waiting, Ready to Test, Needs Feedback, Done, Archived.".to_string(),
    ];

    let description_entries = if project.ai_task_description_mode == "ancestry" {
        let mut entries = parent_task_chain(todo, todos);
        entries.push(todo);
        entries
    } else if project.ai_task_description_mode == "none" {
        vec![]
    } else {
        vec![todo]
    };
    if !description_entries.is_empty() {
        sections.push(String::new());
        if description_entries.len() == 1 {
            sections.push("Task description:".to_string());
            sections.push(non_empty_or(
                &todo.description_markdown,
                "(No task description provided.)",
            ));
        } else {
            sections.push("Task description context:".to_string());
            sections.push(
                description_entries
                    .iter()
                    .map(|entry| {
                        format!(
                            "{} {}: {}\n{}",
                            if entry.id == todo.id {
                                "Current task"
                            } else {
                                "Parent task"
                            },
                            entry.display_id,
                            entry.title,
                            non_empty_or(
                                &entry.description_markdown,
                                "(No task description provided.)"
                            )
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n"),
            );
        }
    }

    sections.push(String::new());
    sections.push("Task artifacts:".to_string());
    sections.push(format!("Artifact file: {}", todo.artifact_markdown_path));
    sections.push(non_empty_or(
        &todo.artifact_markdown,
        "(No task artifacts yet.)",
    ));

    if project.ai_default_include_project_notes && !project.notes_markdown.trim().is_empty() {
        sections.push(String::new());
        sections.push("Project notes:".to_string());
        sections.push(project.notes_markdown.trim().to_string());
    }

    let pending_replies = messages
        .iter()
        .filter(|message| {
            message.todo_id == todo.id
                && message.actor_type == "human"
                && message.delivery.as_deref() == Some("Pending for next session")
        })
        .collect::<Vec<_>>();
    if !pending_replies.is_empty() {
        sections.push(String::new());
        sections.push("Pending human replies:".to_string());
        sections.push(
            pending_replies
                .iter()
                .map(|message| format!("- {}: {}", message.actor_name, message.body))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    if let Some(additional_prompt) = additional_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(String::new());
        sections.push("Additional instructions:".to_string());
        sections.push(additional_prompt.to_string());
    }

    sections.join("\n")
}

fn parent_task_chain<'a>(todo: &TodoSummary, todos: &'a [TodoSummary]) -> Vec<&'a TodoSummary> {
    let mut chain = vec![];
    let mut seen = vec![todo.id];
    let mut parent_id = todo.parent_id;
    while let Some(id) = parent_id {
        if seen.contains(&id) {
            break;
        }
        let Some(parent) = todos.iter().find(|item| item.id == id) else {
            break;
        };
        chain.insert(0, parent);
        seen.push(id);
        parent_id = parent.parent_id;
    }
    chain
}

fn non_empty_or(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn call_tool(app: &AppHandle, name: &str, arguments: Value) -> Result<Value, String> {
    let db = app.state::<AppDb>();
    match name {
        "list_projects" => {
            let snapshot = db.app_snapshot(None, None).map_err(|err| err.to_string())?;
            Ok(json!({ "projects": snapshot.projects }))
        }
        "list_todos" => {
            let project_id = optional_i64(&arguments, "projectId");
            let snapshot = db
                .app_snapshot(project_id, None)
                .map_err(|err| err.to_string())?;
            let todos = snapshot
                .todos
                .into_iter()
                .map(agent_safe_todo_value)
                .collect::<Vec<_>>();
            Ok(json!({ "todos": todos }))
        }
        "get_todo" => {
            let todo_id = resolve_todo_id(&db, &arguments)?;
            let todo = db.get_todo(todo_id).map_err(|err| err.to_string())?;
            let snapshot = db
                .app_snapshot(Some(todo.project_id), Some(todo_id))
                .map_err(|err| err.to_string())?;
            let summary = snapshot
                .todos
                .into_iter()
                .find(|item| item.id == todo_id)
                .ok_or_else(|| "todo not found in snapshot".to_string())?;
            // The snapshot only carries unread/pending messages; `get` must
            // return the full history.
            let messages = db.todo_messages(todo_id).map_err(|err| err.to_string())?;
            Ok(json!({ "todo": agent_safe_todo_value(summary), "messages": messages }))
        }
        "update_todo_state" => update_todo_state_tool(app, &db, arguments),
        "message_todo" => message_todo_tool(app, &db, arguments),
        "list_actions" => {
            let project_id = required_project_id(&db, &arguments)?;
            let actions = db
                .list_project_actions(project_id)
                .map_err(|err| err.to_string())?;
            Ok(json!({ "actions": actions }))
        }
        "create_action" => {
            let project_id = required_project_id(&db, &arguments)?;
            db.create_project_action(
                project_id,
                required_str(&arguments, "fileName")?,
                required_str(&arguments, "runtime")?,
                required_str(&arguments, "title")?,
                arguments
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
            .map_err(|err| err.to_string())?;
            emit_project_changed(app, project_id, "mcp_action_created");
            let actions = db
                .list_project_actions(project_id)
                .map_err(|err| err.to_string())?;
            Ok(json!({ "actions": actions }))
        }
        "run_action" => run_action_tool(app, &db, arguments),
        other => Err(format!("unknown MCP tool: {other}")),
    }
}

fn agent_safe_todo_value(todo: TodoSummary) -> Value {
    let mut value = serde_json::to_value(todo).unwrap_or_else(|_| json!({}));
    remove_journal_markdown(&mut value);
    value
}

fn remove_journal_markdown(value: &mut Value) {
    if let Value::Object(object) = value {
        object.remove("journalMarkdown");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_safe_todo_values_omit_private_journal_markdown() {
        let mut value = json!({
            "displayId": "T-1",
            "descriptionMarkdown": "Prompt-safe description",
            "journalMarkdown": "Private work log",
        });
        remove_journal_markdown(&mut value);

        assert_eq!(
            value.get("descriptionMarkdown").and_then(Value::as_str),
            Some("Prompt-safe description")
        );
        assert!(value.get("journalMarkdown").is_none());
    }
}

/// Raise an OS-level notification when an external agent hands a task back for
/// the human to review (Ready to Test / Needs Feedback). State changes made from
/// the desktop UI itself go through `commands.rs`, so this only fires for
/// CLI/MCP-driven changes — the human is never notified about their own edits.
fn notify_review_state(
    app: &AppHandle,
    db: &AppDb,
    todo_id: i64,
    state: TodoState,
    actor_name: &str,
    message: Option<&str>,
) {
    if !state.is_review_state() {
        return;
    }

    let todo = match db.get_todo(todo_id) {
        Ok(todo) => todo,
        Err(err) => {
            eprintln!("warning: could not load review notification task: {err}");
            return;
        }
    };

    let project_name = match db.get_project(todo.project_id) {
        Ok(project) => project.name,
        Err(err) => {
            eprintln!("warning: could not load review notification project: {err}");
            return;
        }
    };

    let Some(request) = review_notification_request(
        &todo,
        state,
        actor_name,
        message,
        &project_name,
        &uuid::Uuid::new_v4().simple().to_string(),
    ) else {
        return;
    };

    show_review_notification(app.clone(), request);
}

pub fn review_notification_request(
    todo: &Todo,
    state: TodoState,
    _actor_name: &str,
    message: Option<&str>,
    project_name: &str,
    label_suffix: &str,
) -> Option<ReviewNotificationRequest> {
    if !state.is_review_state() {
        return None;
    }

    let body = match message {
        Some(text) if !text.trim().is_empty() => text.trim().to_string(),
        _ => String::new(),
    };

    Some(ReviewNotificationRequest {
        title: format!("{}: {}", state.as_label(), todo.title),
        body,
        project_task_window: project_task_window_spec(
            todo.project_id,
            todo.id,
            project_name,
            label_suffix,
        ),
    })
}

pub fn build_review_notification(request: &ReviewNotificationRequest) -> Notification {
    let mut notification = Notification::new();
    notification
        .summary(&request.title)
        .body(&request.body)
        .auto_icon();
    notification
}

pub fn review_notification_response_opens_task(response: &NotificationResponse) -> bool {
    matches!(response, NotificationResponse::Default)
}

fn show_review_notification(app: AppHandle, request: ReviewNotificationRequest) {
    #[cfg(target_os = "macos")]
    {
        let identifier = app.config().identifier.clone();
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            identifier.as_str()
        });
    }

    let notification = build_review_notification(&request);

    match notification.show() {
        Ok(handle) => {
            std::thread::spawn(move || {
                let target = request.project_task_window;
                let _ = handle.wait_for_response(|response: &NotificationResponse| {
                    if review_notification_response_opens_task(response) {
                        if let Err(err) = open_project_task_window(&app, target) {
                            eprintln!("warning: could not open review notification task: {err}");
                        }
                    }
                });
            });
        }
        Err(err) => {
            eprintln!("warning: could not show review notification: {err}");
        }
    }
}

fn update_todo_state_tool(app: &AppHandle, db: &AppDb, arguments: Value) -> Result<Value, String> {
    let todo_id = resolve_todo_id(db, &arguments)?;
    let state_label = required_str(&arguments, "state")?;
    let state: TodoState = serde_json::from_value(Value::String(state_label.to_string()))
        .map_err(|err| err.to_string())?;
    let actor = Actor {
        actor_type: arguments
            .get("senderType")
            .and_then(Value::as_str)
            .unwrap_or("external")
            .to_string(),
        actor_name: arguments
            .get("senderName")
            .or_else(|| arguments.get("actorName"))
            .and_then(Value::as_str)
            .unwrap_or("MCP")
            .to_string(),
    };
    let actor_name = actor.actor_name.clone();
    db.update_todo_state(UpdateTodoState {
        todo_id,
        state,
        actor,
        message: arguments
            .get("message")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        conversation_id: arguments
            .get("conversationId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        link: arguments
            .get("link")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
    .map_err(|err| err.to_string())?;
    if let Some(conversation_id) = arguments.get("conversationId").and_then(Value::as_str) {
        let _ = db.record_agent_session_provider_session_for_todo(todo_id, conversation_id);
    }
    emit_todo_changed(app, todo_id, "mcp_state_changed");
    notify_review_state(
        app,
        db,
        todo_id,
        state,
        &actor_name,
        arguments.get("message").and_then(Value::as_str),
    );
    Ok(json!({ "ok": true, "todoId": todo_id }))
}

fn message_todo_tool(app: &AppHandle, db: &AppDb, arguments: Value) -> Result<Value, String> {
    let todo_id = resolve_todo_id(db, &arguments)?;
    let state = arguments
        .get("state")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| "state must be a string".to_string())
                .and_then(|state_label| {
                    serde_json::from_value::<TodoState>(Value::String(state_label.to_string()))
                        .map_err(|err| err.to_string())
                })
        })
        .transpose()?;
    let actor = Actor {
        actor_type: arguments
            .get("senderType")
            .and_then(Value::as_str)
            .unwrap_or("external")
            .to_string(),
        actor_name: arguments
            .get("senderName")
            .or_else(|| arguments.get("actorName"))
            .and_then(Value::as_str)
            .unwrap_or("MCP")
            .to_string(),
    };
    let actor_name = actor.actor_name.clone();
    db.message_todo_with_state(
        todo_id,
        actor,
        required_str(&arguments, "message")?,
        state,
        arguments.get("conversationId").and_then(Value::as_str),
        arguments.get("link").and_then(Value::as_str),
    )
    .map_err(|err| err.to_string())?;
    if let Some(conversation_id) = arguments.get("conversationId").and_then(Value::as_str) {
        let _ = db.record_agent_session_provider_session_for_todo(todo_id, conversation_id);
    }
    emit_todo_changed(app, todo_id, "mcp_message_received");
    if let Some(state) = state {
        notify_review_state(
            app,
            db,
            todo_id,
            state,
            &actor_name,
            arguments.get("message").and_then(Value::as_str),
        );
    }
    Ok(json!({ "ok": true, "todoId": todo_id }))
}

fn run_action_tool(app: &AppHandle, db: &AppDb, arguments: Value) -> Result<Value, String> {
    let project_id = required_project_id(db, &arguments)?;
    let file_name = required_str(&arguments, "fileName")?;
    let todo_id = optional_i64(&arguments, "todoId");
    let todo_context = action_todo_context(db, project_id, todo_id)?;
    if file_name == "boomerang:open-folder" {
        let action = db
            .list_project_actions(project_id)
            .map_err(|err| err.to_string())?
            .into_iter()
            .find(|item| item.file_name == file_name)
            .ok_or_else(|| format!("action not found: {file_name}"))?;
        project_action_argument_values(&action, arguments.get("arguments"))?;
        let project = db.get_project(project_id).map_err(|err| err.to_string())?;
        let working_directory = mcp_action_working_directory(db, &project, todo_id)?;
        app.opener()
            .open_path(
                expand_home_alias(&working_directory).display().to_string(),
                configured_project_folder_open_app(&project.project_folder_open_app),
            )
            .map_err(|err| err.to_string())?;
        let run = db
            .record_action_run(NewActionRun {
                project_id,
                todo_id,
                file_name: file_name.to_string(),
                pty_id: None,
                command: None,
                state: "succeeded".to_string(),
                exit_code: Some(0),
            })
            .map_err(|err| err.to_string())?;
        emit_project_changed(app, project_id, "mcp_action_run_created");
        return Ok(json!({ "run": run }));
    }

    let action = db
        .list_project_actions(project_id)
        .map_err(|err| err.to_string())?
        .into_iter()
        .find(|item| item.file_name == file_name)
        .ok_or_else(|| format!("action not found: {file_name}"))?;
    let path = action
        .path
        .clone()
        .ok_or_else(|| format!("action has no script path: {file_name}"))?;
    let action_argument_values =
        project_action_argument_values(&action, arguments.get("arguments"))?;
    let project = db.get_project(project_id).map_err(|err| err.to_string())?;
    let working_directory = mcp_action_working_directory(db, &project, todo_id)?;
    let working_directory = expand_home_alias(&working_directory).display().to_string();
    let (program, mut args) = match action.runtime.as_str() {
        "shell" => ("bash".to_string(), vec![path]),
        "python" => ("python3".to_string(), vec![path]),
        other => return Err(format!("cannot run action runtime: {other}")),
    };
    args.extend(action_argument_values);
    let pty = app.state::<PtyState>();
    let env = project_action_environment(
        project_id,
        &project.name,
        &working_directory,
        &action.file_name,
        &action.title,
        todo_context
            .as_ref()
            .map(|(id, display_id)| (*id, display_id.as_str())),
    );
    let pty_id = pty.spawn_process(
        app,
        PtySpawnSpec {
            program: program.clone(),
            args: args.clone(),
            cwd: working_directory,
            env,
            wsl_enabled: project.terminal_wsl_enabled,
            cols: 100,
            rows: 28,
        },
    )?;
    let run = db
        .record_action_run(NewActionRun {
            project_id,
            todo_id,
            file_name: action.file_name,
            pty_id: Some(pty_id),
            command: Some(format!("{} {}", program, args.join(" "))),
            state: "running".to_string(),
            exit_code: None,
        })
        .map_err(|err| err.to_string())?;
    emit_project_changed(app, project_id, "mcp_action_run_created");
    Ok(json!({ "run": run }))
}

fn action_todo_context(
    db: &AppDb,
    project_id: i64,
    todo_id: Option<i64>,
) -> Result<Option<(i64, String)>, String> {
    let Some(todo_id) = todo_id else {
        return Ok(None);
    };
    let todo = db.get_todo(todo_id).map_err(|err| err.to_string())?;
    if todo.project_id != project_id {
        return Err("todo does not belong to action project".to_string());
    }

    Ok(Some((todo_id, todo.display_id)))
}

fn mcp_action_working_directory(
    db: &AppDb,
    project: &Project,
    todo_id: Option<i64>,
) -> Result<String, String> {
    let Some(todo_id) = todo_id else {
        return Ok(project.working_directory.clone());
    };
    let todo = db.get_todo(todo_id).map_err(|err| err.to_string())?;
    if todo.project_id != project.id {
        return Err("todo does not belong to action project".to_string());
    }
    db.todo_working_directory(todo_id)
        .map_err(|err| err.to_string())
}

fn resolve_todo_id(db: &AppDb, arguments: &Value) -> Result<i64, String> {
    if let Some(todo_id) = optional_i64(arguments, "todoId") {
        return Ok(todo_id);
    }
    let task_id = arguments
        .get("taskId")
        .or_else(|| arguments.get("displayId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "tool requires todoId or taskId".to_string())?;
    let snapshot = db.app_snapshot(None, None).map_err(|err| err.to_string())?;
    for project in snapshot.projects {
        let project_snapshot = db
            .app_snapshot(Some(project.id), None)
            .map_err(|err| err.to_string())?;
        if let Some(todo) = project_snapshot
            .todos
            .into_iter()
            .find(|todo| todo.display_id.eq_ignore_ascii_case(task_id))
        {
            return Ok(todo.id);
        }
    }
    Err(format!("todo not found: {task_id}"))
}

fn required_project_id(db: &AppDb, arguments: &Value) -> Result<i64, String> {
    if let Some(project_id) = optional_i64(arguments, "projectId") {
        return Ok(project_id);
    }
    db.app_snapshot(None, None)
        .map(|snapshot| snapshot.selected_project_id)
        .map_err(|err| err.to_string())
}

fn optional_i64(arguments: &Value, key: &str) -> Option<i64> {
    arguments
        .get(key)
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
}

fn required_str<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("tool requires {key}"))
}

fn emit_todo_changed(app: &AppHandle, todo_id: i64, change_type: &str) {
    let _ = app.emit(
        "todos:changed",
        json!({ "todoId": todo_id, "changeType": change_type }),
    );
}

fn emit_project_changed(app: &AppHandle, project_id: i64, change_type: &str) {
    let _ = app.emit(
        "projects:changed",
        json!({ "projectId": project_id, "changeType": change_type }),
    );
}

fn tool_description(name: &str) -> &'static str {
    match name {
        "list_projects" => "List Boomerang projects.",
        "list_todos" => "List todos for a project.",
        "get_todo" => "Read one todo with messages.",
        "update_todo_state" => "Set a todo state.",
        "message_todo" => "Append a message to a todo.",
        "list_actions" => "List project actions.",
        "create_action" => "Create a project action script.",
        "run_action" => "Run a project action.",
        _ => "Boomerang MCP tool.",
    }
}
