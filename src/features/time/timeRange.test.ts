import { describe, expect, it } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { summarizeTodoTime, type TimeRangeSelection } from './timeRange';

describe('time range summaries', () => {
  it('returns stored totals and every log for overall mode', () => {
    const todo = makeTodo({
      ownTimeSeconds: 3600,
      rolledUpTimeSeconds: 5400,
      timeLogs: [makeLog(1, date(2026, 6, 20, 9), date(2026, 6, 20, 10), 3600)],
    });

    const summary = summarizeTodoTime(todo, [todo], selection('overall'), date(2026, 6, 20, 12));

    expect(summary).toMatchObject({
      label: 'Overall',
      ownTimeSeconds: 3600,
      rolledUpTimeSeconds: 5400,
    });
    expect(summary.visibleLogs).toHaveLength(1);
  });

  it('filters own totals, rolled-up totals, and logs to today', () => {
    const child = makeTodo({
      id: 2,
      timeLogs: [makeLog(3, date(2026, 6, 20, 11), date(2026, 6, 20, 11, 15), 900)],
    });
    const todo = makeTodo({
      subtasks: [{ id: 2, displayId: 'T-2', title: 'Child', state: 'Done', done: true }],
      timeLogs: [
        makeLog(1, date(2026, 6, 19, 10), date(2026, 6, 19, 11), 3600),
        makeLog(2, date(2026, 6, 20, 9), date(2026, 6, 20, 9, 30), 1800),
      ],
    });

    const summary = summarizeTodoTime(todo, [todo, child], selection('today'), date(2026, 6, 20, 12));

    expect(summary.ownTimeSeconds).toBe(1800);
    expect(summary.rolledUpTimeSeconds).toBe(2700);
    expect(summary.visibleLogs.map((log) => log.id)).toEqual([2]);
  });

  it('supports custom date windows by prorating overlapping logs', () => {
    const todo = makeTodo({
      timeLogs: [makeLog(1, date(2026, 6, 20, 10), date(2026, 6, 20, 11), 3600)],
    });

    const summary = summarizeTodoTime(
      todo,
      [todo],
      {
        ...selection('custom'),
        endLocal: localInput(date(2026, 6, 20, 10, 45)),
        startLocal: localInput(date(2026, 6, 20, 10, 15)),
      },
      date(2026, 6, 20, 12),
    );

    expect(summary.ownTimeSeconds).toBe(1800);
    expect(summary.visibleLogs.map((log) => log.id)).toEqual([1]);
  });
});

function selection(mode: TimeRangeSelection['mode']): TimeRangeSelection {
  return {
    amount: 24,
    endLocal: '',
    mode,
    startLocal: '',
    unit: 'hours',
  };
}

function makeTodo(overrides: Partial<TodoSummary> = {}): TodoSummary {
  return {
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    activeWorkingDirectory: '~/p/tmatrix',
    id: 1,
    projectId: 1,
    displayId: 'T-1',
    title: 'Parent',
    descriptionMarkdown: '',
    state: 'Doing',
    priority: 'Medium',
    deadline: null,
    updatedAt: date(2026, 6, 20, 9).toISOString(),
    tags: [],
    ownTimeSeconds: 0,
    position: 0,
    rolledUpTimeSeconds: 0,
    stale: false,
    dependencies: [],
    subtasks: [],
    timeLogs: [],
    events: [],
    ...overrides,
    createdAt: overrides.createdAt ?? date(2026, 6, 20, 8).toISOString(),
  };
}

function makeLog(
  id: number,
  startedAt: Date,
  endedAt: Date | null,
  durationSeconds: number,
): TodoSummary['timeLogs'][number] {
  return {
    id,
    durationSeconds,
    endedAt: endedAt?.toISOString() ?? null,
    running: endedAt === null,
    source: 'manual',
    startedAt: startedAt.toISOString(),
  };
}

function date(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function localInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}
