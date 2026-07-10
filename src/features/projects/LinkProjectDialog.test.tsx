import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AppSnapshot, ProjectSummary } from '../../domain/domain';
import { linkProject } from '../../tauri/commands';
import { LinkProjectDialog } from './LinkProjectDialog';

vi.mock('../../tauri/commands', () => ({
  linkProject: vi.fn(),
}));

const snapshotStub = {
  projects: [],
  selectedProjectId: 0,
  selectedTodoId: 0,
  todos: [],
  runningTimer: null,
  sessions: [],
  executionTerminals: [],
  messages: [],
  boomerangBinaryPath: '',
} satisfies AppSnapshot;

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 0,
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: 'T',
    id: 1,
    inheritParent: false,
    mainBranch: 'main',
    name: 'tmatrix',
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    status: 'Active',
    subprojects: [],
    terminalWslEnabled: false,
    workingDirectory: '~/p/tmatrix',
    ...overrides,
  };
}

function renderWithClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
  return queryClient;
}

describe('LinkProjectDialog', () => {
  it('focuses the project combobox when the dialog first opens', () => {
    const parent = makeProject({ id: 1, name: 'Parent', displayIdPrefix: 'P' });
    const linkable = makeProject({ id: 4, name: 'Linkable One', displayIdPrefix: 'LO' });

    renderWithClient(
      <LinkProjectDialog parent={parent} projects={[parent, linkable]} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveFocus();
  });

  it('renders linkable projects and excludes parent + existing children', () => {
    const parent = makeProject({
      id: 1,
      name: 'Parent',
      displayIdPrefix: 'P',
      subprojects: [{ childProjectId: 2, kind: 'link' }],
    });
    const existingChild = makeProject({ id: 2, name: 'Existing Child', displayIdPrefix: 'EC' });
    const subprojectEverywhere = makeProject({
      id: 3,
      name: 'Sub Everywhere',
      displayIdPrefix: 'SE',
    });
    const someOtherParent = makeProject({
      id: 5,
      name: 'Other Parent',
      displayIdPrefix: 'OP',
      subprojects: [{ childProjectId: 3, kind: 'subproject' }],
    });
    const linkable = makeProject({ id: 4, name: 'Linkable One', displayIdPrefix: 'LO' });

    const projects = [parent, existingChild, subprojectEverywhere, someOtherParent, linkable];

    renderWithClient(
      <LinkProjectDialog parent={parent} projects={projects} onClose={vi.fn()} />,
    );

    // Open the combobox by focusing the input.
    fireEvent.focus(screen.getByRole('combobox'));

    const options = screen.getAllByRole('option');
    const optionTexts = options.map((option) => option.textContent ?? '');

    expect(optionTexts).toContain('Linkable One (LO)');
    expect(optionTexts).not.toContain('Existing Child (EC)');
    expect(optionTexts).not.toContain('Parent (P)');
  });

  it('confirm calls linkProject with parent + child ids and closes on success', async () => {
    vi.mocked(linkProject).mockResolvedValue(snapshotStub);
    const onClose = vi.fn();

    const parent = makeProject({ id: 1, name: 'Parent', displayIdPrefix: 'P' });
    const linkable = makeProject({ id: 4, name: 'Linkable One', displayIdPrefix: 'LO' });

    renderWithClient(
      <LinkProjectDialog parent={parent} projects={[parent, linkable]} onClose={onClose} />,
    );

    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Linkable One (LO)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Link Project' }));

    await waitFor(() =>
      expect(linkProject).toHaveBeenCalledWith({
        parentProjectId: 1,
        childProjectId: 4,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('confirm is disabled until a project is selected from the list', () => {
    const parent = makeProject({ id: 1, name: 'Parent', displayIdPrefix: 'P' });
    const linkable = makeProject({ id: 4, name: 'Linkable One', displayIdPrefix: 'LO' });

    renderWithClient(
      <LinkProjectDialog parent={parent} projects={[parent, linkable]} onClose={vi.fn()} />,
    );

    const submit = screen.getByRole('button', { name: 'Link Project' });
    expect(submit).toBeDisabled();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Linkable One' } });
    expect(submit).toBeDisabled();
  });
});
