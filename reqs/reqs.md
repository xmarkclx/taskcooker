# Product Requirements

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
