import { describe, expect, it } from 'vitest';

import type { ProjectSummary, TodoSummary } from '../../domain/domain';
import { buildTimeTrackingReport, timeTrackingSelection } from './timeTrackingTree';

describe('time tracking report', () => {
  it('includes linked projects and nested subprojects once in the selected project scope', () => {
    const projects = [
      project(1, 'Root', [
        { childProjectId: 2, kind: 'subproject' },
        { childProjectId: 3, kind: 'link' },
      ]),
      project(2, 'Child', [{ childProjectId: 3, kind: 'link' }]),
      project(3, 'Linked'),
      project(4, 'Outside'),
    ];
    const todos = [
      todo(1, 1, 'T-1', 3600),
      todo(2, 2, 'C-1', 1800),
      todo(3, 3, 'L-1', 900),
      todo(4, 4, 'O-1', 7200),
    ];

    const now = new Date(2026, 6, 20, 12);
    const report = buildTimeTrackingReport({
      now,
      projectId: 1,
      projects,
      selection: timeTrackingSelection('month', now),
      todos,
    });

    expect(report.projects.map((node) => node.project.name)).toEqual([
      'Root',
      'Child',
      'Linked',
    ]);
    expect(report.totalSeconds).toBe(6300);
  });

  it('shows each task own time and parent-plus-subtasks time without double counting the total', () => {
    const parent = todo(1, 1, 'T-1', 3600, null, [2]);
    const child = todo(2, 1, 'T-2', 1800, 1);

    const report = buildTimeTrackingReport({
      now: new Date(2026, 6, 20, 12),
      projectId: 1,
      projects: [project(1, 'Root')],
      selection: timeTrackingSelection('today'),
      todos: [parent, child],
    });

    expect(report.projects[0].tasks[0]).toMatchObject({
      ownTimeSeconds: 3600,
      rolledUpTimeSeconds: 5400,
    });
    expect(report.projects[0].tasks[0].children[0]).toMatchObject({
      ownTimeSeconds: 1800,
      rolledUpTimeSeconds: 1800,
    });
    expect(report.totalSeconds).toBe(5400);
  });

  it('uses calendar-to-date boundaries for the current week and month', () => {
    const now = new Date(2026, 6, 20, 12);

    expect(timeTrackingSelection('week', now).startLocal).toBe('2026-07-20T00:00');
    expect(timeTrackingSelection('month', now).startLocal).toBe('2026-07-01T00:00');
    expect(timeTrackingSelection('week', now).endLocal).toBe('2026-07-20T12:00');
  });

  it('omits zero-time tasks but keeps a zero-own-time parent with tracked descendants', () => {
    const parent = todo(1, 1, 'T-1', 0, null, [2, 3]);
    const trackedChild = todo(2, 1, 'T-2', 1800, 1);
    const emptyChild = todo(3, 1, 'T-3', 0, 1);
    const now = new Date(2026, 6, 20, 12);

    const report = buildTimeTrackingReport({
      now,
      projectId: 1,
      projects: [project(1, 'Root')],
      selection: timeTrackingSelection('today', now),
      todos: [parent, trackedChild, emptyChild],
    });

    expect(report.projects[0].tasks).toHaveLength(1);
    expect(report.projects[0].tasks[0].todo.id).toBe(1);
    expect(report.projects[0].tasks[0].children.map((child) => child.todo.id)).toEqual([2]);
  });
});

function project(
  id: number,
  name: string,
  subprojects: ProjectSummary['subprojects'] = [],
): ProjectSummary {
  return {
    actionsDirectory: '',
    activeTodoCount: 0,
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: name[0],
    id,
    inheritParent: false,
    mainBranch: 'main',
    name,
    notesMarkdown: '',
    projectFolderOpenApp: '',
    status: 'Active',
    subprojects,
    terminalWslEnabled: false,
    workingDirectory: '',
  };
}

function todo(
  id: number,
  projectId: number,
  displayId: string,
  seconds: number,
  parentId: number | null = null,
  subtaskIds: number[] = [],
): TodoSummary {
  const startedAt = new Date(2026, 6, 20, 9);
  const endedAt = new Date(startedAt.getTime() + seconds * 1000);
  return {
    activeWorkingDirectory: '',
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    createdAt: startedAt.toISOString(),
    deadline: null,
    dependencies: [],
    descriptionMarkdown: '',
    displayId,
    events: [],
    id,
    ownTimeSeconds: seconds,
    parentId,
    position: id,
    priority: 'None',
    projectId,
    rolledUpTimeSeconds: seconds,
    stale: false,
    state: 'Doing',
    subtasks: subtaskIds.map((subtaskId) => ({
      displayId: `T-${subtaskId}`,
      done: false,
      id: subtaskId,
      state: 'Doing',
      title: `Task ${subtaskId}`,
    })),
    tags: [],
    timeLogs: [{
      durationSeconds: seconds,
      endedAt: endedAt.toISOString(),
      id,
      running: false,
      source: 'manual',
      startedAt: startedAt.toISOString(),
    }],
    title: `Task ${id}`,
    updatedAt: endedAt.toISOString(),
  };
}
