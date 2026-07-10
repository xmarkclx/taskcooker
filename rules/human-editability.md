# Human Editability Rules

The code should be easy for a human to read, change, and debug without reverse-engineering agent output.

## Code Shape

- Prefer explicit names over clever abstractions.
- Keep public functions small and documented by tests.
- Keep comments rare but useful: explain non-obvious constraints, invariants, and security decisions.
- Avoid broad utility files that become dumping grounds.
- Keep generated or mechanical files separate from hand-edited code.

## Types And Contracts

- Model domain concepts directly: project, todo, event, message, action, session, attachment, timer.
- Use enums/unions for fixed states, priorities, runtimes, actor types, and event types.
- Normalize external input at the boundary and keep internal code strict.
- Keep frontend and backend contracts synchronized intentionally, not by copy/paste drift.

## Reviews

Before committing a slice, check:

- Could a new engineer find the owning module quickly?
- Is there one obvious place to change this behavior?
- Are tests named after product behavior rather than implementation detail?
- Are security-sensitive decisions visible in code or tests?
- Are assumptions called out instead of buried?

