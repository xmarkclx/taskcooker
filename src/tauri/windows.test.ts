import { describe, expect, it, vi } from 'vitest';

import capabilities from '../../src-tauri/capabilities/default.json';
import type { ProjectSummary } from '../domain/domain';
import {
  focusOpenAppWindow,
  closeCurrentAppWindow,
  listOpenAppWindows,
  openImageWindow,
  openProjectWindow,
  openTaskWindow,
  openTerminalWindow,
  openWorkspaceWindow,
} from './windows';

const project = {
  id: 1,
  name: 'tmatrix',
  client: '',
  workingDirectory: '~/p/tmatrix',
  displayIdPrefix: 'T',
  actionsDirectory: '.boomerang/actions',
  projectFolderOpenApp: 'cursor',
  mainBranch: 'main',
  terminalWslEnabled: false,
  backgroundImagePath: '',
  notesMarkdown: '# tmatrix notes',
  aiDefaultIncludeProjectNotes: false,
  aiTaskDescriptionMode: 'task',
  activeTodoCount: 19,
  status: 'Active' as const,
  inheritParent: false,
  subprojects: [],} satisfies ProjectSummary;

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

describe('Tauri window helpers', () => {
  it('opens a general workspace Tauri window', async () => {
    const calls: Array<{ label: string; options: Record<string, unknown> }> =
      [];
    const FakeWindow = class {
      constructor(label: string, options: Record<string, unknown>) {
        calls.push({ label, options });
      }
    };

    const result = await openWorkspaceWindow({
      labelSuffix: 'test',
      windowFactory: FakeWindow,
    });

    expect(result).toEqual({
      mode: 'tauri',
      label: 'workspace-0-test',
      url: '/',
    });
    expect(calls[0]).toMatchObject({
      label: 'workspace-0-test',
      options: expect.objectContaining({
        title: 'TaskCooker',
        url: '/',
        width: 1180,
        height: 760,
      }),
    });
  });

  it('opens a project-scoped Tauri window', async () => {
    const calls: Array<{ label: string; options: Record<string, unknown> }> =
      [];
    const FakeWindow = class {
      constructor(label: string, options: Record<string, unknown>) {
        calls.push({ label, options });
      }
    };

    const result = await openProjectWindow(project, {
      labelSuffix: 'test',
      windowFactory: FakeWindow,
    });

    expect(result).toEqual({
      mode: 'tauri',
      label: 'project-1-test',
      url: '/?projectId=1',
    });
    expect(calls).toEqual([
      {
        label: 'project-1-test',
        options: expect.objectContaining({
          center: true,
          backgroundColor: '#00000000',
          decorations: false,
          focus: true,
          minHeight: 640,
          minWidth: 960,
          shadow: true,
          title: 'tmatrix - TaskCooker',
          transparent: true,
          url: '/?projectId=1',
        }),
      },
    ]);
  });

  it('opens a task-focused Tauri window', async () => {
    const calls: Array<{ label: string; options: Record<string, unknown> }> =
      [];
    const FakeWindow = class {
      constructor(label: string, options: Record<string, unknown>) {
        calls.push({ label, options });
      }
    };

    const result = await openTaskWindow(
      project,
      {
        artifactMarkdown: '',
        artifactMarkdownPath: '',
        activeWorkingDirectory: '~/p/tmatrix',
        id: 128,
        projectId: 1,
        displayId: 'T-128',
        title: 'Wire up MCP server',
        descriptionMarkdown: '',
        state: 'Ready to Test',
        priority: 'High',
        deadline: null,
        createdAt: '2026-06-20T09:40:00Z',
        updatedAt: '2026-06-20T09:40:00Z',
        tags: [],
        ownTimeSeconds: 0,
        position: 0,
        rolledUpTimeSeconds: 0,
        stale: false,
        dependencies: [],
        events: [],
        subtasks: [],
        timeLogs: [],
      },
      { labelSuffix: 'test', windowFactory: FakeWindow },
    );

    expect(result).toEqual({
      mode: 'tauri',
      label: 'task-128-test',
      url: '/?projectId=1&todoId=128&taskWindow=1',
    });
    expect(calls[0]).toMatchObject({
      label: 'task-128-test',
      options: {
        title: 'T-128 - Wire up MCP server',
        backgroundColor: '#00000000',
        decorations: false,
        shadow: true,
        transparent: true,
        url: '/?projectId=1&todoId=128&taskWindow=1',
        width: 960,
        height: 720,
        minWidth: 760,
        minHeight: 560,
      },
    });
  });

  it('falls back to a browser tab when the Tauri window bridge is unavailable', async () => {
    const opener = vi.fn();
    const ThrowingWindow = class {
      constructor() {
        throw new Error('bridge unavailable');
      }
    };

    const result = await openProjectWindow(project, {
      browserOpen: opener,
      labelSuffix: 'test',
      windowFactory: ThrowingWindow,
    });

    expect(result).toEqual({
      mode: 'browser',
      label: 'project-1-test',
      url: '/?projectId=1',
    });
    expect(opener).toHaveBeenCalledWith('/?projectId=1');
  });

  it('opens a terminal-only window attached to an existing pty', async () => {
    const calls: Array<{ label: string; options: Record<string, unknown> }> =
      [];
    const FakeWindow = class {
      constructor(label: string, options: Record<string, unknown>) {
        calls.push({ label, options });
      }
    };

    const result = await openTerminalWindow(42, 'Claude · session-1', {
      labelSuffix: 'test',
      windowFactory: FakeWindow,
    });

    expect(result).toEqual({
      mode: 'tauri',
      label: 'terminal-42-test',
      url: '/?ptyId=42&terminalTitle=Claude+%C2%B7+session-1',
    });
    expect(calls[0]).toMatchObject({
      label: 'terminal-42-test',
      options: {
        title: 'Claude · session-1',
        backgroundColor: '#00000000',
        decorations: false,
        shadow: true,
        transparent: true,
        url: '/?ptyId=42&terminalTitle=Claude+%C2%B7+session-1',
        width: 960,
        height: 620,
      },
    });
  });

  it('carries task attachment context into detached terminal URLs', async () => {
    const calls: Array<{ label: string; options: Record<string, unknown> }> =
      [];
    const FakeWindow = class {
      constructor(label: string, options: Record<string, unknown>) {
        calls.push({ label, options });
      }
    };

    const result = await openTerminalWindow(
      42,
      'Claude · session-1',
      { projectId: 1, todoId: 128 },
      { labelSuffix: 'test', windowFactory: FakeWindow },
    );

    expect(result).toEqual({
      mode: 'tauri',
      label: 'terminal-42-test',
      url: '/?ptyId=42&terminalTitle=Claude+%C2%B7+session-1&projectId=1&todoId=128',
    });
    expect(calls[0]?.options).toMatchObject({
      url: '/?ptyId=42&terminalTitle=Claude+%C2%B7+session-1&projectId=1&todoId=128',
    });
  });

  it('opens an image popup window for a rendered editor image', async () => {
    const calls: Array<{ label: string; options: Record<string, unknown> }> =
      [];
    const FakeWindow = class {
      constructor(label: string, options: Record<string, unknown>) {
        calls.push({ label, options });
      }
    };

    const result = await openImageWindow(
      'asset://localhost/Users/mark/image with spaces.png',
      {
        labelSuffix: 'test',
        windowFactory: FakeWindow,
      },
    );

    expect(result).toEqual({
      mode: 'tauri',
      label: 'image-0-test',
      url: '/?imageWindow=1&imageSrc=asset%3A%2F%2Flocalhost%2FUsers%2Fmark%2Fimage+with+spaces.png',
    });
    expect(calls[0]).toMatchObject({
      label: 'image-0-test',
      options: expect.objectContaining({
        title: 'Image - TaskCooker',
        url: '/?imageWindow=1&imageSrc=asset%3A%2F%2Flocalhost%2FUsers%2Fmark%2Fimage+with+spaces.png',
        width: 960,
        height: 720,
      }),
    });
  });

  it('grants window-control permissions to detached image windows', async () => {
    // Regression for B-102: image windows could not drag or close because their
    // label was not covered by the Tauri capability allowlist, so
    // core:window:allow-close / allow-start-dragging were denied.
    const result = await openImageWindow(
      'asset://localhost/Users/mark/screenshot.png',
      {
        labelSuffix: 'test',
        windowFactory: class {
          constructor() {}
        },
      },
    );

    const matchesAllowlist = capabilities.windows.some((pattern) =>
      globToRegExp(pattern).test(result.label),
    );

    expect(matchesAllowlist).toBe(true);
  });

  it('lists existing app windows with switcher labels and current-window state', async () => {
    const windows = [
      {
        label: 'main',
        setFocus: vi.fn(),
        title: vi.fn().mockResolvedValue('TaskCooker'),
      },
      {
        label: 'project-1-test',
        setFocus: vi.fn(),
        title: vi.fn().mockResolvedValue('tmatrix - TaskCooker'),
      },
      {
        label: 'task-128-test',
        setFocus: vi.fn(),
        title: vi.fn().mockResolvedValue('T-128 - Wire up MCP server'),
      },
      {
        label: 'terminal-42-test',
        setFocus: vi.fn(),
        title: vi.fn().mockResolvedValue('Claude · session-1'),
      },
    ];

    await expect(
      listOpenAppWindows({
        currentWindow: () => windows[1],
        listWindows: async () => windows,
      }),
    ).resolves.toEqual([
      {
        isCurrent: false,
        kind: 'workspace',
        label: 'main',
        title: 'Main Workspace',
      },
      {
        isCurrent: true,
        kind: 'project',
        label: 'project-1-test',
        title: 'tmatrix',
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
  });

  it('focuses an already open app window by label', async () => {
    const focus = vi.fn().mockResolvedValue(undefined);

    await expect(
      focusOpenAppWindow('project-1-test', {
        getWindowByLabel: async (label) =>
          label === 'project-1-test'
            ? {
                label,
                setFocus: focus,
                title: vi.fn().mockResolvedValue('tmatrix - TaskCooker'),
              }
            : null,
      }),
    ).resolves.toBe(true);

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('reports that a missing window could not be focused', async () => {
    await expect(
      focusOpenAppWindow('missing-window', {
        getWindowByLabel: async () => null,
      }),
    ).resolves.toBe(false);
  });

  it('closes the current app window through the Tauri window API', async () => {
    const close = vi.fn().mockResolvedValue(undefined);

    await expect(closeCurrentAppWindow({ close })).resolves.toBe(true);

    expect(close).toHaveBeenCalledTimes(1);
  });
});
