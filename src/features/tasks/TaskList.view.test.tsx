import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectSummary, TodoSummary } from '../../domain/domain';
import { buildTaskRows, TaskList } from './TaskList';

const appStyles = readFileSync(
  resolve(process.cwd(), 'src/styles.css'),
  'utf8',
);

describe('TaskList views', () => {
  it('shows task list view options as an icon group with only the current view selected', () => {
    const onSortModeChange = vi.fn();
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(
      <TaskList
        {...baseProps({ todos })}
        onSortModeChange={onSortModeChange}
        sortMode="updated"
      />,
    );

    const viewGroup = screen.getByRole('radiogroup', {
      name: 'Task list view',
    });
    ['Tree View', 'Priority View', 'Updated View', 'Created View'].forEach(
      (label) => {
        const radio = within(viewGroup).getByRole('radio', { name: label });
        expect(radio.querySelector('svg')).not.toBeNull();
        if (label === 'Updated View') {
          expect(radio).toBeChecked();
        } else {
          expect(radio).not.toBeChecked();
        }
      },
    );

    fireEvent.click(
      within(viewGroup).getByRole('radio', { name: 'Created View' }),
    );
    expect(onSortModeChange).toHaveBeenCalledWith('created');
  });

  it('places Updated View in the second toolbar slot ahead of Priority View', () => {
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(<TaskList {...baseProps({ todos })} />);

    const viewGroup = screen.getByRole('radiogroup', {
      name: 'Task list view',
    });

    expect(
      within(viewGroup)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label')),
    ).toEqual([
      'Tree View',
      'Updated View',
      'Priority View',
      'Created View',
    ]);
  });

  it('filters by state from the header filter dropdown', async () => {
    const onFilterChange = vi.fn();
    const onStateFilterChange = vi.fn();
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(
      <TaskList
        {...baseProps({ todos })}
        archivedCount={3}
        onFilterChange={onFilterChange}
        onStateFilterChange={onStateFilterChange}
        tasksCount={6}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Filter tasks' });
    expect(trigger).toHaveTextContent('Tasks');

    fireEvent.click(trigger);
    const filterMenu = await screen.findByRole('menu', {
      name: 'Filter tasks',
    });

    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Tasks 6' }),
    ).toHaveClass('active');
    [
      'Icebox',
      'To Do',
      'Doing',
      'Blocked',
      'Delegated',
      'Waiting',
      'Ready to Test',
      'Needs Feedback',
      'Done',
    ].forEach((state) => {
      expect(
        within(filterMenu).getByRole('menuitem', { name: state }),
      ).toBeInTheDocument();
    });
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Archived 3' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(filterMenu).getByRole('menuitem', { name: 'Ready to Test' }),
    );
    expect(onFilterChange).toHaveBeenCalledWith('tasks');
    expect(onStateFilterChange).toHaveBeenCalledWith('Ready to Test');
    expect(
      screen.queryByRole('menu', { name: 'Filter tasks' }),
    ).not.toBeInTheDocument();
  });

  it('shows the active state filter as the filter dropdown text', () => {
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(<TaskList {...baseProps({ todos })} stateFilter="Delegated" />);

    expect(
      screen.getByRole('button', { name: 'Filter tasks' }),
    ).toHaveTextContent('Delegated');
  });

  it('toggles delegated task visibility from a separate header button', () => {
    const onHideDelegatedChange = vi.fn();
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'First task' }),
      makeTodo({ id: 2, position: 1, state: 'Delegated', title: 'Delegated task' }),
      makeTodo({ id: 3, position: 2, state: 'Delegated', title: 'Second delegated task' }),
    ];
    const { rerender } = render(
      <TaskList
        {...baseProps({ todos })}
        delegatedCount={2}
        hideDelegated={false}
        onHideDelegatedChange={onHideDelegatedChange}
      />,
    );

    const toggle = screen.getByRole('button', {
      name: 'Hide Delegated Tasks 2 Delegated Tasks',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const icon = toggle.querySelector('.delegated-cooking-pot-icon');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('viewBox', '0 0 16 16');
    expect(icon?.querySelector('.delegated-cooking-pot-steam')).not.toBeNull();
    expect(icon?.querySelector('.delegated-cooking-pot-lid')).not.toBeNull();
    expect(icon?.querySelector('.delegated-cooking-pot-body')).not.toBeNull();
    expect(within(toggle).getByText('2')).toHaveClass('delegated-filter-count');

    fireEvent.click(toggle);
    expect(onHideDelegatedChange).toHaveBeenCalledWith(true);

    rerender(
      <TaskList
        {...baseProps({ todos })}
        delegatedCount={2}
        hideDelegated
        onHideDelegatedChange={onHideDelegatedChange}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Hide Delegated Tasks 2 Delegated Tasks' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide Delegated Tasks 2 Delegated Tasks' }),
    );
    expect(onHideDelegatedChange).toHaveBeenLastCalledWith(false);
  });

  it('styles the delegated visibility toggle as a raised button with pressed states', () => {
    const toggleRule = cssRule('.delegated-filter-toggle');
    expect(toggleRule).toContain('border: 1px solid var(--line);');
    expect(toggleRule).toContain('box-shadow:');

    const activeRule = cssRule('.delegated-filter-toggle.active');
    expect(activeRule).toContain('box-shadow: inset 0 2px 4px rgb(var(--color-shadow-rgb) / 26%);');
    expect(activeRule).toContain('transform: translateY(1px);');
    expect(activeRule).not.toContain('background:');
    expect(activeRule).not.toContain('border-color:');
    expect(activeRule).not.toContain('color:');

    const hoverRule = cssRulesForSelector('.delegated-filter-toggle:hover');
    expect(hoverRule).not.toContain('background:');
    expect(hoverRule).not.toContain('border-color:');
    expect(hoverRule).not.toContain('color:');

    const activeBadgeRule = cssRulesForSelector(
      '.delegated-filter-toggle.active .delegated-filter-count',
    );
    expect(activeBadgeRule).not.toContain('background:');
    expect(activeBadgeRule).not.toContain('color:');

    const badgeRule = cssRule('.delegated-filter-count');
    expect(badgeRule).toContain('box-shadow: inset 0 1px 0');
    expect(badgeRule).toContain('margin-left: -1px;');

    const iconRule = cssRule('.delegated-cooking-pot-icon');
    expect(iconRule).toContain('height: 16px;');
    expect(iconRule).toContain('width: 16px;');

    const steamRule = cssRule('.delegated-cooking-pot-steam');
    expect(steamRule).toContain('animation: delegated-cooking-steam');

    const reducedMotionRule = cssRulesForSelector(
      '.delegated-cooking-pot-icon.cooking .delegated-cooking-pot-steam',
    );
    expect(reducedMotionRule).toContain('animation: none;');

    const pressedRules = cssRule('.delegated-filter-toggle.delegated-filter-toggle:not(:disabled):active');
    expect(pressedRules).toContain('transform: translateY(1px);');
    expect(pressedRules).not.toContain('scale(');
    expect(pressedRules).toContain(
      'box-shadow: inset 0 2px 4px rgb(var(--color-shadow-rgb) / 26%);',
    );

    const darkActiveRule = cssRule(
      ".app-shell[data-theme='dark'] .delegated-filter-toggle.active",
    );
    expect(darkActiveRule).toContain('background:');
    expect(darkActiveRule).toContain('var(--terminal-dark-green)');
    expect(darkActiveRule).not.toContain('transition:');

    expect(toggleRule).toContain('transition:');
    expect(toggleRule).toContain('box-shadow var(--button-press-duration)');
    expect(toggleRule).not.toContain('transform var(--button-press-duration)');
    expect(toggleRule).not.toContain('background var(--theme-transition-duration)');
    expect(toggleRule).not.toContain('color var(--theme-transition-duration)');
  });

  it('keeps the delegated visibility toggle beside the filter dropdown', () => {
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(<TaskList {...baseProps({ todos })} />);

    const filterButton = screen.getByRole('button', { name: 'Filter tasks' });
    const toggle = screen.getByRole('button', { name: 'Hide Delegated Tasks' });
    expect(filterButton.closest('.list-filter-dropdown')?.nextElementSibling).toBe(toggle);
    expect(toggle.querySelector('.delegated-cooking-pot-steam')).toBeNull();
    expect(toggle.querySelector('.delegated-filter-count')).toBeNull();
    expect(cssRule('.list-filter-row')).not.toContain('justify-content: space-between;');
    expect(cssRule('.segment.view-segment')).toContain('margin-left: auto;');
  });

  it('does not show a hide-list button in the task list toolbar', () => {
    const todos = [makeTodo({ id: 1, position: 0, title: 'First task' })];

    render(<TaskList {...baseProps({ todos })} />);

    expect(
      screen.queryByRole('button', { name: 'Hide task list' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a task in a new window when its row is double-clicked', () => {
    const onOpenTaskWindow = vi.fn();
    const todos = [makeTodo({ id: 7, position: 0, title: 'First task' })];

    render(
      <TaskList
        {...baseProps({ todos })}
        onOpenTaskWindow={onOpenTaskWindow}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /first task/i }));

    expect(onOpenTaskWindow).toHaveBeenCalledWith(7);
  });

  it('renders sorted views as flat task rows instead of a subtask tree', () => {
    const todos = [
      makeTodo({
        id: 1,
        position: 0,
        subtasks: [
          {
            id: 2,
            displayId: 'T-2',
            title: 'Child task',
            state: 'To Do',
            done: false,
          },
        ],
        title: 'Parent task',
      }),
      makeTodo({ id: 2, parentId: 1, position: 0, title: 'Child task' }),
    ];

    render(<TaskList {...baseProps({ todos })} sortMode="updated" />);

    expect(
      screen.getByRole('button', { name: /parent task/i }).closest('.task-row'),
    ).not.toHaveClass('nested');
    expect(
      screen.getByRole('button', { name: /child task/i }).closest('.task-row'),
    ).not.toHaveClass('nested');
  });

  it('mounts linked tasks under their target parent with the source subtask tree', () => {
    const rows = buildTaskRows({
      childProjects: [],
      collapsedProjectIds: new Set(),
      collapsedSubprojectIds: new Set(),
      collapsedTodoIds: new Set(),
      projects: [makeProject({ id: 1 }), makeProject({ id: 2 })],
      selectedProjectId: 1,
      showProjectRoots: false,
      todos: [
        makeTodo({
          id: 1,
          linkedTasks: [
            {
              done: false,
              displayId: 'S-2',
              id: 2,
              parentTodoId: 1,
              position: 0,
              sourceProjectId: 2,
              state: 'To Do',
              targetProjectId: 1,
              title: 'Shared implementation task',
            },
          ],
          position: 0,
          projectId: 1,
          title: 'Client milestone',
        }),
        makeTodo({
          displayId: 'S-2',
          id: 2,
          position: 0,
          projectId: 2,
          subtasks: [
            {
              done: false,
              displayId: 'S-3',
              id: 3,
              state: 'To Do',
              title: 'Real source subtask',
            },
          ],
          title: 'Shared implementation task',
        }),
        makeTodo({
          displayId: 'S-3',
          id: 3,
          parentId: 2,
          position: 0,
          projectId: 2,
          title: 'Real source subtask',
        }),
      ],
      treeView: true,
    });

    expect(
      rows.flatMap((row) =>
        row.type === 'todo' ? [{ depth: row.depth, title: row.todo.title }] : [],
      ),
    ).toEqual([
      { depth: 0, title: 'Client milestone' },
      { depth: 1, title: 'Shared implementation task' },
      { depth: 2, title: 'Real source subtask' },
    ]);
  });

  it('only exposes task drag handles in manual tree view', () => {
    const todos = [
      makeTodo({ id: 1, position: 0, title: 'Parent task' }),
      makeTodo({ id: 2, position: 1, title: 'Second task' }),
    ];
    const { rerender } = render(
      <TaskList {...baseProps({ todos })} sortMode="manual" />,
    );

    expect(screen.getByRole('button', { name: /parent task/i })).toHaveAttribute(
      'aria-roledescription',
      'sortable',
    );

    rerender(<TaskList {...baseProps({ todos })} sortMode="updated" />);

    expect(
      screen.getByRole('button', { name: /parent task/i }),
    ).not.toHaveAttribute('aria-roledescription');
    expect(
      screen.getByRole('button', { name: /second task/i }),
    ).not.toHaveAttribute('aria-roledescription');
  });

  it('shows today and total time counters instead of state age in task rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T12:00:00Z'));
    const todos = [
      makeTodo({
        id: 9,
        ownTimeSeconds: 3 * 60 * 60 + 14 * 60 + 28,
        position: 0,
        state: 'Delegated',
        stateAgeLabel: '1d 7h',
        timeLogs: [
          makeLog(1, '2026-06-23T10:00:00Z', '2026-06-23T11:00:00Z', 60 * 60),
        ],
        title: 'Finish the change docs',
      }),
    ];

    try {
      render(<TaskList {...baseProps({ todos })} />);

      expect(screen.queryAllByText('since 1d 7h')).toHaveLength(0);
      expect(screen.getByText('1h today')).toBeInTheDocument();
      expect(screen.getByText('03:14:28 total')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows tree indicators for active and merged worktree tasks', () => {
    const todos = [
      makeTodo({
        id: 1,
        position: 0,
        title: 'Active worktree task',
        worktreeName: 'T-1',
        worktreePath: '~/p/T-1',
      }),
      makeTodo({
        id: 2,
        position: 1,
        title: 'Merged worktree task',
        worktreeMergedAt: '2026-06-25T10:00:00Z',
        worktreeName: 'T-2',
        worktreePath: '~/p/T-2',
      }),
    ];

    render(<TaskList {...baseProps({ todos })} />);

    expect(
      within(
        screen.getByRole('button', { name: 'T-1: Active worktree task' }),
      ).getByLabelText('Active worktree'),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('button', { name: 'T-2: Merged worktree task' }),
      ).getByLabelText('Merged worktree'),
    ).toHaveTextContent('🎄');
  });

  it('shows a color-coded context project badge on task rows', () => {
    const projects = [
      makeProject({ id: 1, name: 'Home' }),
      makeProject({ id: 2, name: 'Client Portal' }),
    ];
    const todos = [
      makeTodo({
        effectiveContextProjectId: 2,
        id: 1,
        position: 0,
        title: 'Use client context',
      }),
    ];

    render(<TaskList {...baseProps({ todos })} projects={projects} />);

    const contextBadge = screen.getByLabelText('Context project Client Portal');
    expect(contextBadge).toHaveTextContent('Client Portal');
    expect(contextBadge).toHaveClass('context-project-chip');
    expect(
      (contextBadge as HTMLElement).style.getPropertyValue('--project-accent-hue'),
    ).toMatch(/^\d+deg$/);
    expect(cssRule('.context-project-chip')).toContain('align-items: center;');
    expect(appStyles).not.toContain('.context-project-chip::before');
  });

  it('renders projects as tree roots in all-project manual tree view', () => {
    const projects = [
      makeProject({ id: 1, name: 'tmatrix' }),
      makeProject({ id: 2, name: 'life' }),
    ];
    const todos = [
      makeTodo({
        id: 1,
        projectId: 1,
        position: 0,
        title: 'Build prompt context',
      }),
      makeTodo({
        id: 2,
        projectId: 2,
        position: 0,
        title: 'Buy replacement cable',
      }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        projects={projects}
        showProjectRoots
        sortMode="manual"
      />,
    );

    expect(
      screen.getByRole('button', { name: /project tmatrix, 1 task/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /project life, 1 task/i }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: /build prompt context/i })
        .closest('.task-row'),
    ).toHaveClass('nested');
    expect(
      screen
        .getByRole('button', { name: /buy replacement cable/i })
      .closest('.task-row'),
    ).toHaveClass('nested');
  });

  it('accepts controlled accordion state and reports the next state when toggled', () => {
    const todos = [
      makeTodo({
        id: 1,
        position: 0,
        subtasks: [{ id: 2, displayId: 'T-2', title: 'Child task', state: 'To Do', done: false }],
        title: 'Parent task',
      }),
      makeTodo({ id: 2, parentId: 1, position: 1, title: 'Child task' }),
    ];
    const onAccordionStateChange = vi.fn();
    const accordionState = {
      collapsedProjectIds: new Set<number>(),
      collapsedSubprojectIds: new Set<number>(),
      collapsedTodoIds: new Set([1]),
    };
    const { rerender } = render(
      <TaskList
        {...baseProps({ todos })}
        accordionState={accordionState}
        onAccordionStateChange={onAccordionStateChange}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /child task/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand subtasks for T-1' }),
    );

    const nextState = onAccordionStateChange.mock.calls[0]?.[0];
    expect(nextState).toEqual({
      collapsedProjectIds: new Set<number>(),
      collapsedSubprojectIds: new Set<number>(),
      collapsedTodoIds: new Set<number>(),
    });

    rerender(
      <TaskList
        {...baseProps({ todos })}
        accordionState={nextState}
        onAccordionStateChange={onAccordionStateChange}
      />,
    );
    expect(screen.getByRole('button', { name: /child task/i })).toBeInTheDocument();
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

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(new RegExp(`(^|\\n)${escapedSelector}\\s*{[^}]*}`, 's'));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[0];
}

function cssRulesForSelector(selector: string) {
  const rules = Array.from(appStyles.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^}]*)\}/g));

  return rules
    .filter((match) =>
      match.groups?.selectors
        .split(',')
        .some((candidate) => candidate.trim() === selector),
    )
    .map((match) => match.groups?.body ?? '')
    .join('\n');
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

function makeProject(
  overrides: Pick<ProjectSummary, 'id'> & Partial<ProjectSummary>,
): ProjectSummary {
  const { id, ...rest } = overrides;
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 1,
    status: 'Active' as const,
    inheritParent: false,
    subprojects: [],    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: `P${id}`,
    id,
    mainBranch: 'main',
    name: `Project ${id}`,
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    terminalWslEnabled: false,
    workingDirectory: `~/p/project-${id}`,
    ...rest,
  };
}

function makeLog(
  id: number,
  startedAt: string,
  endedAt: string | null,
  durationSeconds: number,
): TodoSummary['timeLogs'][number] {
  return {
    durationSeconds,
    endedAt,
    id,
    running: endedAt === null,
    source: 'manual',
    startedAt,
  };
}
