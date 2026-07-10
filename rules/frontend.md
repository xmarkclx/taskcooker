# Frontend Rules

Use React + TypeScript with Tailwind, shadcn/ui primitives, TanStack Router, TanStack Query, Jotai, TanStack Form, TanStack Virtual, Motion for React, Tiptap, and xterm where required by `reqs/reqs.md`.

## State Ownership

- TanStack Router owns route, selected project/task, and shareable/search-param state.
- TanStack Query owns backend/server state from Tauri commands, MCP status, projects, todos, messages, action discovery, sessions, and settings.
- Jotai owns per-window UI state such as panel visibility, editor mode, transient composer state, and local layout preferences.
- TanStack Form owns form state for settings, metadata edits, action arguments, and preflight inputs.
- Do not store durable backend state in Jotai or component-local state except as temporary dirty editor buffers.

## Multi-Window UI

- Assume more than one webview exists.
- Local UI state is per-window unless the requirement says it is global.
- Listen for backend app-wide events and invalidate query keys from a central event bridge.
- Dirty Markdown editors must detect external changes and offer reload/keep-local behavior instead of overwriting user text.

## Design System

- Match Paper designs and the `Style Guide - Wood Light` tokens. Wood Dark is reference-only for now; force light mode and do not expose a theme switcher until dark mode is redesigned.
- Define reusable colors as named CSS variables first: palette tokens, then semantic aliases such as `--color-primary`, `--color-surface`, `--color-danger`, and feature tokens such as `--terminal-*`. Avoid adding hard-coded colors directly in component styles when a token would make the intent clearer.
- Terminal styling must use `--terminal-font-family`, `--terminal-*` color variables, the shared mono/Nerd Font stack, and xterm contrast enforcement so CLI glyphs and ANSI foreground/background pairs stay readable. Do not vendor terminal fonts unless the source release is pinned and complete third-party license notices are included.
- Use shadcn/ui primitives and lucide icons where appropriate.
- Do not copy/paste repeated controls. If buttons, inputs, badges, menu rows, editor toolbar controls, terminal actions, or task-row affordances share the same visual style or behavior, extract a reusable component with clear props and reuse it.
- Keep reusable components close to their design-system role. Generic controls belong under `src/ui/`; feature-specific composites belong with the feature module that owns the behavior.
- Keep operational UI dense, calm, and task-first.
- Do not put marketing tagline text in the main app chrome.
- Avoid decorative cards, nested cards, and purely ornamental gradients.

## Performance

- Use TanStack Virtual for long non-DnD lists such as messages, logs, terminal output lists, and action/session histories when DOM size can grow.
- Do not virtualize the primary drag-and-drop task list. Its tree DnD behavior depends on the full row set being mounted; fix responsiveness there by reducing row work, narrowing updates, memoizing expensive row calculations, or moving non-UI work off the main thread.
- Use stable query keys and narrow subscriptions to avoid repainting whole panes.
- Keep editor and terminal surfaces resizable without layout shifts.
- Persist global layout preferences such as the task-list width in SQLite app settings when the product requires them to survive across windows/restarts.
- Keep production slowdown profiling disableable from App Settings. Profiler records must avoid user-entered text and should identify window/surface/route enough to debug terminal typing delay, repeated effects, component lifetime leaks, and multi-window render storms.
