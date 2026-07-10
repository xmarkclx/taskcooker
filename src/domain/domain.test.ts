import { describe, expect, it } from 'vitest';

import {
  TODO_STATES,
  compareTodos,
  formatDeadlineBadge,
  formatDuration,
  isReviewState,
  normalizeTodoState,
} from './domain';

describe('todo domain helpers', () => {
  it('normalizes externally supplied state labels leniently without inventing states', () => {
    expect(normalizeTodoState('READY_TO_TEST')).toBe('Ready to Test');
    expect(normalizeTodoState('needs-feedback')).toBe('Needs Feedback');
    expect(normalizeTodoState('icebox')).toBe('Icebox');
    expect(normalizeTodoState('delegated')).toBe('Delegated');
    expect(normalizeTodoState('inbox')).toBeNull();
    expect(normalizeTodoState('ready for review')).toBeNull();
    expect(TODO_STATES).toContain('Icebox');
    expect(TODO_STATES).not.toContain('Inbox');
    expect(TODO_STATES).toContain('Archived');
  });

  it('treats Ready to Test and Needs Feedback as the Review group', () => {
    expect(isReviewState('Ready to Test')).toBe(true);
    expect(isReviewState('Needs Feedback')).toBe(true);
    expect(isReviewState('Waiting')).toBe(false);
  });

  it('formats durations as hh:mm:ss for timers and rolled-up totals', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(12 * 60 + 44)).toBe('00:12:44');
    expect(formatDuration(25 * 60 * 60 + 2)).toBe('25:00:02');
  });

  it('formats deadline urgency using tighter granularity near the deadline', () => {
    const now = new Date('2026-06-20T10:00:00Z');

    expect(formatDeadlineBadge('2026-06-20T18:40:00Z', now)).toEqual({
      label: 'Due in 8h 40m',
      tone: 'soon',
    });
    expect(formatDeadlineBadge('2026-06-18T10:00:00Z', now)).toEqual({
      label: 'Overdue 2d',
      tone: 'overdue',
    });
    expect(formatDeadlineBadge(null, now)).toBeNull();
  });

  it('sorts Review tasks first, then priority, then earliest deadline', () => {
    const sorted = [
      { id: 'a', state: 'Doing', priority: 'Urgent', deadline: '2026-06-20T12:00:00Z', updatedAt: '2026-06-20T09:00:00Z' },
      { id: 'b', state: 'Needs Feedback', priority: 'Low', deadline: null, updatedAt: '2026-06-20T09:00:00Z' },
      { id: 'c', state: 'To Do', priority: 'High', deadline: '2026-06-20T11:00:00Z', updatedAt: '2026-06-20T09:00:00Z' },
      { id: 'd', state: 'Ready to Test', priority: 'None', deadline: null, updatedAt: '2026-06-20T09:00:00Z' },
    ].sort(compareTodos);

    expect(sorted.map((todo) => todo.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
