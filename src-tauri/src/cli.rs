//! `boomerang` command line interface.
//!
//! The desktop binary doubles as a CLI: when launched with a recognized
//! subcommand it performs the action and exits instead of opening the GUI. This
//! lets delegated agents (Claude / Codex) change a task's state, leave messages,
//! and read tasks with a plain command.
//!
//! Task reads and writes (`state`, `message`, `get`, `list`, `create`) talk
//! **directly to the SQLite database** the app uses — no loopback port, no token,
//! no MCP, and no requirement that the desktop app be running. The CLI resolves
//! its own database location from the bundle identifier it was built with (with
//! `BOOMERANG_DB` / `BOOMERANG_DATA_DIR` overrides). An open app still updates
//! live because it watches the database file for external writes (see
//! `db_watcher`).
//!
//! `codex` / `claude` are the exception: they start an interactive terminal
//! inside the running app, so they reach it over the app's loopback control
//! endpoint. The port and token are read automatically from the database, so the
//! caller never has to pass `--port` / `--token`.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::commands::{create_todo_in_db, CreateTodoCommand};
use crate::core::{Actor, AppDb, TodoState, UpdateTodoState, DATABASE_FILE_NAME};

/// Bundle identifier this binary was built with, emitted by `build.rs`. Used to
/// locate the app-data directory (and thus the database) the GUI uses.
const BUNDLE_IDENTIFIER: &str = env!("BOOMERANG_BUNDLE_IDENTIFIER");

/// Subcommands that switch the binary into CLI mode.
const SUBCOMMANDS: &[&str] = &[
    "state", "message", "get", "list", "create", "codex", "claude", "help",
];

/// Inspect the process arguments. If this is a CLI invocation, run it and
/// return the desired process exit code. Otherwise return `None` so the caller
/// launches the desktop GUI as usual.
pub fn run_from_env() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = args.first()?;
    if first == "--help" || first == "-h" {
        print_help();
        return Some(0);
    }
    if !SUBCOMMANDS.contains(&first.as_str()) {
        return None;
    }
    Some(run(&args))
}

fn run(args: &[String]) -> i32 {
    match execute(args) {
        Ok(message) => {
            println!("{message}");
            0
        }
        Err(err) => {
            eprintln!("boomerang: {err}");
            1
        }
    }
}

#[derive(Default)]
struct Options {
    positionals: Vec<String>,
    todo: Option<String>,
    project: Option<String>,
    parent: Option<String>,
    token: Option<String>,
    port: Option<u16>,
    message: Option<String>,
    state: Option<String>,
    description: Option<String>,
    position: Option<i64>,
    prompt: Option<String>,
    sender_name: Option<String>,
    conversation_id: Option<String>,
}

fn execute(args: &[String]) -> Result<String, String> {
    let (command, rest) = args
        .split_first()
        .expect("run_from_env guarantees a command");
    if command == "help" {
        print_help();
        return Ok(String::new());
    }

    let options = parse_options(rest)?;
    let sender_name = options
        .sender_name
        .clone()
        .or_else(|| std::env::var("BOOMERANG_SENDER_NAME").ok())
        .unwrap_or_else(|| "Agent CLI".to_string());
    let conversation_id = options
        .conversation_id
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    match command.as_str() {
        "state" => {
            let db = open_db()?;
            let todo = resolve_todo(&options)?;
            let todo_id = resolve_todo_id(&db, &todo)?;
            let state_label = options.positionals.first().cloned().ok_or_else(|| {
                "state requires a state name, e.g. state \"Ready to Test\"".to_string()
            })?;
            let state = TodoState::from_label(&state_label).map_err(|err| err.to_string())?;
            let message = options
                .message
                .clone()
                .or_else(|| options.positionals.get(1).cloned());
            db.update_todo_state(UpdateTodoState {
                todo_id,
                state,
                actor: external_actor(&sender_name),
                message: message.clone(),
                conversation_id: conversation_id.clone(),
                link: None,
            })
            .map_err(|err| err.to_string())?;
            if let Some(conversation_id) = conversation_id.as_ref() {
                let _ = db.record_agent_session_provider_session_for_todo(todo_id, conversation_id);
            }
            notify_review(&db, todo_id, state, message.as_deref());
            Ok(format!("{todo} → {}", state.as_label()))
        }
        "message" => {
            let db = open_db()?;
            let todo = resolve_todo(&options)?;
            let todo_id = resolve_todo_id(&db, &todo)?;
            let message = options
                .message
                .clone()
                .or_else(|| options.positionals.first().cloned())
                .ok_or_else(|| "message requires text, e.g. message \"your note\"".to_string())?;
            let state = options
                .state
                .as_ref()
                .map(|label| TodoState::from_label(label).map_err(|err| err.to_string()))
                .transpose()?;
            db.message_todo_with_state(
                todo_id,
                external_actor(&sender_name),
                &message,
                state,
                conversation_id.as_deref(),
                None,
            )
            .map_err(|err| err.to_string())?;
            if let Some(conversation_id) = conversation_id.as_ref() {
                let _ = db.record_agent_session_provider_session_for_todo(todo_id, conversation_id);
            }
            if let Some(state) = state {
                notify_review(&db, todo_id, state, Some(&message));
            }
            Ok(format!("Message left on {todo}."))
        }
        "get" => {
            let db = open_db()?;
            let todo = resolve_todo(&options)?;
            let todo_id = resolve_todo_id(&db, &todo)?;
            let target = db.get_todo(todo_id).map_err(|err| err.to_string())?;
            let snapshot = db
                .app_snapshot(Some(target.project_id), Some(todo_id))
                .map_err(|err| err.to_string())?;
            let summary = snapshot
                .todos
                .into_iter()
                .find(|item| item.id == todo_id)
                .ok_or_else(|| "task not found in snapshot".to_string())?;
            // The snapshot only carries unread/pending messages; `get` must
            // print the full history.
            let messages = db.todo_messages(todo_id).map_err(|err| err.to_string())?;
            let mut todo_value = serde_json::to_value(summary).map_err(|err| err.to_string())?;
            // Match the MCP read: the private work journal is not exposed to agents.
            if let Value::Object(object) = &mut todo_value {
                object.remove("journalMarkdown");
            }
            let payload = json!({ "todo": todo_value, "messages": messages });
            Ok(serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string()))
        }
        "list" => {
            let db = open_db()?;
            let project_id = options
                .project
                .as_ref()
                .map(|project| {
                    project.parse::<i64>().map_err(|_| {
                        format!("--project must be a numeric project id, got {project}")
                    })
                })
                .transpose()?;
            let snapshot = db
                .app_snapshot(project_id, None)
                .map_err(|err| err.to_string())?;
            Ok(format_todo_list(
                &json!({ "todos": snapshot.todos }).to_string(),
            ))
        }
        "create" => {
            let db = open_db()?;
            let parent_id = match options.parent.as_ref() {
                Some(parent) => Some(resolve_todo_id(&db, parent)?),
                None => None,
            };
            let project_id = create_project_id(&db, &options, parent_id)?;
            let input = create_command(&options, project_id, parent_id)?;
            let snapshot = create_todo_in_db(&db, input)?;
            let todo = snapshot
                .todos
                .into_iter()
                .find(|todo| todo.id == snapshot.selected_todo_id)
                .ok_or_else(|| "created task not found in snapshot".to_string())?;
            Ok(format!("Created {}: {}", todo.display_id, todo.title))
        }
        "codex" | "claude" => {
            // Starting a terminal needs the running app (it owns the PTY and shows
            // the pane), so this still reaches the app's control endpoint — but the
            // port and token are discovered from the database, not the caller.
            let db = open_db()?;
            let (port, token) = resolve_control_endpoint(&options, &db)?;
            let result = call_method(
                port,
                &token,
                "boomerang/start_execution_terminal",
                provider_arguments(command, &options, &sender_name)?,
            )?;
            Ok(format_started_terminal(&result))
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn parse_options(args: &[String]) -> Result<Options, String> {
    let mut options = Options::default();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        match arg.as_str() {
            "--todo" | "-t" => options.todo = Some(take_value(args, &mut index, "--todo")?),
            "--project" => options.project = Some(take_value(args, &mut index, "--project")?),
            "--parent" => options.parent = Some(take_value(args, &mut index, "--parent")?),
            "--token" => options.token = Some(take_value(args, &mut index, "--token")?),
            "--port" => {
                let value = take_value(args, &mut index, "--port")?;
                options.port = Some(
                    value
                        .parse()
                        .map_err(|_| format!("--port must be a number, got {value}"))?,
                );
            }
            "--message" | "-m" => {
                options.message = Some(take_value(args, &mut index, "--message")?)
            }
            "--state" | "-s" => options.state = Some(take_value(args, &mut index, "--state")?),
            "--description" | "-d" => {
                options.description = Some(take_value(args, &mut index, "--description")?)
            }
            "--position" => {
                let value = take_value(args, &mut index, "--position")?;
                options.position = Some(
                    value
                        .parse()
                        .map_err(|_| format!("--position must be a number, got {value}"))?,
                );
            }
            "--prompt" => options.prompt = Some(take_value(args, &mut index, "--prompt")?),
            "--sender-name" => {
                options.sender_name = Some(take_value(args, &mut index, "--sender-name")?)
            }
            "--conversation-id" => {
                options.conversation_id = Some(take_value(args, &mut index, "--conversation-id")?)
            }
            other if other.starts_with('-') => return Err(format!("unknown flag: {other}")),
            other => options.positionals.push(other.to_string()),
        }
        index += 1;
    }
    Ok(options)
}

fn take_value(args: &[String], index: &mut usize, flag: &str) -> Result<String, String> {
    *index += 1;
    args.get(*index)
        .cloned()
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn external_actor(name: &str) -> Actor {
    Actor {
        actor_type: "external".to_string(),
        actor_name: name.to_string(),
    }
}

/// Open the app's database without disturbing the running app's live state.
fn open_db() -> Result<AppDb, String> {
    let path = database_path()?;
    if !path.exists() {
        return Err(format!(
            "no Boomerang database at {} — open TaskCooker once to create it, or set BOOMERANG_DB",
            path.display()
        ));
    }
    AppDb::connect_path(&path).map_err(|err| format!("cannot open {}: {err}", path.display()))
}

/// Resolve the database file path: explicit `BOOMERANG_DB`, else
/// `BOOMERANG_DATA_DIR`/<file>, else the platform app-data dir for this build's
/// bundle identifier.
fn database_path() -> Result<PathBuf, String> {
    if let Some(path) = env_path("BOOMERANG_DB") {
        return Ok(path);
    }
    Ok(data_dir()?.join(DATABASE_FILE_NAME))
}

fn data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = env_path("BOOMERANG_DATA_DIR") {
        return Ok(dir);
    }
    default_data_dir(BUNDLE_IDENTIFIER)
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|value| !value.as_os_str().is_empty())
}

/// Platform app-data directory matching the desktop app's identifier, so the CLI
/// opens the same database the GUI created. Mirrors Tauri's `app_data_dir`.
fn default_data_dir(identifier: &str) -> Result<PathBuf, String> {
    if cfg!(target_os = "macos") {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(identifier))
    } else if cfg!(target_os = "windows") {
        let base = std::env::var_os("APPDATA").ok_or("APPDATA is not set")?;
        Ok(PathBuf::from(base).join(identifier))
    } else if let Some(base) = std::env::var_os("XDG_DATA_HOME") {
        Ok(PathBuf::from(base).join(identifier))
    } else {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(identifier))
    }
}

/// Resolve a task to its internal id. A numeric value is the internal id; any
/// other value is a display id (e.g. `B-7`), matched case-insensitively.
fn resolve_todo_id(db: &AppDb, todo: &str) -> Result<i64, String> {
    if let Ok(id) = todo.parse::<i64>() {
        return Ok(id);
    }
    let snapshot = db.app_snapshot(None, None).map_err(|err| err.to_string())?;
    for project in snapshot.projects {
        let project_snapshot = db
            .app_snapshot(Some(project.id), None)
            .map_err(|err| err.to_string())?;
        if let Some(found) = project_snapshot
            .todos
            .into_iter()
            .find(|item| item.display_id.eq_ignore_ascii_case(todo))
        {
            return Ok(found.id);
        }
    }
    Err(format!("task not found: {todo}"))
}

fn resolve_todo(options: &Options) -> Result<String, String> {
    if let Some(todo) = options.todo.clone() {
        return Ok(todo);
    }
    for key in ["BOOMERANG_TODO_DISPLAY_ID", "BOOMERANG_TODO_ID"] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                return Ok(value);
            }
        }
    }
    Err("no task given; pass --todo or set BOOMERANG_TODO_DISPLAY_ID".to_string())
}

fn create_command(
    options: &Options,
    project_id: i64,
    parent_id: Option<i64>,
) -> Result<CreateTodoCommand, String> {
    let title = options
        .positionals
        .first()
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if title.is_empty() {
        return Err("create requires a title, e.g. create \"Write release notes\"".to_string());
    }
    Ok(CreateTodoCommand {
        project_id,
        title: title.to_string(),
        description_markdown: options.description.clone(),
        parent_id,
        position: options.position,
    })
}

/// A subtask belongs to its parent's project (matching the GUI/MCP). Only a
/// top-level task uses --project, falling back to the selected project.
fn create_project_id(db: &AppDb, options: &Options, parent_id: Option<i64>) -> Result<i64, String> {
    if let Some(parent_id) = parent_id {
        return db
            .get_todo(parent_id)
            .map(|todo| todo.project_id)
            .map_err(|err| err.to_string());
    }

    if let Some(project) = options.project.as_ref() {
        return project
            .parse::<i64>()
            .map_err(|_| format!("--project must be a numeric project id, got {project}"));
    }

    db.app_snapshot(None, None)
        .map(|snapshot| snapshot.selected_project_id)
        .map_err(|err| err.to_string())
}

/// Raise the same hand-back notification the app's server raises, so the human is
/// alerted when an agent moves a task to a review state even though the write went
/// straight to the database.
fn notify_review(db: &AppDb, todo_id: i64, state: TodoState, message: Option<&str>) {
    if !state.is_review_state() {
        return;
    }
    if notify_review_in_running_app(db, todo_id, state, message) {
        return;
    }
    let Ok(todo) = db.get_todo(todo_id) else {
        return;
    };
    let Ok(project) = db.get_project(todo.project_id) else {
        return;
    };
    let label_suffix = uuid::Uuid::new_v4().simple().to_string();
    let Some(request) = crate::mcp::review_notification_request(
        &todo,
        state,
        "",
        message,
        &project.name,
        &label_suffix,
    ) else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let _ = notify_rust::set_application(BUNDLE_IDENTIFIER);
    }
    let _ = crate::mcp::build_review_notification(&request).show();
}

fn notify_review_in_running_app(
    db: &AppDb,
    todo_id: i64,
    state: TodoState,
    message: Option<&str>,
) -> bool {
    let Ok(settings) = db.app_settings() else {
        return false;
    };
    let port = std::env::var("BOOMERANG_MCP_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(settings.mcp_port as u16);
    let token = std::env::var("BOOMERANG_MCP_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(settings.mcp_token);
    if token.trim().is_empty() {
        return false;
    }

    let mut params = json!({
        "todoId": todo_id,
        "state": state.as_label(),
        "actorName": "Agent CLI",
    });
    if let Some(message) = message {
        params["message"] = json!(message);
    }

    call_method(port, &token, "boomerang/show_review_notification", params).is_ok()
}

fn provider_arguments(kind: &str, options: &Options, sender_name: &str) -> Result<Value, String> {
    let todo = resolve_todo(options)?;
    let mut arguments = json!({ "kind": kind, "senderName": sender_name });
    if let Ok(id) = todo.parse::<i64>() {
        arguments["todoId"] = json!(id);
    } else {
        arguments["taskId"] = json!(todo);
    }
    if let Some(prompt) = options.prompt.as_ref().or(options.positionals.first()) {
        arguments["additionalPrompt"] = json!(prompt);
    }
    Ok(arguments)
}

/// Discover the app's loopback control endpoint for `codex` / `claude`. Explicit
/// flags or env win; otherwise the port and token persisted in the database are
/// used so the caller never has to know them.
fn resolve_control_endpoint(options: &Options, db: &AppDb) -> Result<(u16, String), String> {
    let settings = db.app_settings().map_err(|err| err.to_string())?;
    let port = options
        .port
        .or_else(|| {
            std::env::var("BOOMERANG_MCP_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(settings.mcp_port as u16);
    let token = options
        .token
        .clone()
        .or_else(|| {
            std::env::var("BOOMERANG_MCP_TOKEN")
                .ok()
                .filter(|token| !token.trim().is_empty())
        })
        .unwrap_or(settings.mcp_token);
    if token.trim().is_empty() {
        return Err(
            "no control token available; open TaskCooker so it can serve the control endpoint"
                .to_string(),
        );
    }
    Ok((port, token))
}

fn call_method(port: u16, token: &str, method: &str, arguments: Value) -> Result<Value, String> {
    call_json_rpc(
        port,
        token,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": arguments,
        }),
    )
}

fn call_json_rpc(port: u16, token: &str, request: Value) -> Result<Value, String> {
    let raw = http_post(port, token, &request.to_string())?;
    let response: Value = serde_json::from_str(&raw)
        .map_err(|err| format!("could not parse Boomerang response ({err}): {raw}"))?;
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        return Err(message.to_string());
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

fn format_todo_list(payload: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return payload.to_string();
    };
    let Some(todos) = value.get("todos").and_then(Value::as_array) else {
        return payload.to_string();
    };
    if todos.is_empty() {
        return "(no tasks)".to_string();
    }

    todos
        .iter()
        .map(|todo| {
            let display_id = todo.get("displayId").and_then(Value::as_str).unwrap_or("?");
            let state = todo.get("state").and_then(Value::as_str).unwrap_or("?");
            let title = todo.get("title").and_then(Value::as_str).unwrap_or("");
            format!("{display_id} [{state}] {title}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_started_terminal(result: &Value) -> String {
    let terminal = &result["terminal"];
    let todo = &result["todo"];
    let label = terminal
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("terminal");
    let display_id = todo
        .get("displayId")
        .and_then(Value::as_str)
        .unwrap_or("task");
    format!("Started {label} for {display_id}.")
}

fn http_post(port: u16, token: &str, body: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|err| {
        format!("cannot reach TaskCooker on 127.0.0.1:{port} (is the app running?): {err}")
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|err| format!("cannot configure connection: {err}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|err| format!("cannot configure connection: {err}"))?;
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("cannot send request: {err}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| format!("cannot read response: {err}"))?;
    let (head, payload) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "malformed response from Boomerang".to_string())?;
    let status_line = head.lines().next().unwrap_or_default();
    if !status_line.contains(" 200 ") {
        let detail = payload.trim();
        return Err(format!(
            "Boomerang refused the request ({}): {detail}",
            status_line.trim()
        ));
    }
    Ok(payload.to_string())
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> &'static str {
    r#"boomerang — update a Boomerang task from the command line

Task reads/writes go straight to the app's database, so they work with no port,
no token, and whether or not the desktop app is running.

USAGE:
    boomerang state <STATE> [-m <MESSAGE>] [OPTIONS]
    boomerang message <TEXT> [-s <STATE>] [OPTIONS]
    boomerang get [OPTIONS]
    boomerang list [--project <ID>] [OPTIONS]
    boomerang create <TITLE> [--project <ID>] [--parent <ID>] [OPTIONS]
    boomerang codex [--todo <ID>] [--prompt <TEXT>] [OPTIONS]
    boomerang claude [--todo <ID>] [--prompt <TEXT>] [OPTIONS]

COMMANDS:
    state      Set the task state, optionally with a message
    message    Leave a message on the task, optionally changing state
    get        Print the task and its messages
    list       List tasks, optionally for one project
    create     Create a task, optionally under a parent task
    codex      Start Codex CLI for a task (needs the running app)
    claude     Start Claude Code CLI for a task (needs the running app)

OPTIONS:
    -t, --todo <ID>       Task display id (e.g. B-7) or numeric id.
                          Defaults to $BOOMERANG_TODO_DISPLAY_ID / $BOOMERANG_TODO_ID.
        --project <ID>    Numeric project id for list/create. Defaults to selected project.
        --parent <ID>     Parent task display id or numeric id for create.
    -d, --description <TEXT>
                          Task description Markdown for create.
        --position <N>    Insert position for create.
        --prompt <TEXT>   Extra instructions for codex/claude.
    -m, --message <TEXT>  Message text (for the state command).
    -s, --state <STATE>   State to set (for the message command).
        --sender-name <N> Display name for the update. Defaults to "Agent CLI".
        --conversation-id <ID>
                          Provider/Boomerang conversation id for message threading.
        --port <PORT>     Override the codex/claude control port (auto-discovered otherwise).
        --token <TOKEN>   Override the codex/claude control token (auto-discovered otherwise).
                          --port/--token are ignored by state/message/get/list/create.

ENVIRONMENT:
    BOOMERANG_DB          Explicit path to the SQLite database file.
    BOOMERANG_DATA_DIR    Directory holding the database (overrides the default app-data dir).

STATES:
    Icebox, To Do, Doing, Blocked, Delegated, Waiting,
    Ready to Test, Needs Feedback, Done, Archived
"#
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_options_accepts_conversation_id_for_agent_threads() {
        let options = parse_options(&[
            "--conversation-id".to_string(),
            "codex-native-session".to_string(),
        ])
        .unwrap();

        assert_eq!(
            options.conversation_id.as_deref(),
            Some("codex-native-session")
        );
    }

    #[test]
    fn parse_options_accepts_create_task_fields() {
        let options = parse_options(&[
            "--project".to_string(),
            "2".to_string(),
            "--parent".to_string(),
            "B-7".to_string(),
            "--description".to_string(),
            "Details".to_string(),
            "--position".to_string(),
            "3".to_string(),
        ])
        .unwrap();

        assert_eq!(options.project.as_deref(), Some("2"));
        assert_eq!(options.parent.as_deref(), Some("B-7"));
        assert_eq!(options.description.as_deref(), Some("Details"));
        assert_eq!(options.position, Some(3));
    }

    #[test]
    fn parse_options_still_accepts_legacy_port_and_token() {
        // Existing delegated-agent prompts pass --port/--token; they must keep
        // parsing (the values are simply ignored for db-direct commands).
        let options = parse_options(&[
            "--port".to_string(),
            "56833".to_string(),
            "--token".to_string(),
            "abc".to_string(),
        ])
        .unwrap();

        assert_eq!(options.port, Some(56833));
        assert_eq!(options.token.as_deref(), Some("abc"));
    }

    #[test]
    fn create_command_maps_fields() {
        let options = Options {
            positionals: vec!["Child task".to_string()],
            description: Some("Details".to_string()),
            position: Some(1),
            ..Options::default()
        };
        let command = create_command(&options, 2, Some(7)).unwrap();

        assert_eq!(command.title, "Child task");
        assert_eq!(command.project_id, 2);
        assert_eq!(command.parent_id, Some(7));
        assert_eq!(command.description_markdown.as_deref(), Some("Details"));
        assert_eq!(command.position, Some(1));
    }

    #[test]
    fn create_project_id_uses_parent_project_even_when_project_flag_is_present() {
        let db = AppDb::open_in_memory().unwrap();
        let other_project = db
            .create_project(crate::core::NewProject {
                name: "Other".to_string(),
                working_directory: "~/p/other".to_string(),
                display_id_prefix: "O".to_string(),
                actions_directory: ".boomerang/actions".to_string(),
                terminal_wsl_enabled: false,
                parent_project_id: None,
                inherit_parent: false,
            })
            .unwrap();
        let parent_project = db
            .create_project(crate::core::NewProject {
                name: "Parent".to_string(),
                working_directory: "~/p/parent".to_string(),
                display_id_prefix: "P".to_string(),
                actions_directory: ".boomerang/actions".to_string(),
                terminal_wsl_enabled: false,
                parent_project_id: None,
                inherit_parent: false,
            })
            .unwrap();
        let parent = db.create_todo(parent_project.id, "Parent task").unwrap();
        let options = Options {
            project: Some(other_project.id.to_string()),
            parent: Some(parent.display_id.clone()),
            ..Options::default()
        };

        let resolved_parent_id = options
            .parent
            .as_ref()
            .map(|parent| resolve_todo_id(&db, parent).unwrap());
        let project_id = create_project_id(&db, &options, resolved_parent_id).unwrap();

        assert_eq!(resolved_parent_id, Some(parent.id));
        assert_eq!(project_id, parent_project.id);
    }

    #[test]
    fn provider_arguments_include_task_kind_and_extra_prompt() {
        let arguments = provider_arguments(
            "codex",
            &Options {
                todo: Some("B-164".to_string()),
                prompt: Some("Use the small fix.".to_string()),
                ..Options::default()
            },
            "Agent CLI",
        )
        .unwrap();

        assert_eq!(arguments["kind"], json!("codex"));
        assert_eq!(arguments["taskId"], json!("B-164"));
        assert_eq!(arguments["additionalPrompt"], json!("Use the small fix."));
        assert_eq!(arguments["senderName"], json!("Agent CLI"));
    }

    #[test]
    fn help_mentions_list_and_create() {
        let text = help_text();

        assert!(text.contains("boomerang list"));
        assert!(text.contains("boomerang create <TITLE>"));
        assert!(text.contains("boomerang codex"));
        assert!(text.contains("boomerang claude"));
        assert!(text.contains("--parent <ID>"));
        assert!(text.contains("--prompt <TEXT>"));
    }
}
