//! WSL2 loopback relay for the network server (Windows only).
//!
//! WSL2's default NAT networking gives the Linux VM its own loopback, so
//! `http://localhost:<port>` inside WSL cannot reach the Windows network
//! server even though it binds `0.0.0.0`. When the network server starts, the
//! app pipes a small POSIX-sh script into `wsl.exe -e sh` that listens on
//! WSL's own `127.0.0.1:<port>` and forwards each connection to the Windows
//! host (WSL's default gateway) on the same port, so WSL processes can use
//! `localhost:<port>` like everything else. The security model is unchanged:
//! the relay is a transparent TCP forward into the token-gated server and
//! binds only WSL's loopback, widening no listen surface.
//!
//! Lifetime: the script's final `cat >/dev/null` blocks reading the child's
//! stdin, so the relay tears itself down (the trap kills the forwarder) as
//! soon as this process closes that pipe — on server stop, port change, app
//! exit, or crash. Everything is best effort: if `wsl.exe`, a default route,
//! or a forwarder tool (socat, python3) is missing, the script just exits and
//! the network server itself is unaffected.

use std::io::Write;
use std::process::{Child, Command, Stdio};

/// Same flag `task_titles.rs` uses: never flash a console window when the GUI
/// app spawns a background child.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A running `wsl.exe` relay child. Dropping it kills the Windows-side
/// process; the in-WSL forwarder additionally exits on its own when the stdin
/// pipe closes, so no orphan keeps the WSL port bound.
pub struct WslRelay {
    child: Child,
}

impl WslRelay {
    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for WslRelay {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The relay program, passed over stdin (not argv) because `wsl.exe` argument
/// re-quoting is unreliable for multi-line scripts. socat is preferred;
/// python3 (present on stock Ubuntu/Debian WSL images) is the fallback.
fn relay_script(port: u16) -> String {
    format!(
        r#"gateway="$(ip route show default 2>/dev/null | awk '{{print $3; exit}}')"
[ -n "$gateway" ] || exit 1
if command -v socat >/dev/null 2>&1; then
  socat "TCP-LISTEN:{port},bind=127.0.0.1,fork,reuseaddr" "TCP:$gateway:{port}" &
elif command -v python3 >/dev/null 2>&1; then
  TASKCOOKER_RELAY_GATEWAY="$gateway" TASKCOOKER_RELAY_PORT={port} python3 - <<'PY' &
import asyncio, os

gateway = os.environ["TASKCOOKER_RELAY_GATEWAY"]
port = int(os.environ["TASKCOOKER_RELAY_PORT"])

async def pump(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except OSError:
        pass
    try:
        writer.close()
    except OSError:
        pass

async def handle(client_reader, client_writer):
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection(gateway, port)
    except OSError:
        client_writer.close()
        return
    await asyncio.gather(
        pump(client_reader, upstream_writer),
        pump(upstream_reader, client_writer),
    )

async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", port)
    async with server:
        await server.serve_forever()

asyncio.run(main())
PY
else
  exit 1
fi
relay=$!
trap 'kill "$relay" 2>/dev/null' EXIT TERM INT
cat >/dev/null
"#
    )
}

/// Best-effort spawn of the relay for `port`. Returns `None` off Windows, when
/// WSL is not installed, or when the script cannot be delivered; callers treat
/// all of those as "no relay" and keep serving normally.
pub fn spawn(port: u16) -> Option<WslRelay> {
    if !cfg!(windows) {
        return None;
    }
    let mut command = Command::new("wsl.exe");
    command
        .args(["-e", "sh"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().ok()?;
    // Write the script but keep the pipe open: the script's trailing `cat`
    // holds the relay alive exactly as long as this handle exists.
    let delivered = child
        .stdin
        .as_mut()
        .map(|stdin| {
            stdin
                .write_all(relay_script(port).as_bytes())
                .and_then(|()| stdin.flush())
                .is_ok()
        })
        .unwrap_or(false);
    if !delivered {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }
    Some(WslRelay { child })
}

#[cfg(test)]
mod tests {
    use super::relay_script;

    #[test]
    fn relay_binds_wsl_loopback_and_forwards_to_the_windows_gateway() {
        let script = relay_script(8791);
        assert!(script.contains("TCP-LISTEN:8791,bind=127.0.0.1,fork,reuseaddr"));
        assert!(script.contains("TCP:$gateway:8791"));
        assert!(script.contains("TASKCOOKER_RELAY_PORT=8791"));
        assert!(script.contains(r#"asyncio.start_server(handle, "127.0.0.1", port)"#));
    }

    #[test]
    fn relay_refuses_to_run_without_a_gateway() {
        let script = relay_script(8790);
        assert!(script.contains(r#"[ -n "$gateway" ] || exit 1"#));
    }

    #[test]
    fn relay_tears_down_when_the_app_side_pipe_closes() {
        let script = relay_script(8790);
        assert!(script.contains("trap 'kill \"$relay\" 2>/dev/null' EXIT TERM INT"));
        assert!(script.ends_with("cat >/dev/null\n"));
    }
}
