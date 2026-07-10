import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';
import { openNativeListContextMenu } from './nativeListContextMenu';
import { openNativeTaskRowContextMenu } from './nativeTaskRowContextMenu';

vi.mock('./nativeTaskRowContextMenu', () => ({
  canUseNativeTaskRowContextMenu: vi.fn(() => false),
  openNativeTaskRowContextMenu: vi.fn(async () => true),
}));

vi.mock('./nativeListContextMenu', () => ({
  canUseNativeListContextMenu: vi.fn(() => false),
  openNativeListContextMenu: vi.fn(async () => true),
}));

describe('TaskList list context menu', () => {
  it('shows a New task fallback menu when right-clicking the empty list area', () => {
    const onNewTask = vi.fn();
    const { container } = render(<TaskList {...baseProps({ todos: [], onNewTask })} />);

    const taskRows = container.querySelector('.task-rows');
    expect(taskRows).not.toBeNull();
    fireEvent.contextMenu(taskRows as Element, { clientX: 30, clientY: 40 });

    const newTask = screen.getByRole('menuitem', { name: 'New task' });
    fireEvent.click(newTask);
    expect(onNewTask).toHaveBeenCalledOnce();
  });

  it('prefers the native list menu when available', async () => {
    const { canUseNativeListContextMenu } = await import('./nativeListContextMenu');
    vi.mocked(canUseNativeListContextMenu).mockReturnValue(true);
    vi.mocked(openNativeListContextMenu).mockClear();

    const { container } = render(<TaskList {...baseProps({ todos: [] })} />);
    fireEvent.contextMenu(container.querySelector('.task-rows') as Element, {
      clientX: 12,
      clientY: 18,
    });

    expect(openNativeListContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ x: 12, y: 18 }),
    );
    expect(screen.queryByRole('menuitem', { name: 'New task' })).not.toBeInTheDocument();

    vi.mocked(canUseNativeListContextMenu).mockReturnValue(false);
  });

  it('does not open the list menu when right-clicking a task row', async () => {
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];
    const { canUseNativeTaskRowContextMenu } = await import('./nativeTaskRowContextMenu');
    vi.mocked(canUseNativeTaskRowContextMenu).mockReturnValue(true);
    vi.mocked(openNativeListContextMenu).mockClear();
    vi.mocked(openNativeTaskRowContextMenu).mockClear();

    render(<TaskList {...baseProps({ todos })} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /first task/i }), {
      clientX: 18,
      clientY: 24,
    });

    expect(openNativeTaskRowContextMenu).toHaveBeenCalled();
    expect(openNativeListContextMenu).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: 'New task' })).not.toBeInTheDocument();
  });
});

function baseProps({
  todos,
  onNewTask = vi.fn(),
}: {
  todos: TodoSummary[];
  onNewTask?: () => void;
}) {
  return {
    archivedCount: 0,
    canCreateTask: true,
    filter: 'tasks' as const,
    onDeleteTodo: vi.fn(),
    onFilterChange: vi.fn(),
    onNewTask,
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
