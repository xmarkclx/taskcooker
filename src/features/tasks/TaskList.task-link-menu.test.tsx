import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { formatTaskUri } from './taskLinks';
import { TaskList } from './TaskList';

describe('TaskList task link context menu', () => {
  it('pastes a copied task URI as a linked child under the context task', async () => {
    const onLinkTodo = vi.fn();
    const todos = [
      makeTodo({ id: 1, displayId: 'T-1', position: 0, title: 'Target parent' }),
      makeTodo({ id: 2, displayId: 'B-264', position: 0, projectId: 2, title: 'Shared task' }),
    ];
    const clipboard = {
      readText: vi.fn(async () => formatTaskUri('B-264')),
      writeText: vi.fn(),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });

    render(<TaskList {...baseProps({ todos })} onLinkTodo={onLinkTodo} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /target parent/i }), {
      clientX: 18,
      clientY: 24,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Paste B-264 task' }));

    await waitFor(() => {
      expect(onLinkTodo).toHaveBeenCalledWith({
        sourceTodoId: 2,
        targetParentTodoId: 1,
        position: 0,
      });
    });
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
