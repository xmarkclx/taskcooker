# Evidence-First Code Generation

Agents must reduce hallucination by making every implementation decision traceable to evidence.

## Hard Rules

- Inspect the repo before creating patterns.
- Check actual dependency versions in `package.json`, lockfiles, `Cargo.toml`, and generated types before using an API.
- Use official documentation for version-sensitive behavior when local evidence is missing.
- Do not invent imports, component names, Tauri commands, Tauri capabilities, plugin scopes, database columns, enum values, query keys, route names, or CLI flags.
- Do not claim something works unless the verification command actually ran and passed.
- Do not hide uncertainty. If a claim cannot be verified, label it in the final response as `WARNING: ASSUMPTIONS`.

## Required Verification Points

- New npm/Rust APIs: verify against installed package types, package docs, or official docs.
- Tauri permissions/capabilities/CSP: verify against Tauri v2 docs or generated schemas.
- SQLite schema and migrations: verify with tests or a real migration run.
- Cross-window sync: verify with backend event emission and frontend invalidation tests or browser checks.
- Security-sensitive surfaces: verify token checks, path validation, CORS behavior, and command execution boundaries with tests.
- UI from Paper: inspect Paper nodes/tokens before recreating layout or colors.

## Preferred Patterns

- Centralize Tauri command names and query keys in typed helpers.
- Use Rust DTOs and TypeScript types generated or mirrored from one documented contract.
- Keep schema changes migration-owned; no ad hoc table creation in feature code.
- Prefer narrow adapters around external tools such as Claude, Codex, MCP, shell scripts, and xterm.
- Use small tests that prove behavior instead of large snapshots that only prove markup.

