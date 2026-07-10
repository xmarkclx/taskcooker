# TaskCooker

**Stop babysitting terminals. Start shipping tasks.**

Line up the tasks. Nuke them all. Serve the masterpiece.

TaskCooker is a free, open-source desktop app for delegating work to AI agents: coding, research, writing, anything you can shape into a task. You manage tasks, subtasks, and projects with their own contexts. TaskCooker manages the agents, directories, and worktrees.

Visit the website over at taskcooker.mc-lopez.com to know more.

Built with TypeScript, React, Rust, and Tauri. Local-first: your tasks and your code stay on your machine. Works with the AI subscriptions you already pay for, like Claude Code and Codex.

Feature Discussions and Support go in [https://www.reddit.com/r/taskcooker/](https://www.reddit.com/r/taskcooker/).

## Why

> "I was running 20 to 40 terminal tabs across different worktrees. Burned out, anxious, staring blankly at the screen trying to remember where I was with each task. There had to be a better way to get things done in the agentic world."


## Development

Prerequisites:

- [Node.js](https://nodejs.org) 20 or newer
- [pnpm](https://pnpm.io) 10 (`corepack enable` picks the pinned version from `package.json`)
- [Rust](https://rustup.rs) stable toolchain
- Platform dependencies for Tauri 2: see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for macOS, Windows, and Linux

Run the app in development:

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts the Vite dev server (via `scripts/ensure-dev-server.mjs`) and launches the desktop shell with hot reload. The dev build uses its own bundle identifier (`com.marklopez.boomerangtasks.dev`), so it never touches the data of an installed production app.

Frontend-only iteration without the desktop shell:

```bash
pnpm dev
```

Checks to run before pushing:

```bash
pnpm test        # vitest suite
pnpm typecheck   # tsc --noEmit
pnpm smoke       # smoke checks
```



## Building for production

Build a release bundle for your current platform:

```bash
pnpm tauri build
```

Bundles land in `src-tauri/target/release/bundle/` (`.app`/`.dmg` on macOS, `.msi`/`.exe` on Windows, `.deb`/`.AppImage` on Linux).

On macOS there is an install helper that builds with the production identity (`TaskCooker`, `com.marklopez.boomerangtasks`), backs up the previous version, and installs to `~/Applications`:

```bash
pnpm install:app
```



## Contributing

Contributions are welcome. TaskCooker aims to include any feature, as long as it helps people get things done.
I'm also open to suggestions to make the code more maintainable, and to improve the developer experience.

Before opening a PR:

- **Review your code before you PR it.** Agent-written code is welcome here (the codebase is deliberately agent-friendly), but you are the author of record: read the diff, understand it, and stand behind it.
- Read `AGENTS.md` and the guardrails in `rules/` (architecture, frontend, backend, database, security, testing). They are the source of truth for how this codebase is built.
- Run `pnpm test` and `pnpm typecheck`, and add tests for behavior changes. Test-first is preferred.
- Keep changes focused: one concern per PR.



## Support

TaskCooker is free. If it saves your sanity, support development on [Ko-fi](https://ko-fi.com/mclopez).

## License

[MIT](LICENSE) © Mark Lopez