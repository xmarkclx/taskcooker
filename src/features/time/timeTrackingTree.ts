import type { ProjectSummary, TodoSummary } from '../../domain/domain';
import {
  summarizeTodoTime,
  type TimeRangeSelection,
} from './timeRange';

export type TimeTrackingPreset = 'today' | 'week' | 'month';

export type TimeTrackingTaskNode = {
  children: TimeTrackingTaskNode[];
  ownTimeSeconds: number;
  rolledUpTimeSeconds: number;
  todo: TodoSummary;
};

export type TimeTrackingProjectNode = {
  project: ProjectSummary;
  tasks: TimeTrackingTaskNode[];
  totalSeconds: number;
};

export type TimeTrackingReport = {
  projects: TimeTrackingProjectNode[];
  totalSeconds: number;
};

export function timeTrackingSelection(
  preset: TimeTrackingPreset,
  now = new Date(),
): TimeRangeSelection {
  if (preset === 'today') {
    return {
      amount: 1,
      endLocal: '',
      mode: 'today',
      startLocal: '',
      unit: 'days',
    };
  }

  const start = new Date(now);
  if (preset === 'week') {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);

  return {
    amount: 1,
    endLocal: formatLocalDateTime(now),
    mode: 'custom',
    startLocal: formatLocalDateTime(start),
    unit: 'days',
  };
}

export function buildTimeTrackingReport({
  now,
  projectId,
  projects,
  selection,
  todos,
}: {
  now: Date;
  projectId: number;
  projects: ProjectSummary[];
  selection: TimeRangeSelection;
  todos: TodoSummary[];
}): TimeTrackingReport {
  const scopedProjectIds = projectIdsInScope(projectId, projects);
  const scopedTodos = todos.filter((todo) => scopedProjectIds.has(todo.projectId));
  const todoById = new Map(scopedTodos.map((todo) => [todo.id, todo]));
  const projectNodes = projects
    .filter((project) => scopedProjectIds.has(project.id))
    .map((project) => {
      const projectTodos = scopedTodos.filter((todo) => todo.projectId === project.id);
      const projectTodoIds = new Set(projectTodos.map((todo) => todo.id));
      const roots = projectTodos
        .filter((todo) => !todo.parentId || !projectTodoIds.has(todo.parentId))
        .sort(compareTodoPosition)
        .map((todo) => buildTaskNode(todo, todoById, scopedTodos, selection, now))
        .filter((node): node is TimeTrackingTaskNode => Boolean(node));
      const totalSeconds = projectTodos.reduce(
        (total, todo) =>
          total + summarizeTodoTime(todo, [todo], selection, now).ownTimeSeconds,
        0,
      );
      return { project, tasks: roots, totalSeconds };
    })
    .filter((node) => node.totalSeconds > 0 || node.tasks.length > 0);

  return {
    projects: projectNodes,
    totalSeconds: projectNodes.reduce((total, project) => total + project.totalSeconds, 0),
  };
}

function projectIdsInScope(projectId: number, projects: ProjectSummary[]): Set<number> {
  if (projectId === 0) {
    return new Set(projects.map((project) => project.id));
  }

  const byId = new Map(projects.map((project) => [project.id, project]));
  const included = new Set<number>();
  const pending = [projectId];
  while (pending.length > 0) {
    const currentId = pending.pop()!;
    if (included.has(currentId)) {
      continue;
    }
    included.add(currentId);
    const current = byId.get(currentId);
    if (current) {
      pending.push(...current.subprojects.map((edge) => edge.childProjectId));
    }
  }
  return included;
}

function buildTaskNode(
  todo: TodoSummary,
  todoById: Map<number, TodoSummary>,
  allTodos: TodoSummary[],
  selection: TimeRangeSelection,
  now: Date,
  ancestors = new Set<number>(),
): TimeTrackingTaskNode | null {
  const summary = summarizeTodoTime(todo, allTodos, selection, now);
  if (summary.rolledUpTimeSeconds <= 0) {
    return null;
  }

  if (ancestors.has(todo.id)) {
    return {
      children: [],
      ownTimeSeconds: summary.ownTimeSeconds,
      rolledUpTimeSeconds: summary.ownTimeSeconds,
      todo,
    };
  }

  const nextAncestors = new Set(ancestors).add(todo.id);
  const children = todo.subtasks
    .map((subtask) => todoById.get(subtask.id))
    .filter((child): child is TodoSummary => Boolean(child))
    .sort(compareTodoPosition)
    .map((child) =>
      buildTaskNode(child, todoById, allTodos, selection, now, nextAncestors),
    )
    .filter((node): node is TimeTrackingTaskNode => Boolean(node));

  return {
    children,
    ownTimeSeconds: summary.ownTimeSeconds,
    rolledUpTimeSeconds: summary.rolledUpTimeSeconds,
    todo,
  };
}

function compareTodoPosition(left: TodoSummary, right: TodoSummary): number {
  return left.position - right.position || left.id - right.id;
}

function formatLocalDateTime(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}
