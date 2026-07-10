use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

#[derive(Default)]
pub struct RemoteTunnelState {
    child: Mutex<Option<Child>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInvokeCommand {
    pub base_url: String,
    pub command: String,
    pub args: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRemoteTunnelCommand {
    pub ssh_host: String,
    pub server_port: u16,
    pub local_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTunnelSummary {
    pub base_url: String,
    pub local_port: u16,
    pub server_port: u16,
    pub ssh_host: String,
}

#[tauri::command]
pub fn remote_invoke(input: RemoteInvokeCommand) -> Result<Value, String> {
    invoke_remote_command(&input.base_url, &input.command, input.args)
}

#[tauri::command]
pub fn start_remote_tunnel(
    state: State<'_, RemoteTunnelState>,
    input: StartRemoteTunnelCommand,
) -> Result<RemoteTunnelSummary, String> {
    let ssh_host = required_text("SSH host", &input.ssh_host)?;
    let local_port = input.local_port.unwrap_or(find_free_loopback_port()?);
    let mut child = Command::new("ssh")
        .args([
            "-N",
            "-o",
            "ExitOnForwardFailure=yes",
            "-L",
            &format!("{local_port}:127.0.0.1:{}", input.server_port),
            &ssh_host,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("cannot start SSH tunnel: {err}"))?;

    let mut current = state
        .child
        .lock()
        .map_err(|_| "remote tunnel lock poisoned")?;
    if let Some(mut previous) = current.take() {
        let _ = previous.kill();
        let _ = previous.wait();
    }
    if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
        return Err(format!("SSH tunnel exited immediately: {status}"));
    }
    *current = Some(child);

    Ok(RemoteTunnelSummary {
        base_url: format!("http://127.0.0.1:{local_port}"),
        local_port,
        server_port: input.server_port,
        ssh_host,
    })
}

#[tauri::command]
pub fn stop_remote_tunnel(state: State<'_, RemoteTunnelState>) -> Result<(), String> {
    let mut current = state
        .child
        .lock()
        .map_err(|_| "remote tunnel lock poisoned")?;
    if let Some(mut child) = current.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

pub fn invoke_remote_command(
    base_url: &str,
    command: &str,
    args: Option<Value>,
) -> Result<Value, String> {
    let endpoint = parse_loopback_base_url(base_url)?;
    let body = match args {
        Some(args) => json!({ "command": command, "args": args }).to_string(),
        None => json!({ "command": command }).to_string(),
    };
    let mut stream = TcpStream::connect(("127.0.0.1", endpoint.port))
        .map_err(|err| format!("cannot connect to remote TaskCooker server: {err}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|err| err.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|err| err.to_string())?;
    write!(
        stream,
        "POST /command HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        endpoint.port,
        body.len(),
        body
    )
    .map_err(|err| err.to_string())?;

    let response = read_http_response(&mut stream)?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "remote command failed".to_string()));
    }
    Ok(response.data.unwrap_or(Value::Null))
}

struct LoopbackEndpoint {
    port: u16,
}

fn parse_loopback_base_url(base_url: &str) -> Result<LoopbackEndpoint, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let host_port = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| "remote base URL must start with http://".to_string())?;
    let (host, port) = host_port
        .rsplit_once(':')
        .ok_or_else(|| "remote base URL must include a port".to_string())?;
    if host != "127.0.0.1" && !host.eq_ignore_ascii_case("localhost") {
        return Err("remote base URL must be loopback".to_string());
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| "remote base URL port is invalid".to_string())?;
    Ok(LoopbackEndpoint { port })
}

#[derive(Deserialize)]
struct RemoteCommandResponse {
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
}

fn read_http_response(stream: &mut TcpStream) -> Result<RemoteCommandResponse, String> {
    let mut reader = BufReader::new(stream);
    let mut status = String::new();
    reader
        .read_line(&mut status)
        .map_err(|err| err.to_string())?;
    let status_code = status
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    let mut content_length = None;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|err| err.to_string())?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let mut body = String::new();
    if let Some(length) = content_length {
        let mut bytes = vec![0; length];
        reader
            .read_exact(&mut bytes)
            .map_err(|err| err.to_string())?;
        body = String::from_utf8(bytes).map_err(|err| err.to_string())?;
    } else {
        reader
            .read_to_string(&mut body)
            .map_err(|err| err.to_string())?;
    }
    let response: RemoteCommandResponse =
        serde_json::from_str(&body).map_err(|err| format!("invalid remote response: {err}"))?;
    if status_code >= 500 {
        return Err(response
            .error
            .unwrap_or_else(|| format!("remote server returned HTTP {status_code}")));
    }
    Ok(response)
}

fn find_free_loopback_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|err| format!("cannot allocate local tunnel port: {err}"))
}

fn required_text(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    Ok(trimmed.to_string())
}
