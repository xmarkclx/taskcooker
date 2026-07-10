# Database Rules

SQLite is the durable source of truth. Use migrations and typed repository/service functions for schema access.

## Schema Discipline

- All schema changes go through migrations.
- Foreign keys are enabled and tested.
- Use internal primary keys for relations and stable display IDs for humans/agents.
- Never reuse display IDs.
- Never derive the next todo sequence with `MAX(seq)+1` or `COUNT(*)+1`.

## Transactions

- Allocate display IDs by incrementing the project counter and inserting the todo in the same transaction.
- Add todo/project event rows in the same transaction as the mutation they describe.
- Dependency and subtask cycle checks must run inside the same transaction as the insert/update.
- The global running timer invariant is enforced centrally in the database/service layer.
- Project-level prompt context defaults are durable project data. Store them on `projects` and mutate them through focused backend commands, not component-local state.

## Events

- Events are first-class append-only rows in v1.
- Change events require enough `before` and `after` data to reconstruct what changed.
- State age derives from the newest `state_changed` event.
- Staleness derives from the newest inbound/activity event.

## Tests

Cover at least:

- Atomic display ID allocation.
- Todo mutation plus event append in one transaction.
- Dependency cycle rejection.
- Subtask parent cycle rejection.
- Parent delete promotion behavior.
- Single global running timer.
- Cascading delete of todo-owned data without reusing display IDs.
