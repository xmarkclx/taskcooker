import type { TodoState, TodoSummary } from '../../domain/domain';
import { formatDeadlineBadge } from '../../domain/domain';

export function StateBadge({
  state,
  ageLabel,
  compact = false,
  stale,
}: {
  state: TodoSummary['state'];
  ageLabel?: string;
  compact?: boolean;
  stale?: boolean;
}) {
  let label: string = state;
  if (compact) {
    label = state.toUpperCase();
  } else if (ageLabel) {
    label = `${state} since ${ageLabel}`;
  }
  const stateClass = todoStateToneClass(state);

  return <span className={`state-badge ${stateClass} ${stale ? 'stale' : ''}`}>{label}</span>;
}

export function todoStateToneClass(state: TodoState): string {
  if (state === 'Ready to Test') {
    return 'review';
  }

  if (state === 'Needs Feedback') {
    return 'needs-feedback';
  }

  return state.toLowerCase().replace(/\s/g, '-');
}

export function TaskMetaBadge({ now, todo }: { now: Date; todo: TodoSummary }) {
  if (todo.title === 'Create project action') {
    return <span className="meta-chip">New action</span>;
  }

  const deadline = formatDeadlineBadge(todo.deadline, now);
  if (deadline) {
    return <span className={`deadline-chip ${deadline.tone}`}>{deadline.label}</span>;
  }

  return null;
}
