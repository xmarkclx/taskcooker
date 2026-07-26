# Product Requirements

## Network serving (LAN/Tailscale)

- The desktop app is the only network host: Settings → "Serve on network
  (LAN/Tailscale)" binds `0.0.0.0` on the configured port (default 8790) and
  serves the app's bundled web UI plus the command API. There is no separate
  headless server binary, and no additional serving modes.
- When serving is enabled, the settings dialog lists the concrete
  `http://<address>:<port>` URLs (primary LAN address first, plus other
  LAN/Tailscale addresses) so the user can open TaskCooker from another
  device without hunting for an IP.
- Opening `http://<host>:<port>` in a browser shows a token gate; after
  pasting the connection token (or arriving via `?token=…`), the full
  TaskCooker board runs against the server's real data over HTTP. Board
  changes arrive live over the server's `/stream` event connection (with
  polling as a fallback).
- Terminals work in the browser: PTY output streams over `/stream`, and
  keystrokes/resize/scrollback go through the command endpoint into the
  app's PTY registry. Starting/stopping agent sessions and execution
  terminals from the browser drives the desktop app's real terminals. Native
  dialogs and local file opening remain Tauri-only and fail gracefully in
  the browser.
- A browser page served this way must never fall back to the preview seed
  data; transient network errors surface as errors.
- Non-loopback serving always requires the connection token as
  `Authorization: Bearer <token>` on `/command`; `GET /health` stays open so
  reachability can be checked without the token.
- The desktop network server reuses the MCP connection token; regenerating the
  token restarts the network listener so the old token stops working.
- On Windows with WSL2 (NAT networking), the app also mirrors the listener
  onto WSL's own loopback: while the network server runs, a relay inside WSL
  listens on `127.0.0.1:<port>` and forwards to the Windows host, so
  `http://localhost:<port>` works from WSL as well. This is best effort
  (needs `wsl.exe` plus socat or python3 in the distro), still requires the
  connection token, and stops together with the server.
- The MCP endpoint itself remains bound to `127.0.0.1` (unchanged).

## Task title generation

- Task title generation runs in the background and must not open a visible
  terminal or console window.
- On Windows, Codex script shims may be invoked through PowerShell, but that
  child process must be created without a console window.

## Agent Boomerang updates

- Agent prompts must use the token-authenticated loopback HTTP/MCP endpoint for
  task reads, state changes, and messages. They must not launch the TaskCooker
  desktop executable as a CLI client for these operations.
- The endpoint remains bound to `127.0.0.1` and is exposed to agent sessions
  through `BOOMERANG_MCP_URL`, `BOOMERANG_MCP_PORT`, and
  `BOOMERANG_MCP_TOKEN`.
- Starting an AI agent while the MCP server is disabled must fail with a clear
  instruction to enable it; the security-sensitive server toggle must continue
  to close the listener fully.
- Direct API request examples must work in both native Windows and WSL. Windows
  hosts use `curl.exe` in both modes: this avoids PowerShell's `curl` alias and
  lets WSL NAT reach the Windows loopback listener without broadening its bind
  address. Non-Windows hosts use `curl`.
