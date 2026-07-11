import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectSummary } from '../../domain/domain';
import { NewProjectDialog } from './NewProjectDialog';

const appStyles = readFileSync(
  resolve(process.cwd(), 'src/styles.css'),
  'utf8',
);

describe('NewProjectDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a unique task prefix from the project name', async () => {
    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onWorkingDirectoryStatus={vi.fn().mockResolvedValue({
          exists: true,
          path: '/Users/markcl/p/alpha-api',
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'tmatrix' },
    });
    expect(screen.getByLabelText('Project task prefix')).toHaveValue('T2');

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Alpha API' },
    });
    expect(screen.getByLabelText('Project working directory')).toHaveValue(
      '~/p/alpha-api',
    );
    expect(screen.getByLabelText('Project task prefix')).toHaveValue('AA');
  });

  it('shows a missing working directory message and can create the folder', async () => {
    const onCreateWorkingDirectory = vi.fn().mockResolvedValue({
      exists: true,
      path: '/Users/markcl/p/alpha-api',
    });
    const onWorkingDirectoryStatus = vi.fn().mockResolvedValue({
      exists: false,
      path: '/Users/markcl/p/alpha-api',
    });

    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={onCreateWorkingDirectory}
        onSubmit={vi.fn()}
        onWorkingDirectoryStatus={onWorkingDirectoryStatus}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Alpha API' },
    });

    expect(
      await screen.findByText('Working directory not found'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/alpha-api does not exist yet/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));

    await waitFor(() => {
      expect(onCreateWorkingDirectory).toHaveBeenCalledWith('~/p/alpha-api');
    });
    expect(
      await screen.findByText('Working directory ready'),
    ).toBeInTheDocument();
  });

  it('uses the Choose button to select a working directory', async () => {
    const onChooseWorkingDirectory = vi
      .fn()
      .mockResolvedValue('/Users/markcl/p/chosen-app');
    const onWorkingDirectoryStatus = vi.fn().mockResolvedValue({
      exists: true,
      path: '/Users/markcl/p/chosen-app',
    });
    const DialogWithInjectedChooser =
      NewProjectDialog as React.ComponentType<any>;

    render(
      <DialogWithInjectedChooser
        existingProjects={existingProjects}
        onChooseWorkingDirectory={onChooseWorkingDirectory}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onWorkingDirectoryStatus={onWorkingDirectoryStatus}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project working directory'), {
      target: { value: '~/p/typed-app' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => {
      expect(onChooseWorkingDirectory).toHaveBeenCalledWith('~/p/typed-app');
    });
    expect(screen.getByLabelText('Project working directory')).toHaveValue(
      '/Users/markcl/p/chosen-app',
    );
    expect(
      await screen.findByText('Working directory ready'),
    ).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn();

    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={onClose}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onWorkingDirectoryStatus={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses theme-aware tokens instead of hard-coded colors so dark mode is not ruined', () => {
    const fieldInput = cssRule('.new-project-field input');
    const headerH2 = cssRule('.new-project-header h2');
    const footer = cssRule('.new-project-footer');
    const ready = cssRule('.new-project-status-card.ready');
    const missing = cssRule('.new-project-status-card.missing');
    const darkReady = cssRule(
      ".app-shell[data-theme='dark'] .new-project-status-card.ready",
    );
    const darkMissing = cssRule(
      ".app-shell[data-theme='dark'] .new-project-status-card.missing",
    );

    expect(fieldInput).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(headerH2).toContain('var(--color-text-strong)');
    expect(footer).toContain('var(--color-surface-warm)');
    expect(ready).toContain('var(--state-green-surface)');
    expect(missing).toContain('var(--state-amber-surface)');
    expect(darkReady).not.toContain('var(--state-green-border)');
    expect(darkMissing).not.toContain('var(--state-amber-surface)');
  });

  it('keeps the working directory field on its own full-width row', () => {
    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onWorkingDirectoryStatus={vi.fn()}
      />,
    );

    const directoryField = screen.getByLabelText('Project working directory').closest('label');
    expect(directoryField).toHaveClass('new-project-directory-field');
    expect(cssRule('.new-project-directory-field')).toContain('grid-column: 1 / -1');
  });

  it('shows and submits the WSL terminal option on Windows', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
    const onSubmit = vi.fn();

    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={onSubmit}
        onWorkingDirectoryStatus={vi.fn().mockResolvedValue({
          exists: true,
          path: '/Users/markcl/p/alpha-api',
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Alpha API' },
    });
    fireEvent.click(screen.getByLabelText('Run terminals in WSL'));

    await waitFor(() => {
      expect(screen.getByText('Working directory ready')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ terminalWslEnabled: true }),
      );
    });
  });

  it('hides the WSL terminal option off Windows and submits false', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const onSubmit = vi.fn();

    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={onSubmit}
        onWorkingDirectoryStatus={vi.fn().mockResolvedValue({
          exists: true,
          path: '/Users/markcl/p/alpha-api',
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Alpha API' },
    });

    expect(screen.queryByLabelText('Run terminals in WSL')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Working directory ready')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ terminalWslEnabled: false }),
      );
    });
  });
});

describe('subproject mode', () => {
  const parentProject: ProjectSummary = {
    ...existingProjects[0],
    id: 5,
    name: 'Client A',
    displayIdPrefix: 'CA',
  };

  it('shows the subproject hint and a checked inherit checkbox while hiding the working directory field', () => {
    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onWorkingDirectoryStatus={vi.fn()}
        parentProject={parentProject}
      />,
    );

    expect(screen.getByText('Subproject of Client A')).toBeInTheDocument();
    const checkbox = screen.getByLabelText('Inherit parent folder and notes');
    expect(checkbox).toBeChecked();
    expect(screen.queryByLabelText('Project working directory')).not.toBeInTheDocument();
  });

  it('reveals the working directory field when inherit is unchecked and submits with inheritParent false', async () => {
    const onSubmit = vi.fn();
    const onWorkingDirectoryStatus = vi.fn().mockResolvedValue({
      exists: true,
      path: '/Users/markcl/p/alpha-api',
    });

    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={onSubmit}
        onWorkingDirectoryStatus={onWorkingDirectoryStatus}
        parentProject={parentProject}
      />,
    );

    fireEvent.click(screen.getByLabelText('Inherit parent folder and notes'));
    expect(screen.getByLabelText('Inherit parent folder and notes')).not.toBeChecked();
    expect(screen.getByLabelText('Project working directory')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Alpha API' },
    });
    fireEvent.change(screen.getByLabelText('Project working directory'), {
      target: { value: '~/p/alpha-api' },
    });

    await waitFor(() => {
      expect(screen.getByText('Working directory ready')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ parentProjectId: 5, inheritParent: false }),
      );
    });
  });

  it('submits with inheritParent true when inheriting', async () => {
    const onSubmit = vi.fn();

    render(
      <NewProjectDialog
        existingProjects={existingProjects}
        onClose={() => undefined}
        onCreateWorkingDirectory={vi.fn()}
        onSubmit={onSubmit}
        onWorkingDirectoryStatus={vi.fn()}
        parentProject={parentProject}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Alpha API' },
    });
    expect(screen.getByLabelText('Inherit parent folder and notes')).toBeChecked();
    expect(screen.queryByLabelText('Project working directory')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ parentProjectId: 5, inheritParent: true }),
      );
    });
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(
    new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`),
  );
  return match?.groups?.body ?? '';
}

const existingProjects: ProjectSummary[] = [
  {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 19,
    status: 'Active' as const,
    inheritParent: false,
    subprojects: [],    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: 'T',
    id: 1,
    name: 'tmatrix',
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    mainBranch: 'main',
    terminalWslEnabled: false,
    workingDirectory: '~/p/tmatrix',
  },
];
