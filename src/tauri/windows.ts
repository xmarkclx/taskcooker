import {
  getAllWebviewWindows,
  getCurrentWebviewWindow,
  WebviewWindow,
} from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { ProjectSummary, TodoSummary } from '../domain/domain';

type AppWindowOptions = {
  backgroundColor: '#00000000';
  center: true;
  decorations: false;
  focus: true;
  height: number;
  minHeight: number;
  minWidth: number;
  shadow: true;
  title: string;
  transparent: true;
  url: string;
  width: number;
};

export type AppWindowFactory = new (
  label: string,
  options: AppWindowOptions,
) => unknown;

export type OpenWindowResult = {
  mode: 'tauri' | 'browser';
  label: string;
  url: string;
};

export type OpenWindowDeps = {
  browserOpen?: (url: string) => void;
  labelSuffix?: string;
  windowFactory?: AppWindowFactory;
};

export type AppWindowKind = 'image' | 'other' | 'project' | 'task' | 'terminal' | 'workspace';

export type OpenAppWindowSummary = {
  isCurrent: boolean;
  kind: AppWindowKind;
  label: string;
  title: string;
};

export type AppWindowHandle = {
  label: string;
  setFocus: () => Promise<void>;
  title: () => Promise<string>;
};

export type AppWindowSwitcherDeps = {
  currentWindow?: () => AppWindowHandle | null | undefined;
  getWindowByLabel?: (label: string) => Promise<AppWindowHandle | null>;
  listWindows?: () => Promise<AppWindowHandle[]>;
};

export type CloseCurrentWindowDeps = {
  close?: () => Promise<void> | void;
};

export type TerminalWindowAttachmentTarget = {
  projectId: number;
  todoId: number;
};

const defaultWindowFactory = WebviewWindow as AppWindowFactory;
const appWindowChromeOptions = {
  backgroundColor: '#00000000',
  decorations: false,
  shadow: true,
  transparent: true,
} as const;

export async function listOpenAppWindows(
  deps: AppWindowSwitcherDeps = {},
): Promise<OpenAppWindowSummary[]> {
  if (!deps.listWindows && !hasTauriBridge()) {
    return [];
  }

  const windows = await (deps.listWindows ?? defaultListWindows)();
  const currentWindow = getCurrentSwitcherWindow(deps);
  const currentLabel = currentWindow?.label ?? null;

  return Promise.all(
    windows.map(async (window) => {
      const kind = inferWindowKind(window.label);
      return {
        isCurrent: window.label === currentLabel,
        kind,
        label: window.label,
        title: normalizeWindowTitle(window.label, kind, await readWindowTitle(window)),
      };
    }),
  );
}

export async function focusOpenAppWindow(
  label: string,
  deps: AppWindowSwitcherDeps = {},
): Promise<boolean> {
  if (!label || (!deps.getWindowByLabel && !hasTauriBridge())) {
    return false;
  }

  const window = await (deps.getWindowByLabel ?? defaultGetWindowByLabel)(label);
  if (!window) {
    return false;
  }

  await window.setFocus();
  return true;
}

export async function closeCurrentAppWindow(
  deps: CloseCurrentWindowDeps = {},
): Promise<boolean> {
  const close = deps.close ?? (hasTauriBridge() ? () => getCurrentWindow().close() : undefined);
  if (!close) {
    return false;
  }

  try {
    await close();
    return true;
  } catch {
    return false;
  }
}

export async function openWorkspaceWindow(
  deps: OpenWindowDeps = {},
): Promise<OpenWindowResult> {
  const label = buildWindowLabel('workspace', 0, deps.labelSuffix);
  const options: AppWindowOptions = {
    ...appWindowChromeOptions,
    center: true,
    focus: true,
    height: 760,
    minHeight: 640,
    minWidth: 960,
    title: 'TaskCooker',
    url: '/',
    width: 1180,
  };

  return openManagedWindow(label, options, deps);
}

export async function openProjectWindow(
  project: ProjectSummary,
  deps: OpenWindowDeps = {},
): Promise<OpenWindowResult> {
  const url = buildProjectUrl(project.id);
  const label = buildWindowLabel('project', project.id, deps.labelSuffix);
  const options: AppWindowOptions = {
    ...appWindowChromeOptions,
    center: true,
    focus: true,
    height: 760,
    minHeight: 640,
    minWidth: 960,
    title: `${project.name} - TaskCooker`,
    url,
    width: 1180,
  };

  return openManagedWindow(label, options, deps);
}

export async function openTaskWindow(
  project: ProjectSummary,
  todo: TodoSummary,
  deps: OpenWindowDeps = {},
): Promise<OpenWindowResult> {
  const url = buildTaskUrl(project.id, todo.id);
  const label = buildWindowLabel('task', todo.id, deps.labelSuffix);
  const options: AppWindowOptions = {
    ...appWindowChromeOptions,
    center: true,
    focus: true,
    height: 720,
    minHeight: 560,
    minWidth: 760,
    title: `${todo.displayId} - ${todo.title}`,
    url,
    width: 960,
  };

  return openManagedWindow(label, options, deps);
}

export async function openImageWindow(
  src: string,
  deps: OpenWindowDeps = {},
): Promise<OpenWindowResult> {
  const url = buildImageUrl(src);
  const label = buildWindowLabel('image', 0, deps.labelSuffix);
  const options: AppWindowOptions = {
    ...appWindowChromeOptions,
    center: true,
    focus: true,
    height: 720,
    minHeight: 420,
    minWidth: 640,
    title: 'Image - TaskCooker',
    url,
    width: 960,
  };

  return openManagedWindow(label, options, deps);
}

export async function openTerminalWindow(
  ptyId: number,
  title: string,
  deps?: OpenWindowDeps,
): Promise<OpenWindowResult>;
export async function openTerminalWindow(
  ptyId: number,
  title: string,
  attachmentTarget?: TerminalWindowAttachmentTarget,
  deps?: OpenWindowDeps,
): Promise<OpenWindowResult>;
export async function openTerminalWindow(
  ptyId: number,
  title: string,
  attachmentTargetOrDeps: TerminalWindowAttachmentTarget | OpenWindowDeps = {},
  maybeDeps: OpenWindowDeps = {},
): Promise<OpenWindowResult> {
  const attachmentTarget = isTerminalAttachmentTarget(attachmentTargetOrDeps)
    ? attachmentTargetOrDeps
    : undefined;
  const deps: OpenWindowDeps = attachmentTarget
    ? maybeDeps
    : (attachmentTargetOrDeps as OpenWindowDeps);
  const url = buildTerminalUrl(ptyId, title, attachmentTarget);
  const label = buildWindowLabel('terminal', ptyId, deps.labelSuffix);
  const options: AppWindowOptions = {
    ...appWindowChromeOptions,
    center: true,
    focus: true,
    height: 620,
    minHeight: 420,
    minWidth: 720,
    title,
    url,
    width: 960,
  };

  return openManagedWindow(label, options, deps);
}

function openManagedWindow(
  label: string,
  options: AppWindowOptions,
  deps: OpenWindowDeps,
): OpenWindowResult {
  const windowFactory = deps.windowFactory ?? defaultWindowFactory;

  if (deps.windowFactory || hasTauriBridge()) {
    try {
      new windowFactory(label, options);
      return { mode: 'tauri', label, url: options.url };
    } catch {
      openBrowserFallback(options.url, deps.browserOpen);
      return { mode: 'browser', label, url: options.url };
    }
  }

  openBrowserFallback(options.url, deps.browserOpen);
  return { mode: 'browser', label, url: options.url };
}

async function defaultListWindows(): Promise<AppWindowHandle[]> {
  return getAllWebviewWindows() as Promise<AppWindowHandle[]>;
}

async function defaultGetWindowByLabel(label: string): Promise<AppWindowHandle | null> {
  return WebviewWindow.getByLabel(label) as Promise<AppWindowHandle | null>;
}

function getCurrentSwitcherWindow(deps: AppWindowSwitcherDeps): AppWindowHandle | null {
  if (deps.currentWindow) {
    return deps.currentWindow() ?? null;
  }

  if (!hasTauriBridge()) {
    return null;
  }

  try {
    return getCurrentWebviewWindow() as AppWindowHandle;
  } catch {
    return null;
  }
}

async function readWindowTitle(window: AppWindowHandle): Promise<string> {
  try {
    return (await window.title()).trim();
  } catch {
    return '';
  }
}

function inferWindowKind(label: string): AppWindowKind {
  if (label === 'main' || label.startsWith('workspace-')) {
    return 'workspace';
  }
  if (label.startsWith('project-')) {
    return 'project';
  }
  if (label.startsWith('task-')) {
    return 'task';
  }
  if (label.startsWith('terminal-')) {
    return 'terminal';
  }
  if (label.startsWith('image-')) {
    return 'image';
  }

  return 'other';
}

function normalizeWindowTitle(label: string, kind: AppWindowKind, title: string): string {
  if (!title || (kind === 'workspace' && title === 'TaskCooker')) {
    return fallbackWindowTitle(label, kind);
  }

  const suffix = ' - TaskCooker';
  if (title.endsWith(suffix)) {
    return title.slice(0, -suffix.length).trim() || fallbackWindowTitle(label, kind);
  }

  return title;
}

function fallbackWindowTitle(label: string, kind: AppWindowKind): string {
  switch (kind) {
    case 'workspace':
      return 'Main Workspace';
    case 'project':
      return 'Project Window';
    case 'task':
      return 'Task Window';
    case 'terminal':
      return 'Terminal Window';
    case 'image':
      return 'Image Window';
    case 'other':
      return label;
  }
}

function buildProjectUrl(projectId: number): string {
  return `/?${new URLSearchParams({ projectId: projectId.toString() }).toString()}`;
}

function buildTaskUrl(projectId: number, todoId: number): string {
  return `/?${new URLSearchParams({
    projectId: projectId.toString(),
    todoId: todoId.toString(),
    taskWindow: '1',
  }).toString()}`;
}

function buildImageUrl(src: string): string {
  return `/?${new URLSearchParams({
    imageWindow: '1',
    imageSrc: src,
  }).toString()}`;
}

function buildTerminalUrl(
  ptyId: number,
  title: string,
  attachmentTarget?: TerminalWindowAttachmentTarget,
): string {
  const params: Record<string, string> = {
    ptyId: ptyId.toString(),
    terminalTitle: title,
  };
  if (attachmentTarget) {
    params.projectId = attachmentTarget.projectId.toString();
    params.todoId = attachmentTarget.todoId.toString();
  }

  return `/?${new URLSearchParams(params).toString()}`;
}

function buildWindowLabel(
  kind: 'image' | 'project' | 'task' | 'terminal' | 'workspace',
  id: number,
  suffix = Date.now().toString(36),
): string {
  return `${kind}-${id}-${sanitizeLabelPart(suffix)}`;
}

function sanitizeLabelPart(value: string): string {
  const safeValue = value.replace(/[^a-zA-Z0-9\-/:_]/g, '-');
  return safeValue.length > 0 ? safeValue : Date.now().toString(36);
}

function isTerminalAttachmentTarget(
  value: TerminalWindowAttachmentTarget | OpenWindowDeps,
): value is TerminalWindowAttachmentTarget {
  return (
    typeof (value as TerminalWindowAttachmentTarget).projectId === 'number' &&
    typeof (value as TerminalWindowAttachmentTarget).todoId === 'number'
  );
}

function hasTauriBridge(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function openBrowserFallback(url: string, browserOpen?: (url: string) => void): void {
  if (browserOpen) {
    browserOpen(url);
    return;
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
