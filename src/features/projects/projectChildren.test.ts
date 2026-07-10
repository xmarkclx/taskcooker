import { describe, expect, it } from 'vitest';

import type { ProjectSummary } from '../../domain/domain';
import type { TaskFilter } from '../workspace/workspaceHelpers';

import {
  childProjectIds,
  linkableProjects,
  visibleChildProjects,
} from './projectChildren';

type ProjectOverrides = Partial<ProjectSummary> & { id: number };

function project(overrides: ProjectOverrides): ProjectSummary {
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 0,
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: `P${overrides.id}`,
    mainBranch: 'main',
    name: `Project ${overrides.id}`,
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    status: 'Active',
    inheritParent: false,
    subprojects: [],
    terminalWslEnabled: false,
    workingDirectory: `~/p/project-${overrides.id}`,
    ...overrides,
  };
}

function subproject(child: ProjectSummary): ProjectSummary['subprojects'][number] {
  return { childProjectId: child.id, kind: 'subproject' as const };
}

function link(child: ProjectSummary): ProjectSummary['subprojects'][number] {
  return { childProjectId: child.id, kind: 'link' as const };
}

describe('visibleChildProjects', () => {
  const parent = project({ id: 1 });
  const activeChild = project({ id: 2, name: 'Active Child' });
  const blockedChild = project({ id: 3, name: 'Blocked Child', status: 'Blocked' });
  const doneChild = project({ id: 4, name: 'Done Child', status: 'Done' });
  const archivedChild = project({ id: 5, name: 'Archived Child', status: 'Archived' });
  const projectsWithChildren: ProjectSummary[] = [
    {
      ...parent,
      subprojects: [subproject(activeChild), subproject(blockedChild), subproject(doneChild), subproject(archivedChild)],
    },
    activeChild,
    blockedChild,
    doneChild,
    archivedChild,
  ];

  it('shows only Active children in the default tasks view (no stateFilter)', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'tasks');
    expect(result.map((p) => p.name)).toEqual(['Active Child']);
  });

  it('shows Blocked children in the blocked view filter', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'blocked');
    expect(result.map((p) => p.name)).toEqual(['Blocked Child']);
  });

  it('shows Archived children in the archived view filter', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'archived');
    expect(result.map((p) => p.name)).toEqual(['Archived Child']);
  });

  it('shows Done children when stateFilter is Done', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'tasks', 'Done');
    expect(result.map((p) => p.name)).toEqual(['Done Child']);
  });

  it('shows Blocked children when stateFilter is Blocked', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'tasks', 'Blocked');
    expect(result.map((p) => p.name)).toEqual(['Blocked Child']);
  });

  it('shows Archived children when stateFilter is Archived', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'tasks', 'Archived');
    expect(result.map((p) => p.name)).toEqual(['Archived Child']);
  });

  it('stateFilter overrides the view filter', () => {
    const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'archived', 'Blocked');
    expect(result.map((p) => p.name)).toEqual(['Blocked Child']);
  });

  it('shows no children for non-matching task-state filters', () => {
    for (const state of ['To Do', 'Doing', 'Waiting', 'Ready to Test', 'Needs Feedback', 'Delegated'] as const) {
      const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, 'tasks', state);
      expect(result).toEqual([]);
    }
  });

  it('shows no children for todo/delegated/review/feedback view filters (no stateFilter)', () => {
    for (const filter of ['todo', 'delegated', 'review', 'feedback'] as TaskFilter[]) {
      const result = visibleChildProjects(projectsWithChildren[0], projectsWithChildren, filter);
      expect(result).toEqual([]);
    }
  });

  it('returns children ordered by name', () => {
    const zeta = project({ id: 10, name: 'Zeta' });
    const alpha = project({ id: 11, name: 'Alpha' });
    const projects: ProjectSummary[] = [
      { ...parent, subprojects: [subproject(zeta), subproject(alpha)] },
      zeta,
      alpha,
    ];
    const result = visibleChildProjects(projects[0], projects, 'tasks');
    expect(result.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('shows a linked project under each of its parents', () => {
    const parentA = project({ id: 20, name: 'Parent A' });
    const parentB = project({ id: 21, name: 'Parent B' });
    const sharedChild = project({ id: 22, name: 'Shared' });
    const projects: ProjectSummary[] = [
      { ...parentA, subprojects: [link(sharedChild)] },
      { ...parentB, subprojects: [link(sharedChild)] },
      sharedChild,
    ];
    expect(visibleChildProjects(projects[0], projects, 'tasks').map((p) => p.name)).toEqual(['Shared']);
    expect(visibleChildProjects(projects[1], projects, 'tasks').map((p) => p.name)).toEqual(['Shared']);
  });

  it('returns empty when the parent has no subprojects', () => {
    expect(visibleChildProjects(parent, [parent], 'tasks')).toEqual([]);
  });
});

describe('childProjectIds', () => {
  it('collects ids of every project that is a child anywhere', () => {
    const parent = project({ id: 1, subprojects: [subproject(project({ id: 2 }))] });
    const other = project({ id: 3, subprojects: [link(project({ id: 4 }))] });
    const standalone = project({ id: 5 });
    const ids = childProjectIds([parent, other, standalone]);
    expect(ids).toEqual(new Set([2, 4]));
  });

  it('dedupes children that appear under multiple parents', () => {
    const shared = project({ id: 7 });
    const a = project({ id: 1, subprojects: [link(shared)] });
    const b = project({ id: 2, subprojects: [link(shared)] });
    expect(childProjectIds([a, b, shared])).toEqual(new Set([7]));
  });

  it('returns empty for projects with no subprojects', () => {
    expect(childProjectIds([project({ id: 1 })])).toEqual(new Set());
  });
});

describe('linkableProjects', () => {
  const parent = project({ id: 1, name: 'Parent' });

  it('excludes the parent itself', () => {
    const result = linkableProjects(1, [parent]);
    expect(result).toEqual([]);
  });

  it('excludes existing children of this parent', () => {
    const child = project({ id: 2, name: 'Existing Child' });
    const parentWithChild: ProjectSummary = { ...parent, subprojects: [subproject(child)] };
    const result = linkableProjects(1, [parentWithChild, child]);
    expect(result).toEqual([]);
  });

  it('excludes subprojects (single-parent rule)', () => {
    const subParent = project({ id: 2, name: 'Sub' });
    const otherRoot = project({ id: 3, name: 'Root', subprojects: [subproject(subParent)] });
    const result = linkableProjects(1, [parent, otherRoot, subParent]);
    expect(result.map((p) => p.id)).toEqual([3]);
  });

  it('excludes ancestors of the parent (cycle rule)', () => {
    const grandparent = project({ id: 2, name: 'Grandparent' });
    const parentAsChild: ProjectSummary = { ...parent, inheritParent: true };
    const grandparentWithChild: ProjectSummary = {
      ...grandparent,
      subprojects: [subproject(parentAsChild)],
    };
    const result = linkableProjects(1, [grandparentWithChild, parentAsChild]);
    expect(result.map((p) => p.id)).toEqual([]);
  });

  it('includes standalone projects that are not children anywhere', () => {
    const standalone = project({ id: 5, name: 'Standalone' });
    const result = linkableProjects(1, [parent, standalone]);
    expect(result.map((p) => p.id)).toEqual([5]);
  });

  it('returns results ordered by name', () => {
    const zeta = project({ id: 10, name: 'Zeta' });
    const alpha = project({ id: 11, name: 'Alpha' });
    const result = linkableProjects(1, [parent, zeta, alpha]);
    expect(result.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
  });
});
