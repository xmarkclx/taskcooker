import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppSnapshot,
  ProjectActionSummary,
  ProjectSummary,
  TodoSummary,
} from '../../domain/domain';
import { fallbackAppSettings } from '../../tauri/commands';
import { TaskDetail } from './TaskDetail';

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return {
    ...actual,
    convertFileSrc: (path: string) => `asset://${path}`,
  };
});

// These tests assert editor props synchronously; the two-frame paint deferral
// itself is pinned in src/ui/DeferredMount.test.tsx.
vi.mock('../../ui/DeferredMount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/DeferredMount')>();
  return {
    ...actual,
    DeferredMount: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

const appStyles = readFileSync(
  resolve(process.cwd(), 'src/styles.css'),
  'utf8',
);
const markdownEditorCalls = vi.hoisted(
  () =>
    [] as Array<{
      ariaLabel: string;
      markdown: string;
      onSave?: (markdown: string) => void;
      onTocHiddenChange?: (hidden: boolean) => void;
      onTocWidthChange?: (width: number) => void;
      tocHidden?: boolean;
      tocWidth?: number;
    }>,
);
const executionPanelCalls = vi.hoisted(
  () =>
    [] as Array<{
      artifactTocHidden?: boolean;
      artifactTocWidth?: number;
      onArtifactTocHiddenChange?: (hidden: boolean) => void;
      onArtifactTocWidthChange?: (width: number) => void;
    }>,
);

vi.mock('../markdown/MarkdownEditor', () => ({
  MarkdownEditor: (props: {
    ariaLabel: string;
    markdown: string;
    onSave?: (markdown: string) => void;
    onTocHiddenChange?: (hidden: boolean) => void;
    onTocWidthChange?: (width: number) => void;
    tocHidden?: boolean;
    tocWidth?: number;
  }) => {
    markdownEditorCalls.push(props);
    return <div aria-label={props.ariaLabel} />;
  },
}));

vi.mock('./ExecutionPanel', () => ({
  ExecutionPanel: (props: {
    artifactTocHidden?: boolean;
    artifactTocWidth?: number;
    onArtifactTocHiddenChange?: (hidden: boolean) => void;
    onArtifactTocWidthChange?: (width: number) => void;
  }) => {
    executionPanelCalls.push(props);
    return <div aria-label="Execution panel mock" />;
  },
}));

describe('TaskDetail panel visibility', () => {
  it('shows task project actions next to autotitle and runs a selected action', () => {
    const onRunTaskAction = vi.fn();
    const action = projectActionFixture({
      fileName: 'deploy.sh',
      title: 'Deploy Site',
    });

    renderDetail({
      onRunTaskAction,
      projectActions: [action],
    });

    const button = screen.getByRole('button', { name: 'Task actions' });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Run Deploy Site' }));

    expect(onRunTaskAction).toHaveBeenCalledWith(action);
  });

  it('renders task header actions as text controls without icons', () => {
    renderDetail();

    for (const [accessibleName, visibleLabel] of [
      ['Star task', 'Star'],
      ['Delete task', 'Delete'],
      ['Open T-128 in new window', 'Open'],
      ['Hide description panel', 'Description'],
      ['Hide terminal panel', 'Terminal'],
      ['Hide details sidebar', 'Details'],
    ] as const) {
      const button = screen.getByRole('button', { name: accessibleName });
      expect(button).toHaveClass('task-header-action-button');
      expect(button).toHaveTextContent(visibleLabel);
      expect(button.querySelector('svg')).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole('button', { name: 'More task options' }),
    ).not.toBeInTheDocument();
    // Done, Changes, and Archive moved into the header state dropdown.
    expect(
      screen.queryByRole('button', { name: 'Accept task as done' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request changes' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Archive task' }),
    ).not.toBeInTheDocument();
  });

  it('changes state from the header state dropdown', () => {
    const onAcceptDone = vi.fn();
    const onArchive = vi.fn();
    const onStateChange = vi.fn();
    renderDetail({ onAcceptDone, onArchive, onStateChange });

    const trigger = screen.getByRole('button', {
      name: 'Change state (current: To Do)',
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Doing' }));
    expect(onStateChange).toHaveBeenCalledWith('Doing');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }));
    expect(onAcceptDone).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Archived' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it('requests changes from the header state dropdown', () => {
    const onRequestChanges = vi.fn();
    renderDetail({ onRequestChanges });

    fireEvent.click(
      screen.getByRole('button', { name: 'Change state (current: To Do)' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Request changes' }));

    expect(onRequestChanges).toHaveBeenCalledTimes(1);
  });

  it('selects a context project from the header context dropdown', () => {
    const onContextProjectChange = vi.fn();
    const project = projectFixture();
    const contextProject = projectFixture({ id: 2, name: 'client-site' });
    const todo = todoFixture();
    renderDetail({
      onContextProjectChange,
      project,
      snapshot: {
        ...snapshotFixture(project, todo),
        projects: [project, contextProject],
      },
      todo,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Set task context' }));
    // The todo's own project is not offered as a separate context.
    expect(
      screen.queryByRole('menuitemradio', { name: 'tmatrix' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'client-site' }));

    expect(onContextProjectChange).toHaveBeenCalledWith(2);
  });

  it('filters task context projects with a project-switcher style search field', () => {
    const onContextProjectChange = vi.fn();
    const project = projectFixture();
    const clientSite = projectFixture({ activeTodoCount: 4, id: 2, name: 'client-site' });
    const clubAdventure = projectFixture({ activeTodoCount: 6, id: 3, name: 'ClubAdventure Neo' });
    const todo = todoFixture();
    renderDetail({
      onContextProjectChange,
      project,
      snapshot: {
        ...snapshotFixture(project, todo),
        projects: [project, clientSite, clubAdventure],
      },
      todo,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Set task context' }));
    fireEvent.change(screen.getByLabelText('Search context projects'), {
      target: { value: 'club' },
    });

    expect(screen.queryByRole('menuitemradio', { name: 'client-site' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'ClubAdventure Neo' })).toBeInTheDocument();
    expect(screen.queryByText('6 active')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'ClubAdventure Neo' }));

    expect(onContextProjectChange).toHaveBeenCalledWith(3);
  });

  it('styles the task context menu like the project switcher and above the detail pane', () => {
    expect(cssRule('.detail-header')).toContain('overflow: visible;');
    expect(cssRule('.detail-header')).toContain('z-index: 20;');
    expect(cssRule('.detail-header > .detail-id-row')).toContain('z-index: 220;');
    expect(cssRule('.detail-header-menu-wrap')).toContain('z-index: 180;');
    expect(cssRule('.detail-content')).toContain('z-index: 1;');
    expect(cssRule('.detail-header-menu')).toContain('z-index: 180;');
    expect(cssRule('.task-context-switcher-menu')).toContain('width: min(300px, calc(100vw - 48px));');
    expect(cssRule('.task-context-switcher-menu')).toContain('z-index: 160;');
    expect(cssRule('.task-context-search')).toContain('min-height: 32px;');
    expect(cssRule('.task-context-search')).toContain('border: 1px solid var(--line);');
    expect(cssRule('.task-context-option')).toContain('min-height: 38px;');
    expect(cssRule('.task-context-switcher-menu .task-context-option-copy strong')).toContain(
      'font-size: 13px;',
    );
  });

  it('shows the effective context project and clears it back to the own project', () => {
    const onContextProjectChange = vi.fn();
    const project = projectFixture();
    const contextProject = projectFixture({ id: 2, name: 'client-site' });
    const todo = todoFixture({
      contextProjectId: 2,
      effectiveContextProjectId: 2,
    });
    renderDetail({
      onContextProjectChange,
      project,
      snapshot: {
        ...snapshotFixture(project, todo),
        projects: [project, contextProject],
      },
      todo,
    });

    const trigger = screen.getByRole('button', {
      name: 'Change context (current: client-site)',
    });
    expect(trigger).toHaveTextContent('client-site');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'This project' }));

    expect(onContextProjectChange).toHaveBeenCalledWith(null);
  });

  it('labels an inherited context as coming from the parent task', () => {
    const project = projectFixture();
    const contextProject = projectFixture({ id: 2, name: 'client-site' });
    const todo = todoFixture({
      contextProjectId: null,
      effectiveContextProjectId: 2,
    });
    renderDetail({
      project,
      snapshot: {
        ...snapshotFixture(project, todo),
        projects: [project, contextProject],
      },
      todo,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Change context (current: client-site)' }),
    );

    expect(
      screen.getByRole('menuitemradio', { name: 'Default (from parent)' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles the selected task star from the header', () => {
    const onStarredChange = vi.fn();
    renderDetail({ onStarredChange });

    fireEvent.click(screen.getByRole('button', { name: 'Star task' }));

    expect(onStarredChange).toHaveBeenCalledWith(true);
  });

  it('does not render a visible time section heading above the range picker', () => {
    renderDetail();

    expect(screen.queryByText('Time')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Time range')).toBeInTheDocument();
  });

  it('keeps an unset deadline blank until the user selects a date', () => {
    const onDeadlineChange = vi.fn();
    renderDetail({ onDeadlineChange });

    fireEvent.click(
      screen.getByRole('button', { name: 'Deadline: No deadline' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Choose deadline' }),
    ).toBeInTheDocument();
    expect(onDeadlineChange).not.toHaveBeenCalled();
  });

  it('does not render the active working directory in the task header', () => {
    renderDetail();

    expect(screen.queryByText('~/p/tmatrix')).not.toBeInTheDocument();
  });

  it('renders the project background image as a cover layer behind the task header', () => {
    const { container } = renderDetail({
      project: projectFixture({
        backgroundImagePath:
          '/Users/markcl/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-1/background/header.png',
      }),
    });

    const background = container.querySelector(
      '.detail-header-background',
    ) as HTMLElement | null;

    expect(background).toBeInTheDocument();
    expect(background?.style.backgroundImage).toContain(
      'asset:///Users/markcl/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-1/background/header.png',
    );
    expect(appStyles).toMatch(
      /\.detail-header-background\s*{[^}]*background-size:\s*cover;/s,
    );
    expect(appStyles).toMatch(
      /\.detail-header-background\s*{[^}]*filter:\s*grayscale\(100%\)\s*sepia\(100%\)\s*saturate\(150%\);/s,
    );
  });

  it('toggles the description and terminal panels for the selected task', () => {
    const onTodoPanelVisibilityChange = vi.fn();
    renderDetail({ onTodoPanelVisibilityChange });

    expect(screen.getByLabelText('Description Markdown')).toBeInTheDocument();
    expect(screen.getByLabelText('Execution panel mock')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide description panel' }),
    );
    expect(onTodoPanelVisibilityChange).toHaveBeenLastCalledWith({
      descriptionPanelHidden: true,
      executionPanelHidden: false,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide terminal panel' }),
    );
    expect(onTodoPanelVisibilityChange).toHaveBeenLastCalledWith({
      descriptionPanelHidden: false,
      executionPanelHidden: true,
    });
  });

  it('triggers autotitle from the title header button', () => {
    const onGenerateTitle = vi.fn();
    renderDetail({ onGenerateTitle });

    fireEvent.click(
      screen.getByRole('button', { name: 'Autotitle from description' }),
    );

    expect(onGenerateTitle).toHaveBeenCalledTimes(1);
  });

  it('disables the autotitle button and shows progress while generating', () => {
    const onGenerateTitle = vi.fn();
    renderDetail({ onGenerateTitle, titleGenerationPending: true });

    const button = screen.getByRole('button', { name: 'Generating title…' });
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Autotitle from description' }),
    ).not.toBeInTheDocument();
  });

  it('uses remembered task panel visibility when rendering a task', () => {
    const todo = todoFixture({
      descriptionPanelHidden: true,
      executionPanelHidden: false,
    });
    renderDetail({ todo });

    expect(
      screen.queryByLabelText('Description Markdown'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Execution panel mock')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show description panel' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('passes separate persisted TOC widths to description and artifact editors', () => {
    const onDescriptionTocWidthChange = vi.fn();
    const onArtifactTocWidthChange = vi.fn();
    renderDetail({
      appSettings: {
        ...fallbackAppSettings,
        markdownArtifactTocWidth: 256,
        markdownDescriptionTocWidth: 208,
      },
      onArtifactTocWidthChange,
      onDescriptionTocWidthChange,
    });

    expect(
      markdownEditorCalls.find(
        (call) => call.ariaLabel === 'Description Markdown',
      ),
    ).toMatchObject({
      onTocWidthChange: onDescriptionTocWidthChange,
      tocWidth: 208,
    });
    expect(executionPanelCalls.at(-1)).toMatchObject({
      artifactTocWidth: 256,
      onArtifactTocWidthChange,
    });
  });

  it('passes separate task TOC visibility state to description and artifact editors', () => {
    const onDescriptionTocHiddenChange = vi.fn();
    const onArtifactTocHiddenChange = vi.fn();
    renderDetail({
      onArtifactTocHiddenChange,
      onDescriptionTocHiddenChange,
      todo: todoFixture({
        artifactTocHidden: false,
        descriptionTocHidden: true,
      }),
    });

    expect(
      markdownEditorCalls.find(
        (call) => call.ariaLabel === 'Description Markdown',
      ),
    ).toMatchObject({
      onTocHiddenChange: onDescriptionTocHiddenChange,
      tocHidden: true,
    });
    expect(executionPanelCalls.at(-1)).toMatchObject({
      artifactTocHidden: false,
      onArtifactTocHiddenChange,
    });
  });

  it('keeps visited description and journal editors mounted so tab switches do not cancel saves', () => {
    const { container } = renderDetail({
      todo: todoFixture({
        descriptionMarkdown: '# Prompt context',
        journalMarkdown: '# Private work log',
      }),
    });

    const descriptionPanel = container.querySelector('#todo-128-description-panel');
    const journalPanel = container.querySelector('#todo-128-journal-panel');

    // The journal editor is a lazy island: it only mounts once its tab is
    // first activated, so opening a task pays for one editor, not two.
    expect(descriptionPanel).not.toHaveAttribute('hidden');
    expect(journalPanel).toHaveAttribute('hidden');
    expect(container.querySelector('[aria-label="Description Markdown"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Journal Markdown"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }));

    expect(descriptionPanel).toHaveAttribute('hidden');
    expect(journalPanel).not.toHaveAttribute('hidden');
    expect(container.querySelector('[aria-label="Description Markdown"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Journal Markdown"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Description' }));

    // Once visited, both editors stay mounted so pending saves survive.
    expect(container.querySelector('[aria-label="Description Markdown"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Journal Markdown"]')).toBeInTheDocument();
  });

  it('shows description and journal as tabs and saves journal markdown separately', () => {
    const onSaveDescription = vi.fn();
    const onSaveJournal = vi.fn();
    const { container } = renderDetail({
      onSaveDescription,
      onSaveJournal,
      todo: todoFixture({
        descriptionMarkdown: '# Prompt context',
        journalMarkdown: '# Private work log',
      }),
    });

    expect(screen.getByRole('tab', { name: 'Description' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Journal' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(container.querySelector('#todo-128-description-panel')).not.toHaveAttribute('hidden');
    expect(container.querySelector('#todo-128-journal-panel')).toHaveAttribute('hidden');
    const descriptionEditor = markdownEditorCalls.find(
      (call) => call.ariaLabel === 'Description Markdown',
    );
    expect(descriptionEditor).toMatchObject({
      ariaLabel: 'Description Markdown',
      markdown: '# Prompt context',
    });
    descriptionEditor?.onSave?.('# Updated prompt');
    expect(onSaveDescription).toHaveBeenCalledWith(128, '# Updated prompt');

    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }));

    expect(screen.getByRole('tab', { name: 'Journal' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(container.querySelector('#todo-128-description-panel')).toHaveAttribute('hidden');
    expect(container.querySelector('#todo-128-journal-panel')).not.toHaveAttribute('hidden');
    const journalEditor = markdownEditorCalls.find(
      (call) => call.ariaLabel === 'Journal Markdown',
    );
    expect(journalEditor).toMatchObject({
      ariaLabel: 'Journal Markdown',
      markdown: '# Private work log',
    });
    journalEditor?.onSave?.('# Updated journal');
    expect(onSaveJournal).toHaveBeenCalledWith(128, '# Updated journal');
  });

  it('remembers the journal tab when returning to a task', () => {
    const project = projectFixture();
    const firstTodo = todoFixture({
      displayId: 'T-128',
      id: 128,
      journalMarkdown: '# First task journal',
      title: 'First task',
    });
    const secondTodo = todoFixture({
      displayId: 'T-129',
      id: 129,
      journalMarkdown: '# Second task journal',
      title: 'Second task',
    });
    const { rerender } = renderDetail({
      project,
      snapshot: snapshotFixture(project, firstTodo),
      todo: firstTodo,
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }));
    expect(screen.getByRole('tab', { name: 'Journal' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    rerender(
      taskDetailElement({
        project,
        snapshot: snapshotFixture(project, secondTodo),
        todo: secondTodo,
      }),
    );
    expect(screen.getByRole('tab', { name: 'Description' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    rerender(
      taskDetailElement({
        project,
        snapshot: snapshotFixture(project, firstTodo),
        todo: firstTodo,
      }),
    );

    expect(screen.getByRole('tab', { name: 'Journal' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Journal' })).not.toHaveAttribute('hidden');
    expect(
      markdownEditorCalls.find((call) => call.ariaLabel === 'Journal Markdown'),
    ).toMatchObject({
      ariaLabel: 'Journal Markdown',
      markdown: '# First task journal',
    });
  });
});

describe('TaskDetail responsive layout', () => {
  it('keeps space between the stacked description and terminal panels', () => {
    const responsiveRule =
      appStyles.match(
        /@media \(max-width: 1040px\)\s*{([\s\S]*?)\n}\n\n@media \(max-width: 760px\)/,
      )?.[1] ?? '';

    expect(responsiveRule).toMatch(
      /\.detail-workspace\s*{[^}]*grid-template-columns:\s*1fr;[^}]*row-gap:\s*16px;/s,
    );
  });
});

function renderDetail(
  overrides: Partial<ComponentProps<typeof TaskDetail>> = {},
) {
  markdownEditorCalls.length = 0;
  executionPanelCalls.length = 0;

  return render(taskDetailElement(overrides));
}

function projectActionFixture(
  overrides: Partial<ProjectActionSummary> = {},
): ProjectActionSummary {
  const action = {
    arguments: [],
    description: 'Deploy the selected task project',
    fileName: 'run.sh',
    icon: null,
    iconConfigured: false,
    path: '/tmp/.boomerang/actions/run.sh',
    runtime: 'shell',
    title: 'Run',
    validationError: null,
    ...overrides,
  };

  return {
    ...action,
    icon: action.icon ?? null,
    iconConfigured: action.iconConfigured ?? false,
    validationError: action.validationError ?? null,
  };
}

function taskDetailElement(
  overrides: Partial<ComponentProps<typeof TaskDetail>> = {},
) {
  return (
    <Provider>
      <TaskDetail {...taskDetailProps(overrides)} />
    </Provider>
  );
}

function taskDetailProps(
  overrides: Partial<ComponentProps<typeof TaskDetail>> = {},
): ComponentProps<typeof TaskDetail> {
  const project = overrides.project ?? projectFixture();
  const todo = overrides.todo ?? todoFixture();
  const snapshot =
    overrides.snapshot ??
    snapshotFixture(project ?? projectFixture(), todo);

  return {
    appSettings: fallbackAppSettings,
    executionTerminals: [],
    isTimerRunning: false,
    onAcceptDone: vi.fn(),
    onAddDependency: vi.fn(),
    onAddManualTimeLog: vi.fn(),
    onArchive: vi.fn(),
    onBackToList: vi.fn(),
    onCloseExecutionTerminal: vi.fn(),
    onCommitAndMergeWorktree: vi.fn(),
    onContextProjectChange: vi.fn(),
    onOpenExternalTerminal: vi.fn(),
    onRenameExecutionTerminal: vi.fn(),
    onCopyArtifactLink: vi.fn(),
    onCopyPrompt: vi.fn(),
    onCreateSubtask: vi.fn(),
    onDeadlineChange: vi.fn(),
    onDelete: vi.fn(),
    onDeleteTimeLog: vi.fn(),
    onDeleteWorktree: vi.fn().mockResolvedValue(undefined),
    onEnableWorktree: vi.fn(),
    onGenerateTitle: vi.fn(),
    titleGenerationPending: false,
    onOpenArtifact: vi.fn(),
    onOpenWorktreeDiff: vi.fn(),
    onOpenWorktreeFolder: vi.fn(),
    onPriorityChange: vi.fn(),
    onProjectPromptSettingsChange: vi.fn(),
    onRemoveDependency: vi.fn(),
    onRequestChanges: vi.fn(),
    onRunTaskAction: vi.fn(),
    onRunWorktreeAction: vi.fn(),
    onSaveArtifact: vi.fn(),
    onSaveDescription: vi.fn(),
    onSaveJournal: vi.fn(),
    onSelectTodo: vi.fn(),
    onStarredChange: vi.fn(),
    onSetParent: vi.fn(),
    onStartExecutionTerminal: vi.fn(),
    onStartTimer: vi.fn(),
    onStateChange: vi.fn(),
    onStopTimer: vi.fn(),
    onSuggestWorktreeName: vi.fn(),
    onTagsChange: vi.fn(),
    onArtifactTocWidthChange: vi.fn(),
    onArtifactTocHiddenChange: vi.fn(),
    onDescriptionTocWidthChange: vi.fn(),
    onDescriptionTocHiddenChange: vi.fn(),
    onTaskDetailDescriptionWidthChange: vi.fn(),
    onTaskDetailsRailHiddenChange: vi.fn(),
    onTitleChange: vi.fn(),
    onTodoPanelVisibilityChange: vi.fn(),
    onUpdateTimeLogDuration: vi.fn(),
    project,
    projectActions: [],
    snapshot,
    todo,
    ...overrides,
  };
}

function projectFixture(
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
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
    id: 1,
    mainBranch: 'main',
    name: 'tmatrix',
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    terminalWslEnabled: false,
    workingDirectory: '~/p/tmatrix',
    ...overrides,
  };
}

function todoFixture(overrides: Partial<TodoSummary> = {}): TodoSummary {
  return {
    activeWorkingDirectory: '~/p/tmatrix',
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    artifactTocHidden: true,
    deadline: null,
    dependencies: [],
    descriptionMarkdown: '# Goal',
    descriptionPanelHidden: false,
    descriptionTocHidden: true,
    displayId: 'T-128',
    events: [],
    executionPanelHidden: false,
    id: 128,
    journalMarkdown: '',
    ownTimeSeconds: 0,
    parentId: null,
    position: 0,
    priority: 'High',
    projectId: 1,
    rolledUpTimeSeconds: 0,
    stale: false,
    starred: false,
    state: 'To Do',
    subtasks: [],
    tags: [],
    timeLogs: [],
    title: 'Wire up MCP server',
    updatedAt: '2026-06-20T09:40:00Z',
    ...overrides,
    createdAt: overrides.createdAt ?? '2026-06-20T09:00:00Z',
  };
}

function snapshotFixture(
  project: ProjectSummary,
  todo: TodoSummary,
): AppSnapshot {
  return {
    boomerangBinaryPath: 'boomerang',
    executionTerminals: [],
    messages: [],
    projects: [project],
    runningTimer: null,
    selectedProjectId: project.id,
    selectedTodoId: todo.id,
    sessions: [],
    todos: [todo],
  };
}

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(new RegExp(`(^|\\n)${escapedSelector}\\s*{[^}]*}`, 's'));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[0];
}
