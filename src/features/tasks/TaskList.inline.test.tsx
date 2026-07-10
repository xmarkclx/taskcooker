import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TodoState, TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';

describe('TaskList inline create', () => {
  it('requests a sibling below with the next position', () => {
    const onOpenCreateTodo = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
    ];

    render(<TaskList {...baseProps({ todos, onOpenCreateTodo })} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /first task/i }));
    fireEvent.click(screen.getByText('New task below'));

    expect(screen.queryByLabelText('New task title')).not.toBeInTheDocument();
    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: null,
      position: 1,
      projectId: 1,
    });
  });

  it('requests a subtask with the parent and child position', () => {
    const onOpenCreateTodo = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'Parent task' }),
      makeTodo({ id: 2, parentId: 1, position: 0, title: 'Existing subtask' }),
    ];

    render(<TaskList {...baseProps({ todos, onOpenCreateTodo })} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /parent task/i }));
    fireEvent.click(screen.getByText('New subtask'));

    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: 1,
      position: 1,
      projectId: 1,
    });
  });

  it('marks a row completing after the parent accepts an immediate Done change', () => {
    const onSelect = vi.fn();
    const onSetTodoState = vi.fn(() => true);
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
    ];

    render(<TaskList {...baseProps({ todos, onSelect, onSetTodoState })} />);
    const doneButton = screen.getByRole('button', { name: 'Mark T-2 done' });

    expect(doneButton.querySelector('svg')).toBeNull();

    fireEvent.click(doneButton);

    expect(doneButton.closest('.task-row')).toHaveClass('completing');
    expect(onSetTodoState).toHaveBeenCalledWith(2, 'Done');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not mark a row completing when the parent defers Done for confirmation', () => {
    const onSetTodoState = vi.fn(() => false);
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
    ];

    render(<TaskList {...baseProps({ todos, onSetTodoState })} />);
    const doneButton = screen.getByRole('button', { name: 'Mark T-2 done' });

    fireEvent.click(doneButton);

    expect(onSetTodoState).toHaveBeenCalledWith(2, 'Done');
    expect(doneButton.closest('.task-row')).not.toHaveClass('completing');
  });
});

function baseProps({
  todos,
  onOpenCreateTodo = vi.fn(),
  onSelect = vi.fn(),
  onSetTodoState = vi.fn(),
}: {
  todos: TodoSummary[];
  onOpenCreateTodo?: (input: {
    parentId: number | null;
    position: number;
    projectId: number;
  }) => void;
  onSelect?: (todoId: number) => void;
  onSetTodoState?: (todoId: number, state: TodoState) => boolean | void;
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
    onSetTodoState,
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
    onSelect,
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
