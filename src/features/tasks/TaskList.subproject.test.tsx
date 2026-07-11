import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectSummary, TodoSummary } from '../../domain/domain';
import { TaskList } from './TaskList';

const appStyles = readFileSync('src/styles.css', 'utf8');

vi.mock('./nativeTaskRowContextMenu', () => ({
  canUseNativeTaskRowContextMenu: vi.fn(() => false),
  openNativeTaskRowContextMenu: vi.fn(async () => true),
}));

vi.mock('./nativeListContextMenu', () => ({
  canUseNativeListContextMenu: vi.fn(() => false),
  openNativeListContextMenu: vi.fn(async () => true),
}));

vi.mock('./nativeSubprojectRowContextMenu', async () => {
  const actual = await vi.importActual<typeof import('./nativeSubprojectRowContextMenu')>(
    './nativeSubprojectRowContextMenu',
  );
  return {
    canUseNativeSubprojectRowContextMenu: vi.fn(() => false),
    openNativeSubprojectRowContextMenu: vi.fn(async () => true),
    projectStatusActions: actual.projectStatusActions,
  };
});
describe('TaskList subproject rows', () => {
  it('renders subproject rows above the parent tasks when a project is selected', () => {
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
      makeTodo({ id: 2, projectId: 2, position: 0, title: 'Child task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    expect(screen.getByRole('button', { name: /focus project linked api/i })).toBeInTheDocument();
    expect(screen.getByText('Linked')).toBeInTheDocument();
  });

  it('colors the whole subproject row with the child project accent', () => {
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });

    render(
      <TaskList
        {...baseProps({ todos: [] })}
        childProjects={[child]}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    const row = screen
      .getByRole('button', { name: /focus project linked api/i })
      .closest('.subproject-row') as HTMLElement | null;

    expect(row).not.toBeNull();
    expect(row?.style.getPropertyValue('--project-accent-hue')).toMatch(/deg$/);
    expect(row?.style.getPropertyValue('--project-accent-color-light')).toMatch(/^hsl\(/);
    expect(cssRule('.task-row.subproject-row')).toContain('background: hsl(var(--project-accent-hue)');
    expect(cssRule('.task-row.subproject-row')).toContain('border-left-color: var(--project-accent-color-light);');
  });

  it('does not render subproject rows in the All Projects view', () => {
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
      makeTodo({ id: 2, projectId: 2, position: 0, title: 'Child task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={0}
        showProjectRoots
      />,
    );

    expect(screen.queryByRole('button', { name: /focus project linked api/i })).not.toBeInTheDocument();
  });

  it('expands the subproject row to show nested child tasks', () => {
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
      makeTodo({ id: 2, projectId: 2, position: 0, title: 'Child task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    expect(screen.getByRole('button', { name: /child task/i })).toBeInTheDocument();
  });

  it('shows the filtered child-task count instead of the project active count', () => {
    const child = makeProject({
      activeTodoCount: 2,
      id: 2,
      name: 'Blocked API',
      displayIdPrefix: 'BA',
    });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    expect(screen.getByText('0 tasks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subproject blocked api/i })).toBeDisabled();
  });

  it('renders a status badge when the child project is not Active', () => {
    const child = makeProject({
      id: 2,
      name: 'Blocked API',
      displayIdPrefix: 'BA',
      status: 'Blocked',
    });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    expect(screen.getByText('Blocked', { selector: 'span.state-badge' })).toBeInTheDocument();
  });

  it('focuses the subproject row body without opening the project', () => {
    const onProjectFocus = vi.fn();
    const onProjectSelect = vi.fn();
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        onProjectFocus={onProjectFocus}
        onProjectSelect={onProjectSelect}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /focus project linked api/i }));
    expect(onProjectFocus).toHaveBeenCalledWith(2);
    expect(onProjectSelect).not.toHaveBeenCalled();
  });

  it('opens the subproject from its context menu without changing row click focus behavior', () => {
    const onProjectSelect = vi.fn();
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        onProjectSelect={onProjectSelect}
        projects={[makeProject({ id: 1, name: 'Client', displayIdPrefix: 'C' }), child]}
        selectedProjectId={1}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Project' }));
    expect(onProjectSelect).toHaveBeenCalledWith(2);
  });

  it('shows toolbar actions for new tasks, subprojects, and linked projects in a selected project', () => {
    const onAddSubproject = vi.fn();
    const onLinkProject = vi.fn();
    const onOpenCreateTodo = vi.fn();
    const todos = [
      makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' }),
      makeTodo({ id: 2, projectId: 2, position: 0, title: 'Child root task' }),
    ];

    render(
      <TaskList
        {...baseProps({ todos })}
        focusedProjectId={2}
        onAddSubproject={onAddSubproject}
        onLinkProject={onLinkProject}
        onOpenCreateTodo={onOpenCreateTodo}
        selectedProjectId={1}
      />,
    );

    const actions = screen.getByLabelText('Task list actions');
    const search = screen.getByLabelText('Search tasks or ID');
    expect(search.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(actions).getByRole('button', { name: 'New task' }));
    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: null,
      position: 1,
      projectId: 2,
    });

    fireEvent.click(within(actions).getByRole('button', { name: 'Add Subproject' }));
    expect(onAddSubproject).toHaveBeenCalledWith(1);

    fireEvent.click(within(actions).getByRole('button', { name: 'Link Project…' }));
    expect(onLinkProject).toHaveBeenCalledWith(1);
  });

  it('hides project toolbar actions when All Projects is selected', () => {
    render(
      <TaskList
        {...baseProps({ todos: [] })}
        onAddSubproject={vi.fn()}
        onLinkProject={vi.fn()}
        selectedProjectId={0}
      />,
    );

    expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add Subproject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link Project…' })).not.toBeInTheDocument();
  });

  it('shows the Add Subproject and Link Project items in the list context menu when a project is selected', () => {
    const onAddSubproject = vi.fn();
    const onLinkProject = vi.fn();
    const { container } = render(
      <TaskList
        {...baseProps({ todos: [] })}
        onAddSubproject={onAddSubproject}
        onLinkProject={onLinkProject}
        selectedProjectId={1}
      />,
    );

    fireEvent.contextMenu(container.querySelector('.task-rows') as Element, {
      clientX: 30,
      clientY: 40,
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Subproject' }));
    expect(onAddSubproject).toHaveBeenCalledWith(1);

    fireEvent.contextMenu(container.querySelector('.task-rows') as Element, {
      clientX: 30,
      clientY: 40,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Link Project…' }));
    expect(onLinkProject).toHaveBeenCalledWith(1);
  });

  it('does not show Add Subproject / Link Project items when no project is selected (All Projects)', () => {
    const { container } = render(
      <TaskList
        {...baseProps({ todos: [] })}
        onAddSubproject={vi.fn()}
        onLinkProject={vi.fn()}
        selectedProjectId={0}
      />,
    );

    fireEvent.contextMenu(container.querySelector('.task-rows') as Element, {
      clientX: 30,
      clientY: 40,
    });

    expect(screen.queryByRole('menuitem', { name: 'Add Subproject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Link Project…' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'New task' })).toBeInTheDocument();
  });

  it('opens the subproject row context menu fallback with all items', () => {
    const onProjectSelect = vi.fn();
    const onOpenCreateTodo = vi.fn();
    const onAddSubproject = vi.fn();
    const onLinkProject = vi.fn();
    const onUnlinkProject = vi.fn();
    const onUpdateProjectStatus = vi.fn();
    const child = makeProject({ id: 2, name: 'Linked API', displayIdPrefix: 'LA' });
    const todos = [makeTodo({ id: 1, projectId: 1, position: 0, title: 'Parent task' })];

    render(
      <TaskList
        {...baseProps({ todos })}
        childProjects={[child]}
        onAddSubproject={onAddSubproject}
        onLinkProject={onLinkProject}
        onOpenCreateTodo={onOpenCreateTodo}
        onProjectSelect={onProjectSelect}
        onUnlinkProject={onUnlinkProject}
        onUpdateProjectStatus={onUpdateProjectStatus}
        projects={[
          makeProject({
            id: 1,
            name: 'Client A',
            displayIdPrefix: 'C',
            subprojects: [{ childProjectId: 2, kind: 'link' }],
          }),
          child,
        ]}
        selectedProjectId={1}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Project' }));
    expect(onProjectSelect).toHaveBeenCalledWith(2);

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'New task' }));
    expect(onOpenCreateTodo).toHaveBeenCalledWith({
      parentId: null,
      position: 0,
      projectId: 2,
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Subproject' }));
    expect(onAddSubproject).toHaveBeenCalledWith(2);

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Link Project…' }));
    expect(onLinkProject).toHaveBeenCalledWith(2);

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark Done' }));
    expect(onUpdateProjectStatus).toHaveBeenCalledWith(2, 'Done');

    fireEvent.contextMenu(screen.getByRole('button', { name: /focus project linked api/i }), {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: /unlink from client a/i }));
    expect(onUnlinkProject).toHaveBeenCalledWith(1, 2);
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

function makeProject(
  overrides: Pick<ProjectSummary, 'id'> & Partial<ProjectSummary>,
): ProjectSummary {
  const { id, ...rest } = overrides;
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 1,
    status: 'Active' as const,
    inheritParent: false,
    subprojects: [],
    aiDefaultIncludeProjectNotes: false,
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

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}
