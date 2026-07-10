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

## Project Actions And CLI

- Treat `.sh` and `.py` project actions as user/project code, not trusted app code.
- Run actions only from the configured actions directory after path validation.
- Pass arguments as validated argv/env values, not interpolated shell strings.
- Keep action sessions separate from AI conversations unless an action explicitly starts an AI handoff.
- Non-zero action exits remain visible and marked failed.

## Secrets

- Do not commit tokens, connection secrets, S3/R2 credentials, local app tokens, or generated MCP tokens.
- Settings may store local connection tokens, but code/docs must not hardcode real user secrets.
