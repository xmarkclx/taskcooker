import { describe, expect, it } from 'vitest';

import { TODO_STATES, type TodoSummary } from '../../domain/domain';
import { filterTasks, sortTasks } from './workspaceHelpers';

describe('workspace helpers', () => {
  it('filters specialized task list buckets by product state rules', () => {
    const todos = [
      todo({ id: 1, priority: 'Medium', state: 'Icebox', title: 'Icebox task' }),
      todo({ id: 2, priority: 'Medium', state: 'Ready to Test', title: 'Ready task' }),
      todo({ id: 3, priority: 'Medium', state: 'Needs Feedback', title: 'Feedback task' }),
      todo({
        dependencies: [{ id: 1, displayId: 'T-1', title: 'Icebox task', state: 'Done' }],
        id: 4,
        priority: 'Medium',
        state: 'To Do',
        title: 'Actionable dependent task',
      }),
      todo({
        dependencies: [{ id: 1, displayId: 'T-1', title: 'Icebox task', state: 'Archived' }],
        id: 15,
        priority: 'Medium',
        state: 'To Do',
        title: 'Task with archived dependency',
      }),
      todo({
        dependencies: [{ id: 1, displayId: 'T-1', title: 'Icebox task', state: 'Doing' }],
        id: 16,
        priority: 'Medium',
        state: 'To Do',
        title: 'Blocked by open dependency',
      }),
      todo({
        dependencies: [{ id: 1, displayId: 'T-1', title: 'Icebox task', state: 'Done' }],
        id: 5,
        priority: 'Medium',
        state: 'Doing',
        subtasks: [{ id: 6, displayId: 'T-6', title: 'Child task', state: 'Done', done: true }],
        title: 'Doing dependent parent',
      }),
      todo({
        dependencies: [{ id: 1, displayId: 'T-1', title: 'Icebox task', state: 'Done' }],
        id: 7,
        priority: 'Medium',
        state: 'To Do',
        subtasks: [{ id: 8, displayId: 'T-8', title: 'Child task', state: 'Doing', done: false }],
        title: 'Parent with open child',
      }),
      todo({ id: 9, priority: 'Medium', state: 'To Do', title: 'To Do without dependency' }),
      todo({ id: 10, priority: 'Medium', state: 'Delegated', title: 'Delegated task' }),
      todo({ id: 11, priority: 'Medium', state: 'Blocked', title: 'Blocked task' }),
      todo({ id: 12, priority: 'Medium', state: 'Waiting', title: 'Waiting task' }),
      todo({ id: 13, priority: 'Medium', state: 'Done', title: 'Finished task' }),
      todo({ id: 14, priority: 'Medium', state: 'Archived', title: 'Archived task' }),
    ];

    expect(filterTasks(todos, 'tasks', '', '', '').map((item) => item.title)).toEqual([
      'Icebox task',
      'Ready task',
      'Feedback task',
      'Actionable dependent task',
      'Task with archived dependency',
      'Blocked by open dependency',
      'Doing dependent parent',
      'Parent with open child',
      'To Do without dependency',
      'Delegated task',
      'Blocked task',
      'Waiting task',
    ]);
    expect(filterTasks(todos, 'review', '', '', '').map((item) => item.title)).toEqual([
      'Ready task',
    ]);
    expect(filterTasks(todos, 'feedback', '', '', '').map((item) => item.title)).toEqual([
      'Feedback task',
    ]);
    expect(filterTasks(todos, 'todo', '', '', '').map((item) => item.title)).toEqual([
      'Actionable dependent task',
      'Task with archived dependency',
      'Doing dependent parent',
      'To Do without dependency',
    ]);
    expect(filterTasks(todos, 'delegated', '', '', '').map((item) => item.title)).toEqual([
      'Delegated task',
    ]);
    expect(filterTasks(todos, 'blocked', '', '', '').map((item) => item.title)).toEqual([
      'Blocked task',
      'Waiting task',
    ]);
    expect(filterTasks(todos, 'tasks', 'Done', '', '').map((item) => item.title)).toEqual([
      'Finished task',
    ]);
  });

  it('hides only Done and Archived tasks from the Tasks filter', () => {
    const todos = TODO_STATES.map((state, index) =>
      todo({
        id: index + 1,
        priority: 'Medium',
        state,
        title: `${state} task`,
      }),
    );

    expect(
      filterTasks(todos, 'tasks', '', '', '').map((item) => item.state),
    ).toEqual(TODO_STATES.filter((state) => state !== 'Done' && state !== 'Archived'));
  });

  it('optionally filters delegated tasks out of any task list filter', () => {
    const todos = [
      todo({ id: 1, priority: 'Medium', state: 'To Do', title: 'Ready to start' }),
      todo({ id: 2, priority: 'Medium', state: 'Delegated', title: 'Waiting on agent' }),
      todo({ id: 3, priority: 'Medium', state: 'Ready to Test', title: 'Needs review' }),
    ];

    expect(filterTasks(todos, 'tasks', '', '', '', new Set(), true).map((item) => item.title))
      .toEqual(['Ready to start', 'Needs review']);
    expect(
      filterTasks(todos, 'tasks', 'Delegated', '', '', new Set(), true).map(
        (item) => item.title,
      ),
    ).toEqual([]);
    expect(filterTasks(todos, 'tasks', 'Delegated', '', '').map((item) => item.title)).toEqual([
      'Waiting on agent',
    ]);
  });

  it('shows only starred tasks plus parent and linked parent context', () => {
    const todos = [
      todo({
        id: 1,
        priority: 'Medium',
        state: 'Done',
        subtasks: [{ id: 2, displayId: 'T-2', title: 'Starred child', state: 'To Do', done: false }],
        title: 'Filtered parent context',
      }),
      todo({
        id: 2,
        parentId: 1,
        priority: 'Medium',
        starred: true,
        state: 'To Do',
        title: 'Starred child',
      }),
      todo({
        id: 3,
        linkedTasks: [
          {
            done: false,
            displayId: 'T-4',
            id: 4,
            parentTodoId: 3,
            position: 0,
            sourceProjectId: 2,
            state: 'To Do',
            targetProjectId: 1,
            title: 'Starred linked task',
          },
        ],
        priority: 'Medium',
        state: 'Done',
        title: 'Linked parent context',
      }),
      todo({
        displayId: 'T-4',
        id: 4,
        priority: 'Medium',
        projectId: 2,
        starred: true,
        state: 'To Do',
        title: 'Starred linked task',
      }),
      todo({
        id: 5,
        priority: 'Medium',
        state: 'To Do',
        title: 'Unstarred sibling',
      }),
    ];

    expect(
      filterTasks(todos, 'tasks', '', '', '', new Set(), false, true).map((item) => item.title),
    ).toEqual([
      'Filtered parent context',
      'Starred child',
      'Linked parent context',
      'Starred linked task',
    ]);
  });

  it('sorts by priority before review attention in the priority view', () => {
    const todos = [
      todo({ id: 1, priority: 'Low', state: 'Doing', title: 'Needs reply' }),
      todo({ id: 2, priority: 'Urgent', state: 'To Do', title: 'Urgent normal task' }),
      todo({ id: 3, priority: 'None', state: 'Ready to Test', title: 'Ready for review' }),
    ];

    expect(sortTasks(todos, 'default', new Set([1])).map((item) => item.id)).toEqual([
      2,
      1,
      3,
    ]);
  });

  it('puts urgent tasks above no-priority review tasks in the priority view', () => {
    const todos = [
      todo({ id: 1, priority: 'None', state: 'Ready to Test', title: 'No priority review' }),
      todo({ id: 2, priority: 'Urgent', state: 'Delegated', title: 'Urgent delegated' }),
    ];

    expect(sortTasks(todos, 'default').map((item) => item.id)).toEqual([2, 1]);
  });

  it('floats review attention tasks within the same priority', () => {
    const todos = [
      todo({ id: 1, priority: 'Medium', state: 'Doing', title: 'Needs reply' }),
      todo({ id: 2, priority: 'Medium', state: 'To Do', title: 'Plain task' }),
      todo({ id: 3, priority: 'Medium', state: 'Ready to Test', title: 'Ready for review' }),
    ];

    expect(sortTasks(todos, 'default', new Set([1])).map((item) => item.id)).toEqual([
      3,
      1,
      2,
    ]);
  });

  it('does not include delegated tasks in Review just because they have unread messages', () => {
    const todos = [
      todo({ id: 1, priority: 'Medium', state: 'Delegated', title: 'Still delegated' }),
      todo({ id: 2, priority: 'Medium', state: 'Doing', title: 'Needs reply' }),
      todo({ id: 3, priority: 'Medium', state: 'Ready to Test', title: 'Returned work' }),
    ];

    expect(
      filterTasks(todos, 'review', '', '', '', new Set([1, 2])).map((item) => item.title),
    ).toEqual(['Needs reply', 'Returned work']);
  });

  it('does not elevate delegated tasks into the unread attention sort group', () => {
    const todos = [
      todo({ id: 1, priority: 'Medium', state: 'Delegated', title: 'Still delegated' }),
      todo({ id: 2, priority: 'Medium', state: 'Doing', title: 'Needs reply' }),
      todo({ id: 3, priority: 'Medium', state: 'Ready to Test', title: 'Returned work' }),
    ];

    expect(sortTasks(todos, 'default', new Set([1, 2])).map((item) => item.id)).toEqual([
      3,
      2,
      1,
    ]);
  });

  it('manual sort orders by position ascending', () => {
    const todos = [
      todo({ id: 1, position: 2, priority: 'Medium', state: 'To Do', title: 'Third' }),
      todo({ id: 2, position: 0, priority: 'Medium', state: 'To Do', title: 'First' }),
      todo({ id: 3, position: 1, priority: 'Medium', state: 'To Do', title: 'Second' }),
    ];

    expect(sortTasks(todos, 'manual').map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it('created view orders tasks by newest creation time first', () => {
    const todos = [
      todo({
        createdAt: '2026-06-20T09:00:00Z',
        id: 1,
        priority: 'Medium',
        state: 'To Do',
        title: 'Oldest',
      }),
      todo({
        createdAt: '2026-06-20T11:00:00Z',
        id: 2,
        priority: 'Low',
        state: 'To Do',
        title: 'Newest',
      }),
      todo({
        createdAt: '2026-06-20T10:00:00Z',
        id: 3,
        priority: 'Urgent',
        state: 'To Do',
        title: 'Middle',
      }),
    ];

    expect(sortTasks(todos, 'created').map((item) => item.id)).toEqual([2, 3, 1]);
  });
});

function todo(
  overrides: Pick<TodoSummary, 'id' | 'priority' | 'state' | 'title'> &
    Partial<
      Pick<
        TodoSummary,
        | 'createdAt'
        | 'dependencies'
        | 'displayId'
        | 'linkedTasks'
        | 'parentId'
        | 'position'
        | 'projectId'
        | 'starred'
        | 'subtasks'
      >
    >,
): TodoSummary {
  return {
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    activeWorkingDirectory: '~/p/tmatrix',
    createdAt: overrides.createdAt ?? `2026-06-20T09:0${overrides.id}:00Z`,
    deadline: null,
    dependencies: overrides.dependencies ?? [],
    descriptionMarkdown: '',
    displayId: overrides.displayId ?? `T-${overrides.id}`,
    events: [],
    id: overrides.id,
    ownTimeSeconds: 0,
    parentId: overrides.parentId,
    position: overrides.position ?? overrides.id,
    priority: overrides.priority,
    projectId: overrides.projectId ?? 1,
    rolledUpTimeSeconds: 0,
    stale: false,
    state: overrides.state,
    starred: overrides.starred,
    subtasks: overrides.subtasks ?? [],
    linkedTasks: overrides.linkedTasks,
    tags: [],
    timeLogs: [],
    title: overrides.title,
    updatedAt: `2026-06-20T10:0${overrides.id}:00Z`,
  };
}
