import { Play, Square } from 'lucide-react';

import type { TodoPriority } from '../../domain/domain';

type TaskTimerButtonLocation = 'header' | 'list';

export function TaskTimerButton({
  displayId,
  isRunning,
  location,
  onStart,
  onStop,
  priority,
}: {
  displayId: string;
  isRunning: boolean;
  location: TaskTimerButtonLocation;
  onStart: () => void;
  onStop: () => void;
  priority?: TodoPriority;
}) {
  const locationLabel = location === 'header' ? 'in header' : 'from task list';
  const actionLabel = isRunning ? 'Stop timer' : 'Start timer';
  const locationClass =
    location === 'header' ? 'task-header-timer-button' : 'task-title-timer-button';
  const priorityClass = priority ? `priority-${priority.toLowerCase()}` : '';

  return (
    <button
      aria-label={`${actionLabel} ${locationLabel} for ${displayId}`}
      className={`task-timer-button ${locationClass} ${priorityClass} ${
        isRunning ? 'running' : ''
      }`}
      onClick={isRunning ? onStop : onStart}
      title={actionLabel}
      type="button"
    >
      {isRunning ? (
        <Square fill="currentColor" size={13} />
      ) : (
        <Play fill="currentColor" size={13} />
      )}
    </button>
  );
}
