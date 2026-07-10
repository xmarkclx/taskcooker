import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';
import { openNativeTaskRowContextMenu } from './nativeTaskRowContextMenu';

vi.mock('./nativeTaskRowContextMenu', () => ({
  canUseNativeTaskRowContextMenu: vi.fn(() => true),
  openNativeTaskRowContextMenu: vi.fn(async () => true),
}));

describe('TaskList native context menu', () => {
  it('opens the native context menu instead of rendering the React fallback', async () => {
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(<TaskList {...baseProps({ todos })} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /first task/i }), {
      clientX: 18,
      clientY: 24,
    });

    expect(openNativeTaskRowContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 18,
        y: 24,
      }),
    );
    expect(screen.queryByRole('menu', { name: /task actions/i })).not.toBeInTheDocument();
  });
});

function baseProps({ todos }: { todos: TodoSummary[] }) {
  return {
    archivedCount: 0,
    canCreateTask: true,
    filter: 'tasks' as const,
    onDeleteTodo: vi.fn(),
    onFilterChange: vi.fn(),
    onNewTask: vi.fn(),
    onOpenCreateTodo: vi.fn(),
    onReorder: vi.fn(),
    onSetTodoState: vi.fn(),
    onSearchChange: vi.fn(),
    onSortModeChange: vi.fn(),
    searchValue: '',
    onStartTimer: vi.fn(),
    onStateFilterChange: vi.fn(),
    onStopTimer: vi.fn(),
    onTagFilterChange: vi.fn(),
    onWidthChange: vi.fn(),
    runningTimerTodoId: null,
    selectedTodo: todos[0],
    sortMode: 'manual' as const,
    stateFilter: '' as const,
    tagFilter: '',
    tags: [],
    tasksCount: todos.length,
    todos,
    unreadTodoIds: new Set<number>(),
    width: 320,
    onSelect: vi.fn(),
  };
}

function makeTodo(overrides: Pick<TodoSummary, 'id'> & Partial<TodoSummary>): TodoSummary {
  const { id, ...rest } = overrides;
  return {
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    activeWorkingDirectory: '~/p/tmatrix',
    deadline: null,
    dependencies: [],
    descriptionMarkdown: '',
    displayId: `T-${id}`,
    events: [],
    id,
    ownTimeSeconds: 0,
    position: 0,
    priority: 'None',
    projectId: 1,
    rolledUpTimeSeconds: 0,
    stale: false,
    state: 'To Do',
    subtasks: [],
    tags: [],
    timeLogs: [],
    title: `Task ${id}`,
    updatedAt: '2026-06-20T10:00:00Z',
    ...rest,
    createdAt: rest.createdAt ?? '2026-06-20T09:00:00Z',
  };
}
