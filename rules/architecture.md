# Architecture Rules

Boomerang Tasks is a local-first Tauri app with React/TypeScript frontend, Rust backend commands, SQLite persistence, app-data attachments, embedded MCP, and backend-owned PTY sessions.

## Boundaries

- SQLite is the single source of truth for durable app state.
- All durable writes go through the backend application layer.
- Tauri commands are transport adapters. Business logic belongs in Rust services/modules.
- Frontend components do not mutate durable state directly; they call typed command wrappers and let TanStack Query refresh from backend results/events.
- Backend workers, timers, MCP servers, and PTY sessions are process-level singletons owned by Rust. Multiple windows attach to them; they do not duplicate them.

## Write Flow

Every durable todo/project write should follow this order:

1. Validate input.
2. Start one transaction.
3. Apply the state change.
4. Append required event/audit rows in the same transaction.
5. Commit.
6. Emit an app-wide Tauri event for all webviews.
7. Let frontend listeners invalidate or patch TanStack Query caches.

The UI must never show a durable mutation that has not committed and produced its audit trail.

## Module Shape

- Keep modules feature-oriented: projects, todos, events, timers, actions, sessions, notes, attachments, settings, mcp.
- Each module should expose a small public service API plus tests.
- Shared domain types belong in a single domain/model module, not scattered across UI and command handlers.
- Avoid large files. If a file needs a table of contents to navigate, split it by responsibility.

