# Boomerang Tasks Agent Guide

This repo is a local-first Tauri desktop app for managing projects, todos, delegated AI work, project actions, notes, messages, timers, and review state.

Before changing code, read:

- `rules/evidence-first-codegen.md`
- `rules/architecture.md`
- `rules/frontend.md`
- `rules/backend-tauri-rust.md`
- `rules/database.md`
- `rules/security.md`
- `rules/testing.md`
- `rules/human-editability.md`

## Working Rules

- Keep code clean, typed, small, and easy for humans to edit.
- Treat the requirements as product truth. If requirements conflict with code, update the code or call out the conflict.
- Keep `reqs/reqs.md` current as product decisions are clarified during implementation; do not leave newly discovered requirements only in chat or code.
- Never reinstall, replace, relaunch, quit, or otherwise disturb the installed/running app unless Mark explicitly asks for that exact operation in the current turn. Mark may have important work running in app-owned processes.
- Do not invent package APIs, Tauri permissions, schema fields, command names, query keys, or design tokens. Verify them from local files, type definitions, existing examples, or official documentation.
- When unsure, inspect examples in this repo first. If no local example exists, check official documentation.
- If a decision cannot be verified, record it in the final response under `WARNING: ASSUMPTIONS`.
- Prefer test-first implementation for behavior. Watch the test fail for the expected reason before writing production code.
- Use Jotai for app-shell local UI state that would otherwise cause prop drilling
  (dialogs, filters, toasts, panel visibility). Keep durable backend state in
  TanStack Query/Tauri/SQLite, not atoms.

## Project Structure
Implementation docs and guardrails live in `rules/`.

## UI Standards (Dropdowns, Menus, Color Theming)

These rules make every screen look correct in both Wood Light and Wood Dark.
`rules/frontend.md` is the source of truth; this section records concrete
conventions enforced so far.

### Color theming

- Never hard-code hex/`rgb()` colors in component CSS. Use a CSS variable
  token (`var(--color-*)`, `var(--state-*-*)`, `var(--surface*)`, etc.).
  Hard-coded light values (e.g. `#fff8ec`, `#e6f2ec`) render wrong in dark
  mode because they don't pick up the dark token overrides.
- State surfaces/borders MUST have dark variants. The `--state-*-surface`,
  `--state-*-border`, and `--state-*-dark` tokens are overridden in the
  `[data-theme='dark']` block; reuse them for any status badge/chip/card
  (`.state-badge`, `.directory-status`, `.deadline-chip`, status cards).
- Menus/popovers use `var(--color-menu)` (light: surface, dark: `#211812`)
  plus `rgb(var(--color-shadow-rgb) / N%)` for shadows — never a literal
  `rgb(48 35 24 / …)`.
- Use named theme tokens directly for foreground/background pairs; pick a
  pair that is designed to contrast in BOTH themes (e.g. `--color-primary`
  with `--color-primary-contrast`, or a `--*-background` with its matching
  foreground). Do NOT derive colors with `color-mix()` that blends a
  fixed-hue token against a theme-flipping one like `--color-text-strong` —
  the mix inverts lightness between themes and silently kills contrast in
  one of them (this is what broke the action icon/run-button contrast).
- Default brand/action accent is the primary brown (`--color-primary`), not
  green. Reserve `--color-success`/green for genuine success/positive state.
- A new bespoke class is acceptable only if no shared class fits. Prefer
  folding new UI into the shared classes below instead of minting
  `.feature-name-*` duplicates.
- As much as possible, prefer Tailwind only from here on out, and convert classes to Tailwind as you go.

### Reusable controls (`src/ui/`)

Pick the control by option count and behavior:

- **2–4 fixed options, no typing** → `AppSegmentedControl` (`SegmentedControl.tsx`):
  ARIA `radiogroup`, `.segment` class. Use for theme pickers and other
  few-choice toggles. Do NOT use a dropdown for this.
- **Many options, read-only selection** → `AppSelect` (`Select.tsx`): renders a
  native `<select class="app-select">`. The `.app-select` class shares the
  `.form-field select` base style. Use inside `.form-field`, `.select-add-control`,
  or `.custom-time-range` (those wrappers already override `.app-select` for
  their compact layouts). Pass options via the `options` prop.
- **Typeable/filterable list** → the `ClientCombobox` pattern in
  `ProjectSettingsDialog.tsx` (input + ARIA listbox + keyboard nav). If this
  pattern is reused in a 3rd place, extract it to `src/ui/`.
- **Popover menu (trigger button + list of `menuitem` rows)** → the
  `.actions-menu` pattern in `TopBar.tsx`. Uses `var(--color-menu)` and shared
  `.actions-menu-row` styling; already dark-aware.

### Shared dialog/form classes (prefer over bespoke classes)

- `.dialog-backdrop` / `.dialog-panel` — shell for every modal.
- `.dialog-header` + `h2`/`p` + `.dialog-form` + `.dialog-actions` — standard
  modal layout. `.dialog-actions` is the flex footer for Cancel/Save buttons.
- `.form-field` — label (`<span>`) + control, with `.form-field-label-row`,
  `.form-field-required`, `.form-field-hint` for the row label, "Required"
  marker, and helper text respectively.
- `.form-grid` — two-column field grid (label + value).
- `.directory-status` (`.exists`/`.missing`) — reusable status pill using
  state tokens.

### When adding a new modal

Use `.dialog-header`/`.dialog-form`/`.form-field`/`.form-grid`/`.dialog-actions`.
Do not create `.new-foo-dialog`/`.new-foo-field` bespoke duplicates with
hard-coded colors — they break dark mode and drift from the design system.

# Prompts
Don't add tests to prompts as we want them to be easily changeable and adjusted as needed.
