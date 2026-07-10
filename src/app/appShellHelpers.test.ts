import { describe, expect, it } from 'vitest';

import type { ProjectSummary } from '../domain/domain';
import { projectAccentStyle, resolveTaskActionProject } from './appShellHelpers';

describe('project accent styling', () => {
  it('assigns visually separated border accents across the current project list', () => {
    const projects = [
      projectFixture(1, 'tmatrix'),
      projectFixture(2, 'CDC Charter'),
      projectFixture(3, 'Boomerang Tasks'),
    ];

    const hues = projects.map((project) => accentHue(project, projects));

    expect(new Set(hues).size).toBe(projects.length);
    expect(minimumCircularDistance(hues)).toBeGreaterThanOrEqual(40);
  });

  it('keeps duplicate project names distinct within the project list', () => {
    const projects = [
      projectFixture(1, 'Client Site'),
      projectFixture(2, 'Client Site'),
    ];

    const hues = projects.map((project) => accentHue(project, projects));

    expect(new Set(hues).size).toBe(projects.length);
    expect(minimumCircularDistance(hues)).toBeGreaterThanOrEqual(40);
  });

  it('provides concrete theme colors so project dots do not inherit the selected accent', () => {
    const projects = [
      projectFixture(1, 'Boomerang Tasks Test'),
      projectFixture(2, 'test'),
      projectFixture(3, 'tc'),
    ];

    const styles = projects.map((project) =>
      projectAccentStyle(project, projects),
    );

    expect(
      new Set(styles.map((style) => style?.['--project-accent-color-light']))
        .size,
    ).toBe(projects.length);
    expect(
      new Set(styles.map((style) => style?.['--project-accent-color-dark']))
        .size,
    ).toBe(projects.length);
    for (const style of styles) {
      expect(style?.['--project-accent-color-light']).toMatch(
        /^hsl\(\d+deg \d+% 34%\)$/,
      );
      expect(style?.['--project-accent-color-dark']).toMatch(
        /^hsl\(\d+deg \d+% 42%\)$/,
      );
    }
  });
});

describe('task action project resolution', () => {
  it('uses the selected task context before the selected project', () => {
    const selectedProject = projectFixture(1, 'Selected Project');
    const todoProject = projectFixture(2, 'Todo Project');
    const contextProject = projectFixture(3, 'Context Project');

    expect(
      resolveTaskActionProject({
        selectedProject,
        selectedTodoContextProject: contextProject,
        selectedTodoProject: todoProject,
      }),
    ).toBe(contextProject);
  });

  it('uses the selected task own project before the selected project', () => {
    const selectedProject = projectFixture(1, 'Selected Project');
    const todoProject = projectFixture(2, 'Todo Project');

    expect(
      resolveTaskActionProject({
        selectedProject,
        selectedTodoProject: todoProject,
      }),
    ).toBe(todoProject);
  });
});

function accentHue(
  project: ProjectSummary,
  projects: ProjectSummary[],
): number {
  const hue =
    projectAccentStyle(project, projects)?.['--project-accent-hue'] ?? '';

  return Number(hue.replace('deg', ''));
}

function minimumCircularDistance(hues: number[]): number {
  let minimum = 360;
  for (let leftIndex = 0; leftIndex < hues.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < hues.length;
      rightIndex += 1
    ) {
      const delta = Math.abs(hues[leftIndex] - hues[rightIndex]);
      minimum = Math.min(minimum, delta, 360 - delta);
    }
  }

  return minimum;
}

function projectFixture(id: number, name: string): ProjectSummary {
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 1,
    status: 'Active' as const,
    inheritParent: false,
    subprojects: [],    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: 'T',
    id,
    mainBranch: 'main',
    name,
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    terminalWslEnabled: false,
    workingDirectory: `~/p/${name.toLocaleLowerCase().replaceAll(' ', '-')}`,
  };
}
