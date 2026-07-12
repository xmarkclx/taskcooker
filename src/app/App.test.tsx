import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Provider as JotaiProvider, createStore } from 'jotai';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot, seedSnapshot } from '../data/seed';
import type { AppSnapshot } from '../domain/domain';
import { AUTOSAVE_DEBOUNCE_MS } from '../features/markdown/MarkdownEditor';
import { loadRecentRemoteServers } from '../features/remote/remoteServers';
import { doneTerminalWarningDismissed } from '../features/tasks/doneTerminalWarningStorage';
import * as ptyBridge from '../features/terminal/ptyBridge';
import { createTestRouter } from '../router';
import * as tauriCommands from '../tauri/commands';
import * as tauriWindows from '../tauri/windows';
import {
  doneTerminalWarningEnabledAtom,
  recentRemoteServersAtom,
} from './useMainAppUiState';

const tauriEventMock = vi.hoisted(() => {
  const handlers = new Map<
    string,
    Array<(event: { payload: unknown }) => void>
  >();
  return {
    handlers,
    listen: vi.fn(
      async (
        eventName: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
        const current = handlers.get(eventName) ?? [];
        current.push(handler);
        handlers.set(eventName, current);
        return () => {
          handlers.set(
            eventName,
            (handlers.get(eventName) ?? []).filter(
              (candidate) => candidate !== handler,
            ),
          );
        };
      },
    ),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriEventMock.listen,
}));

// These tests drive editors synchronously after render/tab clicks; the
// two-frame paint deferral itself is pinned in src/ui/DeferredMount.test.tsx.
vi.mock('../ui/DeferredMount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/DeferredMount')>();
  return {
    ...actual,
    DeferredMount: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

const appStyles = readFileSync(
  resolve(process.cwd(), 'src/styles.css'),
  'utf8',
);

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'isTauri');
  window.localStorage.clear();
  tauriCommands.setActiveInvokeClient(null);
  tauriEventMock.handlers.clear();
  tauriEventMock.listen.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Boomerang app shell', () => {
  it('renders the Paper wood-light main task screen without marketing tagline chrome', async () => {
    renderApp();

    expect(
      await screen.findByRole('button', { name: 'Go home' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Wire up MCP server').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole('button', { name: 'Filter tasks' }),
    ).toHaveTextContent('Tasks');
    expect(
      screen.getByRole('radiogroup', { name: 'Task list view' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Task' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Execution' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Copy Agent Prompt' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Agent Sessions')).not.toBeInTheDocument();
    expect(screen.queryByText('Messages')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Start Claude' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Send it out. Know when it's back."),
    ).not.toBeInTheDocument();
  });

  it('connects to a remote TaskCooker server from the native menu event', async () => {
    const remoteSnapshot: AppSnapshot = {
      ...seedSnapshot,
      projects: [
        {
          ...seedSnapshot.projects[0],
          id: 501,
          name: 'WSL Brain',
          workingDirectory: '/home/mark/p/boomerangtasks',
        },
      ],
      selectedProjectId: 501,
      selectedTodoId: 0,
      todos: [],
    };
    const startRemoteTunnel = vi
      .spyOn(tauriCommands, 'startRemoteTunnel')
      .mockResolvedValue({
        baseUrl: 'http://127.0.0.1:49152',
        localPort: 49152,
        serverPort: 8790,
        sshHost: 'wsl',
      });
    const stopRemoteTunnel = vi
      .spyOn(tauriCommands, 'stopRemoteTunnel')
      .mockResolvedValue();
    vi.spyOn(tauriCommands, 'loadAppSnapshot')
      .mockResolvedValueOnce(seedSnapshot)
      .mockResolvedValue(remoteSnapshot);

    renderApp();
    await screen.findByRole('button', { name: 'Go home' });
    await act(async () => {
      emitTauriEvent('remote:connect-requested');
    });

    const dialog = await screen.findByRole('dialog', {
      name: /connect to taskcooker server/i,
    });
    fireEvent.change(within(dialog).getByLabelText('SSH host'), {
      target: { value: 'wsl' },
    });
    fireEvent.change(within(dialog).getByLabelText('Server port'), {
      target: { value: '8790' },
    });
    fireEvent.change(within(dialog).getByLabelText('Remote project path'), {
      target: { value: '/home/mark/p/boomerangtasks' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(startRemoteTunnel).toHaveBeenCalledWith({
        sshHost: 'wsl',
        serverPort: 8790,
      });
    });
    expect(await screen.findByText('Connected to wsl')).toBeInTheDocument();
    expect(
      await screen.findByLabelText(/select project: WSL Brain/i),
    ).toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem('taskcooker.remoteServers') ?? '[]',
      ),
    ).toEqual([
      {
        sshHost: 'wsl',
        serverPort: 8790,
        remotePath: '/home/mark/p/boomerangtasks',
      },
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Disconnect remote server' }),
    );

    await waitFor(() => {
      expect(stopRemoteTunnel).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Connected to wsl')).not.toBeInTheDocument();
  });

  it('quick-connects to recent remote servers and keeps only five deduped entries', async () => {
    window.localStorage.setItem(
      'taskcooker.remoteServers',
      JSON.stringify([
        { sshHost: 'alpha', serverPort: 8790, remotePath: '/srv/alpha' },
        {
          sshHost: 'wsl',
          serverPort: 8790,
          remotePath: '/home/mark/p/boomerangtasks',
        },
        { sshHost: 'beta', serverPort: 8791, remotePath: '/srv/beta' },
        { sshHost: 'gamma', serverPort: 8792, remotePath: '/srv/gamma' },
        { sshHost: 'delta', serverPort: 8793, remotePath: '/srv/delta' },
      ]),
    );
    vi.spyOn(tauriCommands, 'startRemoteTunnel').mockResolvedValue({
      baseUrl: 'http://127.0.0.1:49152',
      localPort: 49152,
      serverPort: 8790,
      sshHost: 'wsl',
    });
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(seedSnapshot);

    renderApp();
    await screen.findByRole('button', { name: 'Go home' });
    await act(async () => {
      emitTauriEvent('remote:connect-requested');
    });

    const dialog = await screen.findByRole('dialog', {
      name: /connect to taskcooker server/i,
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /quick connect wsl/i }),
    );

    await waitFor(() => {
      expect(tauriCommands.startRemoteTunnel).toHaveBeenCalledWith({
        sshHost: 'wsl',
        serverPort: 8790,
      });
    });
    expect(
      JSON.parse(
        window.localStorage.getItem('taskcooker.remoteServers') ?? '[]',
      ),
    ).toEqual([
      {
        sshHost: 'wsl',
        serverPort: 8790,
        remotePath: '/home/mark/p/boomerangtasks',
      },
      { sshHost: 'alpha', serverPort: 8790, remotePath: '/srv/alpha' },
      { sshHost: 'beta', serverPort: 8791, remotePath: '/srv/beta' },
      { sshHost: 'gamma', serverPort: 8792, remotePath: '/srv/gamma' },
      { sshHost: 'delta', serverPort: 8793, remotePath: '/srv/delta' },
    ]);
  });

  it('applies saved Wood Dark settings and exposes theme controls', async () => {
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      theme: 'dark',
    });

    renderApp();

    expect(
      await screen.findByRole('button', { name: 'Go home' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.app-shell')).toHaveAttribute(
        'data-theme',
        'dark',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open app settings' }));
    expect(await screen.findByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('resolves the System theme from the OS dark-mode preference', async () => {
    mockSystemColorScheme(true);
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      theme: 'system' as typeof tauriCommands.fallbackAppSettings.theme,
    });

    renderApp();

    expect(
      await screen.findByRole('button', { name: 'Go home' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.app-shell')).toHaveAttribute(
        'data-theme',
        'dark',
      );
    });
    expect(
      screen.getByRole('button', { name: 'Switch to Wood Light theme' }),
    ).toBeInTheDocument();
  });

  it('toggles the header theme control to the opposite pinned theme', async () => {
    const updateAppSettings = vi
      .spyOn(tauriCommands, 'updateAppSettings')
      .mockResolvedValue({
        ...tauriCommands.fallbackAppSettings,
        theme: 'light',
      });
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      theme: 'dark',
    });

    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch to Wood Light theme' }),
    );

    await waitFor(() => {
      expect(updateAppSettings).toHaveBeenCalledWith({
        appContextMarkdown:
          tauriCommands.fallbackAppSettings.appContextMarkdown,
        folderOpenApp: tauriCommands.fallbackAppSettings.folderOpenApp,
        claudePath: tauriCommands.fallbackAppSettings.claudePath,
        codexPath: tauriCommands.fallbackAppSettings.codexPath,
        deepLinkFallback: tauriCommands.fallbackAppSettings.deepLinkFallback,
        homeProjectId: tauriCommands.fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily:
          tauriCommands.fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize:
          tauriCommands.fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight:
          tauriCommands.fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: tauriCommands.fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth:
          tauriCommands.fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled:
          tauriCommands.fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled:
          tauriCommands.fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners:
          tauriCommands.fallbackAppSettings.externalTerminalOpeners,
        taskTitler: tauriCommands.fallbackAppSettings.taskTitler,
        theme: 'light',
      });
    });
  });

  it('derives a stable shell border accent from the selected project name', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      projects: [
        ...seedSnapshot.projects,
        {
          ...seedSnapshot.projects[0],
          activeTodoCount: 1,
          status: 'Active' as const,
          inheritParent: false,
          subprojects: [],          displayIdPrefix: 'CDC',
          id: 2,
          name: 'CDC Charter',
          notesMarkdown: '# CDC Charter notes',
          workingDirectory: '~/p/cdc-charter',
        },
      ],
      todos: [
        ...seedSnapshot.todos,
        {
          ...seedSnapshot.todos[0],
          activeWorkingDirectory: '~/p/cdc-charter',
          artifactMarkdownPath:
            '~/Library/Application Support/com.marklopez.boomerangtasks/artifacts/project-2/CDC-1.md',
          dependencies: [],
          displayId: 'CDC-1',
          id: 4001,
          projectId: 2,
          subtasks: [],
          title: 'Review project accent',
        },
      ],
    });
    const { router } = renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByLabelText(/select project: tmatrix/i),
    ).toBeInTheDocument();
    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell).toHaveAttribute('data-project-accent', 'tmatrix');
    const tmatrixHue = shell.style.getPropertyValue('--project-accent-hue');
    expect(tmatrixHue).toMatch(/^\d+deg$/);

    await act(async () => {
      await router.navigate({
        to: '/',
        search: () => ({ projectId: 2, todoId: undefined }),
      });
    });

    expect(
      await screen.findByLabelText(/select project: cdc charter/i),
    ).toBeInTheDocument();
    expect(shell).toHaveAttribute('data-project-accent', 'CDC Charter');
    const cdcHue = shell.style.getPropertyValue('--project-accent-hue');
    expect(cdcHue).toMatch(/^\d+deg$/);
    expect(cdcHue).not.toBe(tmatrixHue);
    const selectedProjectButton = screen.getByLabelText(
      /select project: cdc charter/i,
    );
    const selectedProjectDot = selectedProjectButton.querySelector(
      '.project-dot',
    ) as HTMLElement;
    expect(
      selectedProjectDot.style.getPropertyValue('--project-accent-hue'),
    ).toBe(cdcHue);

    fireEvent.click(selectedProjectButton);
    const projectMenu = await screen.findByRole('menu', { name: 'Projects' });
    const tmatrixProjectRow = within(projectMenu).getByRole('menuitem', {
      name: /tmatrix/i,
    });
    const tmatrixProjectDot = tmatrixProjectRow.querySelector(
      '.project-dot',
    ) as HTMLElement;
    expect(
      tmatrixProjectDot.style.getPropertyValue('--project-accent-hue'),
    ).toBe(tmatrixHue);

    await act(async () => {
      await router.navigate({
        to: '/',
        search: () => ({ projectId: 1, todoId: undefined }),
      });
    });

    expect(
      await screen.findByLabelText(/select project: tmatrix/i),
    ).toBeInTheDocument();
    expect(shell.style.getPropertyValue('--project-accent-hue')).toBe(
      tmatrixHue,
    );
  });

  it('applies the saved project border width to the app shell', async () => {
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      projectAccentBorderWidth: 6,
    });
    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByLabelText(/select project: tmatrix/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.app-shell')).toHaveStyle({
        '--project-window-border-width': '6px',
      });
    });
  });

  it('uses the Wood Light task list header and keeps project window actions in the project menu', async () => {
    renderApp();

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    const filterTrigger = within(taskList).getByRole('button', {
      name: 'Filter tasks',
    });
    expect(filterTrigger).toHaveTextContent('Tasks');

    fireEvent.click(filterTrigger);
    const filterMenu = await within(taskList).findByRole('menu', {
      name: 'Filter tasks',
    });
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Tasks 6' }),
    ).toHaveClass('active');
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Icebox' }),
    ).toBeInTheDocument();
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'To Do' }),
    ).toBeInTheDocument();
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Doing' }),
    ).toBeInTheDocument();
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Done' }),
    ).toBeInTheDocument();
    expect(
      within(filterMenu).getByRole('menuitem', { name: 'Archived' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    const viewGroup = within(taskList).getByRole('radiogroup', {
      name: 'Task list view',
    });
    expect(
      within(viewGroup).getByRole('radio', { name: 'Tree View' }),
    ).toBeChecked();
    expect(
      within(viewGroup).getByRole('radio', { name: 'Priority View' }),
    ).not.toBeChecked();
    expect(
      within(viewGroup).getByRole('radio', { name: 'Updated View' }),
    ).not.toBeChecked();
    expect(
      within(viewGroup).getByRole('radio', { name: 'Created View' }),
    ).not.toBeChecked();

    expect(
      screen.queryByLabelText('Open tmatrix in new window'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/select project: tmatrix/i));
    expect(
      await screen.findByLabelText('Open tmatrix in new window'),
    ).toBeInTheDocument();
  });

  it('closes an open header popup before opening another app popup', async () => {
    vi.spyOn(tauriWindows, 'listOpenAppWindows').mockResolvedValue([
      {
        isCurrent: true,
        kind: 'workspace',
        label: 'main',
        title: 'TaskCooker',
      },
    ]);

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch windows' }),
    );
    expect(
      await screen.findByRole('menu', { name: 'Open windows' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open app settings' }));

    expect(
      await screen.findByRole('dialog', { name: /app settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menu', { name: 'Open windows' }),
    ).not.toBeInTheDocument();
  });

  it('refreshes app snapshots periodically so age and stale badges keep moving', async () => {
    vi.useFakeTimers();
    const loadAppSnapshot = vi
      .spyOn(tauriCommands, 'loadAppSnapshot')
      .mockResolvedValue(seedSnapshot);

    renderApp();

    await act(async () => {
      await Promise.resolve();
    });
    expect(loadAppSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(loadAppSnapshot).toHaveBeenCalledTimes(2);
  });

  it('shows first-run creation actions when the database is empty', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(emptySnapshot);

    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'No task selected' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    expect(
      await screen.findByRole('dialog', { name: /new project/i }),
    ).toBeInTheDocument();
  });

  it('does not flash the tmatrix demo project while the first snapshot loads', async () => {
    // Keep the real snapshot pending so the React Query placeholder is what
    // the user sees on first paint (slow Windows cold starts make this obvious).
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue(
      tauriCommands.fallbackAppSettings,
    );

    renderApp();

    expect(
      await screen.findByRole('button', { name: 'Create Project' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/select project: tmatrix/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('tmatrix')).not.toBeInTheDocument();
  });

  it('does not borrow task terminals from another project when the selected project has no tasks', async () => {
    mockTerminalEnvironment();
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      executionTerminals: [
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 41,
          state: 'running',
          todoId: 128,
        },
      ],
      projects: [
        ...seedSnapshot.projects,
        {
          ...seedSnapshot.projects[0],
          activeTodoCount: 0,
          displayIdPrefix: 'TP',
          id: 2,
          name: 'test project',
          workingDirectory: '~/p/test-project',
        },
      ],
      selectedProjectId: 2,
      selectedTodoId: 128,
    });

    renderApp('/?projectId=2');

    expect(
      await screen.findByRole('heading', { name: 'No task selected' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Wire up MCP server' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Terminal' }),
    ).not.toBeInTheDocument();
  });

  it('opens project and task windows from shell controls', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderApp();

    fireEvent.click(await screen.findByLabelText(/select project: tmatrix/i));
    fireEvent.click(await screen.findByLabelText('Open tmatrix in new window'));
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        '/?projectId=1',
        '_blank',
        'noopener,noreferrer',
      );
    });

    fireEvent.click(screen.getByLabelText('Open T-128 in new window'));
    await waitFor(() => {
      expect(open).toHaveBeenLastCalledWith(
        '/?projectId=1&todoId=128&taskWindow=1',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  it('switches focus to an already open window from the header selector', async () => {
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const listOpenAppWindows = vi
      .spyOn(tauriWindows, 'listOpenAppWindows')
      .mockResolvedValue([
        {
          isCurrent: true,
          kind: 'workspace',
          label: 'main',
          title: 'Main Workspace',
        },
        {
          isCurrent: false,
          kind: 'project',
          label: 'project-1-test',
          title: 'CDC Charter',
        },
        {
          isCurrent: false,
          kind: 'task',
          label: 'task-128-test',
          title: 'T-128 - Wire up MCP server',
        },
        {
          isCurrent: false,
          kind: 'terminal',
          label: 'terminal-42-test',
          title: 'Claude · session-1',
        },
      ]);
    const focusOpenAppWindow = vi
      .spyOn(tauriWindows, 'focusOpenAppWindow')
      .mockResolvedValue(true);

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch windows' }),
    );

    const menu = await screen.findByRole('menu', { name: 'Open windows' });
    expect(listOpenAppWindows).toHaveBeenCalledTimes(1);
    const switchWindowsButton = screen.getByRole('button', {
      name: 'Switch windows',
    });
    const projectSelector = screen.getByLabelText(/select project: tmatrix/i);
    expect(
      switchWindowsButton.compareDocumentPosition(projectSelector) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const currentWindowRow = within(menu).getByRole('menuitem', {
      name: /tmatrix current window/i,
    });
    expect(currentWindowRow).toBeDisabled();
    expect(
      currentWindowRow.querySelector('.window-kind-dot'),
    ).not.toBeInTheDocument();
    expect(
      currentWindowRow.querySelector('.window-kind-icon .lucide-folder-open'),
    ).toBeInTheDocument();
    expect(
      within(menu)
        .getByRole('menuitem', { name: /Claude · session-1 terminal window/i })
        .querySelector('.window-kind-icon .lucide-square-terminal'),
    ).toBeInTheDocument();

    fireEvent.click(
      within(menu).getByRole('menuitem', {
        name: /CDC Charter project window/i,
      }),
    );

    await waitFor(() => {
      expect(focusOpenAppWindow).toHaveBeenCalledWith('project-1-test');
    });
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it('opens a new window for the current task context from Cmd+Shift+N', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('heading', { name: 'Wire up MCP server' });
    fireEvent.keyDown(document, {
      code: 'KeyN',
      key: 'N',
      metaKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        '/?projectId=1&todoId=128&taskWindow=1',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  it('opens the new task dialog for the current project from Cmd+N', async () => {
    const { router } = renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('heading', { name: 'Wire up MCP server' });
    fireEvent.keyDown(document, {
      code: 'KeyN',
      key: 'n',
      metaKey: true,
    });

    expect(
      await screen.findByRole('dialog', { name: /new task/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Create a task in tmatrix.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Review shortcut behavior' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(
      await screen.findByRole('heading', { name: 'Review shortcut behavior' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 134,
      });
    });
  });

  it('ignores Ctrl+N while a new subtask dialog is already open', async () => {
    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('heading', { name: 'Wire up MCP server' });
    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));

    const dialog = await screen.findByRole('dialog', { name: /new subtask/i });
    expect(
      within(dialog).getByText('Create a subtask under T-128.'),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Task title'), {
      target: { value: 'Preserve this draft' },
    });

    fireEvent.keyDown(document, {
      code: 'KeyN',
      ctrlKey: true,
      key: 'n',
    });

    expect(
      await screen.findByRole('dialog', { name: /new subtask/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /^new task$/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('Create a subtask under T-128.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Task title')).toHaveValue(
      'Preserve this draft',
    );
  });

  it('persists the task details sidebar visibility toggle globally', async () => {
    const setTaskDetailsRailHidden = vi
      .spyOn(tauriCommands, 'setTaskDetailsRailHidden')
      .mockResolvedValue({
        ...tauriCommands.fallbackAppSettings,
        taskDetailsRailHidden: true,
      });

    renderApp('/?projectId=1&todoId=128');

    expect(await screen.findByLabelText('State')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide details sidebar' }),
    );

    await waitFor(() => {
      expect(setTaskDetailsRailHidden).toHaveBeenCalledWith({ hidden: true });
    });
    expect(screen.queryByLabelText('State')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show details sidebar' }),
    ).toBeInTheDocument();
  });

  it('places tags after state and subtasks after priority in the task metadata rail', async () => {
    renderApp('/?projectId=1&todoId=128');

    const stateSection = (await screen.findByLabelText('State')).closest(
      '.meta-section',
    );
    const tagsSection = screen.getByText('Tags').closest('.meta-section');
    const prioritySection = screen
      .getByLabelText('Priority')
      .closest('.meta-section');
    const subtasksSection = screen
      .getByText('Subtasks')
      .closest('.meta-section');
    const deadlineSection = screen
      .getByLabelText('Deadline')
      .closest('.meta-section');

    expect(stateSection).not.toBeNull();
    expect(tagsSection).not.toBeNull();
    expect(prioritySection).not.toBeNull();
    expect(subtasksSection).not.toBeNull();
    expect(deadlineSection).not.toBeNull();
    expect(stateSection!.compareDocumentPosition(tagsSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(tagsSection!.compareDocumentPosition(prioritySection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(prioritySection!.compareDocumentPosition(subtasksSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(subtasksSection!.compareDocumentPosition(deadlineSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows all projects as an aggregate project selector option', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      projects: [
        ...seedSnapshot.projects,
        {
          id: 2,
          name: 'life',
          client: '',
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
          ...seedSnapshot.todos[1],
          id: 901,
          projectId: 2,
          displayId: 'LIFE-1',
          state: 'To Do',
          title: 'Buy replacement cable',
          tags: ['Errand'],
        },
      ],
    });

    renderApp('/?projectId=0&todoId=128');

    expect(
      await screen.findByLabelText(/select project: all projects, 20 active/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /buy replacement cable/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/select project: all projects/i));

    expect(
      await screen.findByRole('menuitem', { name: /all projects/i }),
    ).toBeInTheDocument();
  });

  it('opens new project from the adjacent plus and filters the project menu only by projects', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      projects: [
        ...seedSnapshot.projects,
        {
          id: 2,
          name: 'life',
          client: '',
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
    });

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: 'Go home' });
    const header = document.querySelector('.top-bar') as HTMLElement | null;
    expect(header).not.toBeNull();
    if (!header) {
      throw new Error('top bar did not render');
    }
    const newTaskButton = within(header).getByRole('button', {
      name: 'New task',
    });
    const newWorktreeTaskButton = within(header).getByRole('button', {
      name: 'New Worktree Task',
    });
    const newProjectButton = within(header).getByRole('button', {
      name: 'New project',
    });
    const homeButton = within(header).getByRole('button', { name: 'Go home' });
    const projectSelector = within(header).getByLabelText(
      /select project: tmatrix/i,
    );
    const projectPicker = projectSelector.closest('.project-picker');

    expect(
      newProjectButton.querySelector('.lucide-folder-plus'),
    ).toBeInTheDocument();
    expect(header.querySelector('.top-left')?.firstElementChild).toBe(
      homeButton,
    );
    expect(newWorktreeTaskButton.previousElementSibling).toBe(newTaskButton);
    expect(projectPicker?.previousElementSibling).toBe(newWorktreeTaskButton);
    expect(newTaskButton).toHaveClass('toolbar-button', 'top-icon-button');
    expect(
      screen.queryByLabelText('Add task from task list'),
    ).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    expect(
      await screen.findByRole('dialog', { name: /new project/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(homeButton);
    expect(
      await screen.findByLabelText(/select project: all projects/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/select project: all projects/i));
    const menu = await screen.findByRole('menu', { name: 'Projects' });
    const projectSearch = within(menu).getByLabelText('Search projects');

    expect(
      within(menu).getByRole('menuitem', { name: /all projects/i }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: /tmatrix/i }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: /life/i }),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /project notes/i }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /project settings/i }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /app settings/i }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /new project/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(projectSearch, { target: { value: 'life' } });

    expect(
      within(menu).queryByRole('menuitem', { name: /all projects/i }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /tmatrix/i }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: /life/i }),
    ).toBeInTheDocument();
  });

  it('filters the task list by any fixed todo state', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      todos: [
        ...seedSnapshot.todos,
        {
          ...seedSnapshot.todos[0],
          dependencies: [],
          displayId: 'T-777',
          events: [],
          id: 777,
          state: 'Waiting',
          subtasks: [],
          tags: ['Ops'],
          title: 'Wait for API credentials',
        },
      ],
    });

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: /wire up mcp server/i });
    expect(
      screen.queryByRole('button', { name: /wait for api credentials/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by state'), {
      target: { value: 'Waiting' },
    });

    expect(
      await screen.findByRole('button', { name: /wait for api credentials/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /wire up mcp server/i }),
    ).not.toBeInTheDocument();
  });

  it('shows dependency IDs and title snippets in task list indicators', async () => {
    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    const taskRow = await within(taskList).findByRole('button', {
      name: /wire up mcp server/i,
    });

    expect(
      within(taskRow).getByText('Depends T-104 Set up auth middleware'),
    ).toBeInTheDocument();
  });

  it('renders every task row in the list without virtualization', async () => {
    const project = {
      ...seedSnapshot.projects[0],
      activeTodoCount: 120,
      status: 'Active' as const,
      inheritParent: false,
      subprojects: [],    };
    const todos = Array.from({ length: 120 }, (_, index) => ({
      ...seedSnapshot.todos[0],
      deadline: null,
      dependencies: [],
      displayId: `T-${1000 + index}`,
      events: [],
      id: 1000 + index,
      ownTimeSeconds: 0,
      position: index,
      priority: 'None' as const,
      rolledUpTimeSeconds: 0,
      state: 'To Do' as const,
      stale: false,
      subtasks: [],
      tags: [],
      timeLogs: [],
      title: `Generated task ${index}`,
      updatedAt: '2026-06-20T10:00:00Z',
    }));
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      executionTerminals: [],
      messages: [],
      projects: [project],
      runningTimer: null,
      selectedProjectId: project.id,
      selectedTodoId: todos[0].id,
      sessions: [],
      todos,
    });

    renderApp('/?projectId=1&todoId=1000');

    expect(
      await screen.findByRole('button', { name: /generated task 0/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /generated task 119/i }),
    ).toBeInTheDocument();
  });

  it('computes deadline badges from the current time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-20T18:00:00Z'));

    renderApp();

    expect(await screen.findByText('Due in 40m')).toBeInTheDocument();
    expect(screen.queryByText('Due in 8h 40m')).not.toBeInTheDocument();
  });

  it('requests changes by returning the task to delegated work', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /change state/i }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /request changes/i }),
    );

    expect(await screen.findByDisplayValue('Delegated')).toBeInTheDocument();
  });

  it('closes top-bar menus from keyboard and outside pointer interactions', async () => {
    renderApp();

    fireEvent.click(await screen.findByLabelText(/select project: tmatrix/i));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /project actions/i }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('updates visible task state from the header actions', async () => {
    const { router } = renderApp();

    const stateDropdown = await screen.findByRole('button', {
      name: /change state/i,
    });
    fireEvent.click(stateDropdown);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Done' }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 132,
      });
    });
    expect(
      await screen.findByRole('region', { name: 'Task detail T-132' }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Icebox')).toBeInTheDocument();

    expect(screen.getByText('T-128 · 00:12:44')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Stop running timer for T-128'));
    expect(
      await screen.findByLabelText('Continue timer for T-128'),
    ).toBeInTheDocument();
    expect(screen.getByText('T-128 · 00:12:44')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /create project action/i }),
    );
    fireEvent.click(await screen.findByLabelText('Start timer for T-133'));
    expect(await screen.findByText('T-133 · 00:00:00')).toBeInTheDocument();
  });

  it('starts and stops timers from task list rows', async () => {
    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    const selectedRow = await within(taskList).findByRole('button', {
      name: /wire up mcp server/i,
    });

    expect(within(selectedRow).getByText('AI')).toBeInTheDocument();
    expect(within(selectedRow).getByText('Backend')).toBeInTheDocument();
    expect(
      within(selectedRow).queryByText('elapsed 12m'),
    ).not.toBeInTheDocument();
    expect(within(selectedRow).getByText('00:12:44 total')).toBeInTheDocument();
    expect(selectedRow.querySelector('.priority-dot')).toBeNull();
    expect(
      within(taskList).getByLabelText('Stop timer from task list for T-128'),
    ).toBeInTheDocument();
    expect(
      within(taskList).getByLabelText('Stop timer from task list for T-128'),
    ).toHaveClass('task-title-timer-button');
    expect(
      within(taskList).getByLabelText('Stop timer from task list for T-128'),
    ).not.toHaveClass('icon-button');
    expect(
      within(taskList).getByLabelText('Stop timer from task list for T-128'),
    ).toHaveClass('priority-high');
    expect(
      within(taskList)
        .getByLabelText('Stop timer from task list for T-128')
        .querySelector('svg'),
    ).toHaveAttribute('fill', 'currentColor');

    fireEvent.click(
      await within(taskList).findByLabelText(
        'Start timer from task list for T-133',
      ),
    );

    expect(await screen.findByText('T-133 · 00:00:00')).toBeInTheDocument();
    expect(
      await within(taskList).findByLabelText(
        'Stop timer from task list for T-133',
      ),
    ).toBeInTheDocument();
  });

  it('stops the timer from the app-wide running timer indicator', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByLabelText('Stop running timer for T-128'),
    );

    expect(await screen.findByText('T-128 · 00:12:44')).toBeInTheDocument();
    const continueTimer = screen.getByLabelText('Continue timer for T-128');
    expect(continueTimer.querySelector('svg')).toHaveAttribute(
      'fill',
      'currentColor',
    );

    fireEvent.click(continueTimer);

    expect(await screen.findByText('T-128 · 00:00:00')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Stop running timer for T-128'),
    ).toBeInTheDocument();
  });

  it('uses the timer task state color and focuses an existing task window from the task id', async () => {
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const listOpenAppWindows = vi
      .spyOn(tauriWindows, 'listOpenAppWindows')
      .mockResolvedValue([
        {
          isCurrent: false,
          kind: 'task',
          label: 'task-103-existing',
          title: 'T-103 - Export palette tokens',
        },
      ]);
    const focusOpenAppWindow = vi
      .spyOn(tauriWindows, 'focusOpenAppWindow')
      .mockResolvedValue(true);
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      runningTimer: {
        todoId: 103,
        projectId: 1,
        displayId: 'T-103',
        title: 'Export palette tokens',
        elapsedSeconds: 60,
      },
      selectedProjectId: 0,
      selectedTodoId: 128,
    });
    const { router } = renderApp('/?projectId=0&todoId=128');

    expect(await screen.findByText('T-103 · 00:01:00')).toBeInTheDocument();
    expect(
      document.querySelector('.running-timer-status.delegated'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open T-103' }));

    await waitFor(() => {
      expect(listOpenAppWindows).toHaveBeenCalledTimes(1);
      expect(focusOpenAppWindow).toHaveBeenCalledWith('task-103-existing');
    });
    expect(browserOpen).not.toHaveBeenCalled();
    expect(router.state.location.search).toMatchObject({
      projectId: 0,
      todoId: 128,
    });
  });

  it('opens a task window from the timer task id when none is already open', async () => {
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(tauriWindows, 'listOpenAppWindows').mockResolvedValue([]);
    vi.spyOn(tauriWindows, 'focusOpenAppWindow').mockResolvedValue(false);
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      runningTimer: {
        todoId: 103,
        projectId: 1,
        displayId: 'T-103',
        title: 'Export palette tokens',
        elapsedSeconds: 60,
      },
      selectedProjectId: 0,
      selectedTodoId: 128,
    });
    renderApp('/?projectId=0&todoId=128');

    fireEvent.click(await screen.findByRole('button', { name: 'Open T-103' }));

    await waitFor(() => {
      expect(browserOpen).toHaveBeenCalledWith(
        '/?projectId=1&todoId=103&taskWindow=1',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  it('filters task rows by tag and shows dependency indicators', async () => {
    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByText('Depends T-104 Set up auth middleware'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by tag'), {
      target: { value: 'Security' },
    });

    expect(
      screen.getByRole('button', { name: /resolve auth token scope/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /draft deadline ui states/i }),
    ).not.toBeInTheDocument();
  });

  it('escalates stale waiting-state badges visually', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 103 ? { ...todo, stale: true } : todo,
      ),
    });

    renderApp('/?projectId=1&todoId=103');

    const staleBadges = await screen.findAllByText('Delegated since 1d 8h');
    expect(staleBadges.length).toBeGreaterThanOrEqual(1);
    staleBadges.forEach((badge) => expect(badge).toHaveClass('stale'));
  });

  it('shows Review state age in the selected task header', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128 ? { ...todo, stateAgeLabel: '2h' } : todo,
      ),
    });

    renderApp('/?projectId=1&todoId=128');

    const detailPane = await screen.findByRole('region', {
      name: 'Task detail T-128',
    });
    expect(
      await within(detailPane).findByText('Ready to Test since 2h'),
    ).toBeInTheDocument();
  });

  it('shows specific review state labels in compact task row badges', async () => {
    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });

    expect(
      await within(taskList).findByText('READY TO TEST'),
    ).toBeInTheDocument();
    expect(
      await within(taskList).findByText('NEEDS FEEDBACK'),
    ).toBeInTheDocument();
    expect(within(taskList).queryByText('REVIEW')).not.toBeInTheDocument();
  });

  it('collapses and expands the selected task subtasks', async () => {
    renderApp('/?projectId=1&todoId=128');

    const detailPane = await screen.findByLabelText('Task detail T-128');
    expect(
      await within(detailPane).findByRole('button', {
        name: /define the five mcp tools/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(detailPane).getByRole('button', { name: 'Collapse subtasks' }),
    );

    expect(
      within(detailPane).queryByRole('button', {
        name: /define the five mcp tools/i,
      }),
    ).not.toBeInTheDocument();
    expect(within(detailPane).getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(
      within(detailPane).getByRole('button', { name: 'Expand subtasks' }),
    );

    expect(
      await within(detailPane).findByRole('button', {
        name: /define the five mcp tools/i,
      }),
    ).toBeInTheDocument();
  });

  it('nests subtasks in the main list and collapses them from the parent row', async () => {
    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    expect(
      await within(taskList).findByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(taskList).getByRole('button', {
        name: 'Collapse subtasks for T-128',
      }),
    );

    expect(
      within(taskList).queryByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(taskList).getByRole('button', {
        name: 'Expand subtasks for T-128',
      }),
    );

    expect(
      await within(taskList).findByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    ).toBeInTheDocument();
  });

  it('loads and persists task list accordion state from app settings', async () => {
    const setTaskListAccordionState = vi
      .spyOn(tauriCommands, 'setTaskListAccordionState')
      .mockResolvedValue({
        ...tauriCommands.fallbackAppSettings,
        taskListCollapsedTodoIds: [],
      });
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      taskListCollapsedTodoIds: [128],
    });

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    const expandButton = await within(taskList).findByRole('button', {
      name: 'Expand subtasks for T-128',
    });
    await waitFor(() => {
      expect(
        within(taskList).queryByRole('button', {
          name: /wire settings on\/off toggle/i,
        }),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(expandButton);

    expect(
      await within(taskList).findByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        within(taskList).getByRole('button', {
          name: 'Collapse subtasks for T-128',
        }),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(setTaskListAccordionState).toHaveBeenCalledWith({
        collapsedProjectIds: [],
        collapsedSubprojectIds: [],
        collapsedTodoIds: [],
      });
    });
  });

  it('hides done tasks from Tasks until the Done filter is selected', async () => {
    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    expect(
      within(taskList).queryByRole('button', {
        name: /set up sqlite migrations/i,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      await within(taskList).findByRole('button', { name: 'Filter tasks' }),
    );
    fireEvent.click(
      await within(taskList).findByRole('menuitem', { name: 'Done' }),
    );

    expect(
      await within(taskList).findByRole('button', {
        name: /set up sqlite migrations/i,
      }),
    ).toBeInTheDocument();
  });

  it('hides delegated tasks when the delegated visibility toggle is enabled', async () => {
    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    expect(
      await within(taskList).findByRole('button', {
        name: /export palette tokens/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(taskList).getByRole('button', { name: /hide delegated tasks/i }),
    );

    await waitFor(() => {
      expect(
        within(taskList).queryByRole('button', {
          name: /export palette tokens/i,
        }),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(
      within(taskList).getByRole('button', { name: /hide delegated tasks/i }),
    );

    expect(
      await within(taskList).findByRole('button', {
        name: /export palette tokens/i,
      }),
    ).toBeInTheDocument();
  });

  it('hides archived tasks until the archived filter is selected', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      todos: [
        ...seedSnapshot.todos,
        {
          ...seedSnapshot.todos[1],
          id: 900,
          displayId: 'T-900',
          title: 'Archived research spike',
          state: 'Archived',
          tags: ['Archive'],
        },
      ],
    });

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: 'Go home' });
    expect(
      screen.queryByRole('button', { name: /archived research spike/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Filter tasks' }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Archived 1' }),
    );

    expect(
      await screen.findByRole('button', { name: /archived research spike/i }),
    ).toBeInTheDocument();
  });

  it('stores selected task in router search state', async () => {
    const { router } = renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /resolve auth token scope/i }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 131,
      });
    });
  });

  it('focuses a child project in the parent workspace instead of navigating into it', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(childProjectSnapshot());
    const { router } = renderApp('/?projectId=1&todoId=128');

    fireEvent.click(await screen.findByRole('button', { name: /focus project child platform/i }));

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        focusedProjectId: 2,
        projectId: 1,
      });
      expect(router.state.location.search).not.toHaveProperty('todoId');
    });
    const focusedProject = await screen.findByRole('region', {
      name: 'Focused project Child Platform',
    });
    expect(within(focusedProject).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Project Notes',
      'Project Settings',
    ]);
    expect(within(focusedProject).getAllByText('Child notes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /wire up mcp server/i })).toBeInTheDocument();
  });

  it('creates root tasks for the focused child project from the right pane', async () => {
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(childProjectSnapshot());
    const createTodo = vi.spyOn(tauriCommands, 'createTodo').mockResolvedValue({
      ...childProjectSnapshot(),
      selectedProjectId: 2,
      selectedTodoId: 901,
    });
    const { router } = renderApp('/?projectId=1&focusedProjectId=2');

    const focusedProject = await screen.findByRole('region', {
      name: 'Focused project Child Platform',
    });
    fireEvent.click(within(focusedProject).getByRole('button', { name: 'New root task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText('Task title'), {
      target: { value: 'Child root task two' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(createTodo).toHaveBeenCalledWith({
        descriptionMarkdown: undefined,
        parentId: null,
        position: 1,
        projectId: 2,
        title: 'Child root task two',
      });
    });
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        focusedProjectId: 2,
        projectId: 1,
        todoId: 901,
      });
    });
  });

  it('moves through task history from the header navigation buttons', async () => {
    const { router } = renderApp('/?projectId=1&todoId=128');
    const homeButton = await screen.findByRole('button', { name: 'Go home' });
    const goBack = await screen.findByRole('button', { name: 'Go back' });
    const goForward = screen.getByRole('button', { name: 'Go forward' });
    const switchWindows = screen.getByRole('button', {
      name: 'Switch windows',
    });

    expect(
      homeButton.compareDocumentPosition(goBack) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      goForward.compareDocumentPosition(switchWindows) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(goBack).toBeDisabled();
    expect(goForward).toBeDisabled();

    fireEvent.click(
      await screen.findByRole('button', { name: /resolve auth token scope/i }),
    );
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 131,
      });
    });
    expect(goBack).not.toBeDisabled();
    expect(goForward).toBeDisabled();

    fireEvent.click(goBack);
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 128,
      });
    });
    expect(goBack).toBeDisabled();
    expect(goForward).not.toBeDisabled();

    fireEvent.click(goForward);
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 131,
      });
    });
    expect(goBack).not.toBeDisabled();
    expect(goForward).toBeDisabled();
  });

  it('restores the task description editor scroll position when returning to a task', async () => {
    renderApp('/?projectId=1&todoId=128');

    const detailPane = await screen.findByRole('region', {
      name: 'Task detail T-128',
    });
    fireEvent.click(
      within(detailPane).getAllByRole('button', { name: 'Raw' })[0],
    );
    const descriptionEditor = await within(detailPane).findByLabelText(
      'Description Markdown',
    );
    descriptionEditor.scrollTop = 176;
    fireEvent.scroll(descriptionEditor);

    fireEvent.click(
      await screen.findByRole('button', { name: /resolve auth token scope/i }),
    );
    await screen.findByRole('region', { name: 'Task detail T-131' });
    fireEvent.click(
      await screen.findByRole('button', { name: /wire up mcp server/i }),
    );

    const restoredDetailPane = await screen.findByRole('region', {
      name: 'Task detail T-128',
    });
    fireEvent.click(
      within(restoredDetailPane).getAllByRole('button', { name: 'Raw' })[0],
    );
    expect(
      within(restoredDetailPane).getByLabelText('Description Markdown')
        .scrollTop,
    ).toBe(176);
  });

  it('keeps markdown toolbar state local to each mounted editor', async () => {
    renderApp('/?projectId=1&todoId=128');

    const detailPane = await screen.findByRole('region', {
      name: 'Task detail T-128',
    });

    expect(
      within(detailPane).queryByRole('link', { name: 'Goal' }),
    ).not.toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('link', { name: 'Handoff artifacts' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(detailPane).getAllByRole('button', {
        name: 'Toggle table of contents',
      })[0],
    );

    expect(
      within(detailPane).getByRole('link', { name: 'Goal' }),
    ).toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('link', { name: 'Handoff artifacts' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(detailPane).getAllByRole('button', {
        name: 'Toggle table of contents',
      })[0],
    );

    expect(
      within(detailPane).queryByRole('link', { name: 'Goal' }),
    ).not.toBeInTheDocument();
    expect(
      within(detailPane).queryByRole('link', { name: 'Handoff artifacts' }),
    ).not.toBeInTheDocument();
  });

  it('clears task route state from the mobile detail back button', async () => {
    const { router } = renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to task list' }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
      });
      expect(router.state.location.search).not.toHaveProperty('todoId');
    });
  });

  it('switches from the main route to a detached terminal route', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      },
    });
    vi.spyOn(ptyBridge, 'attachPty').mockResolvedValue({
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    });
    const { router } = renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByRole('button', { name: 'Go home' }),
    ).toBeInTheDocument();

    await act(async () => {
      await router.navigate({
        to: '/',
        search: () => ({
          projectId: 1,
          ptyId: 42,
          terminalTitle: 'Claude terminal',
          todoId: 128,
        }),
      });
    });

    expect(
      await screen.findByRole('heading', { name: 'Claude terminal' }),
    ).toBeInTheDocument();
  });

  it('renders an image viewer window from image route params', async () => {
    renderApp(
      '/?imageWindow=1&imageSrc=asset%3A%2F%2Flocalhost%2FUsers%2Fmark%2Fimage.png',
    );

    const viewer = await screen.findByRole('main', { name: 'Image viewer' });

    expect(viewer).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Opened image' })).toHaveAttribute(
      'src',
      'asset://localhost/Users/mark/image.png',
    );
    expect(
      screen.queryByRole('button', { name: 'Go home' }),
    ).not.toBeInTheDocument();
  });

  it('creates a new task from the top-bar task button', async () => {
    const { router } = renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: 'Go home' });
    fireEvent.click(getTopBarNewTaskButton());
    fireEvent.change(await screen.findByLabelText('Task title'), {
      target: { value: 'Review DNS setup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(
      await screen.findByRole('heading', { name: 'Review DNS setup' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('T-134').length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 1,
        todoId: 134,
      });
    });
  });

  it('keeps cancelled new task drafts locally until a task is created', async () => {
    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: 'Go home' });
    fireEvent.click(getTopBarNewTaskButton());
    let dialog = await screen.findByRole('dialog', { name: /new task/i });
    fireEvent.change(within(dialog).getByLabelText('Task title'), {
      target: { value: 'Draft DNS notes' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raw' }));
    fireEvent.change(
      await within(dialog).findByLabelText('Task description Markdown'),
      {
        target: { value: 'Remember this unsaved body.' },
      },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(getTopBarNewTaskButton());
    dialog = await screen.findByRole('dialog', { name: /new task/i });
    expect(within(dialog).getByLabelText('Task title')).toHaveValue(
      'Draft DNS notes',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raw' }));
    expect(
      within(dialog).getByLabelText('Task description Markdown'),
    ).toHaveValue('Remember this unsaved body.');

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create Task' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Draft DNS notes' }),
    ).toBeInTheDocument();

    fireEvent.click(getTopBarNewTaskButton());
    dialog = await screen.findByRole('dialog', { name: /new task/i });
    expect(within(dialog).getByLabelText('Task title')).toHaveValue('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raw' }));
    expect(
      within(dialog).getByLabelText('Task description Markdown'),
    ).toHaveValue('');
  });

  it('opens the new task dialog from row create actions with placement and Markdown description', async () => {
    const createTodo = vi
      .spyOn(tauriCommands, 'createTodo')
      .mockRejectedValue(new Error('preview fallback'));

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    fireEvent.contextMenu(
      await within(taskList).findByRole('button', {
        name: /resolve auth token scope/i,
      }),
    );
    fireEvent.click(await within(taskList).findByText('New task above'));

    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    expect(
      within(dialog).queryByLabelText('New task title'),
    ).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Task title'), {
      target: { value: 'Prep review notes' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raw' }));
    fireEvent.change(
      await within(dialog).findByLabelText('Task description Markdown'),
      {
        target: { value: '# Review\n\n- [ ] Check modal create' },
      },
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create Task' }),
    );

    await waitFor(() => {
      expect(createTodo).toHaveBeenCalledWith({
        projectId: 1,
        title: 'Prep review notes',
        descriptionMarkdown: '# Review\n\n- [ ] Check modal create',
        parentId: null,
        position: 5,
      });
    });
  });

  it('creates a prefilled project action task from the Actions menu', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /new action task/i }),
    );
    expect(
      await screen.findByDisplayValue('Create project action'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(
      await screen.findByRole('heading', { name: 'Create project action' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('T-134').length).toBeGreaterThanOrEqual(1);
  });

  it('copies the create action prompt from the Actions menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: /copy create action prompt/i,
      }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          'Create or update a Boomerang project action for tmatrix.',
        ),
      );
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        'Action files live under `.boomerang/actions` relative to:',
      ),
    );
    expect(
      await screen.findByText('Create Action Prompt copied'),
    ).toBeInTheDocument();
  });

  it('opens the project actions library grid from the Actions menu', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    fireEvent.click(await screen.findByText('Browse'));

    const dialog = await screen.findByRole('dialog', {
      name: /project actions/i,
    });
    expect(within(dialog).getByText('native · 0 args')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Open this project folder.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'New action' }),
    ).toBeInTheDocument();
  });

  it('opens and deletes script actions from the Actions menu controls', async () => {
    vi.spyOn(tauriCommands, 'listProjectActions').mockResolvedValue([
      {
        arguments: [],
        description: 'Run reinstall flow.',
        fileName: 'reinstall.sh',
        icon: 'RefreshCw',
        iconConfigured: true,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/reinstall.sh',
        runtime: 'shell',
        title: 'Reinstall App',
        validationError: null,
      },
    ]);
    const openProjectAction = vi
      .spyOn(tauriCommands, 'openProjectAction')
      .mockResolvedValue({
        exists: true,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/reinstall.sh',
      });
    const deleteProjectAction = vi
      .spyOn(tauriCommands, 'deleteProjectAction')
      .mockResolvedValue([
        {
          arguments: [],
          description: 'Open this project folder.',
          fileName: 'boomerang:open-folder',
          icon: 'Folder',
          iconConfigured: false,
          path: null,
          runtime: 'native',
          title: 'Open Folder',
          validationError: null,
        },
      ]);

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    const menu = await screen.findByRole('menu', { name: 'Project actions' });
    expect(within(menu).getByText('1 action')).toBeInTheDocument();

    fireEvent.click(
      within(menu).getByRole('button', { name: 'Edit Reinstall App' }),
    );
    await waitFor(() => {
      expect(openProjectAction).toHaveBeenCalledWith({
        projectId: 1,
        fileName: 'reinstall.sh',
      });
    });

    fireEvent.click(
      within(menu).getByRole('button', { name: 'Delete Reinstall App' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: /delete action/i,
    });
    expect(within(dialog).getByText('Reinstall App')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        '/Users/markcl/p/tmatrix/.boomerang/actions/reinstall.sh',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete action' }),
    );

    await waitFor(() => {
      expect(deleteProjectAction).toHaveBeenCalledWith({
        projectId: 1,
        fileName: 'reinstall.sh',
      });
    });
    expect(
      screen.queryByRole('dialog', { name: /delete action/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps copy create action prompt as the first compact Actions menu item', async () => {
    vi.spyOn(tauriCommands, 'listProjectActions').mockResolvedValue([
      {
        arguments: [],
        description: 'Restore the saved previous app backup.',
        fileName: 'install-previous.sh',
        icon: 'RotateCcw',
        iconConfigured: true,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/install-previous.sh',
        runtime: 'shell',
        title: 'Install Previous App',
        validationError: null,
      },
    ]);

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    const menu = await screen.findByRole('menu', { name: 'Project actions' });
    const menuItems = within(menu).getAllByRole('menuitem');

    expect(menuItems[0]).toHaveAccessibleName('Copy create action prompt');
    expect(menuItems[0]).toHaveClass('actions-menu-prompt-row');
    expect(
      within(menu).getByLabelText('Install Previous App icon'),
    ).toBeInTheDocument();
  });

  it('focuses Actions search and runs the first filtered action on Enter', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(tauriCommands, 'listProjectActions').mockResolvedValue([
      {
        arguments: [],
        description: 'Publish the app.',
        fileName: 'deploy.sh',
        icon: null,
        iconConfigured: false,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/deploy.sh',
        runtime: 'shell',
        title: 'Deploy App',
        validationError: null,
      },
      {
        arguments: [],
        description: 'Run reinstall flow.',
        fileName: 'reinstall.sh',
        icon: null,
        iconConfigured: false,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/reinstall.sh',
        runtime: 'shell',
        title: 'Reinstall App',
        validationError: null,
      },
    ]);
    const runProjectAction = vi
      .spyOn(tauriCommands, 'runProjectAction')
      .mockResolvedValue({
        actionFileName: 'reinstall.sh',
        actionTitle: 'Reinstall App',
        command: 'bash reinstall.sh',
        endedAt: null,
        exitCode: null,
        id: 7,
        projectId: 1,
        ptyId: 42,
        runtime: 'shell',
        startedAt: '2026-06-20T10:00:00Z',
        state: 'running',
        todoId: null,
        workingDirectory: '~/p/tmatrix',
      });

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    const search = await screen.findByLabelText('Search actions');
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: 're' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() => {
      expect(runProjectAction).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'reinstall.sh',
          projectId: 1,
        }),
      );
    });
  });

  it('opens action run output in a detached terminal window', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(tauriCommands, 'listProjectActions').mockResolvedValue([
      {
        arguments: [],
        description: 'Run reinstall flow.',
        fileName: 'reinstall.sh',
        icon: 'RefreshCw',
        iconConfigured: true,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/reinstall.sh',
        runtime: 'shell',
        title: 'Reinstall App',
        validationError: null,
      },
    ]);
    const runProjectAction = vi
      .spyOn(tauriCommands, 'runProjectAction')
      .mockResolvedValue({
        actionFileName: 'reinstall.sh',
        actionTitle: 'Reinstall App',
        command: 'bash reinstall.sh',
        endedAt: null,
        exitCode: null,
        id: 7,
        projectId: 1,
        ptyId: 42,
        runtime: 'shell',
        startedAt: '2026-06-20T10:00:00Z',
        state: 'running',
        todoId: null,
        workingDirectory: '~/p/tmatrix',
      });

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /reinstall app/i }),
    );

    await waitFor(() => {
      expect(runProjectAction).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'reinstall.sh',
          projectId: 1,
        }),
      );
      expect(runProjectAction.mock.calls[0]?.[0]).not.toHaveProperty('todoId');
      expect(open).toHaveBeenCalledWith(
        expect.stringContaining('ptyId=42'),
        '_blank',
        'noopener,noreferrer',
      );
    });
    expect(
      screen.queryByRole('dialog', { name: /reinstall app/i }),
    ).not.toBeInTheDocument();
  });

  it('creates a task worktree from the tree quick-create button', async () => {
    const createdSnapshot: AppSnapshot = {
      ...seedSnapshot,
      selectedTodoId: 777,
      todos: [
        ...seedSnapshot.todos,
        {
          ...seedSnapshot.todos[0],
          activeWorkingDirectory: '~/p/tmatrix',
          displayId: 'T-777',
          id: 777,
          title: 'New worktree task',
          worktreeName: null,
          worktreePath: null,
        },
      ],
    };
    const createTodo = vi
      .spyOn(tauriCommands, 'createTodo')
      .mockResolvedValue(createdSnapshot);
    const suggestTodoWorktreeName = vi
      .spyOn(tauriCommands, 'suggestTodoWorktreeName')
      .mockResolvedValue({ name: 'T-777' });
    const enableTodoWorktree = vi
      .spyOn(tauriCommands, 'enableTodoWorktree')
      .mockResolvedValue({
        ...createdSnapshot,
        todos: createdSnapshot.todos.map((todo) =>
          todo.id === 777
            ? {
                ...todo,
                activeWorkingDirectory: '~/p/T-777',
                worktreeName: 'T-777',
                worktreePath: '~/p/T-777',
              }
            : todo,
        ),
      });

    renderApp('/?projectId=1');

    fireEvent.click(
      await screen.findByRole('button', { name: 'New Worktree Task' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText('Task title'), {
      target: { value: 'New worktree task' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create Task' }),
    );

    await waitFor(() => expect(createTodo).toHaveBeenCalled());
    await waitFor(() =>
      expect(suggestTodoWorktreeName).toHaveBeenCalledWith({ todoId: 777 }),
    );
    expect(enableTodoWorktree).toHaveBeenCalledWith({
      todoId: 777,
      worktreeName: 'T-777',
    });
  });

  it('opens the worktree task dialog from Cmd/Ctrl+3', async () => {
    renderApp('/?projectId=1');
    await screen.findByRole('button', { name: 'Go home' });

    fireEvent.keyDown(document, { key: '3', code: 'Digit3', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(
      within(dialog).getByRole('button', { name: 'Create Task' }),
    ).toBeInTheDocument();
  });

  it('runs top-bar project actions in the selected worktree task context', async () => {
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              activeWorkingDirectory: '~/p/T-128',
              worktreeName: 'T-128',
              worktreePath: '~/p/T-128',
            }
          : todo,
      ),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(tauriCommands, 'listProjectActions').mockResolvedValue([
      {
        arguments: [],
        description: 'Start the dev server.',
        fileName: 'dev-server.sh',
        icon: null,
        iconConfigured: false,
        path: '/Users/markcl/p/tmatrix/.boomerang/actions/dev-server.sh',
        runtime: 'shell',
        title: 'Dev Server',
        validationError: null,
      },
    ]);
    const runProjectAction = vi
      .spyOn(tauriCommands, 'runProjectAction')
      .mockResolvedValue({
        actionFileName: 'dev-server.sh',
        actionTitle: 'Dev Server',
        command: 'bash dev-server.sh',
        endedAt: null,
        exitCode: null,
        id: 8,
        projectId: 1,
        ptyId: 52,
        runtime: 'shell',
        startedAt: '2026-06-20T10:00:00Z',
        state: 'running',
        todoId: 128,
        workingDirectory: '~/p/T-128',
      });

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /run dev server/i }),
    );

    await waitFor(() => {
      expect(runProjectAction).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'dev-server.sh',
          projectId: 1,
          todoId: 128,
        }),
      );
    });
  });

  it('loads top-bar project actions from the selected task context project', async () => {
    const contextProject = {
      ...seedSnapshot.projects[0],
      activeTodoCount: 0,
      displayIdPrefix: 'CTX',
      id: 2,
      name: 'Context Lab',
      projectFolderOpenApp: 'zed',
      workingDirectory: '~/p/context-lab',
    };
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      projects: [...seedSnapshot.projects, contextProject],
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              contextProjectId: 2,
              effectiveContextProjectId: 2,
            }
          : todo,
      ),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(tauriCommands, 'listProjectActions').mockImplementation(async ({ projectId }) =>
      projectId === 2
        ? [
            {
              arguments: [],
              description: 'Run in the context folder.',
              fileName: 'context-action.sh',
              icon: null,
              iconConfigured: false,
              path: '/Users/markcl/p/context-lab/.boomerang/actions/context-action.sh',
              runtime: 'shell',
              title: 'Context Action',
              validationError: null,
            },
          ]
        : [
            {
              arguments: [],
              description: 'Run in the original project folder.',
              fileName: 'original-action.sh',
              icon: null,
              iconConfigured: false,
              path: '/Users/markcl/p/tmatrix/.boomerang/actions/original-action.sh',
              runtime: 'shell',
              title: 'Original Action',
              validationError: null,
            },
          ],
    );
    const runProjectAction = vi
      .spyOn(tauriCommands, 'runProjectAction')
      .mockResolvedValue({
        actionFileName: 'context-action.sh',
        actionTitle: 'Context Action',
        command: 'bash context-action.sh',
        endedAt: null,
        exitCode: null,
        id: 18,
        projectId: 2,
        ptyId: 62,
        runtime: 'shell',
        startedAt: '2026-06-20T10:00:00Z',
        state: 'running',
        todoId: 128,
        workingDirectory: '~/p/context-lab',
      });

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: /project actions/i }),
    );
    expect(
      await screen.findByRole('menuitem', { name: /run context action/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /run original action/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /run context action/i }));

    await waitFor(() => {
      expect(runProjectAction).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'context-action.sh',
          projectId: 2,
        }),
      );
    });
  });

  it('opens the top-bar folder button through the selected worktree task context', async () => {
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              activeWorkingDirectory: '~/p/T-128',
              worktreeName: 'T-128',
              worktreePath: '~/p/T-128',
            }
          : todo,
      ),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(tauriCommands, 'listProjectActions').mockResolvedValue([
      {
        arguments: [],
        description: 'Open this project folder.',
        fileName: 'boomerang:open-folder',
        icon: 'Folder',
        iconConfigured: false,
        path: null,
        runtime: 'native',
        title: 'Open Folder',
        validationError: null,
      },
    ]);
    const openProjectFolder = vi
      .spyOn(tauriCommands, 'openProjectFolder')
      .mockResolvedValue({
        exists: true,
        path: '~/p/tmatrix',
      });
    const runProjectAction = vi
      .spyOn(tauriCommands, 'runProjectAction')
      .mockResolvedValue({
        actionFileName: 'boomerang:open-folder',
        actionTitle: 'Open Folder',
        command: null,
        endedAt: '2026-06-20T10:00:00Z',
        exitCode: 0,
        id: 9,
        projectId: 1,
        ptyId: null,
        runtime: 'native',
        startedAt: '2026-06-20T10:00:00Z',
        state: 'succeeded',
        todoId: 128,
        workingDirectory: '~/p/T-128',
      });

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: 'Open Diff' });
    const openProjectFolderButton = await screen.findByRole('button', {
      name: 'Open project folder',
    });
    vi.useFakeTimers();
    fireEvent.click(openProjectFolderButton);

    expect(screen.getByText('Opening with cursor...')).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });
    expect(runProjectAction).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'boomerang:open-folder',
        projectId: 1,
        todoId: 128,
      }),
    );
    expect(openProjectFolder).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(
      screen.queryByText('Opening with cursor...'),
    ).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('copies the agent prompt from the Execution toolbar', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderApp('/?projectId=1&todoId=128');

    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy Agent Prompt' }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('T-128'));
    });
    expect(await screen.findByText('Agent Prompt copied')).toBeInTheDocument();
  });

  it('saves artifact Markdown from the permanent Artifacts execution tab', async () => {
    const updateTodoArtifact = vi
      .spyOn(tauriCommands, 'updateTodoArtifact')
      .mockImplementation(async (input) => ({
        ...seedSnapshot,
        todos: seedSnapshot.todos.map((todo) =>
          todo.id === input.todoId
            ? { ...todo, artifactMarkdown: input.artifactMarkdown }
            : todo,
        ),
      }));

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(await screen.findByRole('tab', { name: 'Artifacts' }));
    const artifactsPanel = await screen.findByRole('tabpanel', {
      name: 'Artifacts',
    });
    fireEvent.click(
      within(artifactsPanel).getByRole('button', { name: 'Raw' }),
    );
    fireEvent.change(
      await within(artifactsPanel).findByLabelText('Artifacts Markdown'),
      {
        target: { value: '# Handoff\n\n```mermaid\ngraph TD\n  A-->B\n```' },
      },
    );

    await waitFor(
      () => {
        expect(updateTodoArtifact).toHaveBeenCalledWith({
          actorName: 'Mark',
          artifactMarkdown: '# Handoff\n\n```mermaid\ngraph TD\n  A-->B\n```',
          todoId: 128,
        });
      },
      { timeout: 3_000 },
    );
  });

  it('keeps a pending journal save after leaving the task before the command resolves', async () => {
    let resolveJournalSave: (snapshot: AppSnapshot) => void = () => undefined;
    const journalSave = new Promise<AppSnapshot>((resolve) => {
      resolveJournalSave = resolve;
    });
    const updateTodoJournal = vi
      .spyOn(tauriCommands, 'updateTodoJournal')
      .mockImplementation(() => journalSave);
    const savedJournal = '# Private work log\n\nSave me in the background.';

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(await screen.findByRole('tab', { name: 'Journal' }));
    const journalPanel = await screen.findByRole('tabpanel', { name: 'Journal' });
    fireEvent.click(within(journalPanel).getByRole('button', { name: 'Raw' }));
    fireEvent.change(await within(journalPanel).findByLabelText('Journal Markdown'), {
      target: { value: savedJournal },
    });

    await waitFor(
      () => {
        expect(updateTodoJournal).toHaveBeenCalledWith({
          actorName: 'Mark',
          journalMarkdown: savedJournal,
          todoId: 128,
        });
      },
      { timeout: 3_000 },
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /resolve auth token scope/i }),
    );
    await screen.findByRole('region', { name: 'Task detail T-131' });

    await act(async () => {
      resolveJournalSave({
        ...seedSnapshot,
        selectedTodoId: 131,
        todos: seedSnapshot.todos.map((todo) =>
          todo.id === 128 ? { ...todo, journalMarkdown: savedJournal } : todo,
        ),
      });
      await journalSave;
    });

    fireEvent.click(
      await screen.findByRole('button', { name: /wire up mcp server/i }),
    );
    await screen.findByRole('region', { name: 'Task detail T-128' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Journal' }));
    const restoredJournalPanel = await screen.findByRole('tabpanel', { name: 'Journal' });
    fireEvent.click(within(restoredJournalPanel).getByRole('button', { name: 'Raw' }));

    expect(await screen.findByLabelText('Journal Markdown')).toHaveValue(savedJournal);
  });

  it('flushes a pending description save to the original task when navigating immediately', async () => {
    const savedDescription = '# Prompt context\n\nSave task A before navigation.';
    const updateTodoDescription = vi
      .spyOn(tauriCommands, 'updateTodoDescription')
      .mockImplementation(async ({ descriptionMarkdown, todoId }) => ({
        ...seedSnapshot,
        selectedTodoId: 131,
        todos: seedSnapshot.todos.map((todo) =>
          todo.id === todoId ? { ...todo, descriptionMarkdown } : todo,
        ),
      }));

    renderApp('/?projectId=1&todoId=128');

    const descriptionPanel = await screen.findByRole('tabpanel', {
      name: 'Description',
    });
    fireEvent.click(within(descriptionPanel).getByRole('button', { name: 'Raw' }));
    fireEvent.change(
      await within(descriptionPanel).findByLabelText('Description Markdown'),
      {
        target: { value: savedDescription },
      },
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /resolve auth token scope/i }),
    );

    await waitFor(() => {
      expect(updateTodoDescription).toHaveBeenCalledWith({
        actorName: 'Mark',
        descriptionMarkdown: savedDescription,
        todoId: 128,
      });
    });
    expect(updateTodoDescription).not.toHaveBeenCalledWith({
      actorName: 'Mark',
      descriptionMarkdown: savedDescription,
      todoId: 131,
    });
  });

  it('persists Execution prompt context toggles per project', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const snapshot = {
      ...seedSnapshot,
      selectedTodoId: 129,
      projects: seedSnapshot.projects.map((project) => ({
        ...project,
        aiDefaultIncludeProjectNotes: false,
        aiTaskDescriptionMode: 'task' as const,
        notesMarkdown: 'Project note for CLI context.',
      })),
      todos: seedSnapshot.todos.map((todo) => {
        if (todo.id === 128) {
          return {
            ...todo,
            descriptionMarkdown: 'Parent description for CLI context.',
            parentId: null,
          };
        }
        if (todo.id === 129) {
          return {
            ...todo,
            descriptionMarkdown: 'Child task description for CLI context.',
            parentId: 128,
          };
        }

        return { ...todo, parentId: null };
      }),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(tauriCommands, 'updateProjectPromptSettings').mockImplementation(
      async (input) => ({
        ...snapshot,
        projects: snapshot.projects.map((project) =>
          project.id === input.projectId
            ? {
                ...project,
                aiDefaultIncludeProjectNotes:
                  input.aiDefaultIncludeProjectNotes,
                aiTaskDescriptionMode: input.aiTaskDescriptionMode,
              }
            : project,
        ),
      }),
    );

    renderApp('/?projectId=1&todoId=129');

    expect(
      await screen.findByLabelText('Include task description'),
    ).toBeChecked();
    fireEvent.click(screen.getByLabelText('Include parent task descriptions'));

    await waitFor(() => {
      expect(tauriCommands.updateProjectPromptSettings).toHaveBeenCalledWith({
        aiDefaultIncludeProjectNotes: false,
        aiTaskDescriptionMode: 'ancestry',
        projectId: 1,
      });
    });

    fireEvent.click(screen.getByLabelText('Include project notes'));
    await waitFor(() => {
      expect(tauriCommands.updateProjectPromptSettings).toHaveBeenCalledWith({
        aiDefaultIncludeProjectNotes: true,
        aiTaskDescriptionMode: 'ancestry',
        projectId: 1,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Agent Prompt' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Parent description for CLI context.'),
      );
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Project note for CLI context.'),
      );
    });
  });

  it('copies the selected todo display ID from the detail header', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy todo ID T-128' }),
    );

    expect(writeText).toHaveBeenCalledWith('T-128');
  });

  it('bulk deletes selected tasks from the task list context menu after in-app confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const deleteTodos = vi
      .spyOn(tauriCommands, 'deleteTodos')
      .mockResolvedValue({
        ...seedSnapshot,
        selectedTodoId: 129,
        todos: seedSnapshot.todos.filter(
          (todo) => todo.id !== 128 && todo.id !== 132,
        ),
      });

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    fireEvent.click(
      within(taskList).getByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
      {
        metaKey: true,
      },
    );
    fireEvent.contextMenu(
      within(taskList).getByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete 2 tasks' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Delete tasks' });
    expect(
      within(dialog).getByText(/T-128 Wire up MCP server/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/T-132 Wire settings on\/off toggle/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete 2 Tasks' }),
    );

    await waitFor(() => {
      expect(deleteTodos).toHaveBeenCalledWith({ todoIds: [128, 132] });
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('confirms the delete tasks dialog when Enter is pressed inside the modal', async () => {
    const deleteTodos = vi
      .spyOn(tauriCommands, 'deleteTodos')
      .mockResolvedValue({
        ...seedSnapshot,
        selectedTodoId: 129,
        todos: seedSnapshot.todos.filter(
          (todo) => todo.id !== 128 && todo.id !== 132,
        ),
      });

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    fireEvent.click(
      within(taskList).getByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
      {
        metaKey: true,
      },
    );
    fireEvent.contextMenu(
      within(taskList).getByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete 2 tasks' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Delete tasks' });
    fireEvent.keyDown(dialog, { key: 'Enter' });

    await waitFor(() => {
      expect(deleteTodos).toHaveBeenCalledWith({ todoIds: [128, 132] });
    });
  });

  it('removes deleted tasks from the task list before the backend delete resolves', async () => {
    const deleteTodos = vi
      .spyOn(tauriCommands, 'deleteTodos')
      .mockReturnValue(new Promise(() => {}));

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    fireEvent.contextMenu(
      within(taskList).getByRole('button', { name: /wire up mcp server/i }),
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete task' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Delete task' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete Task' }),
    );

    // The delete command never resolves, yet the row is already gone.
    await waitFor(() => {
      expect(
        within(taskList).queryByRole('button', { name: /wire up mcp server/i }),
      ).not.toBeInTheDocument();
    });
    expect(deleteTodos).toHaveBeenCalledWith({ todoIds: [128] });
  });

  it('bulk updates selected task states from the task list context menu', async () => {
    const updateTodosState = vi
      .spyOn(tauriCommands, 'updateTodosState')
      .mockResolvedValue({
        ...seedSnapshot,
        todos: seedSnapshot.todos.map((todo) =>
          todo.id === 128 || todo.id === 132
            ? { ...todo, state: 'Doing' }
            : todo,
        ),
      });

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    fireEvent.click(
      within(taskList).getByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
      {
        metaKey: true,
      },
    );
    fireEvent.contextMenu(
      within(taskList).getByRole('button', {
        name: /wire settings on\/off toggle/i,
      }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Doing' }));

    await waitFor(() => {
      expect(updateTodosState).toHaveBeenCalledWith({
        actorName: 'Mark',
        state: 'Doing',
        todoIds: [128, 132],
      });
    });
  });

  it('updates task priority from the task list context menu', async () => {
    const updateTodoPriority = vi
      .spyOn(tauriCommands, 'updateTodoPriority')
      .mockResolvedValue({
        ...seedSnapshot,
        todos: seedSnapshot.todos.map((todo) =>
          todo.id === 128 ? { ...todo, priority: 'Urgent' } : todo,
        ),
      });

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    fireEvent.contextMenu(
      within(taskList).getByRole('button', { name: /wire up mcp server/i }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: '🔴 Urgent' }));

    await waitFor(() => {
      expect(updateTodoPriority).toHaveBeenCalledWith({
        actorName: 'Mark',
        priority: 'Urgent',
        todoId: 128,
      });
    });
  });

  it('warns before starting a provider execution tab when dependencies are unfinished', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const startExecutionTerminal = vi.spyOn(
      tauriCommands,
      'startExecutionTerminal',
    );

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(await screen.findByRole('button', { name: 'Codex' }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('T-104 Set up auth middleware'),
    );
    expect(startExecutionTerminal).not.toHaveBeenCalled();
  });

  it('copies pending human replies into the agent prompt from the Execution tab', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      messages: [
        ...seedSnapshot.messages,
        {
          actorName: 'Mark',
          actorType: 'human',
          body: 'Please retry with the stable token fixture.',
          createdLabel: 'just now',
          delivery: 'Pending for next session',
          id: 'm-pending',
          todoId: 128,
        },
      ],
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              title: 'Wire up MCP server with pending reply',
            }
          : todo,
      ),
    });

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('heading', {
      name: 'Wire up MCP server with pending reply',
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy Agent Prompt' }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Please retry with the stable token fixture.'),
      );
    });
  });

  it('starts normal and provider execution terminals from the Execution tab', async () => {
    mockTerminalEnvironment();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const startExecutionTerminal = vi
      .spyOn(tauriCommands, 'startExecutionTerminal')
      .mockImplementation(async (input) => ({
        exitCode: null,
        kind: input.kind,
        label:
          input.kind === 'terminal'
            ? 'Terminal'
            : input.kind === 'codex'
              ? 'Codex CLI'
              : 'Claude Code CLI',
        ptyId: input.kind === 'terminal' ? 41 : 42,
        state: 'running',
        todoId: input.todoId,
      }));

    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByRole('button', { name: 'New Terminal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New Terminal' }));
    await waitFor(() => {
      expect(startExecutionTerminal).toHaveBeenCalledWith({
        kind: 'terminal',
        todoId: 128,
      });
    });
    expect(
      await screen.findByRole('tab', { name: 'Terminal' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    await waitFor(() => {
      expect(startExecutionTerminal).toHaveBeenCalledWith({
        kind: 'codex',
        prompt: expect.stringContaining('Wire up MCP server'),
        todoId: 128,
      });
    });
    expect(
      await screen.findByRole('tab', { name: 'Codex CLI' }),
    ).toBeInTheDocument();
  });

  it('starts an OMP execution terminal with the selected task prompt', async () => {
    mockTerminalEnvironment();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const startExecutionTerminal = vi
      .spyOn(tauriCommands, 'startExecutionTerminal')
      .mockImplementation(async (input) => ({
        exitCode: null,
        kind: input.kind,
        label: 'OMP',
        ptyId: 88,
        state: 'running',
        todoId: input.todoId,
      }));

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(await screen.findByRole('button', { name: 'OMP' }));

    await waitFor(() => {
      expect(startExecutionTerminal).toHaveBeenCalledWith({
        kind: 'omp',
        prompt: expect.stringContaining('Wire up MCP server'),
        todoId: 128,
      });
    });
    expect(await screen.findByRole('tab', { name: 'OMP' })).toBeInTheDocument();
  });

  it('resumes the saved OMP session without generating a fresh prompt', async () => {
    mockTerminalEnvironment();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              ompSessionId: '019efe10-60fc-7000-9f8e-6545a91a41ce',
            }
          : todo,
      ),
    });
    const startExecutionTerminal = vi
      .spyOn(tauriCommands, 'startExecutionTerminal')
      .mockImplementation(async (input) => ({
        exitCode: null,
        kind: input.kind,
        label: 'OMP',
        ptyId: 89,
        state: 'running',
        todoId: input.todoId,
      }));

    renderApp('/?projectId=1&todoId=128');

    const resumeButtons = await screen.findAllByRole('button', {
      name: 'Resume OMP',
    });
    expect(resumeButtons).toHaveLength(1);
    fireEvent.click(resumeButtons[0]);

    await waitFor(() => {
      expect(startExecutionTerminal).toHaveBeenCalledWith({
        kind: 'omp',
        resumeSessionId: '019efe10-60fc-7000-9f8e-6545a91a41ce',
        todoId: 128,
      });
    });
    expect(startExecutionTerminal.mock.calls[0][0]).not.toHaveProperty(
      'prompt',
    );
  });

  it('does not show resume actions for stopped provider sessions in the Execution tab', async () => {
    mockTerminalEnvironment();
    const session = {
      command: 'codex --cd ~/p/tmatrix',
      conversationId: 'boomerang-session',
      elapsedLabel: '4m',
      id: 'session-codex',
      lastActivity: 'session exited with code 0',
      pendingReplyCount: 0,
      provider: 'Codex' as const,
      providerSessionId: 'codex-native-session',
      ptyId: null,
      state: 'exited' as const,
      todoId: 128,
      workingDirectory: '~/p/tmatrix',
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      sessions: [session],
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              title: 'Wire up stopped Codex session',
            }
          : todo,
      ),
    });
    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('heading', {
      name: 'Wire up stopped Codex session',
    });
    expect(
      screen.queryByRole('button', { name: 'Resume Codex' }),
    ).not.toBeInTheDocument();
  });

  it('keeps task execution terminals when switching away and back to a task', async () => {
    mockTerminalEnvironment();
    const startExecutionTerminal = vi
      .spyOn(tauriCommands, 'startExecutionTerminal')
      .mockResolvedValue({
        exitCode: null,
        kind: 'terminal',
        label: 'Terminal',
        ptyId: 41,
        state: 'running',
        todoId: 128,
      });
    const { router } = renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'New Terminal' }),
    );
    // The pending tab that appears on click is replaced by the started
    // terminal's tab, so re-query until the swap settles.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument();
    });
    expect(startExecutionTerminal).toHaveBeenCalledWith({
      kind: 'terminal',
      todoId: 128,
    });

    await act(async () => {
      await router.navigate({
        to: '/',
        search: () => ({ projectId: 1, todoId: 129 }),
      });
    });
    expect(
      screen.queryByRole('tab', { name: 'Terminal' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      await router.navigate({
        to: '/',
        search: () => ({ projectId: 1, todoId: 128 }),
      });
    });
    expect(
      await screen.findByRole('tab', { name: 'Terminal' }),
    ).toBeInTheDocument();
  });

  it('warns and closes task terminal tabs before setting a task to done', async () => {
    mockTerminalEnvironment();
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      executionTerminals: [
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 41,
          state: 'running',
          todoId: 128,
        },
        {
          exitCode: null,
          kind: 'codex',
          label: 'Codex CLI',
          ptyId: 42,
          state: 'running',
          todoId: 128,
        },
      ],
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    const closeExecutionTerminal = vi
      .spyOn(tauriCommands, 'closeExecutionTerminal')
      .mockResolvedValue(undefined);
    const updateTodoState = vi
      .spyOn(tauriCommands, 'updateTodoState')
      .mockResolvedValue({
        ...snapshot,
        executionTerminals: [],
        todos: snapshot.todos.map((todo) =>
          todo.id === 128 ? { ...todo, state: 'Done' } : todo,
        ),
      } as AppSnapshot);

    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByRole('tab', { name: 'Terminal' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('tab', { name: 'Codex CLI' }),
    ).toBeInTheDocument();
    await acceptTaskAsDone();
    const warning = await screen.findByRole('dialog', {
      name: /close terminal tabs/i,
    });
    expect(within(warning).getByText(/2 terminal tabs/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.getByRole('dialog', { name: /close terminal tabs/i }),
    ).toBeInTheDocument();
    fireEvent.click(warning.parentElement as HTMLElement);
    expect(
      screen.getByRole('dialog', { name: /close terminal tabs/i }),
    ).toBeInTheDocument();

    fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }));
    expect(updateTodoState).not.toHaveBeenCalled();
    expect(closeExecutionTerminal).not.toHaveBeenCalled();

    await acceptTaskAsDone();
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: /close terminal tabs/i }),
      ).getByRole('button', { name: 'Continue' }),
    );

    await waitFor(() => {
      expect(closeExecutionTerminal).toHaveBeenCalledWith({ ptyId: 41 });
      expect(closeExecutionTerminal).toHaveBeenCalledWith({ ptyId: 42 });
      expect(updateTodoState).toHaveBeenCalledWith({
        conversationId: 'local-review',
        message: 'Accepted as done.',
        state: 'Done',
        todoId: 128,
      });
    });
  });

  it('warns that a dirty worktree will be deleted before setting a task to done', async () => {
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              activeWorkingDirectory: '~/p/T-128',
              worktreeName: 'T-128',
              worktreePath: '~/p/T-128',
            }
          : todo,
      ),
    };
    const doneSnapshot: AppSnapshot = {
      ...snapshot,
      todos: snapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              activeWorkingDirectory: '~/p/tmatrix',
              state: 'Done',
              worktreeName: null,
              worktreePath: null,
            }
          : todo,
      ),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(tauriCommands, 'getTodoWorktreeStatus').mockResolvedValue({
      dirty: true,
      todoId: 128,
    });
    const deleteTodoWorktree = vi
      .spyOn(tauriCommands, 'deleteTodoWorktree')
      .mockResolvedValue(doneSnapshot);
    const updateTodoState = vi
      .spyOn(tauriCommands, 'updateTodoState')
      .mockResolvedValue(doneSnapshot);

    renderApp('/?projectId=1&todoId=128');

    await screen.findByRole('button', { name: 'Open Diff' });
    await acceptTaskAsDone();
    const warning = await screen.findByRole('dialog', {
      name: /finish worktree task/i,
    });
    expect(
      await within(warning).findByText(
        'This worktree is dirty. Continuing will delete its uncommitted files.',
      ),
    ).toBeInTheDocument();
    expect(warning).toHaveTextContent(/delete the task worktree/i);
    fireEvent.click(within(warning).getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(deleteTodoWorktree).toHaveBeenCalledWith({ todoId: 128 });
      expect(updateTodoState).toHaveBeenCalledWith({
        conversationId: 'local-review',
        message: 'Accepted as done.',
        state: 'Done',
        todoId: 128,
      });
    });
  });

  it('does not warn before setting an already merged worktree task to done', async () => {
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      todos: seedSnapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              activeWorkingDirectory: '~/p/T-128',
              worktreeMergedAt: '2026-06-26T02:23:36Z',
              worktreeName: 'T-128',
              worktreePath: '~/p/T-128',
            }
          : todo,
      ),
    };
    const doneSnapshot: AppSnapshot = {
      ...snapshot,
      todos: snapshot.todos.map((todo) =>
        todo.id === 128
          ? {
              ...todo,
              state: 'Done',
            }
          : todo,
      ),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    const getTodoWorktreeStatus = vi.spyOn(
      tauriCommands,
      'getTodoWorktreeStatus',
    );
    const deleteTodoWorktree = vi.spyOn(tauriCommands, 'deleteTodoWorktree');
    const updateTodoState = vi
      .spyOn(tauriCommands, 'updateTodoState')
      .mockResolvedValue(doneSnapshot);

    renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText('Merged worktree');
    await acceptTaskAsDone();

    await waitFor(() => {
      expect(updateTodoState).toHaveBeenCalledWith({
        conversationId: 'local-review',
        message: 'Accepted as done.',
        state: 'Done',
        todoId: 128,
      });
    });
    expect(
      screen.queryByRole('dialog', { name: /finish worktree task/i }),
    ).not.toBeInTheDocument();
    expect(getTodoWorktreeStatus).not.toHaveBeenCalled();
    expect(deleteTodoWorktree).not.toHaveBeenCalled();
  });

  it('does not complete a task-list checkbox before the Done terminal warning is continued', async () => {
    mockTerminalEnvironment();
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      executionTerminals: [
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 41,
          state: 'running',
          todoId: 128,
        },
        {
          exitCode: null,
          kind: 'codex',
          label: 'Codex CLI',
          ptyId: 42,
          state: 'running',
          todoId: 128,
        },
      ],
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    const closeExecutionTerminal = vi
      .spyOn(tauriCommands, 'closeExecutionTerminal')
      .mockResolvedValue(undefined);
    const updateTodoState = vi
      .spyOn(tauriCommands, 'updateTodoState')
      .mockResolvedValue({
        ...snapshot,
        executionTerminals: [],
        todos: snapshot.todos.map((todo) =>
          todo.id === 128 ? { ...todo, state: 'Done' } : todo,
        ),
      } as AppSnapshot);

    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByRole('tab', { name: 'Terminal' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('tab', { name: 'Codex CLI' }),
    ).toBeInTheDocument();
    const doneButton = await screen.findByRole('button', {
      name: 'Mark T-128 done',
    });
    fireEvent.click(doneButton);

    const warning = await screen.findByRole('dialog', {
      name: /close terminal tabs/i,
    });
    expect(doneButton.closest('.task-row')).not.toHaveClass('completing');
    expect(updateTodoState).not.toHaveBeenCalled();
    expect(closeExecutionTerminal).not.toHaveBeenCalled();

    fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }));
    // Task rows are keyed by todo id, so cancelling the optimistic Done
    // remounts the row: re-query instead of reusing the detached node.
    const restoredDoneButton = await screen.findByRole('button', {
      name: 'Mark T-128 done',
    });
    expect(restoredDoneButton.closest('.task-row')).not.toHaveClass('completing');
    expect(updateTodoState).not.toHaveBeenCalled();

    fireEvent.click(restoredDoneButton);
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: /close terminal tabs/i }),
      ).getByRole('button', { name: 'Continue' }),
    );

    await waitFor(() => {
      expect(closeExecutionTerminal).toHaveBeenCalledWith({ ptyId: 41 });
      expect(closeExecutionTerminal).toHaveBeenCalledWith({ ptyId: 42 });
      expect(updateTodoState).toHaveBeenCalledWith({
        actorName: 'Mark',
        state: 'Done',
        todoId: 128,
      });
    });
  });

  it('lets the first single-tab Done warning be dismissed', async () => {
    mockTerminalEnvironment();
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      executionTerminals: [
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 41,
          state: 'running',
          todoId: 128,
        },
      ],
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    vi.spyOn(tauriCommands, 'closeExecutionTerminal').mockResolvedValue(undefined);
    vi.spyOn(tauriCommands, 'updateTodoState').mockResolvedValue({
      ...snapshot,
      executionTerminals: [],
      todos: snapshot.todos.map((todo) =>
        todo.id === 128 ? { ...todo, state: 'Done' } : todo,
      ),
    } as AppSnapshot);

    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByRole('tab', { name: 'Terminal' }),
    ).toBeInTheDocument();
    await acceptTaskAsDone();
    const warning = await screen.findByRole('dialog', {
      name: /close terminal tabs/i,
    });
    expect(warning.querySelector('.delete-tasks-list')).toBeInTheDocument();
    expect(appStyles).toMatch(/\.delete-tasks-list\s*{[^}]*margin: 16px 0;/);
    const neverShowAgain = within(warning).getByLabelText(
      'Never show this single-terminal warning again',
    );
    expect(neverShowAgain.closest('label')).toHaveClass('form-check');
    expect(neverShowAgain.closest('.form-field')).toBeNull();
    fireEvent.click(neverShowAgain);
    fireEvent.click(within(warning).getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(
        window.localStorage.getItem('boomerang.doneTerminalWarningDismissed'),
      ).toBe('true');
    });
  });

  it('lets App Settings re-enable the single-terminal Done warning', async () => {
    window.localStorage.setItem(
      'boomerang.doneTerminalWarningDismissed',
      'true',
    );

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open app settings' }),
    );
    const settingsDialog = await screen.findByRole('dialog', {
      name: /app settings/i,
    });
    const warningToggle = within(settingsDialog).getByLabelText(
      'Show single-terminal Done warning',
    );
    expect(warningToggle).not.toBeChecked();

    fireEvent.click(warningToggle);

    expect(
      window.localStorage.getItem('boomerang.doneTerminalWarningDismissed'),
    ).toBeNull();
  });

  it('hydrates existing task execution terminals in a focused task window', async () => {
    mockTerminalEnvironment();
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue({
      ...seedSnapshot,
      executionTerminals: [
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 41,
          state: 'running',
          todoId: 128,
        },
      ],
    } as AppSnapshot);

    renderApp('/?projectId=1&todoId=128&taskWindow=1');

    expect(
      await screen.findByRole('tab', { name: 'Terminal' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'Task list' }),
    ).not.toBeInTheDocument();
  });

  it('updates task priority from the metadata rail', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.change(await screen.findByLabelText('Selected task title'), {
      target: { value: 'Document MCP handoff' },
    });
    fireEvent.blur(screen.getByLabelText('Selected task title'));
    expect(
      await screen.findByDisplayValue('Document MCP handoff'),
    ).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('Priority'), {
      target: { value: 'Urgent' },
    });

    expect(await screen.findByDisplayValue('🔴 Urgent')).toBeInTheDocument();
  });

  it('does not apply preview fallback mutations for failed Tauri commands', async () => {
    Object.defineProperty(globalThis, 'isTauri', {
      configurable: true,
      value: true,
    });
    vi.spyOn(tauriCommands, 'updateTodoPriority').mockRejectedValue(
      new Error('database unavailable'),
    );

    renderApp('/?projectId=1&todoId=128');

    fireEvent.change(await screen.findByLabelText('Priority'), {
      target: { value: 'Urgent' },
    });

    await waitFor(() => {
      expect(tauriCommands.updateTodoPriority).toHaveBeenCalledWith({
        actorName: 'Mark',
        priority: 'Urgent',
        todoId: 128,
      });
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue('🟠 High')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('🔴 Urgent')).not.toBeInTheDocument();
  });

  it('edits dependencies, subtasks, and manual time logs while the journey log stays hidden', async () => {
    renderApp('/?projectId=1&todoId=128');

    const dependencySelect = await screen.findByLabelText('Add dependency');
    expect(screen.queryByText('Journey')).not.toBeInTheDocument();
    fireEvent.change(dependencySelect, {
      target: { value: '131' },
    });
    expect(await screen.findByText('T-131')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));
    const subtaskDialog = await screen.findByRole('dialog', {
      name: /new subtask/i,
    });
    fireEvent.change(within(subtaskDialog).getByLabelText('Task title'), {
      target: { value: 'Document MCP config' },
    });
    fireEvent.click(
      within(subtaskDialog).getByRole('button', { name: 'Create Subtask' }),
    );
    await waitFor(() => {
      expect(
        screen.getAllByText('Document MCP config').length,
      ).toBeGreaterThanOrEqual(1);
    });

    fireEvent.change(screen.getByLabelText('Manual time minutes'), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add manual time' }));
    expect(await screen.findByDisplayValue('25')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('25'), {
      target: { value: '30' },
    });
    const saveLogButton = screen
      .getAllByRole('button', { name: /save time log/i })
      .find((button) => !button.hasAttribute('disabled'));
    expect(saveLogButton).toBeDefined();
    fireEvent.click(saveLogButton!);
    expect(
      (await screen.findAllByText('00:30:00')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('dependency_added')).not.toBeInTheDocument();
  });

  it('sets the task parent from the details rail with a single parent select', async () => {
    const reorderTodo = vi
      .spyOn(tauriCommands, 'reorderTodo')
      .mockResolvedValue(seedSnapshot);

    renderApp('/?projectId=1&todoId=131');

    const parentSelect = await screen.findByLabelText('Set parent');
    fireEvent.change(parentSelect, {
      target: { value: '128' },
    });

    await waitFor(() => {
      expect(reorderTodo).toHaveBeenCalledWith({
        todoId: 131,
        newParentId: 128,
        newIndex: 3,
      });
    });
  });

  it('keeps the task list visible without a toolbar hide button', async () => {
    renderApp('/?projectId=1&todoId=128');

    expect(
      await screen.findByRole('complementary', { name: 'Task list' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Hide task list' }),
    ).not.toBeInTheDocument();
  });

  it('persists the task list width after dragging the resize handle', async () => {
    const setTaskListWidth = vi
      .spyOn(tauriCommands, 'setTaskListWidth')
      .mockResolvedValue({
        ...tauriCommands.fallbackAppSettings,
        taskListWidth: 360,
      });
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      taskListWidth: 330,
    });

    renderApp('/?projectId=1&todoId=128');

    const taskList = await screen.findByRole('complementary', {
      name: 'Task list',
    });
    expect(taskList).toHaveStyle({ width: '330px' });

    const resizeHandle = within(taskList).getByRole('separator', {
      name: 'Resize task list',
    });
    fireEvent.pointerDown(resizeHandle, { clientX: 330, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 360, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 360, pointerId: 1 });

    await waitFor(() => {
      expect(setTaskListWidth).toHaveBeenCalledWith({ width: 360 });
    });
    expect(taskList).toHaveStyle({ width: '360px' });
  });

  it('persists the description and terminal split after dragging the resize handle', async () => {
    const setTaskDetailDescriptionWidth = vi
      .spyOn(tauriCommands, 'setTaskDetailDescriptionWidth')
      .mockResolvedValue({
        ...tauriCommands.fallbackAppSettings,
        taskDetailDescriptionWidth: 500,
      });
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      taskDetailDescriptionWidth: 360,
    });

    renderApp('/?projectId=1&todoId=128');

    const resizeHandle = await screen.findByRole('separator', {
      name: 'Resize description and terminal split',
    });
    const workspace = document.querySelector(
      '.detail-workspace',
    ) as HTMLElement;
    await waitFor(() => {
      expect(
        workspace.style.getPropertyValue('--description-panel-width'),
      ).toBe('360px');
    });

    fireEvent.pointerDown(resizeHandle, { clientX: 360, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 500, pointerId: 1 });

    await waitFor(() => {
      expect(setTaskDetailDescriptionWidth).toHaveBeenCalledWith({
        width: 500,
      });
    });
    expect(workspace.style.getPropertyValue('--description-panel-width')).toBe(
      '500px',
    );
  });

  it('opens task-only windows without the left task list panel', async () => {
    renderApp('/?projectId=1&todoId=128&taskWindow=1');

    expect(
      await screen.findByRole('heading', { name: 'Wire up MCP server' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'Task list' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show task list' }),
    ).not.toBeInTheDocument();
  });

  it('marks unread messages read when the task is opened', async () => {
    Reflect.set(globalThis, 'isTauri', true);
    const readSnapshot = {
      ...seedSnapshot,
      messages: seedSnapshot.messages.map((message) =>
        message.todoId === 128 ? { ...message, unread: false } : message,
      ),
    };
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(seedSnapshot);
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue(
      tauriCommands.fallbackAppSettings,
    );
    const markTodoMessagesRead = vi
      .spyOn(tauriCommands, 'markTodoMessagesRead')
      .mockResolvedValue(readSnapshot);

    renderApp('/?projectId=1&todoId=128');

    await waitFor(() => {
      expect(markTodoMessagesRead).toHaveBeenCalledWith({ todoId: 128 });
    });
    await waitFor(() => {
      expect(screen.queryByText('Unread')).not.toBeInTheDocument();
    });
  });

  it('opens and saves project notes without leaving the selected task', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open project notes' }),
    );
    const notesOverlay = await screen.findByRole('dialog', {
      name: /project notes/i,
    });
    expect(
      within(notesOverlay).getAllByText('tmatrix notes').length,
    ).toBeGreaterThanOrEqual(1);

    fireEvent.click(within(notesOverlay).getByRole('button', { name: 'Raw' }));
    const notesTextarea = await within(notesOverlay).findByLabelText(
      'Project Notes Markdown',
    );
    vi.useFakeTimers();
    fireEvent.change(notesTextarea, {
      target: { value: '# Project notes\n\nKeep token stable.' },
    });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 200);
    });
    vi.useRealTimers();

    fireEvent.click(
      within(notesOverlay).getByRole('button', {
        name: /close project notes/i,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open project notes' }));
    const reopenedNotes = await screen.findByRole('dialog', {
      name: /project notes/i,
    });
    fireEvent.click(within(reopenedNotes).getByRole('button', { name: 'Raw' }));

    expect(
      await within(reopenedNotes).findByLabelText('Project Notes Markdown'),
    ).toHaveValue('# Project notes\n\nKeep token stable.');
    expect(
      screen.getByRole('heading', { name: 'Wire up MCP server' }),
    ).toBeInTheDocument();
  });

  it('uses the saved description TOC width for project notes and persists resize changes', async () => {
    const setMarkdownTocWidth = vi
      .spyOn(tauriCommands, 'setMarkdownTocWidth')
      .mockResolvedValue({
        ...tauriCommands.fallbackAppSettings,
        markdownDescriptionTocWidth: 240,
      });
    vi.spyOn(tauriCommands, 'loadAppSettings').mockResolvedValue({
      ...tauriCommands.fallbackAppSettings,
      markdownDescriptionTocWidth: 224,
    });

    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open project notes' }),
    );
    const notesOverlay = await screen.findByRole('dialog', {
      name: /project notes/i,
    });
    fireEvent.click(
      within(notesOverlay).getByRole('button', {
        name: 'Toggle table of contents',
      }),
    );
    expect(notesOverlay.querySelector('.editor-body')).toHaveStyle({
      gridTemplateColumns: '224px 8px minmax(0, 1fr)',
    });

    fireEvent.keyDown(
      within(notesOverlay).getByRole('separator', {
        name: 'Resize table of contents',
      }),
      { key: 'ArrowRight' },
    );

    await waitFor(() => {
      expect(setMarkdownTocWidth).toHaveBeenCalledWith({
        target: 'description',
        width: 240,
      });
    });
  });

  it('opens project notes and settings from icon-only header controls', async () => {
    const { router } = renderApp('/?projectId=1&todoId=128');
    await screen.findByRole('button', { name: 'Go home' });
    const header = document.querySelector('.top-bar');
    expect(header).not.toBeNull();

    expect(
      within(header as HTMLElement).queryByText('Notes'),
    ).not.toBeInTheDocument();
    expect(
      within(header as HTMLElement).queryByText('Project'),
    ).not.toBeInTheDocument();
    expect(
      within(header as HTMLElement).queryByText('App'),
    ).not.toBeInTheDocument();
    expect(
      within(header as HTMLElement).queryByText('Actions'),
    ).not.toBeInTheDocument();
    expect(
      within(header as HTMLElement).queryByText('+ New Task'),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'Project actions' })
        .querySelector('.lucide-zap'),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'Open project settings' })
        .querySelector('.lucide-folder-cog'),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'Open app settings' })
        .querySelector('.lucide-settings'),
    ).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open project notes' }),
    );
    const notesOverlay = await screen.findByRole('dialog', {
      name: /project notes/i,
    });
    expect(
      within(notesOverlay).getAllByText('tmatrix notes').length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(
      within(notesOverlay).getByRole('button', {
        name: /close project notes/i,
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open project settings' }),
    );
    expect(
      await screen.findByRole('dialog', { name: /project settings/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open app settings' }));
    expect(
      await screen.findByRole('dialog', { name: /app settings/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await act(async () => {
      await router.navigate({
        to: '/',
        search: () => ({ projectId: 0, todoId: undefined }),
      });
    });

    expect(
      await screen.findByLabelText(/select project: all projects/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open project notes' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Open project settings' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Open app settings' }),
    ).toBeEnabled();
  });

  it('opens and saves project settings from the header control', async () => {
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open project settings' }),
    );
    const settingsDialog = await screen.findByRole('dialog', {
      name: /project settings/i,
    });

    expect(
      within(settingsDialog).getByText('Resolved actions directory'),
    ).toBeInTheDocument();
    expect(
      within(settingsDialog).getByText(
        '/Users/markcl/p/tmatrix/.boomerang/actions',
      ),
    ).toBeInTheDocument();
    expect(
      within(settingsDialog).getByText(
        'The built-in Open Folder action is always available.',
      ),
    ).toBeInTheDocument();
    expect(
      within(settingsDialog).getByRole('button', {
        name: 'Create Actions Directory',
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(settingsDialog).getByRole('button', {
        name: 'Create Actions Directory',
      }),
    );
    expect(
      await within(settingsDialog).findByRole('button', {
        name: 'Open Actions Directory',
      }),
    ).toBeInTheDocument();

    fireEvent.change(within(settingsDialog).getByLabelText('Project name'), {
      target: { value: 'tmatrix app' },
    });
    fireEvent.change(
      within(settingsDialog).getByLabelText('Display ID prefix'),
      {
        target: { value: 'TM' },
      },
    );
    fireEvent.change(
      within(settingsDialog).getByLabelText('Actions directory'),
      {
        target: { value: 'actions' },
      },
    );
    fireEvent.change(
      within(settingsDialog).getByLabelText('Project folder open app'),
      {
        target: { value: 'Finder' },
      },
    );
    expect(
      within(settingsDialog).queryByLabelText(
        'Include project notes by default',
      ),
    ).not.toBeInTheDocument();
    expect(
      within(settingsDialog).queryByLabelText('Project AI provider'),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(settingsDialog).getByRole('button', { name: 'Save Settings' }),
    );

    expect(
      await screen.findByLabelText(/select project: tmatrix app/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Wire up MCP server' }),
    ).toBeInTheDocument();
  });

  it('opens and saves app settings from the header control', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderApp('/?projectId=1&todoId=128');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open app settings' }),
    );
    const settingsDialog = await screen.findByRole('dialog', {
      name: /app settings/i,
    });

    expect(
      within(settingsDialog).getByText('MCP status: Running'),
    ).toBeInTheDocument();
    expect(
      within(settingsDialog).getByText('http://127.0.0.1:8787/mcp'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open project folder' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(settingsDialog).getByRole('button', { name: 'Copy MCP token' }),
    );
    expect(writeText).toHaveBeenCalledWith('local-preview-token');

    fireEvent.click(within(settingsDialog).getByLabelText('Enable MCP server'));
    expect(
      within(settingsDialog).queryByLabelText('Claude flags'),
    ).not.toBeInTheDocument();
    expect(
      within(settingsDialog).queryByLabelText('Codex flags'),
    ).not.toBeInTheDocument();
    expect(
      within(settingsDialog).getByRole('radio', { name: 'System' }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(
      within(settingsDialog).getByRole('radio', { name: 'Dark' }),
    );
    fireEvent.click(
      within(settingsDialog).getByRole('button', { name: 'Save Settings' }),
    );

    expect(
      await screen.findByLabelText(/select project: tmatrix/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.app-shell')).toHaveAttribute(
        'data-theme',
        'dark',
      );
    });
    expect(
      screen.getByRole('heading', { name: 'Wire up MCP server' }),
    ).toBeInTheDocument();
  });

  it('opens app settings from the keyboard shortcut', async () => {
    renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText(/select project: tmatrix/i);
    fireEvent.keyDown(document, { key: ',', metaKey: true });

    expect(
      await screen.findByRole('dialog', { name: /app settings/i }),
    ).toBeInTheDocument();
  });

  it('does not close the current Tauri window from Cmd+W', async () => {
    Reflect.set(globalThis, 'isTauri', true);
    const closeCurrentAppWindow = vi
      .spyOn(tauriWindows, 'closeCurrentAppWindow')
      .mockResolvedValue(true);

    renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText(/select project: tmatrix/i);
    fireEvent.keyDown(document, { code: 'KeyW', key: 'w', metaKey: true });

    expect(closeCurrentAppWindow).not.toHaveBeenCalled();
  });

  it('cancels Backspace browser navigation outside editable text fields', async () => {
    renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText(/select project: tmatrix/i);
    const backspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace',
    });

    document.body.dispatchEvent(backspace);

    expect(backspace.defaultPrevented).toBe(true);
  });

  it('keeps Backspace editing behavior inside editable text fields', async () => {
    renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText(/select project: tmatrix/i);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const inputBackspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace',
    });
    const richEditor = document.createElement('div');
    richEditor.setAttribute('contenteditable', 'true');
    document.body.appendChild(richEditor);
    const richBackspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace',
    });

    input.dispatchEvent(inputBackspace);
    richEditor.dispatchEvent(richBackspace);
    input.remove();
    richEditor.remove();

    expect(inputBackspace.defaultPrevented).toBe(false);
    expect(richBackspace.defaultPrevented).toBe(false);
  });

  it('opens whole-app search from Cmd+P and navigates to a result outside the current project', async () => {
    const snapshot: AppSnapshot = {
      ...seedSnapshot,
      projects: [
        ...seedSnapshot.projects,
        {
          id: 2,
          name: 'life',
          client: 'Personal',
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
          dependencies: [],
          descriptionMarkdown: 'Replace the cable before travel.',
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
    vi.spyOn(tauriCommands, 'loadAppSnapshot').mockResolvedValue(snapshot);
    const { router } = renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText(/select project: tmatrix/i);
    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', metaKey: true });
    expect(
      await screen.findByRole('searchbox', { name: /find in page/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /search app/i }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'p', code: 'KeyP', metaKey: true });

    const searchDialog = await screen.findByRole('dialog', {
      name: /search app/i,
    });
    fireEvent.change(
      within(searchDialog).getByLabelText('Search the whole app'),
      {
        target: { value: 'replacement' },
      },
    );

    const result = await within(searchDialog).findByRole('button', {
      name: /LIFE-42 Buy replacement cable life To Do/i,
    });
    fireEvent.click(result);

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        projectId: 2,
        todoId: 4242,
      });
    });
    expect(
      await screen.findByRole('heading', { name: 'Buy replacement cable' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /search app/i }),
    ).not.toBeInTheDocument();
  });

  it('opens project notes from the blank whole-app search default', async () => {
    renderApp('/?projectId=1&todoId=128');

    await screen.findByLabelText(/select project: tmatrix/i);
    fireEvent.keyDown(document, { key: 'p', code: 'KeyP', metaKey: true });

    const searchDialog = await screen.findByRole('dialog', {
      name: /search app/i,
    });
    const projectNotesResult = await within(searchDialog).findByRole('button', {
      name: /Project Notes tmatrix/i,
    });
    expect(projectNotesResult).toHaveClass('active');

    fireEvent.keyDown(
      within(searchDialog).getByLabelText('Search the whole app'),
      {
        key: 'Enter',
      },
    );

    expect(
      await screen.findByRole('dialog', { name: /project notes/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /search app/i }),
    ).not.toBeInTheDocument();
  });
});

function childProjectSnapshot(): AppSnapshot {
  const parent = {
    ...seedSnapshot.projects[0],
    subprojects: [{ childProjectId: 2, kind: 'subproject' as const }],
  };
  const child = {
    ...seedSnapshot.projects[0],
    activeTodoCount: 1,
    displayIdPrefix: 'CP',
    id: 2,
    name: 'Child Platform',
    notesMarkdown: '# Child notes',
    subprojects: [],
    workingDirectory: '~/p/child-platform',
  };
  const childTodo = {
    ...seedSnapshot.todos[0],
    activeWorkingDirectory: '~/p/child-platform',
    dependencies: [],
    dependency: undefined,
    displayId: 'CP-1',
    id: 900,
    position: 0,
    projectId: 2,
    rolledUpTimeSeconds: 0,
    subtasks: [],
    timeLogs: [],
    title: 'Child root task one',
  };

  return {
    ...seedSnapshot,
    projects: [parent, child],
    todos: [...seedSnapshot.todos, childTodo],
  };
}

function getTopBarNewTaskButton() {
  const header = document.querySelector('.top-bar');
  if (!(header instanceof HTMLElement)) {
    throw new Error('top bar did not render');
  }
  return within(header).getByRole('button', { name: 'New task' });
}

// Done moved from a dedicated header button into the header state dropdown.
async function acceptTaskAsDone() {
  fireEvent.click(await screen.findByRole('button', { name: /change state/i }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Done' }));
}

function renderApp(url = '/') {
  const router = createTestRouter(url);

  // A fresh Jotai store per render isolates module-global UI atoms between
  // tests; without it, leaked atom state (open overlays, hidden lists) makes
  // unrelated tests find duplicate or missing elements.
  const store = createStore();
  // Atoms that derive their initial value from localStorage capture it at module
  // load. Re-seed them from the per-test localStorage so each test sees its own
  // fixture instead of the value present when the module first imported.
  store.set(recentRemoteServersAtom, loadRecentRemoteServers());
  store.set(doneTerminalWarningEnabledAtom, !doneTerminalWarningDismissed());
  render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </JotaiProvider>,
  );

  return { router };
}

function emitTauriEvent(eventName: string, payload: unknown = null) {
  for (const handler of tauriEventMock.handlers.get(eventName) ?? []) {
    handler({ payload });
  }
}

function mockSystemColorScheme(matches: boolean) {
  const media = '(prefers-color-scheme: dark)';
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let currentMatches = matches;
  const mediaQueryList = {
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      if (event === 'change') {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    dispatchEvent: vi.fn(),
    get matches() {
      return currentMatches;
    },
    media,
    onchange: null,
    removeEventListener: vi.fn((event: string, listener: EventListener) => {
      if (event === 'change') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      if (query !== media) {
        throw new Error(`Unexpected media query: ${query}`);
      }
      return mediaQueryList;
    }),
  });

  return {
    setMatches(nextMatches: boolean) {
      currentMatches = nextMatches;
      const event = { matches: nextMatches, media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function mockTerminalEnvironment() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: '',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
    },
  });
  vi.spyOn(ptyBridge, 'attachPty').mockResolvedValue({
    claimInput: vi.fn(),
    close: vi.fn(),
    dispose: vi.fn(),
    releaseInput: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  });
}
