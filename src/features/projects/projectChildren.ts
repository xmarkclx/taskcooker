import type { ProjectSummary, ProjectStatus, TodoState } from '../../domain/domain';
import type { TaskFilter } from '../workspace/workspaceHelpers';

// Task-list view filter → project status (used when stateFilter is empty).
// - 'tasks' (default) → Active children only
// - 'blocked'         → Blocked children
// - 'archived'        → Archived children
// - other filters     → no children
const FILTER_TO_STATUS: Partial<Record<TaskFilter, ProjectStatus>> = {
  tasks: 'Active',
  blocked: 'Blocked',
  archived: 'Archived',
};

// TodoState → ProjectStatus mapping (used when stateFilter is set).
// Only the four project statuses map; other task states show no children.
const STATE_TO_STATUS: Partial<Record<TodoState, ProjectStatus>> = {
  Blocked: 'Blocked',
  Done: 'Done',
  Archived: 'Archived',
};

/**
 * Direct children of `parent` whose status matches the task list's current
 * view, ordered by name. The view is the combination of `filter` (the view
 * mode) and `stateFilter` (an explicit state selector that overrides `filter`
 * when non-empty):
 * - stateFilter set → children with the matching project status
 *   (Blocked/Done/Archived; other task states show none).
 * - stateFilter ''  → children matching the view-mode mapping above.
 */
export function visibleChildProjects(
  parent: ProjectSummary,
  projects: ProjectSummary[],
  filter: TaskFilter,
  stateFilter: TodoState | '' = '',
): ProjectSummary[] {
  const status =
    stateFilter !== ''
      ? STATE_TO_STATUS[stateFilter]
      : FILTER_TO_STATUS[filter];
  if (!status) {
    return [];
  }
  const byId = new Map(projects.map((p) => [p.id, p]));
  return parent.subprojects
    .map((edge) => byId.get(edge.childProjectId))
    .filter((child): child is ProjectSummary => Boolean(child))
    .filter((child) => child.status === status)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Set of every project id that appears as a child of any parent (any kind).
 * Used to hide children from the picker's top-level list.
 */
export function childProjectIds(projects: ProjectSummary[]): Set<number> {
  const ids = new Set<number>();
  for (const project of projects) {
    for (const edge of project.subprojects) {
      ids.add(edge.childProjectId);
    }
  }
  return ids;
}

/**
 * Projects that can be linked under `parentId` as a linked project.
 * Excludes:
 * - the parent itself (self-link)
 * - existing children of this parent (duplicate edge)
 * - subprojects anywhere (single-parent rule)
 * - ancestors of the parent (cycle rule)
 * Ordered by name.
 */
export function linkableProjects(
  parentId: number,
  projects: ProjectSummary[],
): ProjectSummary[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const existingChildren = new Set<number>();
  const parent = byId.get(parentId);
  if (parent) {
    for (const edge of parent.subprojects) {
      existingChildren.add(edge.childProjectId);
    }
  }

  const subprojectsEverywhere = new Set<number>();
  for (const project of projects) {
    for (const edge of project.subprojects) {
      if (edge.kind === 'subproject') {
        subprojectsEverywhere.add(edge.childProjectId);
      }
    }
  }

  const ancestors = ancestorIds(parentId, byId);

  return projects
    .filter((candidate) => candidate.id !== parentId)
    .filter((candidate) => !existingChildren.has(candidate.id))
    .filter((candidate) => !subprojectsEverywhere.has(candidate.id))
    .filter((candidate) => !ancestors.has(candidate.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ancestorIds(
  startId: number,
  byId: Map<number, ProjectSummary>,
): Set<number> {
  const ancestors = new Set<number>();
  const visited = new Set<number>();
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const parentIds = findAllParentEdges(current, byId);
    for (const parentId of parentIds) {
      ancestors.add(parentId);
      stack.push(parentId);
    }
  }
  return ancestors;
}

function findAllParentEdges(
  childId: number,
  byId: Map<number, ProjectSummary>,
): number[] {
  const parents: number[] = [];
  for (const project of byId.values()) {
    for (const edge of project.subprojects) {
      if (edge.childProjectId === childId) {
        parents.push(project.id);
      }
    }
  }
  return parents;
}
