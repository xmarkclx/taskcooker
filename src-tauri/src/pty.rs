use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration as StdDuration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::core::AppDb;

const READ_BUF_SIZE: usize = 16 * 1024;
// ponytail: terminal reattach must stay cheap; raise only if deeper in-app scrollback wins over typing latency.
const SCROLLBACK_MAX_BYTES: usize = 512 * 1024;
// Upper bound for one coalesced pty:data event. Heavy output conflates into
// few large events instead of hundreds of per-read ones (which congested the
// webview event loop and made unrelated UI feel sluggish); the cap keeps a
// single event's base64 payload bounded.
const DATA_EVENT_BATCH_MAX_BYTES: usize = 128 * 1024;
// Streams that keep producing are frame-aligned to at most one event per
// display frame; a full batch skips the wait so saturated output still flows.
const DATA_EVENT_MIN_INTERVAL: StdDuration = StdDuration::from_millis(16);
// 🖱️ Terminal queries must be answered by the backend, not xterm. Multiple
// terminal views can mirror one PTY, and only the focused view may write, so
// query replies from xterm are dropped for unfocused terminals (a fresh
// ConPTY shell then blocks on its startup ESC[6n and stays blank forever).
// Worse, queries left in scrollback get re-answered by xterm on every
// reattach, injecting stale reply bytes into the shell. So the backend
// answers device-attribute and startup cursor queries itself and strips
// them from the stream. Replies mirror what xterm.js would send.
const DA1_QUERY_REPLY: &[u8] = b"\x1b[?1;2c";
const DA2_QUERY_REPLY: &[u8] = b"\x1b[>0;276;0c";
// Cursor is at home on a fresh console; only the startup query is answered
// blind — mid-session CPR needs the real cursor position xterm tracks.
const STARTUP_CURSOR_REPLY: &[u8] = b"\x1b[1;1R";
// The startup prelude before ESC[6n is a handful of short mode-set sequences
// (observed: ESC[?9001h ESC[?1004h ESC[6n); past this many forwarded bytes
// the session is clearly interactive and CPR must not be answered blind.
const STARTUP_CURSOR_WINDOW_BYTES: usize = 64;
// A CSI longer than this is not a query; flush it and stop holding bytes.
const QUERY_HOLD_MAX: usize = 256;
#[cfg(windows)]
static CONPTY_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());

pub struct PtyState {
    sessions: RwLock<HashMap<i64, Arc<PtySession>>>,
    next_id: AtomicI64,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicI64::new(1),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PtySpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub wsl_enabled: bool,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyScrollback {
    pub pty_id: i64,
    pub data: String,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

pub fn provider_session_id_from_pty_output(provider: &str, output: &str) -> Option<String> {
    let provider = provider.trim().to_ascii_lowercase();
    if provider != "claude" && provider != "codex" {
        return None;
    }

    let output = strip_ansi_sequences(output);
    output.lines().find_map(|line| {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        let value = if lower.starts_with("session id:") || lower.starts_with("session:") {
            trimmed.split_once(':')?.1.trim()
        } else {
            return None;
        };

        value
            .split_whitespace()
            .next()
            .map(|session| {
                session.trim_matches(|character: char| character == '"' || character == '\'')
            })
            .filter(|session| !session.is_empty())
            .map(ToString::to_string)
    })
}

fn strip_ansi_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\u{1b}' {
            output.push(character);
            continue;
        }

        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    output
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataPayload {
    pty_id: i64,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitPayload {
    pty_id: i64,
    exit_code: i32,
}

struct PtySession {
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    size: Mutex<PtySize>,
    scrollback: Mutex<Vec<u8>>,
    input_owner: PtyInputOwner,
    cwd: String,
    title: String,
    tmux_enabled: bool,
    tmux_session_name: String,
    exited: AtomicBool,
    exit_code: Mutex<Option<i32>>,
}

const ESCAPE_BYTE: u8 = 0x1b;

#[derive(Debug, Clone, Copy, Default)]
enum QueryFilterState {
    #[default]
    Idle,
    AfterEscape,
    InsideCsi,
}

/// 🕵️ Stream filter that answers terminal queries on the PTY's behalf.
///
/// A tiny CSI state machine that survives queries split across reads.
/// Handled sequences (stripped from the stream, answered via the `respond`
/// callback):
/// - `ESC[c` / `ESC[0c`… — primary device attributes → DA1_QUERY_REPLY
/// - `ESC[>c`            — secondary device attributes → DA2_QUERY_REPLY
/// - `ESC[=c`            — tertiary device attributes → swallowed silently
/// - `ESC[6n`            — cursor position, answered `1;1` only during the
///   startup window (ConPTY sessions emit mode-set bytes before the query
///   in the same chunk, so the window is byte-based, not "no output yet")
///
/// Everything else, including DA *responses* (`?`/`;` in the params) and
/// mid-session `ESC[6n`, passes through untouched for xterm to handle.
#[derive(Debug, Default)]
struct TerminalQueryFilter {
    state: QueryFilterState,
    hold: Vec<u8>,
    cursor_replied: bool,
    forwarded: usize,
}

impl TerminalQueryFilter {
    fn process<F: FnMut(&[u8])>(&mut self, input: &[u8], out: &mut Vec<u8>, mut respond: F) {
        let out_start = out.len();
        // Fast path: nothing held and no escape byte means nothing to inspect.
        if matches!(self.state, QueryFilterState::Idle) && !input.contains(&ESCAPE_BYTE) {
            out.extend_from_slice(input);
            self.forwarded += input.len();
            return;
        }

        for &byte in input {
            match self.state {
                QueryFilterState::Idle => {
                    if byte == ESCAPE_BYTE {
                        self.state = QueryFilterState::AfterEscape;
                        self.hold.clear();
                        self.hold.push(byte);
                    } else {
                        out.push(byte);
                    }
                }
                QueryFilterState::AfterEscape => {
                    if byte == b'[' {
                        self.state = QueryFilterState::InsideCsi;
                        self.hold.push(byte);
                    } else if byte == ESCAPE_BYTE {
                        // Flush the orphan ESC; this one starts a new sequence.
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.hold.push(byte);
                    } else {
                        // Non-CSI escape (ESC M etc.) — not a query, flush it.
                        out.extend_from_slice(&self.hold);
                        out.push(byte);
                        self.hold.clear();
                        self.state = QueryFilterState::Idle;
                    }
                }
                QueryFilterState::InsideCsi => {
                    self.hold.push(byte);
                    // 0x40..=0x7e is the CSI final-byte range.
                    if (0x40..=0x7e).contains(&byte) {
                        self.finish_csi(byte, out, &mut respond);
                        self.hold.clear();
                        self.state = QueryFilterState::Idle;
                    } else if self.hold.len() >= QUERY_HOLD_MAX {
                        // Runaway sequence — stop holding, it is not a query.
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.state = QueryFilterState::Idle;
                    }
                }
            }
        }
        self.forwarded += out.len() - out_start;
    }

    fn finish_csi<F: FnMut(&[u8])>(&mut self, final_byte: u8, out: &mut Vec<u8>, respond: &mut F) {
        // hold = ESC [ <params> <final_byte>
        let params = &self.hold[2..self.hold.len() - 1];
        if final_byte == b'c' {
            // `?`/`;` in the params means this is itself a DA *response*
            // echoing through — forward it, never answer it (reply loop!).
            let is_response = params.contains(&b'?') || params.contains(&b';');
            if is_response {
                out.extend_from_slice(&self.hold);
                return;
            }
            match params.first().copied().unwrap_or(0) {
                b'>' => respond(DA2_QUERY_REPLY),
                b'=' => {} // DA3 has no meaningful answer; swallow it. 🤫
                0 | b'0'..=b'9' => respond(DA1_QUERY_REPLY),
                _ => out.extend_from_slice(&self.hold),
            }
            return;
        }

        let is_startup_cursor_query = final_byte == b'n'
            && params == b"6"
            && !self.cursor_replied
            && self.forwarded + (out.len()) <= STARTUP_CURSOR_WINDOW_BYTES;
        if is_startup_cursor_query {
            self.cursor_replied = true;
            respond(STARTUP_CURSOR_REPLY);
            return;
        }

        out.extend_from_slice(&self.hold);
    }
}

#[derive(Debug, Default)]
struct PtyInputOwner {
    owner: Mutex<Option<String>>,
}

impl PtyInputOwner {
    fn claim(&self, owner: &str) -> Result<(), String> {
        let owner = normalized_input_owner(owner)?;
        let mut current = self
            .owner
            .lock()
            .map_err(|_| "pty input owner lock is poisoned".to_string())?;
        *current = Some(owner);
        Ok(())
    }

    fn release(&self, owner: &str) -> Result<(), String> {
        let owner = normalized_input_owner(owner)?;
        let mut current = self
            .owner
            .lock()
            .map_err(|_| "pty input owner lock is poisoned".to_string())?;
        if current.as_deref() == Some(owner.as_str()) {
            *current = None;
        }
        Ok(())
    }

    fn can_write(&self, owner: &str) -> Result<bool, String> {
        let owner = normalized_input_owner(owner)?;
        let current = self
            .owner
            .lock()
            .map_err(|_| "pty input owner lock is poisoned".to_string())?;
        Ok(current.as_deref() == Some(owner.as_str()))
    }
}

fn normalized_input_owner(owner: &str) -> Result<String, String> {
    let owner = owner.trim();
    if owner.is_empty() {
        return Err("pty input owner is required".to_string());
    }

    Ok(owner.to_string())
}

impl Drop for PtySession {
    fn drop(&mut self) {
        kill_session_processes(self);
    }
}

impl PtyState {
    pub fn spawn_process(&self, app: &AppHandle, spec: PtySpawnSpec) -> Result<i64, String> {
        #[cfg(windows)]
        let _conpty_lifecycle_guard = CONPTY_LIFECYCLE_LOCK
            .lock()
            .map_err(|_| "conpty lifecycle lock is poisoned".to_string())?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let launched_at = Utc::now() - Duration::seconds(5);
        let provider = provider_from_program(&spec.program).map(ToString::to_string);
        let task_display_id = pty_env_value(&spec.env, "BOOMERANG_TODO_DISPLAY_ID");
        let tmux_enabled = app
            .try_state::<AppDb>()
            .and_then(|db| db.app_settings().ok())
            .map(|settings| settings.terminal_tmux_enabled)
            .unwrap_or(false);
        let tmux_session_name = format!("boomerang-pty-{id}");
        let title = task_display_id
            .clone()
            .map(|display_id| format!("TaskCooker {display_id}"))
            .unwrap_or_else(|| format!("TaskCooker PTY {id}"));
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: spec.rows,
            cols: spec.cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).map_err(|err| err.to_string())?;
        let (program, args) = pty_command_for_spawn(&spec, tmux_enabled, &tmux_session_name);
        // 🐚 On native Windows, script-shim CLIs (npm's `codex`, `claude`, …)
        // cannot be spawned by CreateProcessW. Launch the interactive shell
        // instead and auto-type the command once the prompt is up.
        let (program, args, typed_command) = windows_shell_first_launch(program, args);
        let mut command = CommandBuilder::new(&program);
        command.args(&args);
        if let Some(cwd) = pty_host_cwd_for_spawn(&spec) {
            command.cwd(cwd);
        }
        for (key, value) in spawn_environment(&spec.env) {
            command.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|err| err.to_string())?;
        drop(pair.slave);

        let killer = child.clone_killer();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|err| err.to_string())?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|err| err.to_string())?,
        ));
        let session = Arc::new(PtySession {
            killer: Mutex::new(killer),
            writer,
            master: Mutex::new(pair.master),
            size: Mutex::new(size),
            scrollback: Mutex::new(Vec::new()),
            input_owner: PtyInputOwner::default(),
            cwd: spec.cwd.clone(),
            title,
            tmux_enabled,
            tmux_session_name,
            exited: AtomicBool::new(false),
            exit_code: Mutex::new(None),
        });

        self.sessions
            .write()
            .expect("pty session lock is not poisoned")
            .insert(id, session.clone());

        if provider.as_deref() == Some("codex") {
            if let Some(task_display_id) = task_display_id {
                spawn_codex_session_discovery(app.clone(), id, task_display_id, launched_at);
            }
        }

        if let Some(command) = typed_command {
            spawn_shell_command_typer(session.clone(), id, command);
        }

        let app_for_reader = app.clone();
        let provider_for_reader = provider.clone();
        let session_for_reader = session.clone();
        let (data_tx, data_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        thread::Builder::new()
            .name(format!("boomerang-pty-reader-{id}"))
            .spawn(move || {
                let mut buf = [0u8; READ_BUF_SIZE];
                let mut query_filter = TerminalQueryFilter::default();
                let mut filtered = Vec::with_capacity(READ_BUF_SIZE);
                let mut replies: Vec<u8> = Vec::new();
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            filtered.clear();
                            replies.clear();
                            query_filter.process(&buf[..n], &mut filtered, |reply| {
                                replies.extend_from_slice(reply);
                            });
                            if !replies.is_empty() {
                                if let Ok(mut writer) = session_for_reader.writer.lock() {
                                    let _ = writer.write_all(&replies);
                                    let _ = writer.flush();
                                }
                            }
                            if filtered.is_empty() {
                                continue;
                            }
                            let chunk = filtered.as_slice();
                            append_scrollback(&session_for_reader, chunk);
                            let text = String::from_utf8_lossy(chunk);
                            if let Some(provider) = provider_for_reader.as_deref() {
                                discover_provider_session_from_output(
                                    &app_for_reader,
                                    id,
                                    provider,
                                    &text,
                                );
                            }
                            if data_tx.send(chunk.to_vec()).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|err| err.to_string())?;

        // Conflating emitter: a quiet terminal (keystroke echo) emits each
        // chunk immediately, while a fast producer queues chunks faster than
        // one emit round-trip and they merge into a single event. The channel
        // acts as the backpressure buffer, so event frequency self-limits
        // under load without adding latency when idle.
        let app_for_emitter = app.clone();
        thread::Builder::new()
            .name(format!("boomerang-pty-emitter-{id}"))
            .spawn(move || {
                let event_name = pty_data_event_name(id);
                let mut last_emit: Option<std::time::Instant> = None;
                while let Ok(first) = data_rx.recv() {
                    let mut batch = first;
                    drain_pending_pty_data(&data_rx, &mut batch);
                    // Frame-align sustained streams (~60 events/s max). The
                    // first chunk after a quiet spell always emits with no
                    // added latency, so keystroke echo stays instant.
                    if let Some(previous) = last_emit {
                        let elapsed = previous.elapsed();
                        if elapsed < DATA_EVENT_MIN_INTERVAL
                            && batch.len() < DATA_EVENT_BATCH_MAX_BYTES
                        {
                            thread::sleep(DATA_EVENT_MIN_INTERVAL - elapsed);
                            drain_pending_pty_data(&data_rx, &mut batch);
                        }
                    }
                    let _ = app_for_emitter.emit(
                        &event_name,
                        PtyDataPayload {
                            pty_id: id,
                            data: STANDARD.encode(&batch),
                        },
                    );
                    last_emit = Some(std::time::Instant::now());
                }
            })
            .map_err(|err| err.to_string())?;

        let app_for_waiter = app.clone();
        let session_for_waiter = session;
        thread::Builder::new()
            .name(format!("boomerang-pty-waiter-{id}"))
            .spawn(move || {
                let exit_code = match child.wait() {
                    Ok(status) => status.exit_code() as i32,
                    Err(_) => -1,
                };
                session_for_waiter.exited.store(true, Ordering::Release);
                if let Ok(mut code) = session_for_waiter.exit_code.lock() {
                    *code = Some(exit_code);
                }
                let event_name = pty_exit_event_name(id);
                let _ = app_for_waiter.emit(
                    &event_name,
                    PtyExitPayload {
                        pty_id: id,
                        exit_code,
                    },
                );
                if let Some(db) = app_for_waiter.try_state::<AppDb>() {
                    if let Ok(Some(run)) = db.finish_action_run_for_pty(id, exit_code.into()) {
                        let _ = app_for_waiter.emit(
                            "projects:changed",
                            json!({
                                "projectId": run.project_id,
                                "changeType": "action_run_finished",
                            }),
                        );
                    }
                    if let Ok(Some(terminal)) =
                        db.finish_execution_terminal_for_pty(id, exit_code.into())
                    {
                        let _ = app_for_waiter.emit(
                            "todos:changed",
                            json!({
                                "todoId": terminal.todo_id,
                                "changeType": "execution_terminal_exited",
                            }),
                        );
                    }
                    if let Ok(Some(session)) = db.finish_agent_session_for_pty(id, exit_code.into())
                    {
                        let _ = app_for_waiter.emit(
                            "todos:changed",
                            json!({
                                "todoId": session.todo_id,
                                "changeType": "agent_session_exited",
                            }),
                        );
                    }
                }
            })
            .map_err(|err| err.to_string())?;

        Ok(id)
    }

    pub fn scrollback(&self, id: i64) -> Result<PtyScrollback, String> {
        let session = self.session(id)?;
        let data = session
            .scrollback
            .lock()
            .map_err(|_| "pty scrollback lock is poisoned".to_string())?
            .clone();
        let exit_code = *session
            .exit_code
            .lock()
            .map_err(|_| "pty exit-code lock is poisoned".to_string())?;

        Ok(PtyScrollback {
            pty_id: id,
            data: STANDARD.encode(data),
            exited: session.exited.load(Ordering::Acquire),
            exit_code,
        })
    }

    pub fn write_text(&self, id: i64, text: &str) -> Result<(), String> {
        let session = self.session(id)?;
        let result = session
            .writer
            .lock()
            .map_err(|_| "pty writer lock is poisoned".to_string())?
            .write_all(text.as_bytes())
            .map_err(|err| err.to_string());
        result
    }

    pub fn close(&self, id: i64) -> Result<(), String> {
        let session = self
            .sessions
            .write()
            .map_err(|_| "pty session lock is poisoned".to_string())?
            .remove(&id);
        if let Some(session) = session {
            // Kill on a background thread: signalling the process group can
            // block, and callers only need the session out of the registry.
            let kill_target = session.clone();
            let spawned = thread::Builder::new()
                .name(format!("boomerang-pty-killer-{id}"))
                .spawn(move || {
                    kill_session_processes_guarded(&kill_target);
                });
            if spawned.is_err() {
                kill_session_processes_guarded(&session);
            }
        }
        Ok(())
    }

    pub fn open_external_terminal(
        &self,
        id: i64,
        app_data_dir: &Path,
        opener_templates: &str,
    ) -> Result<(), String> {
        let session = self.session(id)?;
        if !session.tmux_enabled {
            return Err("terminal was not started with tmux enabled".to_string());
        }

        let command_file =
            external_terminal_command_file(app_data_dir, id, &session.tmux_session_name)?;
        let tmux_command = format!(
            "tmux -L boomerang attach-session -t {}",
            shell_quote(&session.tmux_session_name)
        );
        let replacements = [
            ("{ptyId}", id.to_string()),
            ("{session}", shell_quote(&session.tmux_session_name)),
            ("{title}", shell_quote(&session.title)),
            ("{cwd}", shell_quote(&session.cwd)),
            ("{tmuxCommand}", shell_quote(&tmux_command)),
            (
                "{commandFile}",
                shell_quote(command_file.to_string_lossy().as_ref()),
            ),
        ];
        let mut last_error = None;
        for template in opener_templates
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            let mut command = template.to_string();
            for (name, value) in &replacements {
                command = command.replace(name, value);
            }
            match Command::new("/bin/sh").arg("-lc").arg(&command).spawn() {
                Ok(_) => return Ok(()),
                Err(error) => last_error = Some(error.to_string()),
            }
        }

        Err(last_error.unwrap_or_else(|| "no external terminal openers configured".to_string()))
    }

    fn session(&self, id: i64) -> Result<Arc<PtySession>, String> {
        self.sessions
            .read()
            .map_err(|_| "pty session lock is poisoned".to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))
    }
}

fn pty_command_for_spawn(
    spec: &PtySpawnSpec,
    tmux_enabled: bool,
    tmux_session_name: &str,
) -> (String, Vec<String>) {
    pty_command_for_spawn_for_platform(
        spec,
        tmux_enabled,
        tmux_session_name,
        TerminalLaunchPlatform::current(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalLaunchPlatform {
    Unix,
    Windows,
}

impl TerminalLaunchPlatform {
    fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else {
            Self::Unix
        }
    }
}

fn pty_command_for_spawn_for_platform(
    spec: &PtySpawnSpec,
    tmux_enabled: bool,
    tmux_session_name: &str,
    platform: TerminalLaunchPlatform,
) -> (String, Vec<String>) {
    let (program, args) = native_pty_command_for_spawn(spec, tmux_enabled, tmux_session_name);
    if spec.wsl_enabled && platform == TerminalLaunchPlatform::Windows {
        let mut wsl_args = vec!["--cd".to_string(), spec.cwd.clone()];
        if !program.is_empty() {
            wsl_args.push("--".to_string());
            if spec.env.is_empty() {
                wsl_args.push(program);
            } else {
                wsl_args.push("env".to_string());
                wsl_args.extend(spec.env.iter().map(|(key, value)| format!("{key}={value}")));
                wsl_args.push(program);
            }
            wsl_args.extend(args);
        }
        return ("wsl.exe".to_string(), wsl_args);
    }

    (program, args)
}

fn pty_host_cwd_for_spawn(spec: &PtySpawnSpec) -> Option<&str> {
    pty_host_cwd_for_spawn_for_platform(spec, TerminalLaunchPlatform::current())
}

fn pty_host_cwd_for_spawn_for_platform(
    spec: &PtySpawnSpec,
    platform: TerminalLaunchPlatform,
) -> Option<&str> {
    if spec.wsl_enabled && platform == TerminalLaunchPlatform::Windows {
        None
    } else {
        Some(spec.cwd.as_str())
    }
}

/// 🐚⌨️ Shell-first launch for native Windows: CreateProcessW can only start
/// real Win32 executables, but npm-installed CLIs (`codex`, `claude`, …) live
/// on PATH as script shims (extensionless sh script, `.cmd`, `.ps1`) that
/// fail with "%1 is not a valid Win32 application" (os error 193) when
/// spawned directly. Instead of resolving shims ourselves, launch the
/// interactive shell and auto-type the command once the prompt is up — the
/// CLI then resolves and inherits env exactly as if typed by hand.
/// Returns (program, args, command-to-type).
fn windows_shell_first_launch(
    program: String,
    args: Vec<String>,
) -> (String, Vec<String>, Option<String>) {
    if TerminalLaunchPlatform::current() != TerminalLaunchPlatform::Windows {
        return (program, args, None);
    }

    let shell = windows_terminal_shell_path();
    shell_first_launch_for_platform(program, args, &shell, TerminalLaunchPlatform::current())
}

fn shell_first_launch_for_platform(
    program: String,
    args: Vec<String>,
    shell: &Path,
    platform: TerminalLaunchPlatform,
) -> (String, Vec<String>, Option<String>) {
    if platform != TerminalLaunchPlatform::Windows
        || program.is_empty()
        || has_exe_extension(&program)
    {
        return (program, args, None);
    }

    let shell_name = windows_path_file_name(shell).to_ascii_lowercase();
    if shell_name != "pwsh.exe" && shell_name != "powershell.exe" {
        // Only cmd.exe available: quoting arbitrary prompt text for cmd is
        // unsafe, so keep the direct spawn and let it error loudly instead.
        return (program, args, None);
    }

    let typed_command = typed_shell_command(&program, &args);
    (
        shell.display().to_string(),
        vec!["-NoLogo".to_string()],
        Some(typed_command),
    )
}

fn has_exe_extension(program: &str) -> bool {
    Path::new(program)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
}

fn windows_path_file_name(path: &Path) -> String {
    path.to_string_lossy()
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .to_string()
}

/// `& 'program' 'args'… ; exit $LASTEXITCODE` — the call operator plus
/// single-quoted (PowerShell literal) arguments, so prompts with spaces,
/// double quotes, `$`, and newlines pass through verbatim; only `'` needs
/// doubling. The trailing `exit` keeps the old semantics: the terminal
/// session ends with the CLI's exit code instead of dropping back to the
/// prompt, so exit tracking for agent sessions keeps working.
fn typed_shell_command(program: &str, args: &[String]) -> String {
    let mut command = format!("& {}", powershell_quote(program));
    for arg in args {
        command.push(' ');
        command.push_str(&powershell_quote(arg));
    }
    command.push_str(" ; exit $LASTEXITCODE");
    command
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Preferred interactive shell on Windows: pwsh 7 from PATH or its default
/// install dir, then Windows PowerShell 5, then cmd.exe as a last resort.
pub(crate) fn windows_terminal_shell_path() -> PathBuf {
    if let Some(path) = which_in_path("pwsh.exe") {
        return path;
    }

    if let Some(program_files) = env::var_os("ProgramFiles").map(PathBuf::from) {
        let candidate = program_files.join("PowerShell").join("7").join("pwsh.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    let system_root = env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let powershell = system_root
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if powershell.is_file() {
        return powershell;
    }

    env::var_os("COMSPEC")
        .map(PathBuf::from)
        .unwrap_or_else(|| system_root.join("System32").join("cmd.exe"))
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for directory in env::split_paths(&path) {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn native_pty_command_for_spawn(
    spec: &PtySpawnSpec,
    tmux_enabled: bool,
    tmux_session_name: &str,
) -> (String, Vec<String>) {
    if !tmux_enabled {
        return (spec.program.clone(), spec.args.clone());
    }

    let mut args = vec![
        "-L".to_string(),
        "boomerang".to_string(),
        "new-session".to_string(),
        "-A".to_string(),
        "-s".to_string(),
        tmux_session_name.to_string(),
        "-x".to_string(),
        spec.cols.to_string(),
        "-y".to_string(),
        spec.rows.to_string(),
    ];
    if !spec.program.is_empty() {
        args.push("--".to_string());
        args.push(spec.program.clone());
    }
    args.extend(spec.args.clone());
    ("tmux".to_string(), args)
}

fn spawn_environment(overrides: &[(String, String)]) -> Vec<(String, String)> {
    let configured_path = overrides
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())
        .or_else(|| env::var("PATH").ok());
    let path = usable_cli_path(configured_path.as_deref());
    let mut env = overrides
        .iter()
        .filter(|(key, _)| key != "PATH")
        .cloned()
        .collect::<Vec<_>>();
    upsert_env(&mut env, "PATH", path);
    ensure_env(&mut env, "TERM", "xterm-256color");
    ensure_env(&mut env, "COLORTERM", "truecolor");
    ensure_utf8_locale(&mut env);
    env
}

fn ensure_env(env: &mut Vec<(String, String)>, key: &str, value: &str) {
    if env.iter().any(|(name, _)| name == key) {
        return;
    }

    env.push((key.to_string(), value.to_string()));
}

fn upsert_env(env: &mut Vec<(String, String)>, key: &str, value: String) {
    if let Some((_, existing)) = env.iter_mut().find(|(name, _)| name == key) {
        *existing = value;
        return;
    }

    env.push((key.to_string(), value));
}

fn ensure_utf8_locale(env: &mut Vec<(String, String)>) {
    if env
        .iter()
        .any(|(key, value)| is_locale_env_key(key) && is_utf8_locale(value))
    {
        return;
    }

    for key in ["LC_ALL", "LC_CTYPE", "LANG"] {
        if let Ok(value) = env::var(key) {
            if is_utf8_locale(&value) {
                upsert_env(env, key, value);
                return;
            }
        }
    }

    upsert_env(env, "LANG", fallback_utf8_locale().to_string());
}

fn is_locale_env_key(key: &str) -> bool {
    matches!(key, "LC_ALL" | "LC_CTYPE" | "LANG")
}

fn is_utf8_locale(value: &str) -> bool {
    let value = value.to_ascii_uppercase();
    value.contains("UTF-8") || value.contains("UTF8")
}

fn fallback_utf8_locale() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "en_US.UTF-8"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "C.UTF-8"
    }
    #[cfg(windows)]
    {
        "en_US.UTF-8"
    }
}

pub(crate) fn usable_cli_path(configured_path: Option<&str>) -> String {
    // 🪟 Windows PATH uses `;` and drive letters contain `:`; splitting on `:`
    // would shred `C:\Windows\system32;...` into garbage. The stripped-PATH
    // problem this function works around is a macOS/Linux GUI-launch issue,
    // so on Windows keep the inherited PATH untouched.
    if cfg!(windows) {
        return configured_path.unwrap_or_default().to_string();
    }

    let mut parts = configured_path
        .unwrap_or_default()
        .split(':')
        .filter(|part| !part.trim().is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    for fallback in common_cli_path_entries() {
        if !parts.iter().any(|part| part == &fallback) {
            parts.push(fallback.to_string());
        }
    }
    parts.join(":")
}

fn common_cli_path_entries() -> Vec<String> {
    let mut entries = vec![
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    if let Some(home) = env::var_os("HOME").and_then(|value| value.into_string().ok()) {
        entries.push(format!("{home}/.local/bin"));
        entries.push(format!("{home}/.cargo/bin"));
        entries.push(format!("{home}/.bun/bin"));
    }
    entries
}

fn external_terminal_command_file(
    app_data_dir: &Path,
    pty_id: i64,
    tmux_session_name: &str,
) -> Result<PathBuf, String> {
    let directory = app_data_dir.join("external-terminals");
    fs::create_dir_all(&directory).map_err(|err| err.to_string())?;
    let path = directory.join(format!("pty-{pty_id}.command"));
    fs::write(
        &path,
        format!(
            "#!/bin/sh\nexec tmux -L boomerang attach-session -t {}\n",
            shell_quote(tmux_session_name)
        ),
    )
    .map_err(|err| err.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .map_err(|err| err.to_string())?;
    }
    Ok(path)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// ⌨️ Waits for the shell prompt to paint, then types the wrapped CLI command
/// into the PTY. ConPTY buffers typed-ahead input, so even if the shell is
/// still initializing the keystrokes land once it starts reading stdin.
fn spawn_shell_command_typer(session: Arc<PtySession>, id: i64, command: String) {
    let _ = thread::Builder::new()
        .name(format!("boomerang-pty-shell-typer-{id}"))
        .spawn(move || {
            // Up to ~10s for the first prompt bytes; startup is usually <1s.
            for _ in 0..40 {
                if session.exited.load(Ordering::Acquire) {
                    return;
                }
                let has_output = session
                    .scrollback
                    .lock()
                    .map(|scrollback| !scrollback.is_empty())
                    .unwrap_or(false);
                if has_output {
                    break;
                }
                thread::sleep(StdDuration::from_millis(250));
            }
            // Small grace period so the prompt finishes painting first.
            thread::sleep(StdDuration::from_millis(500));
            if session.exited.load(Ordering::Acquire) {
                return;
            }
            if let Ok(mut writer) = session.writer.lock() {
                let _ = writer.write_all(command.as_bytes());
                let _ = writer.write_all(b"\r");
                let _ = writer.flush();
            }
        });
}

// Wraps the kill in the ConPTY lifecycle lock on Windows; skipping the kill on
// a poisoned lock matches the previous close() behavior (the session's Drop
// still retries the kill without the guard).
fn kill_session_processes_guarded(session: &PtySession) {
    #[cfg(windows)]
    let Ok(_conpty_lifecycle_guard) = CONPTY_LIFECYCLE_LOCK.lock() else {
        return;
    };
    kill_session_processes(session);
}

fn kill_session_processes(session: &PtySession) {
    #[cfg(unix)]
    if let Ok(master) = session.master.lock() {
        if let Some(pgid) = master.process_group_leader() {
            let _ = kill_unix_process_group(pgid);
        }
    }

    if let Ok(mut killer) = session.killer.lock() {
        let _ = killer.kill();
    }
}

#[cfg(unix)]
fn kill_unix_process_group(pgid: libc::pid_t) -> std::io::Result<()> {
    let result = unsafe { libc::kill(unix_process_group_signal_pid(pgid), libc::SIGHUP) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn unix_process_group_signal_pid(pgid: libc::pid_t) -> libc::pid_t {
    -pgid
}

// `async`: base64-encoding up to 512KB of scrollback per attach is too much
// work for the main thread (B-252).
#[tauri::command(async)]
pub fn pty_scrollback(state: State<'_, PtyState>, id: i64) -> Result<PtyScrollback, String> {
    state.scrollback(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, request: Request) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-pty-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| "pty_write: missing x-pty-id header".to_string())?;
    let input_owner = request
        .headers()
        .get("x-pty-input-owner")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "pty_write: missing x-pty-input-owner header".to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("pty_write: expected raw body".to_string());
    };
    let session = state.session(id)?;
    if !session.input_owner.can_write(input_owner)? {
        return Err("pty_write: terminal view does not own focused input".to_string());
    }
    let result = session
        .writer
        .lock()
        .map_err(|_| "pty writer lock is poisoned".to_string())?
        .write_all(bytes)
        .map_err(|err| err.to_string());
    result
}

#[tauri::command]
pub fn pty_claim_input(state: State<'_, PtyState>, id: i64, owner: String) -> Result<(), String> {
    state.session(id)?.input_owner.claim(&owner)
}

#[tauri::command]
pub fn pty_release_input(state: State<'_, PtyState>, id: i64, owner: String) -> Result<(), String> {
    state.session(id)?.input_owner.release(&owner)
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: i64, cols: u16, rows: u16) -> Result<(), String> {
    let session = state.session(id)?;
    let mut current_size = session
        .size
        .lock()
        .map_err(|_| "pty size lock is poisoned".to_string())?;
    if pty_grid_matches(&current_size, cols, rows) {
        return Ok(());
    }

    session
        .master
        .lock()
        .map_err(|_| "pty master lock is poisoned".to_string())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;
    *current_size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    Ok(())
}

// `async`: killing the shell's process group can block; keep it off the main
// thread so closing a terminal never freezes the UI (B-252). `pty_write` and
// `pty_resize` deliberately stay synchronous — main-thread execution is what
// guarantees keystrokes and resizes apply in arrival order.
#[tauri::command(async)]
pub fn pty_close(state: State<'_, PtyState>, id: i64) -> Result<(), String> {
    state.close(id)
}

fn pty_grid_matches(size: &PtySize, cols: u16, rows: u16) -> bool {
    size.cols == cols && size.rows == rows
}

fn append_scrollback(session: &PtySession, chunk: &[u8]) {
    let Ok(mut scrollback) = session.scrollback.lock() else {
        return;
    };
    scrollback.extend_from_slice(chunk);
    if scrollback.len() > SCROLLBACK_MAX_BYTES {
        let overflow = scrollback.len() - SCROLLBACK_MAX_BYTES;
        scrollback.drain(..overflow);
    }
}

/// Merges every chunk already queued by the reader into `batch`, up to the
/// per-event size cap, without waiting for more.
fn drain_pending_pty_data(data_rx: &std::sync::mpsc::Receiver<Vec<u8>>, batch: &mut Vec<u8>) {
    while batch.len() < DATA_EVENT_BATCH_MAX_BYTES {
        match data_rx.try_recv() {
            Ok(chunk) => batch.extend_from_slice(&chunk),
            Err(_) => break,
        }
    }
}

fn pty_data_event_name(id: i64) -> String {
    format!("pty:data:{id}")
}

fn pty_exit_event_name(id: i64) -> String {
    format!("pty:exit:{id}")
}

fn provider_from_program(program: &str) -> Option<&'static str> {
    let name = Path::new(program)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(program)
        .trim_end_matches(".exe");
    if name.eq_ignore_ascii_case("codex") {
        Some("codex")
    } else if name.eq_ignore_ascii_case("claude") {
        Some("claude")
    } else {
        None
    }
}

fn pty_env_value(env: &[(String, String)], key: &str) -> Option<String> {
    env.iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn discover_provider_session_from_output(
    app: &AppHandle,
    pty_id: i64,
    provider: &str,
    output: &str,
) {
    let Some(provider_session_id) = provider_session_id_from_pty_output(provider, output) else {
        return;
    };
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let Ok(Some(session)) =
        db.record_agent_session_provider_session_from_pty(pty_id, &provider_session_id)
    else {
        return;
    };
    emit_provider_session_discovered(app, session.todo_id);
}

fn spawn_codex_session_discovery(
    app: AppHandle,
    pty_id: i64,
    task_display_id: String,
    since: DateTime<Utc>,
) {
    let Some(index_path) = codex_session_index_path() else {
        return;
    };
    let _ = thread::Builder::new()
        .name(format!("boomerang-codex-session-discovery-{pty_id}"))
        .spawn(move || {
            // ponytail: Codex has no naming flag; match its generated thread name by task id.
            for _ in 0..60 {
                if let Some(provider_session_id) =
                    latest_codex_session_id_from_index(&index_path, &task_display_id, since)
                {
                    if let Some(db) = app.try_state::<AppDb>() {
                        if let Ok(Some(session)) = db
                            .record_agent_session_provider_session_from_pty(
                                pty_id,
                                &provider_session_id,
                            )
                        {
                            emit_provider_session_discovered(&app, session.todo_id);
                            return;
                        }
                    }
                }
                thread::sleep(StdDuration::from_millis(500));
            }
        });
}

fn emit_provider_session_discovered(app: &AppHandle, todo_id: i64) {
    let _ = app.emit(
        "todos:changed",
        json!({
            "todoId": todo_id,
            "changeType": "agent_provider_session_discovered",
        }),
    );
}

fn codex_session_index_path() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
        .map(|codex_home| codex_home.join("session_index.jsonl"))
}

fn latest_codex_session_id_from_index(
    index_path: &Path,
    task_display_id: &str,
    since: DateTime<Utc>,
) -> Option<String> {
    let mut latest: Option<(DateTime<Utc>, String)> = None;
    let file = BufReader::new(std::fs::File::open(index_path).ok()?);
    for line in file.lines().map_while(Result::ok) {
        let Some((timestamp, session_id)) = codex_index_entry(&line, task_display_id, since) else {
            continue;
        };
        if latest
            .as_ref()
            .map(|(latest_timestamp, _)| timestamp > *latest_timestamp)
            .unwrap_or(true)
        {
            latest = Some((timestamp, session_id));
        }
    }
    latest.map(|(_, session_id)| session_id)
}

fn codex_index_entry(
    line: &str,
    task_display_id: &str,
    since: DateTime<Utc>,
) -> Option<(DateTime<Utc>, String)> {
    let value: serde_json::Value = serde_json::from_str(&line).ok()?;
    let thread_name = value.get("thread_name")?.as_str()?.trim();
    if !thread_name_starts_with_task_id(thread_name, task_display_id) {
        return None;
    }
    let session_id = value.get("id")?.as_str()?.trim();
    if session_id.is_empty() {
        return None;
    }
    let timestamp = value
        .get("updated_at")?
        .as_str()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())?
        .with_timezone(&Utc);
    if timestamp < since {
        return None;
    }
    Some((timestamp, session_id.to_string()))
}

fn thread_name_starts_with_task_id(thread_name: &str, task_display_id: &str) -> bool {
    let Some(rest) = thread_name.strip_prefix(task_display_id) else {
        return false;
    };
    rest.is_empty()
        || rest
            .chars()
            .next()
            .map(|character| character.is_whitespace() || character == ':')
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::unix_process_group_signal_pid;
    use super::{
        drain_pending_pty_data, latest_codex_session_id_from_index, powershell_quote,
        pty_command_for_spawn, pty_command_for_spawn_for_platform, pty_data_event_name,
        pty_exit_event_name, pty_grid_matches, pty_host_cwd_for_spawn_for_platform,
        shell_first_launch_for_platform, spawn_environment, typed_shell_command, PtyInputOwner,
        PtySpawnSpec, TerminalLaunchPlatform, TerminalQueryFilter, DATA_EVENT_BATCH_MAX_BYTES,
        QUERY_HOLD_MAX, SCROLLBACK_MAX_BYTES,
    };
    use chrono::{TimeZone, Utc};
    use std::fs;
    use std::path::Path;

    #[test]
    fn input_owner_allows_only_the_claimed_terminal_to_write() {
        let owner = PtyInputOwner::default();

        owner.claim("window-a").unwrap();

        assert!(owner.can_write("window-a").unwrap());
        assert!(!owner.can_write("window-b").unwrap());
    }

    #[test]
    fn input_owner_release_does_not_clear_a_newer_claim() {
        let owner = PtyInputOwner::default();

        owner.claim("window-a").unwrap();
        owner.claim("window-b").unwrap();
        owner.release("window-a").unwrap();

        assert!(!owner.can_write("window-a").unwrap());
        assert!(owner.can_write("window-b").unwrap());
    }

    #[test]
    fn drain_merges_queued_chunks_into_one_batch() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        tx.send(b"beta".to_vec()).unwrap();
        tx.send(b"gamma".to_vec()).unwrap();

        let mut batch = b"alpha".to_vec();
        drain_pending_pty_data(&rx, &mut batch);

        assert_eq!(batch, b"alphabetagamma".to_vec());
    }

    #[test]
    fn drain_stops_at_the_event_size_cap() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        tx.send(vec![b'x'; 1]).unwrap();
        tx.send(vec![b'y'; 1]).unwrap();

        let mut batch = vec![b'a'; DATA_EVENT_BATCH_MAX_BYTES];
        drain_pending_pty_data(&rx, &mut batch);

        // The full batch is left for the next event instead of growing.
        assert_eq!(batch.len(), DATA_EVENT_BATCH_MAX_BYTES);
        assert_eq!(rx.try_recv().unwrap(), vec![b'x'; 1]);
    }

    #[test]
    fn drain_does_not_block_on_an_empty_queue() {
        let (_tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();

        let mut batch = b"solo".to_vec();
        drain_pending_pty_data(&rx, &mut batch);

        assert_eq!(batch, b"solo".to_vec());
    }

    #[test]
    fn pty_event_names_are_scoped_to_one_terminal() {
        assert_eq!(pty_data_event_name(42), "pty:data:42");
        assert_eq!(pty_exit_event_name(42), "pty:exit:42");
    }

    fn run_filter(filter: &mut TerminalQueryFilter, input: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        filter.process(input, &mut out, |reply| replies.push(reply.to_vec()));
        (out, replies)
    }

    #[test]
    fn startup_cursor_query_is_stripped_and_answered() {
        let mut filter = TerminalQueryFilter::default();

        let (out, replies) = run_filter(&mut filter, b"\x1b[?9001h\x1b[?1004h\x1b[6n");

        assert_eq!(replies, vec![b"\x1b[1;1R".to_vec()]);
        assert_eq!(out, b"\x1b[?9001h\x1b[?1004h");
    }

    #[test]
    fn startup_cursor_query_split_across_reads_is_answered() {
        let mut filter = TerminalQueryFilter::default();

        let (out_first, replies_first) = run_filter(&mut filter, b"\x1b[?1004h\x1b[6");
        let (out_second, replies_second) = run_filter(&mut filter, b"n\x1b[1;1H");

        assert!(replies_first.is_empty());
        assert_eq!(out_first, b"\x1b[?1004h");
        assert_eq!(replies_second, vec![b"\x1b[1;1R".to_vec()]);
        assert_eq!(out_second, b"\x1b[1;1H");
    }

    #[test]
    fn later_cursor_queries_pass_through_after_startup() {
        let mut filter = TerminalQueryFilter::default();

        let (_, first_replies) = run_filter(&mut filter, b"\x1b[6n");
        let (out, second_replies) = run_filter(&mut filter, b"prompt\x1b[6n");

        assert_eq!(first_replies, vec![b"\x1b[1;1R".to_vec()]);
        assert!(second_replies.is_empty());
        assert_eq!(out, b"prompt\x1b[6n");
    }

    #[test]
    fn cursor_query_after_startup_window_passes_through() {
        let mut filter = TerminalQueryFilter::default();
        let banner = vec![b'x'; 200];

        let (out, replies) = run_filter(&mut filter, &banner);
        let (later, later_replies) = run_filter(&mut filter, b"\x1b[6n");

        assert!(replies.is_empty());
        assert_eq!(out, banner);
        assert!(later_replies.is_empty());
        assert_eq!(later, b"\x1b[6n");
    }

    #[test]
    fn primary_device_attributes_query_is_stripped_and_answered() {
        let mut filter = TerminalQueryFilter::default();

        let (bare, bare_replies) = run_filter(&mut filter, b"\x1b[c");
        let (zero, zero_replies) = run_filter(&mut filter, b"\x1b[0c");

        assert!(bare.is_empty());
        assert_eq!(bare_replies, vec![b"\x1b[?1;2c".to_vec()]);
        assert!(zero.is_empty());
        assert_eq!(zero_replies, vec![b"\x1b[?1;2c".to_vec()]);
    }

    #[test]
    fn secondary_device_attributes_query_is_stripped_and_answered() {
        let mut filter = TerminalQueryFilter::default();

        let (out, replies) = run_filter(&mut filter, b"\x1b[>c");

        assert!(out.is_empty());
        assert_eq!(replies, vec![b"\x1b[>0;276;0c".to_vec()]);
    }

    #[test]
    fn tertiary_device_attributes_query_is_swallowed_silently() {
        let mut filter = TerminalQueryFilter::default();

        let (out, replies) = run_filter(&mut filter, b"\x1b[=c");

        assert!(out.is_empty());
        assert!(replies.is_empty());
    }

    #[test]
    fn device_attribute_query_embedded_in_output_keeps_surrounding_bytes() {
        let mut filter = TerminalQueryFilter::default();

        let (out, replies) = run_filter(&mut filter, b"pre\x1b[0cpost");

        assert_eq!(out, b"prepost");
        assert_eq!(replies, vec![b"\x1b[?1;2c".to_vec()]);
    }

    #[test]
    fn device_attribute_responses_pass_through_without_reply_loop() {
        let mut filter = TerminalQueryFilter::default();

        let (da1, da1_replies) = run_filter(&mut filter, b"\x1b[?1;2c");
        let (da2, da2_replies) = run_filter(&mut filter, b"\x1b[>0;276;0c");

        assert_eq!(da1, b"\x1b[?1;2c");
        assert!(da1_replies.is_empty());
        assert_eq!(da2, b"\x1b[>0;276;0c");
        assert!(da2_replies.is_empty());
    }

    #[test]
    fn device_attribute_query_split_across_reads_is_answered() {
        let mut filter = TerminalQueryFilter::default();

        let (out_first, replies_first) = run_filter(&mut filter, b"\x1b");
        let (out_second, replies_second) = run_filter(&mut filter, b"[");
        let (out_third, replies_third) = run_filter(&mut filter, b"c");

        assert!(out_first.is_empty() && out_second.is_empty() && out_third.is_empty());
        assert!(replies_first.is_empty() && replies_second.is_empty());
        assert_eq!(replies_third, vec![b"\x1b[?1;2c".to_vec()]);
    }

    #[test]
    fn non_query_csi_and_escape_sequences_pass_through() {
        let mut filter = TerminalQueryFilter::default();

        let (csi, csi_replies) = run_filter(&mut filter, b"\x1b[?2004h");
        let (escape, escape_replies) = run_filter(&mut filter, b"\x1bM");
        let (status, status_replies) = run_filter(&mut filter, b"\x1b[5n");

        assert_eq!(csi, b"\x1b[?2004h");
        assert!(csi_replies.is_empty());
        assert_eq!(escape, b"\x1bM");
        assert!(escape_replies.is_empty());
        assert_eq!(status, b"\x1b[5n");
        assert!(status_replies.is_empty());
    }

    #[test]
    fn runaway_csi_sequence_is_flushed_at_hold_cap() {
        let mut filter = TerminalQueryFilter::default();
        let mut input = b"\x1b[".to_vec();
        input.extend(std::iter::repeat(b'0').take(QUERY_HOLD_MAX));

        let (out, replies) = run_filter(&mut filter, &input);

        assert_eq!(out.len(), QUERY_HOLD_MAX + 2);
        assert!(replies.is_empty());
    }

    #[test]
    fn pty_grid_match_skips_same_size_resize() {
        let size = portable_pty::PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        };

        assert!(pty_grid_matches(&size, 100, 30));
    }

    #[test]
    fn pty_grid_match_detects_changed_size() {
        let size = portable_pty::PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        };

        assert!(!pty_grid_matches(&size, 120, 30));
        assert!(!pty_grid_matches(&size, 100, 40));
    }

    #[cfg(unix)]
    #[test]
    fn unix_process_group_signal_pid_targets_the_whole_group() {
        assert_eq!(unix_process_group_signal_pid(42), -42);
    }

    #[test]
    fn tmux_enabled_spawn_wraps_the_original_process() {
        let spec = PtySpawnSpec {
            program: "codex".to_string(),
            args: vec!["--yolo".to_string(), "Work".to_string()],
            cwd: "/tmp/project".to_string(),
            env: vec![],
            wsl_enabled: false,
            cols: 120,
            rows: 40,
        };

        let (program, args) = pty_command_for_spawn(&spec, true, "boomerang-pty-42");

        assert_eq!(program, "tmux");
        assert_eq!(
            args,
            vec![
                "-L",
                "boomerang",
                "new-session",
                "-A",
                "-s",
                "boomerang-pty-42",
                "-x",
                "120",
                "-y",
                "40",
                "--",
                "codex",
                "--yolo",
                "Work",
            ]
        );
    }

    #[test]
    fn windows_wsl_enabled_spawn_wraps_the_original_process() {
        let spec = PtySpawnSpec {
            program: "codex".to_string(),
            args: vec!["--yolo".to_string(), "Work".to_string()],
            cwd: "~/projects/tmatrix".to_string(),
            env: vec![],
            wsl_enabled: true,
            cols: 120,
            rows: 40,
        };

        let (program, args) = pty_command_for_spawn_for_platform(
            &spec,
            false,
            "boomerang-pty-42",
            TerminalLaunchPlatform::Windows,
        );

        assert_eq!(program, "wsl.exe");
        assert_eq!(
            args,
            vec![
                "--cd",
                "~/projects/tmatrix",
                "--",
                "codex",
                "--yolo",
                "Work",
            ]
        );
        assert_eq!(
            pty_host_cwd_for_spawn_for_platform(&spec, TerminalLaunchPlatform::Windows),
            None
        );
    }

    #[test]
    fn windows_wsl_enabled_runs_tmux_inside_wsl() {
        let spec = PtySpawnSpec {
            program: "codex".to_string(),
            args: vec!["--yolo".to_string(), "Work".to_string()],
            cwd: r"C:\Users\mark\p\tmatrix".to_string(),
            env: vec![],
            wsl_enabled: true,
            cols: 120,
            rows: 40,
        };

        let (program, args) = pty_command_for_spawn_for_platform(
            &spec,
            true,
            "boomerang-pty-42",
            TerminalLaunchPlatform::Windows,
        );

        assert_eq!(program, "wsl.exe");
        assert_eq!(
            args,
            vec![
                "--cd",
                r"C:\Users\mark\p\tmatrix",
                "--",
                "tmux",
                "-L",
                "boomerang",
                "new-session",
                "-A",
                "-s",
                "boomerang-pty-42",
                "-x",
                "120",
                "-y",
                "40",
                "--",
                "codex",
                "--yolo",
                "Work",
            ]
        );
    }

    #[test]
    fn windows_script_shim_cli_launches_shell_and_types_the_command() {
        let (program, args, typed) = shell_first_launch_for_platform(
            "codex".to_string(),
            vec![
                "--yolo".to_string(),
                "--cd".to_string(),
                r"E:\taskcooker".to_string(),
                "Work on B-1's fix".to_string(),
            ],
            Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe"),
            TerminalLaunchPlatform::Windows,
        );

        assert_eq!(program, r"C:\Program Files\PowerShell\7\pwsh.exe");
        assert_eq!(args, vec!["-NoLogo"]);
        assert_eq!(
            typed.as_deref(),
            Some(
                r"& 'codex' '--yolo' '--cd' 'E:\taskcooker' 'Work on B-1''s fix' ; exit $LASTEXITCODE"
            ),
        );
    }

    #[test]
    fn windows_exe_programs_spawn_directly_without_shell_typing() {
        let (program, args, typed) = shell_first_launch_for_platform(
            r"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe".to_string(),
            vec!["-NoLogo".to_string()],
            Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe"),
            TerminalLaunchPlatform::Windows,
        );

        assert_eq!(
            program,
            r"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe"
        );
        assert_eq!(args, vec!["-NoLogo"]);
        assert!(typed.is_none());
    }

    #[test]
    fn shell_first_launch_is_skipped_outside_windows() {
        let (program, args, typed) = shell_first_launch_for_platform(
            "codex".to_string(),
            vec!["--yolo".to_string()],
            Path::new("/bin/zsh"),
            TerminalLaunchPlatform::Unix,
        );

        assert_eq!(program, "codex");
        assert_eq!(args, vec!["--yolo"]);
        assert!(typed.is_none());
    }

    #[test]
    fn shell_first_launch_is_skipped_when_only_cmd_is_available() {
        let (program, args, typed) = shell_first_launch_for_platform(
            "codex".to_string(),
            vec!["--yolo".to_string()],
            Path::new(r"C:\Windows\System32\cmd.exe"),
            TerminalLaunchPlatform::Windows,
        );

        assert_eq!(program, "codex");
        assert_eq!(args, vec!["--yolo"]);
        assert!(typed.is_none());
    }

    #[test]
    fn typed_shell_command_keeps_multiline_prompts_literal() {
        let command = typed_shell_command(
            "claude",
            &[
                "--dangerously-skip-permissions".to_string(),
                "line one\nline \"two\" with $vars".to_string(),
            ],
        );

        assert_eq!(
            command,
            "& 'claude' '--dangerously-skip-permissions' 'line one\nline \"two\" with $vars' ; exit $LASTEXITCODE",
        );
    }

    #[test]
    fn powershell_quote_doubles_embedded_single_quotes() {
        assert_eq!(powershell_quote("it's done"), "'it''s done'");
    }

    #[test]
    fn wsl_enabled_is_ignored_outside_windows() {
        let spec = PtySpawnSpec {
            program: "codex".to_string(),
            args: vec!["--yolo".to_string(), "Work".to_string()],
            cwd: "/tmp/project".to_string(),
            env: vec![],
            wsl_enabled: true,
            cols: 120,
            rows: 40,
        };

        let (program, args) = pty_command_for_spawn_for_platform(
            &spec,
            false,
            "boomerang-pty-42",
            TerminalLaunchPlatform::Unix,
        );

        assert_eq!(program, "codex");
        assert_eq!(args, vec!["--yolo", "Work"]);
    }

    #[cfg(unix)]
    #[test]
    fn spawn_environment_adds_common_cli_path_when_path_is_missing() {
        let env = spawn_environment(&[]);
        let path = env
            .iter()
            .find_map(|(key, value)| (key == "PATH").then_some(value.as_str()))
            .expect("PATH is injected");

        assert!(path.contains("/opt/homebrew/bin"));
        assert!(path.contains("/usr/local/bin"));
        assert!(path.contains("/usr/bin"));
    }

    #[cfg(unix)]
    #[test]
    fn spawn_environment_expands_stripped_gui_app_path() {
        let env = spawn_environment(&[(
            "PATH".to_string(),
            "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
        )]);
        let path = env
            .iter()
            .find_map(|(key, value)| (key == "PATH").then_some(value.as_str()))
            .expect("PATH is preserved");

        assert!(path.starts_with("/usr/bin:/bin:/usr/sbin:/sbin"));
        assert!(path.contains("/opt/homebrew/bin"));
        assert!(path.contains("/usr/local/bin"));
    }

    // 🪟 A semicolon-separated Windows PATH must survive untouched; the Unix
    // fallback expansion splits on ':' which would corrupt drive letters.
    #[cfg(windows)]
    #[test]
    fn spawn_environment_keeps_windows_path_untouched() {
        let env = spawn_environment(&[(
            "PATH".to_string(),
            r"C:\Windows\system32;C:\Windows;C:\Program Files\Git\cmd".to_string(),
        )]);
        let path = env
            .iter()
            .find_map(|(key, value)| (key == "PATH").then_some(value.as_str()))
            .expect("PATH is preserved");

        assert_eq!(
            path,
            r"C:\Windows\system32;C:\Windows;C:\Program Files\Git\cmd"
        );
    }

    #[test]
    fn spawn_environment_adds_terminal_capability_defaults() {
        let env = spawn_environment(&[]);

        assert_eq!(env_value(&env, "TERM"), Some("xterm-256color"));
        assert_eq!(env_value(&env, "COLORTERM"), Some("truecolor"));
    }

    #[test]
    fn spawn_environment_adds_utf8_locale_default() {
        let env = spawn_environment(&[]);
        let locale = ["LC_ALL", "LC_CTYPE", "LANG"]
            .into_iter()
            .find_map(|key| env_value(&env, key))
            .expect("a UTF-8 locale is injected");

        assert!(locale.to_ascii_uppercase().contains("UTF-8"));
    }

    #[test]
    fn scrollback_cap_keeps_terminal_reattach_replay_small() {
        assert!(SCROLLBACK_MAX_BYTES <= 512 * 1024);
    }

    #[test]
    fn latest_codex_session_id_from_index_matches_task_id_prefix() {
        let temp = tempfile::tempdir().unwrap();
        let index_path = temp.path().join("session_index.jsonl");
        fs::write(
            &index_path,
            r#"{"id":"old","thread_name":"B-146 stale match","updated_at":"2026-06-23T23:59:00Z"}
{"id":"wrong","thread_name":"B-147 other task","updated_at":"2026-06-24T00:01:00Z"}
{"id":"codex-native-session","thread_name":"B-146 Managed Session","updated_at":"2026-06-24T00:02:00Z"}
"#,
        )
        .unwrap();

        assert_eq!(
            latest_codex_session_id_from_index(
                &index_path,
                "B-146",
                Utc.with_ymd_and_hms(2026, 6, 24, 0, 0, 0).unwrap(),
            ),
            Some("codex-native-session".to_string()),
        );
    }

    fn env_value<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
        env.iter()
            .find_map(|(name, value)| (name == key).then_some(value.as_str()))
    }
}
