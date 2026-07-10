import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectSummary } from '../../domain/domain';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';

describe('ProjectSettingsDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not show prompt defaults or provider controls in project settings', () => {
    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onClose={() => undefined}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={() => undefined}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={null}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={project}
        projectActions={[]}
      />,
    );

    expect(
      screen.queryByLabelText('Include project notes by default'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Project AI provider'),
    ).not.toBeInTheDocument();
  });

  it('submits trimmed project client text and main branch', async () => {
    const onSubmit = vi.fn();

    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onClose={() => undefined}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={onSubmit}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={null}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={project}
        projectActions={[]}
      />,
    );

    expect(screen.getByLabelText('Client')).toHaveValue('Existing Client');

    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: '  Acme Studio  ' },
    });
    fireEvent.change(screen.getByLabelText('Main branch'), {
      target: { value: '  develop  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          client: 'Acme Studio',
          mainBranch: 'develop',
        }),
      );
    });
  });

  it('shows the WSL terminal checkbox only on Windows', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

    const props = {
      actionsDirectory: {
        exists: true,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions',
      },
      onClose: () => undefined,
      onChooseBackgroundImage: () => undefined,
      onClearBackgroundImage: () => undefined,
      onConnectGitHub: () => undefined,
      onCreateActionsDirectory: () => undefined,
      onOpenActionsDirectory: () => undefined,
      onOpenGitHub: () => undefined,
      onOpenProjectFolder: () => undefined,
      onPushGitHub: () => undefined,
      onSubmit: () => undefined,
      clientOptions: ['Existing Client', 'Acme Studio'],
      gitRepository: null,
      ownerOptions: ['markcl', 'taskcooker-org'],
      project,
      projectActions: [],
    };

    const { rerender } = render(<ProjectSettingsDialog {...props} />);

    expect(
      screen.queryByLabelText('Run terminals in WSL'),
    ).not.toBeInTheDocument();

    vi.restoreAllMocks();
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');

    rerender(
      <ProjectSettingsDialog
        {...props}
        project={{ ...project, terminalWslEnabled: true }}
      />,
    );

    expect(screen.getByLabelText('Run terminals in WSL')).toBeChecked();
  });

  it('submits the WSL terminal checkbox value on Windows', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
    const onSubmit = vi.fn();

    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onClose={() => undefined}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={onSubmit}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={null}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={{ ...project, terminalWslEnabled: false }}
        projectActions={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText('Run terminals in WSL'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalWslEnabled: true,
        }),
      );
    });
  });

  it('does not show OpenCode project settings', () => {
    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onClose={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={() => undefined}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={null}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={project}
        projectActions={[]}
      />,
    );

    expect(screen.queryByLabelText('OpenCode folder')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Blank uses the project working directory.'),
    ).not.toBeInTheDocument();
  });

  it('lets client be picked from a searchable existing client list or typed as new text', async () => {
    const onSubmit = vi.fn();

    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onClose={() => undefined}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={onSubmit}
        clientOptions={[
          'Acme Studio',
          'Thirst Creative',
          'Existing Client',
          'Acme Studio',
          '',
        ]}
        gitRepository={null}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={project}
        projectActions={[]}
      />,
    );

    const client = screen.getByRole('combobox', { name: 'Client' });
    expect(client).toHaveValue('Existing Client');

    fireEvent.focus(client);
    expect(
      screen.getByRole('option', { name: 'Acme Studio' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Thirst Creative' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Acme Studio' })).toHaveLength(
      1,
    );

    fireEvent.change(client, { target: { value: 'thir' } });
    expect(
      screen.queryByRole('option', { name: 'Acme Studio' }),
    ).not.toBeInTheDocument();
    fireEvent.mouseDown(
      screen.getByRole('option', { name: 'Thirst Creative' }),
    );
    expect(client).toHaveValue('Thirst Creative');

    fireEvent.change(client, { target: { value: '  New Client  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          client: 'New Client',
        }),
      );
    });
  });

  it('shows task header background controls', () => {
    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onClose={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={() => undefined}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={null}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={{
          ...project,
          backgroundImagePath:
            '/Users/markcl/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-1/background/header.png',
        }}
        projectActions={[]}
      />,
    );

    expect(screen.getByText('Task header background')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose Background Image' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear Background Image' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/attachments\/project-1\/background\/header\.png/),
    ).toBeInTheDocument();
  });

  it('shows assigned git repository and GitHub actions on the Git Config tab', () => {
    const onConnectGitHub = vi.fn();
    const onOpenGitHub = vi.fn();
    const onPushGitHub = vi.fn();

    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onClose={() => undefined}
        onConnectGitHub={onConnectGitHub}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={onOpenGitHub}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={onPushGitHub}
        onSubmit={() => undefined}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={{
          fullName: 'markcl/tmatrix',
          htmlUrl: 'https://github.com/markcl/tmatrix',
          remoteUrl: 'git@github.com:markcl/tmatrix.git',
        }}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={project}
        projectActions={[]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Git Config' }));

    expect(screen.getByText('markcl/tmatrix')).toBeInTheDocument();
    expect(
      screen.getByText('git@github.com:markcl/tmatrix.git'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open in GitHub' }));
    expect(onOpenGitHub).toHaveBeenCalledWith(
      'https://github.com/markcl/tmatrix',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }));
    expect(onPushGitHub).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Connect with Github' }),
    ).not.toBeInTheDocument();
  });

  it('opens a cancellable GitHub repo form when no git repository is assigned', async () => {
    const onConnectGitHub = vi.fn();

    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onClose={() => undefined}
        onConnectGitHub={onConnectGitHub}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={() => undefined}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={null}
        ownerOptions={['xmarkclx', 'NoSleepTinker']}
        project={{ ...project, name: 'Boomerang Tasks Test' }}
        projectActions={[]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Git Config' }));
    expect(
      screen.getByRole('button', { name: 'Connect with Github' }),
    ).toHaveClass('primary-button');
    expect(
      screen.getByRole('button', { name: 'Connect with Github' }).className,
    ).not.toContain('items-center');
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Github' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Connect with Github' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Owner' })).toHaveValue(
      'xmarkclx',
    );
    fireEvent.focus(screen.getByRole('combobox', { name: 'Owner' }));
    expect(
      screen.getByRole('option', { name: 'NoSleepTinker' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Repo name')).toHaveValue(
      'boomerang-tasks-test',
    );
    expect(screen.getByRole('radio', { name: 'Private' })).toBeChecked();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Connect with Github' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Project Settings' }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Github' }),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), {
      target: { value: 'taskcooker-org' },
    });
    fireEvent.change(screen.getByLabelText('Repo name'), {
      target: { value: ' boomerangtasks ' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create repository' }));

    await waitFor(() => {
      expect(onConnectGitHub).toHaveBeenCalledWith({
        owner: 'taskcooker-org',
        repoName: 'boomerangtasks',
        visibility: 'public',
      });
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Github' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel GitHub connection' }),
    );

    expect(
      screen.queryByRole('dialog', { name: 'Connect with Github' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the project settings dialog viewport-constrained and scrollable', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    const rule = css.match(/\.project-settings-dialog\s*{[^}]+}/)?.[0] ?? '';

    expect(rule).toContain('max-height');
    expect(rule).toContain('overflow-y: auto');
  });

  it('keeps Git Config cards padded and action buttons inline', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    const primaryButtonRule =
      css.match(/\.primary-button\s*{[^}]+}/)?.[0] ?? '';
    render(
      <ProjectSettingsDialog
        actionsDirectory={{
          exists: true,
          path: '/Users/markcl/p/tmatrix/.boomerang/actions',
        }}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onClose={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={() => undefined}
        clientOptions={['Existing Client', 'Acme Studio']}
        gitRepository={{
          fullName: 'markcl/tmatrix',
          htmlUrl: 'https://github.com/markcl/tmatrix',
          remoteUrl: 'git@github.com:markcl/tmatrix.git',
        }}
        ownerOptions={['markcl', 'taskcooker-org']}
        project={project}
        projectActions={[]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Git Config' }));

    expect(
      screen.getByText('Assigned repository').closest('.dialog-form'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Push to GitHub' })).toHaveClass(
      'primary-button',
    );
    expect(
      screen.getByRole('button', { name: 'Push to GitHub' }).className,
    ).not.toContain('items-center');
    expect(primaryButtonRule).toContain('align-items: center');
    expect(primaryButtonRule).toContain('display: inline-flex');
    expect(primaryButtonRule).toContain('gap: 7px');
  });

  it('does not render the inherit checkbox when not a subproject', () => {
    render(
      <ProjectSettingsDialog
        actionsDirectory={{ exists: true, path: '/actions' }}
        onClose={() => undefined}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={vi.fn()}
        clientOptions={[]}
        gitRepository={null}
        ownerOptions={[]}
        project={project}
        projectActions={[]}
      />,
    );

    expect(screen.queryByLabelText('Inherit parent folder and notes')).not.toBeInTheDocument();
  });

  it('renders the inherit checkbox reflecting project.inheritParent in subproject mode', async () => {
    const onSubmit = vi.fn();
    render(
      <ProjectSettingsDialog
        actionsDirectory={{ exists: true, path: '/actions' }}
        onClose={() => undefined}
        onChooseBackgroundImage={() => undefined}
        onClearBackgroundImage={() => undefined}
        onConnectGitHub={() => undefined}
        onCreateActionsDirectory={() => undefined}
        onOpenActionsDirectory={() => undefined}
        onOpenGitHub={() => undefined}
        onOpenProjectFolder={() => undefined}
        onPushGitHub={() => undefined}
        onSubmit={onSubmit}
        clientOptions={[]}
        gitRepository={null}
        ownerOptions={[]}
        project={project}
        projectActions={[]}
        isSubproject
      />,
    );

    const checkbox = screen.getByLabelText('Inherit parent folder and notes');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ inheritParent: true }),
      );
    });
  });
});

const project = {
  actionsDirectory: '.boomerang/actions',
  activeTodoCount: 19,
  status: 'Active' as const,
  inheritParent: false,
  subprojects: [],  aiDefaultIncludeProjectNotes: false,
  aiTaskDescriptionMode: 'task',
  backgroundImagePath: '',
  client: 'Existing Client',
  displayIdPrefix: 'T',
  id: 1,
  name: 'tmatrix',
  notesMarkdown: '',
  projectFolderOpenApp: 'cursor',
  mainBranch: 'main',
  terminalWslEnabled: false,
  workingDirectory: '~/p/tmatrix',
} satisfies ProjectSummary;
