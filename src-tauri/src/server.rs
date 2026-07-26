//! HTTP server for LAN/Tailscale access (T-34), hosted by the desktop app.
//!
//! The desktop app is the only supported host (`NetworkServerState`): it
//! serves its bundled web UI, the data-plane command surface, the interactive
//! PTY/agent plane, and a `/stream` event feed on `0.0.0.0:<port>` so any
//! browser on the LAN or tailnet can run TaskCooker against this machine's
//! data. (The standalone `taskcooker-server` binary and the in-app SSH-tunnel
//! client were both removed; the loopback/no-token bind mode below survives
//! only as a transport exercised by tests.)
//!
//! Auth/transport model, by bind address:
//! - Loopback bind without a token: the low-level mode used by tests; no
//!   network auth of its own.
//! - Any bind with a token (T-34 network mode): every `/command` request must
//!   carry the bearer token; `GET /health` stays open for reachability checks.
//!   A non-loopback bind REFUSES to start without a token. Intended for
//!   trusted networks (a home LAN or a Tailscale tailnet, which encrypts
//!   transport between nodes); plain HTTP over hostile networks is not a
//!   supported deployment.
//!
//! Browser hardening: requests carrying an `Origin` header (i.e. anything a
//! browser issues cross-origin) are always rejected unless the web UI is being
//! served and the Origin is same-origin, mirroring `mcp.rs`. In no-token mode
//! the `Host` header must additionally be loopback to block DNS rebinding; in
//! token mode the token itself defeats CSRF/rebinding, because a browser
//! cannot attach the `Authorization` header cross-origin without a CORS
//! preflight we never approve.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};

use crate::commands::*;
use crate::core::{AppDb, AppSettingsSummary};
use crate::mcp::mcp_token_is_authorized;

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

/// Resolves a UI asset path (e.g. `/index.html`, `/assets/app.js`) to its
/// bytes and MIME type. Backed by a directory for the headless binary and by
/// Tauri's embedded asset resolver for the in-app host.
pub type UiAssets = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;

/// Pre-dispatch hook for commands that need the desktop app process (PTY
/// terminals, agent sessions). Returns `None` for commands it does not
/// handle, which then fall through to the pure-DB dispatch table.
pub type InteractiveDispatch =
    Arc<dyn Fn(&str, &Value) -> Option<Result<Value, String>> + Send + Sync>;

pub type EventUnsubscribe = Box<dyn FnOnce() + Send>;

/// Subscribes a callback to a named app event and returns an unsubscribe
/// handle. Backed by Tauri's event bus in the in-app host; powers the
/// `GET /stream` endpoint that replaces Tauri events for browser clients.
pub type EventSubscribe =
    Arc<dyn Fn(&str, Box<dyn Fn(String) + Send + Sync>) -> EventUnsubscribe + Send + Sync>;

/// How to bind and secure a server instance. See the module docs for the two
/// supported modes.
#[derive(Clone)]
pub struct ServeOptions {
    pub bind: IpAddr,
    pub port: u16,
    /// Bearer token required on `/command`. Mandatory for non-loopback binds.
    pub token: Option<String>,
    /// When set, GET requests serve the TaskCooker web UI so a browser on the
    /// LAN/tailnet can open the app. Requires a token (browser mode never runs
    /// open).
    pub ui: Option<UiAssets>,
    /// App-process command hook (PTY/terminal plane); in-app host only.
    pub interactive: Option<InteractiveDispatch>,
    /// App event subscription for `GET /stream`; in-app host only.
    pub subscribe: Option<EventSubscribe>,
}

impl ServeOptions {
    /// SSH-tunnel mode: loopback bind, no token (B-171 behaviour).
    pub fn loopback(port: u16) -> Self {
        Self {
            bind: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port,
            token: None,
            ui: None,
            interactive: None,
            subscribe: None,
        }
    }

    /// Network mode: bind an address reachable from the LAN/tailnet, gated by
    /// the bearer token.
    pub fn network(bind: IpAddr, port: u16, token: String) -> Self {
        Self {
            bind,
            port,
            token: Some(token),
            ui: None,
            interactive: None,
            subscribe: None,
        }
    }

    pub fn with_ui(mut self, ui: UiAssets) -> Self {
        self.ui = Some(ui);
        self
    }
}

/// Serve UI assets from a plain directory (the headless binary's `--ui` flag).
/// Rejects any path that is not a plain relative descent into the directory.
pub fn ui_assets_from_directory(dir: PathBuf) -> UiAssets {
    Arc::new(move |path: &str| {
        let relative = path.trim_start_matches('/');
        if relative.is_empty() {
            return None;
        }
        let mut safe = PathBuf::new();
        for component in Path::new(relative).components() {
            match component {
                Component::Normal(part) => safe.push(part),
                _ => return None,
            }
        }
        let full = dir.join(safe);
        let bytes = std::fs::read(&full).ok()?;
        Some((bytes, mime_for_path(&full)))
    })
}

fn mime_for_path(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// A running server with a handle so tests (and the in-app host) can stop it.
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

struct RunningNetworkServer {
    server: RunningServer,
    token: String,
    /// Windows only: mirrors this listener onto WSL2's own loopback so
    /// `localhost:<port>` works inside WSL despite its NAT network. Dropped
    /// (killed) together with the server.
    wsl_relay: Option<crate::wsl_relay::WslRelay>,
}

/// In-app host for the network server (T-34). Serves the command surface on
/// `0.0.0.0` so other devices on the LAN or a Tailscale tailnet can reach this
/// desktop app's data, gated by the app's connection token. Opens its own
/// SQLite connection to the app database (WAL keeps it consistent with the
/// desktop app's connection), mirroring how the headless binary shares a file.
pub struct NetworkServerState {
    db_path: PathBuf,
    current: Mutex<Option<RunningNetworkServer>>,
}

impl NetworkServerState {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            current: Mutex::new(None),
        }
    }

    /// Start, restart, or stop the network server to match settings. Reuses the
    /// MCP connection token, so regenerating that token must re-apply settings
    /// here to cut over running listeners. Serves the app's own bundled web UI
    /// so a browser on the LAN/tailnet can open TaskCooker directly.
    pub fn apply_settings(
        &self,
        app: &tauri::AppHandle,
        settings: &AppSettingsSummary,
    ) -> Result<(), String> {
        if !settings.network_server_enabled {
            self.stop();
            return Ok(());
        }

        let port = u16::try_from(settings.network_server_port)
            .map_err(|_| format!("invalid network server port: {}", settings.network_server_port))?;
        let token = settings.mcp_token.trim().to_string();
        if token.is_empty() {
            return Err("cannot serve on the network without a connection token".to_string());
        }
        {
            let current = self
                .current
                .lock()
                .expect("network server lock is not poisoned");
            if current
                .as_ref()
                .is_some_and(|running| running.server.port == port && running.token == token)
            {
                return Ok(());
            }
        }

        self.stop();
        let db = AppDb::open_path(&self.db_path)
            .map_err(|err| format!("cannot open database for network server: {err}"))?;
        // The resolver reads the embedded frontend bundle in production and
        // falls back to `frontendDist` (the dist/ folder) in `tauri dev`.
        let resolver = app.asset_resolver();
        let ui: UiAssets = Arc::new(move |path: &str| {
            resolver
                .get(path.to_string())
                .map(|asset| (asset.bytes, asset.mime_type))
        });
        // Terminals and agent sessions live in this process, so browser
        // clients drive them through the interactive hook and receive PTY
        // output (and board-change events) via `/stream`.
        let app_for_dispatch = app.clone();
        let interactive: InteractiveDispatch = Arc::new(move |command, args| {
            crate::commands::network_interactive_dispatch(&app_for_dispatch, command, args)
        });
        let app_for_events = app.clone();
        let subscribe: EventSubscribe = Arc::new(move |event, callback| {
            use tauri::Listener;
            let event_id = app_for_events.listen(event.to_string(), move |event| {
                callback(event.payload().to_string());
            });
            let app_for_unlisten = app_for_events.clone();
            Box::new(move || {
                use tauri::Listener;
                app_for_unlisten.unlisten(event_id);
            })
        });
        let mut options =
            ServeOptions::network(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port, token.clone())
                .with_ui(ui);
        options.interactive = Some(interactive);
        options.subscribe = Some(subscribe);
        let server = spawn(db, options)
            .map_err(|err| format!("cannot serve on network port {port}: {err}"))?;
        // Best effort: WSL2's NAT loopback cannot see this listener, so mirror
        // it inside WSL. `None` (non-Windows, WSL absent) changes nothing.
        let wsl_relay = crate::wsl_relay::spawn(port);
        *self
            .current
            .lock()
            .expect("network server lock is not poisoned") = Some(RunningNetworkServer {
            server,
            token,
            wsl_relay,
        });
        Ok(())
    }

    pub fn stop(&self) {
        let running = self
            .current
            .lock()
            .expect("network server lock is not poisoned")
            .take();
        if let Some(mut running) = running {
            running.server.stop();
            if let Some(mut relay) = running.wsl_relay.take() {
                relay.stop();
            }
        }
    }
}

/// Bind a listener per `options` (port 0 picks a free port) and serve in a
/// background thread. Returns the actual bound port. Non-loopback binds
/// without a non-empty token are refused before anything is bound.
pub fn spawn(db: AppDb, options: ServeOptions) -> std::io::Result<RunningServer> {
    let token = options
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string);
    if !options.bind.is_loopback() && token.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "a non-loopback bind address requires an access token",
        ));
    }
    if options.ui.is_some() && token.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "serving the web UI requires an access token",
        ));
    }

    let listener = TcpListener::bind((options.bind, options.port))?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let context = Arc::new(ServerContext {
        db: Arc::new(db),
        token,
        ui: options.ui,
        interactive: options.interactive,
        subscribe: options.subscribe,
        shutdown: shutdown.clone(),
    });
    let handle = thread::Builder::new()
        .name(format!("{SERVER_NAME}-{port}"))
        .spawn(move || accept_loop(listener, context))?;

    Ok(RunningServer {
        port,
        shutdown,
        handle: Some(handle),
    })
}

struct ServerContext {
    db: Arc<AppDb>,
    token: Option<String>,
    ui: Option<UiAssets>,
    interactive: Option<InteractiveDispatch>,
    subscribe: Option<EventSubscribe>,
    shutdown: Arc<AtomicBool>,
}

// One thread per connection: `/stream` connections stay open for their whole
// lifetime, so serial handling would head-of-line block every other request.
fn accept_loop(listener: TcpListener, context: Arc<ServerContext>) {
    for stream in listener.incoming() {
        if context.shutdown.load(Ordering::SeqCst) {
            return;
        }
        match stream {
            Ok(mut stream) => {
                let context = context.clone();
                let _ = thread::Builder::new()
                    .name(format!("{SERVER_NAME}-conn"))
                    .spawn(move || handle_stream(&context, &mut stream));
            }
            Err(ref err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return,
        }
    }
}

fn handle_stream(context: &ServerContext, stream: &mut TcpStream) {
    let token = context.token.as_deref();
    let ui = context.ui.as_ref();
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

    // Browser hardening (see module docs): refuse cross-origin browser
    // requests. When the web UI is served (token mode), same-origin browser
    // requests are the legitimate client and must pass; the bearer token still
    // gates every command. In tunnel mode (no token) also require a loopback
    // Host so a malicious page on the client machine cannot drive commands
    // through the forwarded port (CSRF / DNS rebinding).
    let browser_allowed = ui.is_some() && token.is_some() && origin_matches_host(&request);
    if (is_browser_request(&request) && !browser_allowed)
        || (token.is_none() && !host_is_loopback(&request))
    {
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
            if !request_is_authorized(&request, token) {
                let _ = write_json(stream, 401, json!({ "ok": false, "error": "unauthorized" }));
                return;
            }
            let response = handle_command(context, &request.body);
            let status = if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                200
            } else {
                400
            };
            let _ = write_json(stream, status, response);
        }
        ("GET", "/stream") if context.subscribe.is_some() => {
            if !request_is_authorized(&request, token) {
                let _ = write_json(stream, 401, json!({ "ok": false, "error": "unauthorized" }));
                return;
            }
            serve_event_stream(context, &request, stream);
        }
        ("GET", _) if ui.is_some() => {
            serve_ui_asset(ui.expect("ui presence checked"), &path, stream);
        }
        _ => {
            let _ = write_json(stream, 404, json!({ "ok": false, "error": "not found" }));
        }
    }
}

fn request_is_authorized(request: &HttpRequest, token: Option<&str>) -> bool {
    match token {
        None => true,
        Some(token) => {
            let header_refs = request
                .headers
                .iter()
                .map(|(name, value)| (name.as_str(), value.as_str()))
                .collect::<Vec<_>>();
            mcp_token_is_authorized(&header_refs, token)
        }
    }
}

/// Streams named app events to a browser as `text/event-stream` frames. The
/// web client reads this with `fetch` (which can attach the bearer header,
/// unlike `EventSource`). Payloads are the JSON strings Tauri events carry.
fn serve_event_stream(context: &ServerContext, request: &HttpRequest, stream: &mut TcpStream) {
    let subscribe = context
        .subscribe
        .as_ref()
        .expect("subscribe presence checked by route");
    let query = request
        .path
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or("");
    let events: Vec<String> = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("events="))
        .map(|value| {
            value
                .split(',')
                .map(percent_decode)
                .filter(|name| !name.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if events.is_empty() || events.len() > 32 {
        let _ = write_json(
            stream,
            400,
            json!({ "ok": false, "error": "stream requires 1-32 event names in ?events=" }),
        );
        return;
    }

    let (sender, receiver) = std::sync::mpsc::channel::<(String, String)>();
    let mut unsubscribes: Vec<EventUnsubscribe> = Vec::new();
    for name in &events {
        let sender = sender.clone();
        let event_name = name.clone();
        unsubscribes.push(subscribe(
            name,
            Box::new(move |payload| {
                let _ = sender.send((event_name.clone(), payload));
            }),
        ));
    }
    drop(sender);

    let header_written = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
    )
    .and_then(|()| stream.flush())
    .is_ok();
    if header_written {
        let mut last_write = std::time::Instant::now();
        loop {
            if context.shutdown.load(Ordering::SeqCst) {
                break;
            }
            match receiver.recv_timeout(Duration::from_secs(1)) {
                Ok((name, payload)) => {
                    // Payloads are serde-serialized JSON, which never contains
                    // raw newlines, so one data line per frame is safe.
                    if write!(stream, "event: {name}\ndata: {payload}\n\n")
                        .and_then(|()| stream.flush())
                        .is_err()
                    {
                        break;
                    }
                    last_write = std::time::Instant::now();
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Heartbeat keeps half-open sockets detectable and bounds
                    // how long a stream can outlive a disabled server.
                    if last_write.elapsed() >= Duration::from_secs(10) {
                        if write!(stream, ": ping\n\n")
                            .and_then(|()| stream.flush())
                            .is_err()
                        {
                            break;
                        }
                        last_write = std::time::Instant::now();
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }
    for unsubscribe in unsubscribes {
        unsubscribe();
    }
}

/// Minimal percent-decoding for event names in the `?events=` query
/// (`encodeURIComponent` encodes `:` as `%3A`).
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

/// A same-origin browser request carries an `Origin` whose host:port equals
/// the `Host` header. Cross-origin (or rebinding) requests differ and stay
/// blocked.
fn origin_matches_host(request: &HttpRequest) -> bool {
    let (Some(origin), Some(host)) = (request.header("origin"), request.header("host")) else {
        return false;
    };
    let origin_host = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or(origin)
        .trim_end_matches('/');
    origin_host.eq_ignore_ascii_case(host.trim())
}

fn serve_ui_asset(ui: &UiAssets, path: &str, stream: &mut TcpStream) {
    let lookup = if path == "/" { "/index.html" } else { path };
    let last_segment = lookup.rsplit('/').next().unwrap_or_default();
    let asset = ui(lookup).or_else(|| {
        // SPA fallback: extension-less paths are client-side routes.
        if last_segment.contains('.') {
            None
        } else {
            ui("/index.html")
        }
    });
    match asset {
        Some((bytes, mime)) => {
            // Vite content-hashes everything under /assets/, so those may cache
            // forever; index.html must always revalidate to pick up new builds.
            let cache_control = if lookup.starts_with("/assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            let _ = write_response_bytes(stream, 200, &mime, cache_control, &bytes);
        }
        None => {
            let _ = write_json(stream, 404, json!({ "ok": false, "error": "not found" }));
        }
    }
}

fn write_response_bytes(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    cache_control: &str,
    body: &[u8],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} OK\r\nContent-Type: {content_type}\r\nCache-Control: {cache_control}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
    )?;
    stream.write_all(body)
}

fn handle_command(context: &ServerContext, body: &str) -> Value {
    let db = context.db.as_ref();
    let request: Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(err) => return json!({ "ok": false, "error": format!("invalid JSON body: {err}") }),
    };
    let command = match request.get("command").and_then(Value::as_str) {
        Some(command) => command,
        None => return json!({ "ok": false, "error": "missing \"command\"" }),
    };
    let args = request.get("args").cloned().unwrap_or(Value::Null);

    // The interactive hook (in-app host: PTYs, agent sessions) gets first
    // refusal; everything else runs through the pure-DB dispatch table.
    if let Some(interactive) = context.interactive.as_ref() {
        if let Some(result) = interactive(command, &args) {
            return match result {
                Ok(data) => json!({ "ok": true, "data": data }),
                Err(error) => json!({ "ok": false, "error": error }),
            };
        }
    }

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
        "get_project_git_repository" => arm!(
            ProjectGitRepositoryCommand,
            get_project_git_repository_from_db
        ),
        "list_project_github_owners" => {
            arm_noarg!(list_project_github_owners_from_host()?)
        }
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
        401 => "Unauthorized",
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
