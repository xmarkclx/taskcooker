import { type CSSProperties, useEffect, useState } from 'react';
import type { RouterHistory } from '@tanstack/react-router';

import type {
  ActionRunSummary,
  AppSnapshot,
  AppThemePreference,
  ExecutionTerminalSummary,
  ProjectSummary,
  ResolvedAppTheme,
  RunningTimerSummary,
  TodoState,
  TodoSummary,
} from '../domain/domain';
import { deleteTodoLocally, markTodoMessagesReadLocally } from '../domain/snapshotActions';
import type { TaskSelectorOption } from '../features/tasks/TaskSelector';
import type { AppNotificationPayload } from '../tauri/events';
import { readNewTaskParentId } from './appShellDrafts';

const SYSTEM_DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Title, description and submit label for the New Task / subtask / action dialog. */
export function resolveNewTaskDialogCopy(
  kind: 'task' | 'worktree-task' | 'action' | undefined,
  isSubtask: boolean,
  parentDisplayId: string | undefined,
  projectName: string | undefined,
): { title: string; description: string; submitLabel: string } {
  if (kind === 'action') {
    return {
      title: 'New action task',
      description: 'Create a task that writes or updates a project action file.',
      submitLabel: 'Create Task',
    };
  }

  if (isSubtask) {
    return {
      title: 'New subtask',
      description: `Create a subtask under ${parentDisplayId ?? 'the selected task'}.`,
      submitLabel: 'Create Subtask',
    };
  }

  return {
    title: 'New task',
    description: `Create a task in ${projectName ?? 'the selected project'}.`,
    submitLabel: 'Create Task',
  };
}

/**
 * Resolves the parent-task picker state for the New Task dialog: the tasks that
 * are listable as parents (project tasks that are not archived) and the
 * remembered per-project parent, kept only while it is still a valid option.
 */
export function resolveNewTaskParentSelection(
  enabled: boolean,
  projectId: number | undefined,
  todos: TodoSummary[],
): { parentOptions?: TaskSelectorOption[]; initialParentId: number | null } {
  if (!enabled || !projectId) {
    return { initialParentId: null };
  }

  const parentOptions = todos
    .filter((todo) => todo.projectId === projectId && todo.state !== 'Archived')
    .map((todo) => ({ id: todo.id, displayId: todo.displayId, title: todo.title }));
  const remembered = readNewTaskParentId(projectId);
  const initialParentId = parentOptions.some((option) => option.id === remembered)
    ? remembered
    : null;

  return { parentOptions, initialParentId };
}

export function resolveTaskActionProject({
  selectedProject,
  selectedTodoContextProject,
  selectedTodoProject,
}: {
  selectedProject?: ProjectSummary;
  selectedTodoContextProject?: ProjectSummary;
  selectedTodoProject?: ProjectSummary;
}): ProjectSummary | undefined {
  return selectedTodoContextProject ?? selectedTodoProject ?? selectedProject;
}

export function todosVisibleInProjectScope({
  isAllProjects,
  projectId,
  todos,
  visibleChildProjectIds,
}: {
  isAllProjects: boolean;
  projectId: number | undefined;
  todos: TodoSummary[];
  visibleChildProjectIds: ReadonlySet<number>;
}): TodoSummary[] {
  if (isAllProjects) {
    return todos;
  }

  const visibleTodoIds = new Set<number>();
  const childrenByParentId = new Map<number, TodoSummary[]>();
  for (const todo of todos) {
    if (todo.parentId !== undefined && todo.parentId !== null) {
      const children = childrenByParentId.get(todo.parentId) ?? [];
      children.push(todo);
      childrenByParentId.set(todo.parentId, children);
    }
    if (todo.projectId === projectId || visibleChildProjectIds.has(todo.projectId)) {
      visibleTodoIds.add(todo.id);
    }
  }

  const includeTree = (todoId: number) => {
    if (visibleTodoIds.has(todoId)) {
      return;
    }
    visibleTodoIds.add(todoId);
    for (const child of childrenByParentId.get(todoId) ?? []) {
      includeTree(child.id);
    }
  };

  for (const todo of todos) {
    if (!visibleTodoIds.has(todo.id)) {
      continue;
    }
    for (const linkedTask of todo.linkedTasks ?? []) {
      includeTree(linkedTask.id);
    }
  }

  return todos.filter((todo) => visibleTodoIds.has(todo.id));
}

/**
 * Removes the todos from the snapshot and moves selection before the backend
 * delete round-trip. onError restores the pre-delete snapshot with an error
 * toast; preview mode keeps the optimistic state as its offline fallback.
 */
export function deleteTodosOptimistically({
  applySnapshot,
  deleteTodos,
  navigateToSnapshotSelection,
  previousSnapshot,
  previewFallbacksEnabled,
  showToast,
  todoIds,
}: {
  applySnapshot: (snapshot: AppSnapshot) => void;
  deleteTodos: (
    input: { todoIds: number[] },
    options: { onError: (error: unknown) => void },
  ) => void;
  navigateToSnapshotSelection: (snapshot: AppSnapshot) => void;
  previousSnapshot: AppSnapshot;
  previewFallbacksEnabled: boolean;
  showToast: (payload: AppNotificationPayload) => void;
  todoIds: number[];
}): void {
  const optimistic = todoIds.reduce(
    (snapshot, todoId) => deleteTodoLocally(snapshot, todoId),
    previousSnapshot,
  );
  applySnapshot(optimistic);
  navigateToSnapshotSelection(optimistic);
  deleteTodos(
    { todoIds },
    {
      onError: (error) => {
        if (previewFallbacksEnabled) {
          return;
        }

        applySnapshot(previousSnapshot);
        navigateToSnapshotSelection(previousSnapshot);
        showToast({
          body: error instanceof Error ? error.message : String(error),
          kind: 'error',
          title: 'Could not delete tasks',
        });
      },
    },
  );
}

export function useResolvedTheme(theme: AppThemePreference): ResolvedAppTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedAppTheme>(() => readSystemTheme());

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia(SYSTEM_DARK_MEDIA_QUERY);
    const updateSystemTheme = (event?: Pick<MediaQueryListEvent, 'matches'>) => {
      setSystemTheme((event?.matches ?? query.matches) ? 'dark' : 'light');
    };

    updateSystemTheme();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', updateSystemTheme);
      return () => query.removeEventListener('change', updateSystemTheme);
    }

    query.addListener(updateSystemTheme);
    return () => query.removeListener(updateSystemTheme);
  }, [theme]);

  return theme === 'system' ? systemTheme : theme;
}

export function useHistoryNavigationState(history: RouterHistory): {
  canGoBack: boolean;
  canGoForward: boolean;
} {
  const [bounds, setBounds] = useState(() => {
    const currentIndex = history.location.state.__TSR_index;
    return {
      currentIndex,
      maxIndex: currentIndex,
    };
  });

  useEffect(() => {
    const currentIndex = history.location.state.__TSR_index;
    setBounds({
      currentIndex,
      maxIndex: currentIndex,
    });

    return history.subscribe(({ action, location }) => {
      const nextIndex = location.state.__TSR_index;
      setBounds((previous) => ({
        currentIndex: nextIndex,
        maxIndex:
          action.type === 'PUSH'
            ? nextIndex
            : Math.max(previous.maxIndex, nextIndex),
      }));
    });
  }, [history]);

  return {
    canGoBack: bounds.currentIndex > 0,
    canGoForward: bounds.currentIndex < bounds.maxIndex,
  };
}

export function useMarkSelectedTodoMessagesRead({
  appSnapshotIsPlaceholder,
  markMessagesRead,
  markMessagesReadPending,
  previewFallbacksEnabled,
  selectedTodo,
  setPreviewSnapshot,
  unreadTodoIds,
}: {
  appSnapshotIsPlaceholder: boolean;
  markMessagesRead: (input: { todoId: number }) => void;
  markMessagesReadPending: boolean;
  previewFallbacksEnabled: boolean;
  selectedTodo?: TodoSummary;
  setPreviewSnapshot: (updater: (snapshot: AppSnapshot) => AppSnapshot) => void;
  unreadTodoIds: ReadonlySet<number>;
}) {
  useEffect(() => {
    if (
      appSnapshotIsPlaceholder ||
      !selectedTodo ||
      !unreadTodoIds.has(selectedTodo.id) ||
      markMessagesReadPending
    ) {
      return;
    }

    if (previewFallbacksEnabled) {
      setPreviewSnapshot((snapshot) => markTodoMessagesReadLocally(snapshot, selectedTodo.id));
      return;
    }

    markMessagesRead({ todoId: selectedTodo.id });
  }, [
    appSnapshotIsPlaceholder,
    markMessagesRead,
    markMessagesReadPending,
    previewFallbacksEnabled,
    selectedTodo?.id,
    setPreviewSnapshot,
    unreadTodoIds,
  ]);
}

export function usePreventBrowserBackspaceNavigation() {
  useEffect(() => {
    const preventBrowserBackspaceNavigation = (event: KeyboardEvent) => {
      if (shouldPreventBrowserBackspaceNavigation(event)) {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', preventBrowserBackspaceNavigation, { capture: true });
    return () => {
      document.removeEventListener('keydown', preventBrowserBackspaceNavigation, { capture: true });
    };
  }, []);
}

const EDITABLE_INPUT_TYPES = new Set([
  '',
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week',
]);

export function shouldPreventBrowserBackspaceNavigation(event: KeyboardEvent): boolean {
  return event.key === 'Backspace' && !isEditableBackspaceTarget(event.target);
}

function isEditableBackspaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  if (target instanceof HTMLInputElement) {
    return !target.readOnly && !target.disabled && EDITABLE_INPUT_TYPES.has(target.type);
  }

  return Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'));
}

function readSystemTheme(): ResolvedAppTheme {
  if (typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(SYSTEM_DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function withTimerState(
  timer: RunningTimerSummary,
  todo: TodoSummary | undefined,
): RunningTimerSummary & { state: TodoState } {
  return {
    ...timer,
    state: todo?.state ?? 'Doing',
  };
}

export function actionRunExecutionTerminal(
  run: ActionRunSummary,
): ExecutionTerminalSummary | null {
  if (run.ptyId === null || run.todoId === null) {
    return null;
  }

  return {
    exitCode: run.exitCode,
    kind: 'terminal',
    label: `Action · ${run.actionTitle}`,
    ptyId: run.ptyId,
    state: actionRunTerminalState(run.state),
    todoId: run.todoId,
  };
}

function actionRunTerminalState(state: string): ExecutionTerminalSummary['state'] {
  if (state === 'failed') {
    return 'failed';
  }
  if (state === 'running' || state === 'starting') {
    return 'running';
  }
  return 'exited';
}

export function countChildrenForParent(
  todos: TodoSummary[],
  projectId: number,
  parentId: number | null,
  excludedTodoId: number,
): number {
  const childIds = new Set<number>();
  for (const todo of todos) {
    if (
      todo.projectId === projectId &&
      todo.id !== excludedTodoId &&
      (todo.parentId ?? null) === parentId
    ) {
      childIds.add(todo.id);
    }
  }

  if (parentId !== null) {
    const parent = todos.find((todo) => todo.id === parentId);
    for (const subtask of parent?.subtasks ?? []) {
      if (subtask.id !== excludedTodoId) {
        childIds.add(subtask.id);
      }
    }
  }

  return childIds.size;
}

export function confirmUnfinishedDependencyWarning(todo: TodoSummary): boolean {
  const unfinishedDependencies = todo.dependencies.filter(
    (dependency) => dependency.state !== 'Done' && dependency.state !== 'Archived',
  );
  if (!unfinishedDependencies.length) {
    return true;
  }

  const dependencyList = unfinishedDependencies
    .map((dependency) => `${dependency.displayId} ${dependency.title}`)
    .join('\n');
  return window.confirm(
    `This task has unfinished dependencies:\n\n${dependencyList}\n\nStart the AI session anyway?`,
  );
}

type ProjectAccentStyle = CSSProperties & {
  '--project-accent-hue': string;
  '--project-accent-saturation': string;
  '--project-accent-soft-saturation': string;
  '--project-accent-color-light': string;
  '--project-accent-color-dark': string;
};

const PROJECT_ACCENT_HUES = [
  210, 348, 126, 264, 42, 180, 318, 96, 234, 12, 150, 288, 66, 204, 342, 120, 252, 30,
];
const PROJECT_ACCENT_MIN_DISTANCE = 40;
const PROJECT_ACCENT_PROBE_STEP = 5;

export function projectAccentStyle(
  project: ProjectSummary | undefined,
  projects: ProjectSummary[] = project ? [project] : [],
): ProjectAccentStyle | undefined {
  if (!project) {
    return undefined;
  }

  const accent = projectAccent(project, projects);

  return {
    '--project-accent-hue': `${accent.hue}deg`,
    '--project-accent-saturation': `${accent.saturation}%`,
    '--project-accent-soft-saturation': `${Math.max(48, accent.saturation - 14)}%`,
    '--project-accent-color-light': `hsl(${accent.hue}deg ${accent.saturation}% 34%)`,
    '--project-accent-color-dark': `hsl(${accent.hue}deg ${accent.saturation}% 42%)`,
  };
}

function projectAccent(
  project: ProjectSummary,
  projects: ProjectSummary[],
): { hue: number; saturation: number } {
  const assignments = projectAccentAssignments(projects.length ? projects : [project]);
  return (
    assignments.get(projectAccentKey(project)) ?? {
      hue: PROJECT_ACCENT_HUES[projectNameHash(project.name) % PROJECT_ACCENT_HUES.length],
      saturation: projectAccentSaturation(project.name),
    }
  );
}

function projectAccentAssignments(
  projects: ProjectSummary[],
): Map<string, { hue: number; saturation: number }> {
  const assignments = new Map<string, { hue: number; saturation: number }>();
  const usedHues: number[] = [];
  const usedSlots = new Set<number>();
  const sortedProjects = [...projects].sort((left, right) => {
    const nameOrder = normalizeProjectName(left.name).localeCompare(normalizeProjectName(right.name));
    return nameOrder || left.id - right.id;
  });

  for (const project of sortedProjects) {
    const hash = projectNameHash(project.name);
    const hue = chooseProjectAccentHue(hash, usedSlots, usedHues);
    usedHues.push(hue);
    assignments.set(projectAccentKey(project), {
      hue,
      saturation: 68 + (hash % 11),
    });
  }

  return assignments;
}

function chooseProjectAccentHue(hash: number, usedSlots: Set<number>, usedHues: number[]): number {
  const preferredSlot = hash % PROJECT_ACCENT_HUES.length;

  for (let attempt = 0; attempt < PROJECT_ACCENT_HUES.length; attempt += 1) {
    const slot = (preferredSlot + attempt * PROJECT_ACCENT_PROBE_STEP) % PROJECT_ACCENT_HUES.length;
    const hue = PROJECT_ACCENT_HUES[slot];
    if (!usedSlots.has(slot) && isSeparatedHue(hue, usedHues)) {
      usedSlots.add(slot);
      return hue;
    }
  }

  for (let attempt = 0; attempt < PROJECT_ACCENT_HUES.length; attempt += 1) {
    const slot = (preferredSlot + attempt * PROJECT_ACCENT_PROBE_STEP) % PROJECT_ACCENT_HUES.length;
    if (!usedSlots.has(slot)) {
      usedSlots.add(slot);
      return PROJECT_ACCENT_HUES[slot];
    }
  }

  return overflowProjectAccentHue(hash, usedHues);
}

function overflowProjectAccentHue(hash: number, usedHues: number[]): number {
  let bestHue = hash % 360;
  let bestDistance = -1;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const hue = (hash + attempt * 137) % 360;
    const distance = Math.min(...usedHues.map((usedHue) => circularHueDistance(hue, usedHue)));
    if (distance > bestDistance) {
      bestDistance = distance;
      bestHue = hue;
    }
    if (distance >= PROJECT_ACCENT_MIN_DISTANCE) {
      return hue;
    }
  }

  return bestHue;
}

function isSeparatedHue(hue: number, usedHues: number[]): boolean {
  return usedHues.every(
    (usedHue) => circularHueDistance(hue, usedHue) >= PROJECT_ACCENT_MIN_DISTANCE,
  );
}

function circularHueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right);
  return Math.min(distance, 360 - distance);
}

function projectAccentSaturation(name: string): number {
  return 68 + (projectNameHash(name) % 11);
}

function projectAccentKey(project: ProjectSummary): string {
  return `${project.id}:${normalizeProjectName(project.name)}`;
}

function normalizeProjectName(name: string): string {
  return name.trim().toLocaleLowerCase() || 'project';
}

function projectNameHash(name: string): number {
  const normalized = normalizeProjectName(name);
  let hash = 2_166_136_261;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }

  return hash;
}
