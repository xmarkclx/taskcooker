import {
  AppWindow,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Command,
  ExternalLink,
  FileText,
  FolderCog,
  FolderPlus,
  FolderOpen,
  Home,
  Image,
  type LucideIcon,
  Moon,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  SquareTerminal,
  Sun,
  TreePine,
  Trash2,
  Zap,
} from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';

import type {
  AppSnapshot,
  AppThemePreference,
  ProjectActionSummary,
  ProjectSummary,
  ResolvedAppTheme,
  TodoState,
} from '../../domain/domain';
import { formatDuration } from '../../domain/domain';
import { projectAccentStyle } from '../../app/appShellHelpers';
import {
  focusOpenAppWindow,
  listOpenAppWindows,
  type AppWindowKind,
  type OpenAppWindowSummary,
} from '../../tauri/windows';
import { AppButton } from '../../ui/Button';
import { WindowControls } from '../../ui/WindowControls';
import { ProjectActionIcon } from '../projects/ProjectActionIcon';
import { ProjectSelectorMenu } from '../projects/ProjectSelectorMenu';
import { childProjectIds } from '../projects/projectChildren';
import { terminalWindowFocusRestoreNonceAtom } from '../terminal/terminalFocusState';
import { todoStateToneClass } from '../tasks/taskBadges';
import { useLiveElapsedSeconds } from '../time/liveTime';

type TopBarTimerSummary = NonNullable<AppSnapshot['runningTimer']> & {
  state: TodoState;
};

export function TopBar({
  canGoBack,
  canGoForward,
  canCreateTask,
  project,
  projectActions,
  projects,
  selectedProjectId,
  onNewActionTask,
  onCopyActionPrompt,
  onDeleteAction,
  onEditAction,
  onGoBack,
  onGoForward,
  onGoHome,
  onNewProject,
  onNewTask,
  onNewWorktreeTask,
  onOpenAppSettings,
  onOpenGlobalSearch,
  onOpenProjectFolder,
  onOpenProjectActions,
  onOpenProjectNotes,
  onOpenProjectSettings,
  onOpenProjectWindow,
  onProjectSelect,
  onRefreshActions,
  onRunAction,
  onStartRunningTimer,
  onStopRunningTimer,
  onTimerTaskSelect,
  lastStoppedTimer,
  onThemeToggle,
  resolvedTheme,
  runningTimer,
  themePreference,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  canCreateTask: boolean;
  project?: ProjectSummary;
  projectActions: ProjectActionSummary[];
  projects: ProjectSummary[];
  selectedProjectId: number;
  onNewActionTask: () => void;
  onCopyActionPrompt: () => void;
  onDeleteAction: (action: ProjectActionSummary) => void;
  onEditAction: (action: ProjectActionSummary) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoHome: () => void;
  onNewProject: () => void;
  onNewTask: () => void;
  onNewWorktreeTask: () => void;
  onOpenAppSettings: () => void;
  onOpenGlobalSearch: () => void;
  onOpenProjectFolder: () => void;
  onOpenProjectActions: () => void;
  onOpenProjectNotes: () => void;
  onOpenProjectSettings: () => void;
  onOpenProjectWindow: (project: ProjectSummary) => void;
  onProjectSelect: (projectId: number) => void;
  onRefreshActions: () => void;
  onRunAction: (action: ProjectActionSummary) => void;
  onStartRunningTimer: (todoId: number) => void;
  onStopRunningTimer: () => void;
  onThemeToggle: () => void;
  onTimerTaskSelect: (todoId: number, projectId: number) => void;
  lastStoppedTimer: TopBarTimerSummary | null;
  resolvedTheme: ResolvedAppTheme;
  runningTimer: TopBarTimerSummary | null;
  themePreference: AppThemePreference;
}) {
  const requestTerminalWindowFocusRestore = useSetAtom(
    terminalWindowFocusRestoreNonceAtom,
  );
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [openWindows, setOpenWindows] = useState<OpenAppWindowSummary[]>([]);
  const [windowMenuStatus, setWindowMenuStatus] = useState<'error' | 'idle' | 'loading'>('idle');
  const [projectSearch, setProjectSearch] = useState('');
  const [actionSearch, setActionSearch] = useState('');
  const [actionsMenuOffsetX, setActionsMenuOffsetX] = useState(0);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsMenuPanelRef = useRef<HTMLDivElement>(null);
  const windowMenuRef = useRef<HTMLDivElement>(null);
  const visibleTimer = runningTimer
    ? { ...runningTimer, running: true }
    : lastStoppedTimer
      ? { ...lastStoppedTimer, running: false }
      : null;
  const visibleTimerElapsedSeconds = useLiveElapsedSeconds(
    visibleTimer?.elapsedSeconds ?? 0,
    runningTimer?.todoId ?? null,
  );
  const filteredActions = projectActions.filter((action) =>
    `${action.title} ${action.fileName} ${action.description}`
      .toLowerCase()
      .includes(actionSearch.trim().toLowerCase()),
  );
  const isAllProjects = selectedProjectId === 0 && projects.length > 0;
  const allProjectsActiveCount = projects.reduce(
    (total, item) => total + item.activeTodoCount,
    0,
  );
  const hiddenChildIds = childProjectIds(projects);
  const selectedProjectLabel = isAllProjects ? 'All Projects' : project?.name ?? 'No project';
  const selectedProjectActiveCount = isAllProjects
    ? allProjectsActiveCount
    : project?.activeTodoCount ?? 0;
  const selectedProjectDotStyle = isAllProjects
    ? undefined
    : projectAccentStyle(project, projects);
  const themeToggleLabel =
    resolvedTheme === 'dark' ? 'Switch to Wood Light theme' : 'Switch to Wood Dark theme';
  const themeToggleTitle =
    themePreference === 'system'
      ? `${themeToggleLabel} (currently following system)`
      : themeToggleLabel;

  const refreshOpenWindows = () => {
    setWindowMenuStatus('loading');
    void listOpenAppWindows()
      .then((windows) => {
        setOpenWindows(windows);
        setWindowMenuStatus('idle');
      })
      .catch(() => {
        setOpenWindows([]);
        setWindowMenuStatus('error');
      });
  };

  useEffect(() => {
    if (!projectMenuOpen && !actionsMenuOpen && !windowMenuOpen) {
      return;
    }

    const closeMenus = () => {
      setProjectMenuOpen(false);
      setActionsMenuOpen(false);
      setWindowMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        projectMenuRef.current?.contains(target) ||
        actionsMenuRef.current?.contains(target) ||
        windowMenuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenus();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [actionsMenuOpen, projectMenuOpen, windowMenuOpen]);

  useEffect(() => {
    if (!projectMenuOpen) {
      setProjectSearch('');
    }
  }, [projectMenuOpen]);

  useEffect(() => {
    if (!actionsMenuOpen) {
      setActionSearch('');
      setActionsMenuOffsetX(0);
    }
  }, [actionsMenuOpen]);

  useEffect(() => {
    if (!actionsMenuOpen) {
      return undefined;
    }

    let animationFrame = 0;
    const fitMenuToViewport = () => {
      const menu = actionsMenuPanelRef.current;
      if (!menu) {
        return;
      }
      const rect = menu.getBoundingClientRect();
      const gutter = 16;
      const rightLimit = window.innerWidth - gutter;
      let delta = 0;
      if (rect.left < gutter) {
        delta = gutter - rect.left;
      } else if (rect.right > rightLimit) {
        delta = rightLimit - rect.right;
      }
      if (delta !== 0) {
        setActionsMenuOffsetX((current) => current + delta);
      }
    };
    const scheduleFit = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(fitMenuToViewport);
    };

    scheduleFit();
    window.addEventListener('resize', scheduleFit);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', scheduleFit);
    };
  }, [actionsMenuOpen, filteredActions.length]);

  return (
    <header className="top-bar" data-tauri-drag-region="deep">
      <WindowControls />
      <div className="top-left">
        <AppButton
          aria-label="Go home"
          className="top-icon-button"
          onClick={() => {
            setProjectMenuOpen(false);
            setActionsMenuOpen(false);
            setWindowMenuOpen(false);
            onGoHome();
          }}
          title="Go Home"
          variant="toolbar"
        >
          <Home size={15} />
        </AppButton>
        <div aria-label="Navigation history" className="history-controls">
          <AppButton
            aria-label="Go back"
            className="top-icon-button history-button"
            disabled={!canGoBack}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onGoBack();
            }}
            title="Go back"
            variant="toolbar"
          >
            <ChevronLeft size={16} />
          </AppButton>
          <AppButton
            aria-label="Go forward"
            className="top-icon-button history-button"
            disabled={!canGoForward}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onGoForward();
            }}
            title="Go forward"
            variant="toolbar"
          >
            <ChevronRight size={16} />
          </AppButton>
        </div>
        <div className="window-menu-wrap" ref={windowMenuRef}>
          <AppButton
            aria-expanded={windowMenuOpen}
            aria-haspopup="menu"
            aria-label="Switch windows"
            className="top-icon-button"
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen((open) => {
                if (!open) {
                  refreshOpenWindows();
                }
                return !open;
              });
            }}
            title="Switch windows"
            variant="toolbar"
          >
            <AppWindow size={15} />
          </AppButton>
          {windowMenuOpen ? (
            <div aria-label="Open windows" className="window-menu" role="menu">
              {windowMenuStatus === 'loading' ? (
                <div className="window-menu-empty">Loading windows...</div>
              ) : null}
              {windowMenuStatus === 'error' ? (
                <div className="window-menu-empty">Could not load windows.</div>
              ) : null}
              {windowMenuStatus === 'idle' && openWindows.length === 0 ? (
                <div className="window-menu-empty">No open windows</div>
              ) : null}
              {openWindows.map((window) => {
                const display = windowMenuDisplay(window, project);
                const WindowIcon = windowKindIcon(display.kind);

                return (
                  <button
                    aria-label={`${display.title} ${display.detail}`}
                    className={`window-menu-row ${window.isCurrent ? 'selected' : ''}`}
                    disabled={window.isCurrent}
                    key={window.label}
                    onClick={() => {
                      void focusOpenAppWindow(window.label);
                      setWindowMenuOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className={`window-kind-icon ${windowKindClass(display.kind)}`}>
                      <WindowIcon aria-hidden="true" size={16} strokeWidth={2.2} />
                    </span>
                    <span>
                      <strong>{display.title}</strong>
                      <small>{display.detail}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="top-divider" />
        <div className="project-controls" ref={projectMenuRef}>
          <AppButton
            aria-label="New task"
            className="top-icon-button"
            disabled={!canCreateTask}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onNewTask();
            }}
            title="New Task"
            variant="toolbar"
          >
            <Plus size={15} />
          </AppButton>
          <AppButton
            aria-label="New Worktree Task"
            className="top-icon-button"
            disabled={!canCreateTask}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onNewWorktreeTask();
            }}
            title="New Worktree Task (Cmd/Ctrl+3)"
            variant="toolbar"
          >
            <TreePine size={15} />
          </AppButton>
          <div className="project-picker">
            <AppButton
              aria-expanded={projectMenuOpen}
              aria-haspopup="menu"
              aria-label={`Select project: ${selectedProjectLabel}, ${selectedProjectActiveCount} active`}
              onClick={() => {
                setActionsMenuOpen(false);
                setWindowMenuOpen(false);
                setProjectMenuOpen((open) => !open);
              }}
              variant="project"
            >
              <span
                className={`project-dot ${isAllProjects ? 'all-projects-dot' : ''}`}
                style={selectedProjectDotStyle}
              />
              <strong>{selectedProjectLabel}</strong>
              <span>{selectedProjectActiveCount} active</span>
              <ChevronDown size={14} />
            </AppButton>
            {projectMenuOpen ? (
              <ProjectSelectorMenu
                ariaLabel="Projects"
                className="project-menu"
                hiddenProjectIdsWhenSearchEmpty={hiddenChildIds}
                listClassName="project-menu-list"
                onProjectSelect={(item) => {
                  onProjectSelect(item.id);
                  setProjectMenuOpen(false);
                }}
                onSearchChange={setProjectSearch}
                projectDotStyle={(item) => projectAccentStyle(item, projects)}
                projects={projects}
                renderProjectAction={(item) => (
                  <button
                    aria-label={`Open ${item.name} in new window`}
                    className="project-menu-open"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenProjectWindow(item);
                      setProjectMenuOpen(false);
                    }}
                    title={`Open ${item.name} in new window`}
                    type="button"
                  >
                    <ExternalLink size={15} />
                  </button>
                )}
                rowClassName="project-menu-row"
                searchAriaLabel="Search projects"
                searchClassName="project-menu-search"
                searchInputName="project-search"
                searchValue={projectSearch}
                selectedProjectId={selectedProjectId}
                staticRows={
                  projects.length > 0
                    ? [
                        {
                          detail: `${allProjectsActiveCount} active`,
                          dotClassName: 'all-projects-dot',
                          id: 'all-projects',
                          label: 'All Projects',
                          onSelect: () => {
                            onProjectSelect(0);
                            setProjectMenuOpen(false);
                          },
                          selected: isAllProjects,
                        },
                      ]
                    : []
                }
              />
            ) : null}
          </div>
          <AppButton
            aria-label="New project"
            className="top-icon-button project-new-button"
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onNewProject();
            }}
            title="New Project"
            variant="toolbar"
          >
            <FolderPlus size={15} />
          </AppButton>
        </div>
        <div className="top-action-group">
          <AppButton
            aria-label="Open project folder"
            disabled={!project}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              requestTerminalWindowFocusRestore((nonce) => nonce + 1);
              onOpenProjectFolder();
            }}
            className="top-icon-button"
            title="Open Project Folder"
            variant="toolbar"
          >
            <FolderOpen size={15} />
          </AppButton>
          <AppButton
            aria-label="Open project notes"
            disabled={!project}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onOpenProjectNotes();
            }}
            className="top-icon-button"
            title="Project Notes"
            variant="toolbar"
          >
            <FileText size={15} />
          </AppButton>
          <AppButton
            aria-label="Open project settings"
            disabled={!project}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onOpenProjectSettings();
            }}
            className="top-icon-button"
            title="Project Settings"
            variant="toolbar"
          >
            <FolderCog size={15} />
          </AppButton>
          <AppButton
            aria-label="Open app settings"
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onOpenAppSettings();
            }}
            className="top-icon-button"
            title="App Settings"
            variant="toolbar"
          >
            <Settings size={15} />
          </AppButton>
        </div>
      </div>

      <div className="top-right">
        <div className="actions-menu-wrap" ref={actionsMenuRef}>
          <AppButton
            aria-label="Search app"
            className="top-icon-button"
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen(false);
              setWindowMenuOpen(false);
              onOpenGlobalSearch();
            }}
            title="Search app"
            variant="toolbar"
          >
            <Search size={15} />
          </AppButton>
          <AppButton
            aria-expanded={actionsMenuOpen}
            aria-haspopup="menu"
            aria-label="Project actions"
            disabled={!project}
            onClick={() => {
              setProjectMenuOpen(false);
              setActionsMenuOpen((open) => !open);
            }}
            className="top-icon-button"
            title="Project actions"
            variant="toolbar"
          >
            <Zap size={15} />
          </AppButton>
          {actionsMenuOpen ? (
            <div
              aria-label="Project actions"
              className="actions-menu"
              ref={actionsMenuPanelRef}
              role="menu"
              style={
                actionsMenuOffsetX
                  ? { transform: `translateX(${actionsMenuOffsetX}px)` }
                  : undefined
              }
            >
              <label className="actions-search">
                <Search size={14} />
                <input
                  aria-label="Search actions"
                  autoFocus
                  onChange={(event) => setActionSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return;
                    }
                    const firstAction = filteredActions[0];
                    if (!firstAction || firstAction.validationError) {
                      return;
                    }
                    event.preventDefault();
                    onRunAction(firstAction);
                    setActionsMenuOpen(false);
                  }}
                  placeholder="Search actions"
                  value={actionSearch}
                />
              </label>
              <button
                aria-label="Copy create action prompt"
                className="actions-menu-row actions-menu-prompt-row"
                disabled={!project}
                onClick={() => {
                  onCopyActionPrompt();
                  setActionsMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span className="actions-menu-row-icon dashed" aria-hidden="true">
                  <ClipboardCopy size={14} />
                </span>
                <span className="actions-menu-row-copy">
                  <strong>Copy create action prompt</strong>
                  <small>Prompt for a new project action</small>
                </span>
              </button>
              <div className="actions-menu-status-row">
                <span
                  className="actions-menu-count"
                  title={`${filteredActions.length} of ${projectActions.length} actions`}
                >
                  <span className="actions-menu-count-dot" />
                  {filteredActions.length} {filteredActions.length === 1 ? 'action' : 'actions'}
                </span>
                <div className="actions-menu-tools">
                  <button
                    disabled={!project}
                    onClick={() => {
                      onOpenProjectActions();
                      setActionsMenuOpen(false);
                    }}
                    type="button"
                  >
                    Browse
                  </button>
                  <button disabled={!project} onClick={onRefreshActions} type="button">
                    Refresh
                  </button>
                </div>
              </div>
              {filteredActions.map((action) => (
                <div
                  aria-disabled={Boolean(action.validationError)}
                  aria-label={action.title}
                  className="actions-menu-row"
                  key={action.fileName}
                  role="group"
                >
                  <ProjectActionIcon
                    action={action}
                    className="actions-menu-row-icon"
                    size={16}
                  />
                  <span className="actions-menu-row-copy">
                    <strong>{action.title}</strong>
                    <small>
                      {action.validationError ??
                        (action.runtime === 'native'
                          ? `${action.runtime} · ${action.arguments.length} args`
                          : `${action.runtime} · ${action.arguments.length} args · ${action.fileName}`)}
                    </small>
                  </span>
                  <span className="actions-menu-row-actions">
                    <button
                      aria-label={`Run ${action.title}`}
                      className="actions-menu-icon-button run"
                      disabled={Boolean(action.validationError)}
                      onClick={() => {
                        onRunAction(action);
                        setActionsMenuOpen(false);
                      }}
                      role="menuitem"
                      title={action.validationError ?? `Run ${action.title}`}
                      type="button"
                    >
                      <Play fill="currentColor" size={15} />
                    </button>
                    <button
                      aria-label={`Edit ${action.title}`}
                      className="actions-menu-icon-button edit"
                      disabled={action.runtime === 'native'}
                      onClick={() => onEditAction(action)}
                      title={
                        action.runtime === 'native'
                          ? 'Native actions cannot be edited'
                          : `Edit ${action.title}`
                      }
                      type="button"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      aria-label={`Delete ${action.title}`}
                      className="actions-menu-icon-button delete"
                      disabled={action.runtime === 'native'}
                      onClick={() => {
                        onDeleteAction(action);
                        setActionsMenuOpen(false);
                      }}
                      title={
                        action.runtime === 'native'
                          ? 'Native actions cannot be deleted'
                          : `Delete ${action.title}`
                      }
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              ))}
              {filteredActions.length === 0 ? (
                <div className="actions-menu-empty">No actions found</div>
              ) : null}
              <button
                className="actions-menu-row actions-menu-secondary-row"
                disabled={!project}
                onClick={() => {
                  onNewActionTask();
                  setActionsMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span className="actions-menu-row-icon dashed" aria-hidden="true">
                  <Command size={15} />
                </span>
                <span className="actions-menu-row-copy">
                  <strong>New action task</strong>
                  <small>Create a task for a project action file</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
        {visibleTimer ? (
          <div className={`running-timer ${visibleTimer.running ? 'running' : 'stopped'}`}>
            <span
              aria-label={`Timer task state: ${visibleTimer.state}`}
              className={`running-timer-status ${todoStateToneClass(visibleTimer.state)}`}
              title={visibleTimer.state}
            />
            <button
              aria-label={`Open ${visibleTimer.displayId}`}
              className="running-timer-task"
              onClick={() => onTimerTaskSelect(visibleTimer.todoId, visibleTimer.projectId)}
              title={`Open ${visibleTimer.displayId}`}
              type="button"
            >
              {visibleTimer.displayId} · {formatDuration(visibleTimerElapsedSeconds)}
            </button>
            <button
              aria-label={
                visibleTimer.running
                  ? `Stop running timer for ${visibleTimer.displayId}`
                  : `Continue timer for ${visibleTimer.displayId}`
              }
              className={`running-timer-control ${visibleTimer.running ? 'stop' : 'start'}`}
              onClick={() =>
                visibleTimer.running
                  ? onStopRunningTimer()
                  : onStartRunningTimer(visibleTimer.todoId)
              }
              title={
                visibleTimer.running
                  ? `Stop timer for ${visibleTimer.displayId}`
                  : `Continue timer for ${visibleTimer.displayId}`
              }
              type="button"
            >
              {visibleTimer.running ? (
                <Square fill="currentColor" size={10} />
              ) : (
                <Play fill="currentColor" size={11} />
              )}
            </button>
          </div>
        ) : null}
        <AppButton
          aria-label={themeToggleLabel}
          className="top-icon-button"
          onClick={onThemeToggle}
          title={themeToggleTitle}
          variant="toolbar"
        >
          {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </AppButton>
      </div>
    </header>
  );
}

function windowKindLabel(kind: AppWindowKind): string {
  switch (kind) {
    case 'workspace':
      return 'Workspace window';
    case 'project':
      return 'Project window';
    case 'task':
      return 'Task window';
    case 'terminal':
      return 'Terminal window';
    case 'image':
      return 'Image window';
    case 'other':
      return 'App window';
  }
}

function windowMenuDisplay(
  window: OpenAppWindowSummary,
  project?: ProjectSummary,
): { detail: string; kind: AppWindowKind; title: string } {
  const kind = window.kind === 'workspace' && project ? 'project' : window.kind;
  const title = window.kind === 'workspace' && project ? project.name : window.title;

  return {
    detail: window.isCurrent ? 'Current window' : windowKindLabel(kind),
    kind,
    title,
  };
}

function windowKindIcon(kind: AppWindowKind): LucideIcon {
  switch (kind) {
    case 'workspace':
    case 'project':
      return FolderOpen;
    case 'task':
      return FileText;
    case 'terminal':
      return SquareTerminal;
    case 'image':
      return Image;
    case 'other':
      return AppWindow;
  }
}

function windowKindClass(kind: AppWindowKind): string {
  return `window-kind-${kind}`;
}
