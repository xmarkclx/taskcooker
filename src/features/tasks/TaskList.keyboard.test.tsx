import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';

describe('TaskList keyboard shortcuts', () => {
  it('requests a sibling create when Enter is pressed on the task list', () => {
    const onOpenCreateTodo = vi.fn();
    const todos = [makeTodo({ id: 1, position: 0 })];

    render(<TaskList {...baseProps({ todos, onOpenCreateTodo, selectedTodo: todos[0] })} />);
    fireEvent.keyDown(screen.getByLabelText('Task list'), { key: 'Enter' });

    expect(screen.queryByLabelText('New task title')).not.toBeInTheDocument();
    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: null,
      position: 1,
      projectId: 1,
    });
  });

  it('requests a subtask when Cmd+Enter is pressed on the task list', () => {
    const onOpenCreateTodo = vi.fn();
    const todos = [makeTodo({ id: 1, position: 0 })];

    render(<TaskList {...baseProps({ todos, onOpenCreateTodo, selectedTodo: todos[0] })} />);
    fireEvent.keyDown(screen.getByLabelText('Task list'), { key: 'Enter', metaKey: true });

    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: 1,
      position: 0,
      projectId: 1,
    });
  });

  it('uses the context-menu row for Enter quick-create while the menu has focus', () => {
    const onOpenCreateTodo = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
    ];

    render(<TaskList {...baseProps({ todos, onOpenCreateTodo, selectedTodo: todos[1] })} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /first task/i }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' });

    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: null,
      position: 1,
      projectId: 1,
    });
  });
});

function baseProps({
  todos,
  onOpenCreateTodo,
  selectedTodo,
}: {
  todos: TodoSummary[];
  onOpenCreateTodo: (input: {
    parentId: number | null;
    position: number;
    projectId: number;
  }) => void;
  selectedTodo: TodoSummary;
}) {
  return {
    archivedCount: 0,
    canCreateTask: true,
    filter: 'tasks' as const,
    onDeleteTodo: vi.fn(),
    onFilterChange: vi.fn(),
    onNewTask: vi.fn(),
    onOpenCreateTodo,
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
    selectedTodo,
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
