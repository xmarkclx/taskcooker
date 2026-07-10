import { describe, expect, it } from 'vitest';

import { queryKeys } from './queryKeys';

describe('query keys', () => {
  it('keeps project and todo cache keys stable and scoped', () => {
    expect(queryKeys.projects()).toEqual(['projects']);
    expect(queryKeys.todos({ projectId: 1, filter: 'review' })).toEqual([
      'todos',
      { projectId: 1, filter: 'review' },
    ]);
    expect(queryKeys.todo(7)).toEqual(['todo', 7]);
    expect(queryKeys.appSnapshot()).toEqual(['appSnapshot']);
    expect(queryKeys.appSettings()).toEqual(['appSettings']);
    expect(queryKeys.projectActions(1)).toEqual(['projectActions', 1]);
    expect(queryKeys.projectActionsDirectory(1)).toEqual(['projectActionsDirectory', 1]);
  });
});
