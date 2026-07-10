import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';

describe('TaskList bulk context actions', () => {
  it('uses Cmd-click selection for bulk delete from the context menu', () => {
    const onDeleteTodos = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
      makeTodo({ id: 3, position: 2, title: 'Third task' }),
    ];

    render(<TaskList {...baseProps({ todos })} onDeleteTodos={onDeleteTodos} />);

    fireEvent.click(screen.getByRole('button', { name: /second task/i }), { metaKey: true });
    fireEvent.contextMenu(screen.getByRole('button', { name: /second task/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete 2 tasks' }));

    expect(onDeleteTodos).toHaveBeenCalledWith([1, 2]);
  });

  it('uses Shift-click range selection for bulk status changes from the context menu', () => {
    const onSetTodosState = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
      makeTodo({ id: 3, position: 2, title: 'Third task' }),
    ];

    render(<TaskList {...baseProps({ todos })} onSetTodosState={onSetTodosState} />);

    fireEvent.click(screen.getByRole('button', { name: /third task/i }), { shiftKey: true });
    fireEvent.contextMenu(screen.getByRole('button', { name: /second task/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Doing' }));

    expect(onSetTodosState).toHaveBeenCalledWith([1, 2, 3], 'Doing');
  });

  it('right-clicking an unselected row scopes bulk actions to that row', () => {
    const onDeleteTodos = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
      makeTodo({ id: 3, position: 2, title: 'Third task' }),
    ];

    render(<TaskList {...baseProps({ todos })} onDeleteTodos={onDeleteTodos} />);

    fireEvent.click(screen.getByRole('button', { name: /second task/i }), { metaKey: true });
    fireEvent.contextMenu(screen.getByRole('button', { name: /third task/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }));

    expect(onDeleteTodos).toHaveBeenCalledWith([3]);
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
