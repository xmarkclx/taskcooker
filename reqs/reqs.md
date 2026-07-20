# Product Requirements

## Automatic task titles

- When Codex Spark is selected, automatic and manual task title generation must invoke the configured Codex CLI on Windows even when it is installed as an npm PowerShell or command shim.
- If Codex Spark cannot generate a title, the task keeps the local first-text-line fallback title.

## Terminal input focus

- Opening a project folder from either the top bar or an execution panel must restore the active terminal's keyboard focus when the TaskCooker window returns.
- Selecting a terminal tab with the mouse, starting a terminal, or switching to a terminal created by an action must move keyboard focus into xterm rather than leaving it on the triggering control.
- When a terminal-owned TaskCooker window regains native focus, it must restore xterm focus and reclaim backend PTY input ownership before forwarding keystrokes.
- A TaskCooker window that is not natively focused must immediately release PTY input ownership and must not claim or write input solely because its webview retained an xterm `document.activeElement`.
- Terminal tabs must continue tracking native window focus while inactive so activating a tab in a background window cannot steal PTY input ownership.
- Native focus restoration must not steal focus from terminal find, editors, dialogs, or other controls unless an external action explicitly requested terminal restoration.
- If xterm's real input remains DOM-focused but local focus bookkeeping or a previous ownership claim failed, the next key must reconcile ownership instead of being silently dropped.
- Recreating a focused xterm instance for a theme or setup change must blur the obsolete input and transfer focus and ownership to the replacement instance.
- A focused terminal may retry a write once after the backend explicitly reports stale input ownership.

## WSL artifact storage

- On Windows, tasks in projects with `Run terminals in WSL` enabled must read, write, and open artifact Markdown under the default WSL distro user's home, using the same `~/AppData/Roaming/com.marklopez.boomerangtasks/artifacts/project-<id>/<display-id>.md` path given to agents.
- WSL artifact paths shown in prompts must use forward slashes so they are directly usable in Linux shells.
- Projects that do not run terminals in WSL continue storing artifacts in the host platform's app-data directory.

## Windows CLI invocation

- Invoking the Boomerang Tasks executable as a CLI from Windows or WSL must not allocate or flash a separate Windows console window, including for development builds.

## Time tracking

- Tasks and Time Logs are explicit workspace tabs. Selecting Tasks restores the normal task workspace; selecting Time Logs opens the reporting page.
- The Time Tracking page provides Today, This week, and This month filters. Week and month ranges start at the local calendar boundary and include time through today.
- Its project filter includes every nested subproject and linked project, without counting a project twice when it is reachable through multiple links.
- Task rows form a tree and show both task-only time and time rolled up from that task plus all subtasks.
- The tree hides tasks with no time in the selected range, while retaining a zero-own-time parent when a descendant has time so the hierarchy stays understandable.
- The page total counts each scoped task's own time once.
