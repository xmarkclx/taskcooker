# Debloated Route Orchestrators

Route/app shell files compose features; they do not own feature behavior.

## Rules

- Keep independent feature logic in the owning feature folder, usually under `src/features/<feature>/` or `src/features/<feature>/lib/`.
- Keep shell-only effects/helpers under `src/app/`.
- Extract large inline prop callbacks into typed prop builders near the component they feed.
- Extract reusable effects into focused effect files; the route shell should only call them.
- Do not create broad dumping-ground utility files. Name files after the behavior they own.
- If a route shell needs a table of contents to navigate, split it before adding more behavior.
