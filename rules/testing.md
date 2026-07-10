# Testing Rules

Use tests to pin behavior before implementation. Prefer small, behavior-focused tests over broad snapshots.

## Test First

- Write the failing test first for new behavior.
- Run it and confirm it fails for the expected reason.
- Write the smallest implementation that passes.
- Run the test again and keep the output clean.

## Backend Coverage

- Unit-test validation, state resolution, ID allocation, graph cycle checks, prompt assembly, action metadata parsing, path normalization, and timer rules.
- Integration-test SQLite migrations and write/event transaction behavior.
- Test MCP auth, loopback binding configuration, CORS rejection, and write logging.

## Frontend Coverage

- Test route/search state parsing.
- Test query key factories and event-driven invalidation.
- Test list sorting, Review grouping, due/stale badges, and state normalization.
- Test dirty editor conflict behavior.
- Test form validation for settings/action args.

## Verification Commands

Once the scaffold exists, keep these commands working:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `cargo test` from `src-tauri`

If a command cannot run, report why.

