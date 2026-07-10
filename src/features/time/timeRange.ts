import type { TodoSummary } from '../../domain/domain';

export type TimeRangeMode = 'today' | 'overall' | 'custom';
export type CustomTimeRangeUnit = 'hours' | 'days';

export type TimeRangeSelection = {
  amount: number;
  endLocal: string;
  mode: TimeRangeMode;
  startLocal: string;
  unit: CustomTimeRangeUnit;
};

export type TimeSummary = {
  label: string;
  ownTimeSeconds: number;
  rolledUpTimeSeconds: number;
  visibleLogs: TodoSummary['timeLogs'];
};

type TimeBounds = {
  endMs: number;
  label: string;
  startMs: number;
};

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

export function summarizeTodoTime(
  todo: TodoSummary,
  allTodos: TodoSummary[],
  selection: TimeRangeSelection,
  now: Date,
): TimeSummary {
  if (selection.mode === 'overall') {
    return {
      label: 'Overall',
      ownTimeSeconds: todo.ownTimeSeconds,
      rolledUpTimeSeconds: todo.rolledUpTimeSeconds,
      visibleLogs: todo.timeLogs,
    };
  }

  const bounds = timeRangeBounds(selection, now);
  const ownTimeSeconds = sumLogsInRange(todo.timeLogs, bounds, now);

  return {
    label: bounds.label,
    ownTimeSeconds,
    rolledUpTimeSeconds:
      ownTimeSeconds + sumDescendantLogsInRange(todo, allTodos, bounds, now),
    visibleLogs: todo.timeLogs.filter((log) => logOverlapSeconds(log, bounds, now) > 0),
  };
}

export function timeRangeBounds(
  selection: TimeRangeSelection,
  now: Date,
): TimeBounds {
  if (selection.mode === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      endMs: now.getTime(),
      label: 'Today',
      startMs: start.getTime(),
    };
  }

  if (selection.mode === 'overall') {
    return {
      endMs: Number.POSITIVE_INFINITY,
      label: 'Overall',
      startMs: Number.NEGATIVE_INFINITY,
    };
  }

  const startDate = parseLocalDateTime(selection.startLocal);
  const endDate = parseLocalDateTime(selection.endLocal);
  if (startDate || endDate) {
    return {
      endMs: endDate?.getTime() ?? now.getTime(),
      label: 'Custom',
      startMs: startDate?.getTime() ?? Number.NEGATIVE_INFINITY,
    };
  }

  const amount = Number.isFinite(selection.amount) && selection.amount > 0
    ? selection.amount
    : 24;
  const unitMs = selection.unit === 'days' ? DAY_MS : HOUR_MS;
  return {
    endMs: now.getTime(),
    label: `Last ${formatAmount(amount)} ${selection.unit}`,
    startMs: now.getTime() - amount * unitMs,
  };
}

function sumDescendantLogsInRange(
  todo: TodoSummary,
  allTodos: TodoSummary[],
  bounds: TimeBounds,
  now: Date,
  visited = new Set<number>(),
): number {
  if (visited.has(todo.id)) {
    return 0;
  }

  visited.add(todo.id);
  return todo.subtasks.reduce((total, subtask) => {
    const child = allTodos.find((item) => item.id === subtask.id);
    if (!child) {
      return total;
    }

    return (
      total +
      sumLogsInRange(child.timeLogs, bounds, now) +
      sumDescendantLogsInRange(child, allTodos, bounds, now, visited)
    );
  }, 0);
}

function sumLogsInRange(
  logs: TodoSummary['timeLogs'],
  bounds: TimeBounds,
  now: Date,
): number {
  return logs.reduce((total, log) => total + logOverlapSeconds(log, bounds, now), 0);
}

function logOverlapSeconds(
  log: TodoSummary['timeLogs'][number],
  bounds: TimeBounds,
  now: Date,
): number {
  const startMs = new Date(log.startedAt).getTime();
  if (!Number.isFinite(startMs)) {
    return 0;
  }

  const endMs = logEndMs(log, startMs, now);
  const overlapMs = Math.min(endMs, bounds.endMs) - Math.max(startMs, bounds.startMs);
  if (overlapMs <= 0) {
    return 0;
  }

  const logMs = Math.max(SECOND_MS, endMs - startMs);
  return Math.round(log.durationSeconds * (overlapMs / logMs));
}

function logEndMs(
  log: TodoSummary['timeLogs'][number],
  startMs: number,
  now: Date,
): number {
  if (log.running && !log.endedAt) {
    return Math.max(startMs, now.getTime());
  }

  if (log.endedAt) {
    const endedAtMs = new Date(log.endedAt).getTime();
    if (Number.isFinite(endedAtMs)) {
      return Math.max(startMs, endedAtMs);
    }
  }

  return startMs + log.durationSeconds * SECOND_MS;
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
