import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectActionSummary, ProjectSummary } from '../../domain/domain';
import { ProjectActionsDialog } from './ProjectActionsDialog';

describe('ProjectActionsDialog', () => {
  it('renders action metadata as compact icon-first rows', () => {
    render(
      <ProjectActionsDialog
        actions={[
          makeAction({
            fileName: 'install-previous.sh',
            icon: 'RotateCcw',
            runtime: 'shell',
            title: 'Install Previous App',
          }),
        ]}
        onClose={vi.fn()}
        onNewActionTask={vi.fn()}
        onRefresh={vi.fn()}
        onRunAction={vi.fn()}
        project={project}
      />,
    );

    const card = screen.getByRole('article', {
      name: 'Install Previous App install-previous.sh',
    });

    expect(
      within(card).getByLabelText('Install Previous App icon'),
    ).toBeInTheDocument();
    expect(within(card).getByText('install-previous.sh')).toHaveClass(
      'project-action-card-file',
    );
  });

  it('runs the selected action from its compact card', () => {
    const onRunAction = vi.fn();
    const action = makeAction({
      fileName: 'install-previous.sh',
      icon: 'RotateCcw',
      title: 'Install Previous App',
    });

    render(
      <ProjectActionsDialog
        actions={[action]}
        onClose={vi.fn()}
        onNewActionTask={vi.fn()}
        onRefresh={vi.fn()}
        onRunAction={onRunAction}
        project={project}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Run Install Previous App' }),
    );

    expect(onRunAction).toHaveBeenCalledWith(action);
  });
});

const project: ProjectSummary = {
  actionsDirectory: '.boomerang/actions',
  activeTodoCount: 1,
  status: 'Active' as const,
  inheritParent: false,
  subprojects: [],  aiDefaultIncludeProjectNotes: false,
  aiTaskDescriptionMode: 'task',
  backgroundImagePath: '',
  client: '',
  displayIdPrefix: 'B',
  id: 1,
  mainBranch: 'main',
  name: 'boomerangtasks',
  notesMarkdown: '',
  projectFolderOpenApp: 'cursor',
  terminalWslEnabled: false,
  workingDirectory: '~/p/boomerangtasks',
};

function makeAction(
  input: Partial<ProjectActionSummary>,
): ProjectActionSummary {
  return {
    arguments: [],
    description: 'Restore the saved previous Boomerang Tasks app backup.',
    fileName: 'reinstall.sh',
    icon: null,
    iconConfigured: false,
    path: null,
    runtime: 'shell',
    title: 'Install App',
    validationError: null,
    ...input,
  };
}
