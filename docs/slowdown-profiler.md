# Slowdown Profiler

Boomerang ships a lightweight production profiler for diagnosing UI slowdown after the app has been running for a while.

## Setting

- Default: enabled.
- Disable: open App Settings with `Cmd+,`, uncheck **Enable slowdown profiler**, then save.
- Scope: global app setting in SQLite, so all windows follow the same setting after settings sync.

## What It Records

Records are JSONL objects. The profiler intentionally does not record typed text.

- `browser-long-task`: browser long-task entries when the WebView supports them.
- `event-loop-lag`: main-thread timer drift over the threshold.
- `input-delay`: delay from keyboard/pointer/input event to the next animation frame. The record includes a surface such as `terminal`, `markdown`, `task-list`, or `form-input`, and key type only (`character`, `Enter`, `Backspace`, etc.).
- `render-storm`: a watched React surface rendered many times in a short window.
- `component-mounted` / `component-unmounted`: watched expensive surfaces mounted or unmounted.
- `terminal-*`: terminal attach/detach, resize sync, and PTY output burst records.

Each record may include `windowLabel` and `route` so multi-window issues can be separated.

Watched surfaces include:

- `app`
- `task-detail`
- `execution-panel`
- `markdown-editor`
- `terminal-surface`
- `detached-terminal-window`

## Log Files

Logs live under the Tauri app data directory:

```text
<AppData>/logs/slowdown-profile.jsonl
<AppData>/logs/slowdown-profile.previous.jsonl
```

Each file is capped at about 100 MB. When the current log would exceed 100 MB, Boomerang deletes the older previous log, moves the current log to `slowdown-profile.previous.jsonl`, and starts a fresh current log. Total profiler storage is about 200 MB.

On macOS, locate the current files with:

```bash
find "$HOME/Library/Application Support" -path '*boomerangtasks*/logs/slowdown-profile*.jsonl' -print
```

## Reading A Slow Log

Useful first checks:

```bash
tail -n 200 "$LOG"
rg '"surface":"terminal"|"kind":"render-storm"|"kind":"event-loop-lag"' "$LOG"
```

If terminal typing slows down, look for `input-delay` records with `surface: "terminal"` and nearby `terminal-output-burst`, `terminal-resize-sync`, or `render-storm` records from the same `windowLabel`.
