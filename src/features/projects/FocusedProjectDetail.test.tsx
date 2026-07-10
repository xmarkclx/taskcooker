import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AppSettingsSummary, ProjectSummary } from '../../domain/domain';
import { FocusedProjectDetail } from './FocusedProjectDetail';

vi.mock('../markdown/MarkdownEditor', () => ({
  MarkdownEditor: ({
    ariaLabel,
    markdown,
    onSave,
  }: {
    ariaLabel: string;
    markdown: string;
    onSave: (markdown: string) => void;
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(event) => onSave(event.target.value)}
      value={markdown}
    />
  ),
}));

describe('FocusedProjectDetail', () => {
  it('opens on project notes first and keeps project settings as the second tab', () => {
    render(
      <FocusedProjectDetail
        {...baseProps()}
        project={projectFixture({ name: 'Design System', notesMarkdown: '# Notes' })}
      />,
    );

    const pane = screen.getByRole('region', { name: 'Focused project Design System' });
    const tabs = within(pane).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Project Notes', 'Project Settings']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(pane).getByLabelText('Project Notes Markdown')).toHaveValue('# Notes');
  });

  it('submits root task creation for the focused project from the detail header', () => {
    const onNewRootTask = vi.fn();

    render(<FocusedProjectDetail {...baseProps({ onNewRootTask })} />);

    fireEvent.click(screen.getByRole('button', { name: 'New root task' }));

    expect(onNewRootTask).toHaveBeenCalledTimes(1);
  });

  it('shows project settings on the second tab and submits trimmed settings', () => {
    const onSubmitSettings = vi.fn();

    render(<FocusedProjectDetail {...baseProps({ onSubmitSettings })} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Project Settings' }));
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: '  Renamed Child  ' },
    });
    fireEvent.change(screen.getByLabelText('Display ID prefix'), {
      target: { value: ' rc ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Project Settings' }));

    expect(onSubmitSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        displayIdPrefix: 'RC',
        name: 'Renamed Child',
      }),
    );
  });

  it('passes note edits to the project notes save handler', () => {
    const onSaveNotes = vi.fn();

    render(<FocusedProjectDetail {...baseProps({ onSaveNotes })} />);

    fireEvent.change(screen.getByLabelText('Project Notes Markdown'), {
      target: { value: '# Updated notes' },
    });

    expect(onSaveNotes).toHaveBeenCalledWith('# Updated notes');
  });
});

function baseProps(
  overrides: Partial<ComponentProps<typeof FocusedProjectDetail>> = {},
): ComponentProps<typeof FocusedProjectDetail> {
  return {
    clientOptions: ['Existing Client'],
    isSubproject: true,
    markdownEditorMode: 'raw' as AppSettingsSummary['markdownEditorMode'],
    markdownTocHidden: false,
    markdownTocWidth: 180,
    onMarkdownEditorModeChange: vi.fn(),
    onMarkdownTocHiddenChange: vi.fn(),
    onMarkdownTocWidthChange: vi.fn(),
    onNewRootTask: vi.fn(),
    onOpenImage: vi.fn(),
    onOpenProject: vi.fn(),
    onSaveNotes: vi.fn(),
    onSubmitSettings: vi.fn(),
    project: projectFixture(),
    ...overrides,
  };
}

function projectFixture(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 1,
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: 'Existing Client',
    displayIdPrefix: 'CH',
    id: 2,
    inheritParent: false,
    mainBranch: 'main',
    name: 'Child Project',
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    status: 'Active',
    subprojects: [],
    terminalWslEnabled: false,
    workingDirectory: '~/p/child',
    ...overrides,
  };
}
