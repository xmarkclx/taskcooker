import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';

type DndContextHarnessProps = {
  children?: ReactNode;
  onDragAbort?: (event: { id: string | number }) => void;
  onDragStart?: (event: { active: { id: string | number } }) => void;
};

const dndHarness = vi.hoisted(() => ({
  latestDndContextProps: null as DndContextHarnessProps | null,
}));

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(() => []),
  DndContext: ({ children, ...props }: DndContextHarnessProps) => {
    dndHarness.latestDndContextProps = props;
    return <div data-testid="dnd-context">{children}</div>;
  },
  KeyboardSensor: vi.fn(),
  MeasuringStrategy: { Always: 'always' },
  PointerSensor: vi.fn(),
  pointerWithin: vi.fn(() => []),
  useDroppable: vi.fn(() => ({ isOver: false, setNodeRef: vi.fn() })),
  useSensor: vi.fn((sensor, options) => ({ options, sensor })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  })),
  verticalListSortingStrategy: vi.fn(() => []),
}));

// TaskTimerButton renders exactly once per task row, so counting its renders
// counts row renders without exposing TaskList internals.
let timerButtonRenders = 0;
vi.mock('./TaskTimerButton', () => ({
  TaskTimerButton: () => {
    timerButtonRenders += 1;
    return null;
  },
}));

describe('TaskList row render cost', () => {
  beforeEach(() => {
    dndHarness.latestDndContextProps = null;
    timerButtonRenders = 0;
  });

  it('re-renders only the affected row when one todo changes state', () => {
    const todos = Array.from({ length: 30 }, (_, index) =>
      makeTodo({ id: index + 1, position: index }),
    );
    const props = baseProps({ todos });
    const { rerender } = render(<TaskList {...props} />);
    expect(timerButtonRenders).toBeGreaterThanOrEqual(30);

    timerButtonRenders = 0;
    const nextTodos = todos.map((todo) =>
      todo.id === 5 ? { ...todo, state: 'Done' as const } : todo,
    );
    rerender(<TaskList {...props} todos={nextTodos} />);

    // Unchanged rows must not re-render; allow a small margin for the
    // changed row plus React strict double-rendering.
    expect(timerButtonRenders).toBeLessThanOrEqual(4);
  });

  it('still marks a task done through the checkbox after memoization', () => {
    const todos = [
      makeTodo({ id: 1, position: 0 }),
      makeTodo({ id: 2, position: 1 }),
    ];
    const onSetTodoState = vi.fn();
    render(<TaskList {...baseProps({ todos })} onSetTodoState={onSetTodoState} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mark T-2 done' }));
    expect(onSetTodoState).toHaveBeenCalledWith(2, 'Done');
  });

  it('hides drop destinations when dnd-kit aborts a pending drag', () => {
    const todos = [
      makeTodo({ id: 1, position: 0 }),
      makeTodo({ id: 2, position: 1 }),
    ];
    render(<TaskList {...baseProps({ todos })} />);

    act(() => {
      dndHarness.latestDndContextProps?.onDragStart?.({ active: { id: 1 } });
    });
    expect(screen.getByText('Before “Task 2”')).toBeInTheDocument();
    expect(typeof dndHarness.latestDndContextProps?.onDragAbort).toBe('function');

    act(() => {
      dndHarness.latestDndContextProps?.onDragAbort?.({ id: 1 });
    });

    expect(screen.queryByText('Before “Task 2”')).not.toBeInTheDocument();
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

function makeTodo(
  overrides: Pick<TodoSummary, 'id'> & Partial<TodoSummary>,
): TodoSummary {
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
