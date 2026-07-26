# Security Rules

Boomerang Tasks is local-first, but it still exposes powerful write and process surfaces. Treat MCP, Tauri commands, project actions, CLI sessions, pasted files, and links as security-sensitive.

## Tauri/Webview

- Use Tauri capabilities with least privilege.
- Keep CSP restrictive.
- Do not load remote scripts or CDN assets in the app webview.
- Frontend filesystem or shell plugin access must be scoped and justified; prefer Rust-side controlled commands for sensitive operations.

## MCP

- Bind only to `127.0.0.1`, never `0.0.0.0`.
- Require the per-install token on every request.
- Deny browser origins with CORS; this is a local tool surface, not a browser API.
- Log every accepted write with actor/sender context.
- The server toggle must fully close the listener when disabled.

## Network Server (LAN/Tailscale)

- The MCP endpoint stays loopback-only. Direct network access goes through the
  separate command server (`server.rs`), never by widening the MCP bind.
- A non-loopback bind must refuse to start without a bearer token. `/command`
  requires the token on every request; `GET /health` may stay open for
  reachability checks.
- Cross-origin browser requests are always rejected. When the server also
  serves the web UI (token mode), same-origin browser requests (`Origin`
  matching `Host`) are the legitimate client and are allowed — the bearer
  token still gates every `/command` call, which defeats CSRF/DNS rebinding.
  The server module also retains a loopback-without-token transport mode (used
  only by tests): there any `Origin` header is rejected and the `Host` header
  must be loopback.
- Serving the web UI without a token must refuse to start; UI assets
  themselves (the app shell, no data) are served without auth, like a login
  page.
- The desktop toggle defaults to off; disabling it must fully close the
  listener. Regenerating the connection token must restart the listener so the
  old token stops working immediately.
- The WSL2 loopback relay (`wsl_relay.rs`) must stay a transparent TCP
  forward into the token-gated server: it binds only `127.0.0.1` inside WSL,
  adds no auth bypass, and must die with the app (stdin-watchdog) so no
  orphan keeps the WSL port bound.
- Intended for trusted networks (home LAN, Tailscale tailnet — Tailscale
  encrypts transport between nodes). Plain HTTP across untrusted networks is
  not a supported deployment.

## Project Actions And CLI

- Treat `.sh` and `.py` project actions as user/project code, not trusted app code.
- Run actions only from the configured actions directory after path validation.
- Pass arguments as validated argv/env values, not interpolated shell strings.
- Keep action sessions separate from AI conversations unless an action explicitly starts an AI handoff.
- Non-zero action exits remain visible and marked failed.

## Secrets

- Do not commit tokens, connection secrets, S3/R2 credentials, local app tokens, or generated MCP tokens.
- Settings may store local connection tokens, but code/docs must not hardcode real user secrets.
