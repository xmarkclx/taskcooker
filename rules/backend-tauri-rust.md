# Backend Tauri/Rust Rules

The Rust side owns persistence, validation, process/session registries, MCP, filesystem writes, PTYs, timers, and app-wide events.

## Tauri Commands

- Commands should deserialize inputs, call services, map errors, and return typed DTOs.
- Do not put business rules directly inside command handlers.
- Prefer explicit command DTOs over loosely typed JSON.
- Every command that mutates durable state must use the central write/event service.

## Events

- Emit backend events only after the database commit succeeds.
- Use global events for cross-window invalidation.
- Keep event payloads small: IDs, changed entity type, and invalidation scope. Large data should be refetched through typed commands.

## Process Ownership

- PTY sessions for Claude, Codex, and project actions are backend-owned.
- Detached terminal windows attach to existing sessions; they must not spawn duplicate processes.
- Keep a backend registry for PTY IDs, subscribers, recent scrollback, process state, and focused input owner.

## Filesystem

- Attachments are saved under the app data directory, not project working directories by default.
- Validate and normalize paths before use.
- Reject action filenames containing separators, traversal, hidden-file names, or unsupported extensions.
- Store Markdown image references with the `~` home alias required by the product spec.

