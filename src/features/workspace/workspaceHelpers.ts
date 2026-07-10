import { homeDir } from '@tauri-apps/api/path';

import type {
  ProjectActionSummary,
  ProjectActionsDirectorySummary,
  ProjectSummary,
  TodoState,
  TodoSummary,
} from '../../domain/domain';
import { compareTodos, isReviewState } from '../../domain/domain';

export type TaskFilter =
  | 'tasks'
  | 'review'
  | 'feedback'
  | 'todo'
  | 'delegated'
  | 'blocked'
  | 'archived';
export type TaskSortMode =
  | 'manual'
  | 'default'
  | 'priority'
  | 'deadline'
  | 'state'
  | 'updated'
  | 'created';

const priorityRank: Record<TodoSummary['priority'], number> = {
  None: 0,
  Low: 1,
  Medium: 2,
  High: 3,
  Urgent: 4,
};

export function newActionTaskDescription(project?: ProjectSummary): string {
  const workingDirectory = project?.workingDirectory ?? '<project-working-directory>';

  return [
    '# Project action task',
    '',
    `Create or update a Boomerang project action for ${project?.name ?? 'this project'}.`,
    '',
    `Action files live under \`${project?.actionsDirectory ?? 'actions'}\` relative to:`,
    '',
    '```text',
    workingDirectory,
    '```',
    '',
    'Use a single `.sh` or `.py` file with metadata comments at the top: `title`, `description`, `icon`, and one `arg` line per argument.',
  ].join('\n');
}

export function filterTasks(
  todos: TodoSummary[],
  filter: TaskFilter,
  stateFilter: TodoState | '',
  searchValue: string,
  tagFilter: string,
  reviewTodoIds: ReadonlySet<number> = new Set(),
  hideDelegated = false,
): TodoSummary[] {
  const query = searchValue.trim().toLowerCase();
  return todos.filter((todo) => {
    if (hideDelegated && todo.state === 'Delegated') {
      return false;
    }
    if (stateFilter) {
      if (todo.state !== stateFilter) {
        return false;
      }
    } else {
      if (!matchesTaskFilter(todo, filter, reviewTodoIds)) {
        return false;
      }
    }
    if (tagFilter && !todo.tags.includes(tagFilter)) {
      return false;
    }
    if (!query) {
      return true;
    }

    return [
      todo.displayId,
      todo.title,
      todo.state,
      todo.priority,
      ...todo.tags,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

export function matchesTaskFilter(
  todo: TodoSummary,
  filter: TaskFilter,
  reviewTodoIds: ReadonlySet<number> = new Set(),
): boolean {
  switch (filter) {
    case 'tasks':
      return isTasksFilterTodo(todo);
    case 'review':
      return isReviewFilterTodo(todo, reviewTodoIds);
    case 'feedback':
      return isNeedsFeedbackFilterTodo(todo);
    case 'todo':
      return isTodoFilterTodo(todo);
    case 'delegated':
      return todo.state === 'Delegated';
    case 'blocked':
      return isBlockedFilterTodo(todo);
    case 'archived':
      return todo.state === 'Archived';
  }
}

export function isTasksFilterTodo(todo: TodoSummary): boolean {
  return !['Blocked', 'Waiting', 'Done', 'Archived'].includes(todo.state);
}

export function isReviewFilterTodo(
  todo: TodoSummary,
  reviewTodoIds: ReadonlySet<number> = new Set(),
): boolean {
  return (
    todo.state !== 'Done' &&
    todo.state !== 'Archived' &&
    (todo.state === 'Ready to Test' || hasUnreadReviewAttention(todo, reviewTodoIds))
  );
}

export function isNeedsFeedbackFilterTodo(todo: TodoSummary): boolean {
  return todo.state === 'Needs Feedback';
}

export function isTodoFilterTodo(todo: TodoSummary): boolean {
  return (
    (todo.state === 'To Do' || todo.state === 'Doing') &&
    todo.dependencies.every((dependency) => isCompleteDependencyState(dependency.state)) &&
    (todo.subtasks.length === 0 || todo.subtasks.every((subtask) => subtask.done))
  );
}

function isCompleteDependencyState(state: TodoState): boolean {
  return state === 'Done' || state === 'Archived';
}

export function isBlockedFilterTodo(todo: TodoSummary): boolean {
  return todo.state === 'Blocked' || todo.state === 'Waiting';
}

export function sortTasks(
  todos: TodoSummary[],
  sortMode: TaskSortMode,
  reviewTodoIds: ReadonlySet<number> = new Set(),
): TodoSummary[] {
  const next = [...todos];
  switch (sortMode) {
    case 'manual':
      return next.sort((a, b) => a.position - b.position || a.id - b.id);
    case 'deadline':
      return next.sort(
        (a, b) =>
          (a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY) -
          (b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY),
      );
    case 'state':
      return next.sort((a, b) => a.state.localeCompare(b.state) || compareTodos(a, b));
    case 'updated':
      return next.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    case 'created':
      return next.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case 'priority':
    case 'default':
    default:
      return next.sort((a, b) => compareTodosWithAttention(a, b, reviewTodoIds));
  }
}

function compareTodosWithAttention(
  a: TodoSummary,
  b: TodoSummary,
  reviewTodoIds: ReadonlySet<number>,
): number {
  const priorityDelta = priorityRank[b.priority] - priorityRank[a.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const aNeedsReview = isReviewState(a.state) || hasUnreadReviewAttention(a, reviewTodoIds);
  const bNeedsReview = isReviewState(b.state) || hasUnreadReviewAttention(b, reviewTodoIds);
  const reviewDelta = Number(bNeedsReview) - Number(aNeedsReview);
  if (reviewDelta !== 0) {
    return reviewDelta;
  }

  const deadlineDelta = getDeadlineRank(a.deadline) - getDeadlineRank(b.deadline);
  if (deadlineDelta !== 0) {
    return deadlineDelta;
  }

  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function getDeadlineRank(deadline: string | null): number {
  return deadline ? new Date(deadline).getTime() : Number.MAX_SAFE_INTEGER;
}

function hasUnreadReviewAttention(
  todo: TodoSummary,
  reviewTodoIds: ReadonlySet<number>,
): boolean {
  return (
    reviewTodoIds.has(todo.id) &&
    todo.state !== 'Delegated' &&
    todo.state !== 'Needs Feedback' &&
    todo.state !== 'Done' &&
    todo.state !== 'Archived'
  );
}

export function defaultProjectActions(project: ProjectSummary): ProjectActionSummary[] {
  return [
    {
      arguments: [],
      description: 'Open this project folder.',
      fileName: 'boomerang:open-folder',
      icon: 'Folder',
      iconConfigured: false,
      path: null,
      runtime: 'native',
      title: 'Open Folder',
      validationError: project.workingDirectory ? null : 'Project working directory is missing.',
    },
  ];
}

export function defaultProjectActionsDirectory(project: ProjectSummary): ProjectActionsDirectorySummary {
  const actionsDirectory = project.actionsDirectory.trim() || 'actions';
  const workingDirectory = expandHomeFallback(project.workingDirectory);
  const path = actionsDirectory.startsWith('/')
    ? actionsDirectory
    : `${workingDirectory.replace(/\/$/, '')}/${actionsDirectory}`;

  return {
    exists: false,
    path,
  };
}

function expandHomeFallback(path: string): string {
  if (!path.startsWith('~/')) {
    return path;
  }

  return `/Users/markcl/${path.slice(2)}`;
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export async function expandHomeForDeepLink(path: string): Promise<string> {
  if (!path.startsWith('~/')) {
    return path;
  }

  try {
    const home = await homeDir();
    return `${home.replace(/\/$/, '')}/${path.slice(2)}`;
  } catch {
    return path;
  }
}
