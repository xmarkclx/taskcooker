import { describe, expect, it } from 'vitest';

import { seedSnapshot } from '../../data/seed';
import type { AppSnapshot } from '../../domain/domain';
import { searchApp } from './globalSearch';

describe('global app search', () => {
  it('searches tasks across every project and includes descriptions, artifacts, and project text', () => {
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      projects: [
        ...seedSnapshot.projects,
        {
          id: 2,
          name: 'life',
          client: 'Household',
          workingDirectory: '~/p/life',
          displayIdPrefix: 'LIFE',
          actionsDirectory: '.boomerang/actions',
          projectFolderOpenApp: 'cursor',
          mainBranch: 'main',
          terminalWslEnabled: false,
          backgroundImagePath: '',
          notesMarkdown: '',
          aiDefaultIncludeProjectNotes: false,
          aiTaskDescriptionMode: 'task',
          activeTodoCount: 1,
          status: 'Active' as const,
          inheritParent: false,
          subprojects: [],        },
      ],
      todos: [
        ...seedSnapshot.todos,
        {
          ...seedSnapshot.todos[0],
          artifactMarkdown: '# Receipt artifact\n\nUSB-C hub model notes.',
          dependencies: [],
          descriptionMarkdown: 'Replace the kitchen cable before travel.',
          displayId: 'LIFE-42',
          events: [],
          id: 4242,
          projectId: 2,
          state: 'To Do',
          subtasks: [],
          tags: ['Errands'],
          title: 'Buy replacement cable',
        },
      ],
    };

    const titleResults = searchApp(snapshot, 'replacement cable');
    expect(titleResults[0]).toMatchObject({
      projectId: 2,
      projectName: 'life',
      title: 'Buy replacement cable',
      todoId: 4242,
    });
    expect(titleResults[0].matchedFields).toContain('Title');

    const artifactResults = searchApp(snapshot, 'USB-C hub');
    expect(artifactResults[0]).toMatchObject({
      displayId: 'LIFE-42',
      todoId: 4242,
    });
    expect(artifactResults[0].matchedFields).toContain('Artifact');

    const projectResults = searchApp(snapshot, 'Household');
    expect(projectResults.map((result) => result.todoId)).toContain(4242);
    expect(
      projectResults.find((result) => result.todoId === 4242)?.matchedFields,
    ).toContain('Project');
  });

  it('returns no results for blank queries', () => {
    expect(searchApp(seedSnapshot, '   ')).toEqual([]);
  });
});
