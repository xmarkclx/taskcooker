import {
  ClipboardCopy,
  ExternalLink,
  FileText,
  FolderOpen,
  GitCompare,
  GitMerge,
  Play,
  SquareTerminal,
  Trash2,
  Zap,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  ExecutionTerminalKind,
  ExecutionTerminalSummary,
  ResolvedAppTheme,
  TaskDescriptionPromptMode,
} from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DeferredMount, useActivatedOnce } from '../../ui/DeferredMount';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { useSlowdownRenderProbe } from '../performance/slowdownProfiler';
import { clearCachedPtyScrollback } from '../terminal/ptyBridge';
import { TerminalSurface } from '../terminal/TerminalSurface';

const PENDING_TERMINAL_TAB_ID = 'pending-terminal';
// Upper bound on hidden-but-mounted terminal surfaces per task; each one holds
// an xterm instance plus a WebGL context, so the cap keeps worst-case memory
// and GL-context usage flat no matter how many tabs a task accumulates.
const TERMINAL_KEEP_ALIVE_COUNT = 3;
const EXECUTION_KIND_LABELS: Record<ExecutionTerminalKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  omp: 'OMP',
  terminal: 'Terminal',
  worktree_merge: 'Merge',
};

type ExecutionPanelProps = {
  artifact: {
    markdown: string;
    markdownPath: string;
  };
  attachmentTarget?: {
    projectId: number;
    todoId: number;
  };
  canStart: boolean;
  executionTerminals: ExecutionTerminalSummary[];
  onCloseExecutionTerminal: (ptyId: number) => Promise<void>;
  onOpenExternalTerminal: (ptyId: number) => Promise<void>;
  onCopyArtifactLink: () => void;
  onCopyPrompt: () => void;
  onOpenFolder: () => void;
  openFolderDisabled?: boolean;
  onOpenImage?: (src: string) => void;
  onOpenArtifact: () => void;
  onOpenWorktreeDiff: () => Promise<void | ExecutionTerminalSummary>;
  onDeleteWorktree: () => Promise<void>;
  onArtifactTocHiddenChange: (hidden: boolean) => void;
  onArtifactTocWidthChange: (width: number) => void;
  onPromptSettingsChange: (settings: {
    aiDefaultIncludeProjectNotes: boolean;
    aiTaskDescriptionMode: TaskDescriptionPromptMode;
  }) => void;
  onRenameExecutionTerminal: (ptyId: number, label: string) => Promise<void>;
  onSaveArtifact: (todoId: number, artifactMarkdown: string) => void;
  onStartExecutionTerminal: (
    kind: ExecutionTerminalKind,
    options?: { resumeSessionId?: string },
  ) => Promise<ExecutionTerminalSummary>;
  onSuggestWorktreeName: () => Promise<{ name: string }>;
  onEnableWorktree: (worktreeName: string) => Promise<void>;
  onCommitAndMergeWorktree: () => Promise<ExecutionTerminalSummary>;
  ompSessionId?: string | null;
  codexSessionId?: string | null;
  claudeSessionId?: string | null;
  promptSettings?: {
    aiDefaultIncludeProjectNotes: boolean;
    aiTaskDescriptionMode: TaskDescriptionPromptMode;
  };
  artifactTocHidden: boolean;
  artifactTocWidth: number;
  markdownEditorFontFamily: string;
  markdownEditorFontSize: string;
  markdownEditorMaxImageHeight: string;
  theme: ResolvedAppTheme;
  terminalTmuxEnabled: boolean;
  todoId: number;
  worktree?: {
    mainBranch?: string;
    name?: string | null;
    path?: string | null;
  };
};

export function ExecutionPanel({
  artifact,
  attachmentTarget,
  canStart,
  executionTerminals,
  onCloseExecutionTerminal,
  onOpenExternalTerminal,
  onCopyArtifactLink,
  onCopyPrompt,
  onOpenFolder,
  openFolderDisabled = false,
  onOpenImage,
  onOpenArtifact,
  onOpenWorktreeDiff,
  onDeleteWorktree,
  onArtifactTocHiddenChange,
  onArtifactTocWidthChange,
  onPromptSettingsChange,
  onRenameExecutionTerminal,
  onSaveArtifact,
  onStartExecutionTerminal,
  onSuggestWorktreeName,
  onEnableWorktree,
  onCommitAndMergeWorktree,
  ompSessionId,
  codexSessionId,
  claudeSessionId,
  promptSettings,
  artifactTocHidden,
  artifactTocWidth,
  markdownEditorFontFamily,
  markdownEditorFontSize,
  markdownEditorMaxImageHeight,
  theme,
  terminalTmuxEnabled,
  todoId,
  worktree,
}: ExecutionPanelProps) {
  useSlowdownRenderProbe('execution-panel', `todo:${todoId}`);
  // Remember the active execution tab per task, so returning to a task reselects
  // the tab you left on instead of resetting to Artifacts.
  const [activeTabByTodo, setActiveTabByTodo] = useState<Record<number, string>>({});
  const activeTabId = activeTabByTodo[todoId] ?? null;
  const setActiveTabId = (value: string | ((current: string | null) => string)) => {
    setActiveTabByTodo((prev) => {
      const current = prev[todoId] ?? null;
      const next = typeof value === 'function' ? value(current) : value;
      if (next == null || next === current) return prev;
      return { ...prev, [todoId]: next };
    });
  };
  const [artifactContextMenu, setArtifactContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [terminalContextMenu, setTerminalContextMenu] = useState<{
    tab: ExecutionTerminalSummary;
    x: number;
    y: number;
  } | null>(null);
  const [editingTab, setEditingTab] = useState<{
    ptyId: number;
    label: string;
  } | null>(null);
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [worktreePending, setWorktreePending] = useState(false);
  const [startingKind, setStartingKind] = useState<ExecutionTerminalKind | null>(null);
  const [renamingPtyId, setRenamingPtyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useMemo(
    () => executionTerminals.filter((terminal) => terminal.todoId === todoId),
    [executionTerminals, todoId],
  );
  const hasOpenProviderTab = (kind: ExecutionTerminalKind) =>
    tabs.some((terminal) => terminal.kind === kind && terminal.state === 'running');
  const tabIds = tabs.map(terminalTabId).join('|');
  const artifactTabId = 'artifacts';
  // Mount the artifact editor on first activation only (and keep it mounted so
  // dirty edits survive tab switches) instead of paying Tiptap init on open.
  const artifactActivated = useActivatedOnce(activeTabId === artifactTabId);
  const artifactPaneRef = useRef<HTMLDivElement>(null);
  const focusActiveTabAfterShortcutRef = useRef(false);
  const [tabContentFocusNonce, setTabContentFocusNonce] = useState(0);
  const orderedTabIds = useMemo(
    () => [artifactTabId, ...tabs.map(terminalTabId)],
    [tabs],
  );
  // Keep the most recently used terminal surfaces mounted (hidden via the
  // pane's `visibility: hidden`) so switching tabs never tears down and
  // rebuilds xterm/WebGL or re-attaches the PTY. Capped so a task with many
  // tabs cannot accumulate WebGL contexts and scrollback buffers (B-252).
  const [mountedTabIds, setMountedTabIds] = useState<string[]>([]);
  useEffect(() => {
    setMountedTabIds((current) => {
      const valid = current.filter((id) =>
        tabs.some((tab) => terminalTabId(tab) === id),
      );
      const next =
        activeTabId !== null && tabs.some((tab) => terminalTabId(tab) === activeTabId)
          ? [...valid.filter((id) => id !== activeTabId), activeTabId]
          : valid;
      const capped = next.slice(-TERMINAL_KEEP_ALIVE_COUNT);
      return capped.length === current.length &&
        capped.every((id, index) => id === current[index])
        ? current
        : capped;
    });
  }, [activeTabId, tabs]);

  const moveActiveTab = (direction: 1 | -1) => {
    if (orderedTabIds.length <= 1) {
      return;
    }
    focusActiveTabAfterShortcutRef.current = true;
    setActiveTabId((current) => {
      const index = current ? orderedTabIds.indexOf(current) : -1;
      const base = index === -1 ? 0 : index;
      const next =
        (base + direction + orderedTabIds.length) % orderedTabIds.length;
      return orderedTabIds[next];
    });
  };

  const handleTabNavigationKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (editingTab || !(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    let direction: 1 | -1 | null = null;
    if (event.key === 'Tab') {
      direction = event.shiftKey ? -1 : 1;
    } else if (event.key === 'PageDown') {
      direction = 1;
    } else if (event.key === 'PageUp') {
      direction = -1;
    }
    if (direction === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moveActiveTab(direction);
  };

  useEffect(() => {
    if (!focusActiveTabAfterShortcutRef.current || activeTabId === null) {
      return;
    }

    focusActiveTabAfterShortcutRef.current = false;
    setTabContentFocusNonce((nonce) => nonce + 1);
  }, [activeTabId]);

  useEffect(() => {
    if (activeTabId !== artifactTabId || tabContentFocusNonce === 0) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      focusFirstExecutionPaneTarget(artifactPaneRef.current);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [activeTabId, artifactTabId, tabContentFocusNonce]);

  useEffect(() => {
    setActiveTabId((current) =>
      current &&
      (current === artifactTabId ||
        (current === PENDING_TERMINAL_TAB_ID && startingKind !== null) ||
        tabs.some((tab) => terminalTabId(tab) === current))
        ? current
        : tabs[0]
          ? terminalTabId(tabs[0])
          : artifactTabId,
    );
  }, [artifactTabId, startingKind, tabIds, tabs, todoId]);

  // Deliberately not keyed on startingKind: a failed launch must keep its
  // error visible after the pending tab clears.
  useEffect(() => {
    setError(null);
  }, [artifactTabId, tabIds, tabs, todoId]);

  const startTerminal = async (
    kind: ExecutionTerminalKind,
    options?: { resumeSessionId?: string },
  ) => {
    if (!canStart || startingKind) {
      return;
    }

    setError(null);
    // Show a pending tab right away; spawning the PTY (process launch + DB
    // write) takes long enough that an inert toolbar reads as a missed click.
    setStartingKind(kind);
    setActiveTabId(PENDING_TERMINAL_TAB_ID);
    try {
      const terminal = options
        ? await onStartExecutionTerminal(kind, options)
        : await onStartExecutionTerminal(kind);
      setActiveTabId(terminalTabId(terminal));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setStartingKind(null);
    }
  };
  const closeTab = (tab: ExecutionTerminalSummary) => {
    setError(null);
    // Switch tabs immediately; the close command (process kill + snapshot
    // rebuild) finishes in the background and reports failures via the error
    // line while the shell's close handler rolls the snapshot back.
    const nextTabs = tabs.filter((item) => item.ptyId !== tab.ptyId);
    if (activeTabId === terminalTabId(tab)) {
      setActiveTabId(nextTabs.at(-1) ? terminalTabId(nextTabs.at(-1)!) : artifactTabId);
    }
    setMountedTabIds((current) => current.filter((id) => id !== terminalTabId(tab)));
    clearCachedPtyScrollback(tab.ptyId);
    void Promise.resolve(onCloseExecutionTerminal(tab.ptyId)).catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    });
  };
  const openExternalTerminal = async (tab: ExecutionTerminalSummary) => {
    setError(null);
    setTerminalContextMenu(null);
    try {
      await onOpenExternalTerminal(tab.ptyId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };
  const beginRename = (tab: ExecutionTerminalSummary) => {
    setEditingTab({ ptyId: tab.ptyId, label: tab.label });
  };
  const commitRename = async (tab: ExecutionTerminalSummary) => {
    if (!editingTab || editingTab.ptyId !== tab.ptyId || renamingPtyId !== null) {
      return;
    }

    const label = editingTab.label.trim();
    if (!label || label === tab.label) {
      setEditingTab(null);
      return;
    }

    setError(null);
    setRenamingPtyId(tab.ptyId);
    try {
      await onRenameExecutionTerminal(tab.ptyId, label);
      setEditingTab(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRenamingPtyId(null);
    }
  };
  const handleRenameKeyDown =
    (tab: ExecutionTerminalSummary) => (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitRename(tab);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setEditingTab(null);
      }
    };
  const taskDescriptionMode = promptSettings?.aiTaskDescriptionMode ?? 'task';
  const includeTaskDescription = taskDescriptionMode !== 'none';
  const includeParentTaskDescriptions = taskDescriptionMode === 'ancestry';
  const includeProjectNotes = promptSettings?.aiDefaultIncludeProjectNotes ?? false;
  const setPromptSettings = (next: {
    aiDefaultIncludeProjectNotes?: boolean;
    aiTaskDescriptionMode?: TaskDescriptionPromptMode;
  }) => {
    if (!promptSettings) {
      return;
    }

    onPromptSettingsChange({
      aiDefaultIncludeProjectNotes:
        next.aiDefaultIncludeProjectNotes ?? promptSettings.aiDefaultIncludeProjectNotes,
      aiTaskDescriptionMode: next.aiTaskDescriptionMode ?? promptSettings.aiTaskDescriptionMode,
    });
  };
  const artifactAttachmentTarget = attachmentTarget
    ? {
        ...attachmentTarget,
        scope: 'todo-artifact' as const,
      }
    : undefined;
  const openArtifactContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setArtifactContextMenu({ x: event.clientX, y: event.clientY });
  };
  const openTerminalContextMenu =
    (tab: ExecutionTerminalSummary) => (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!terminalTmuxEnabled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setTerminalContextMenu({ tab, x: event.clientX, y: event.clientY });
    };

  const openWorktreeDialog = async () => {
    if (!canStart || worktreePending) {
      return;
    }

    setError(null);
    setWorktreeDialogOpen(true);
    setWorktreePending(true);
    try {
      const suggestion = await onSuggestWorktreeName();
      setWorktreeName(suggestion.name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setWorktreeDialogOpen(false);
    } finally {
      setWorktreePending(false);
    }
  };

  const createWorktree = async () => {
    const name = worktreeName.trim();
    if (!name || worktreePending) {
      return;
    }

    setError(null);
    setWorktreePending(true);
    try {
      await onEnableWorktree(name);
      setWorktreeDialogOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setWorktreePending(false);
    }
  };

  const runWorktreeTerminalAction = async (
    action: () => Promise<void | ExecutionTerminalSummary>,
  ) => {
    setError(null);
    try {
      const terminal = await action();
      if (terminal) {
        setActiveTabId(terminalTabId(terminal));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };
  const deleteWorktree = async () => {
    setError(null);
    setWorktreePending(true);
    try {
      await onDeleteWorktree();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setWorktreePending(false);
    }
  };
  const hasWorktree = Boolean(worktree?.name);

  return (
    <section
      aria-label="Execution"
      className="execution-panel"
      onKeyDownCapture={handleTabNavigationKeyDown}
    >
      <div className="execution-context-options" aria-label="Execution prompt context">
        <label>
          <input
            aria-label="Include task description"
            checked={includeTaskDescription}
            disabled={!canStart || !promptSettings}
            onChange={(event) =>
              setPromptSettings({
                aiTaskDescriptionMode: event.target.checked ? 'task' : 'none',
              })
            }
            type="checkbox"
          />
          <span>Task description</span>
        </label>
        <label>
          <input
            aria-label="Include parent task descriptions"
            checked={includeParentTaskDescriptions}
            disabled={!canStart || !promptSettings || !includeTaskDescription}
            onChange={(event) =>
              setPromptSettings({
                aiTaskDescriptionMode: event.target.checked ? 'ancestry' : 'task',
              })
            }
            type="checkbox"
          />
          <span>Parent descriptions</span>
        </label>
        <label>
          <input
            aria-label="Include project notes"
            checked={includeProjectNotes}
            disabled={!canStart || !promptSettings}
            onChange={(event) =>
              setPromptSettings({
                aiDefaultIncludeProjectNotes: event.target.checked,
              })
            }
            type="checkbox"
          />
          <span>Project notes</span>
        </label>
      </div>
      <div aria-label="Execution launch actions" className="execution-toolbar" role="toolbar">
        <AppButton
          disabled={!canStart || startingKind !== null}
          onClick={() => void startTerminal('codex')}
          variant="toolbar"
        >
          <Play size={15} /> Codex
        </AppButton>
        {codexSessionId && !hasOpenProviderTab('codex') ? (
          <AppButton
            disabled={!canStart || startingKind !== null}
            onClick={() => void startTerminal('codex', { resumeSessionId: codexSessionId })}
            variant="toolbar"
          >
            <Play size={15} /> Resume Codex
          </AppButton>
        ) : null}
        <AppButton
          disabled={!canStart || startingKind !== null}
          onClick={() => void startTerminal('claude')}
          variant="toolbar"
        >
          <Play size={15} /> Claude
        </AppButton>
        {claudeSessionId && !hasOpenProviderTab('claude') ? (
          <AppButton
            disabled={!canStart || startingKind !== null}
            onClick={() => void startTerminal('claude', { resumeSessionId: claudeSessionId })}
            variant="toolbar"
          >
            <Play size={15} /> Resume Claude
          </AppButton>
        ) : null}
        <AppButton
          disabled={!canStart || startingKind !== null}
          onClick={() => void startTerminal('omp')}
          variant="toolbar"
        >
          <Play size={15} /> OMP
        </AppButton>
        {ompSessionId && !hasOpenProviderTab('omp') ? (
          <AppButton
            disabled={!canStart || startingKind !== null}
            onClick={() => void startTerminal('omp', { resumeSessionId: ompSessionId })}
            variant="toolbar"
          >
            <Play size={15} /> Resume OMP
          </AppButton>
        ) : null}
        <AppButton
          aria-label="Copy Agent Prompt"
          disabled={!canStart}
          onClick={onCopyPrompt}
          title="Copy Agent Prompt"
          variant="toolbar"
        >
          <ClipboardCopy size={15} /> Prompt
        </AppButton>
        <AppButton
          aria-label="Open Folder"
          disabled={!canStart || openFolderDisabled}
          onClick={onOpenFolder}
          title="Open project folder"
          variant="toolbar"
        >
          <FolderOpen size={15} /> Open Folder
        </AppButton>
        {!hasWorktree ? (
          <AppButton
            disabled={!canStart || worktreePending}
            onClick={() => void openWorktreeDialog()}
            variant="toolbar"
          >
            <Zap size={15} /> Worktree
          </AppButton>
        ) : null}
        {hasWorktree ? (
          <>
          <AppButton
            aria-label="Open Diff"
            onClick={() => void runWorktreeTerminalAction(onOpenWorktreeDiff)}
            title={`Diff against ${worktree?.mainBranch ?? 'main'}`}
            variant="toolbar"
          >
            <GitCompare size={15} /> Open Diff
          </AppButton>
          <AppButton
            aria-label="Commit & Merge"
            onClick={() => void runWorktreeTerminalAction(onCommitAndMergeWorktree)}
            title={`Commit and merge into ${worktree?.mainBranch ?? 'main'}`}
            variant="toolbar"
          >
            <GitMerge size={15} /> Commit & Merge
          </AppButton>
          <AppButton
            aria-label="Delete Worktree"
            disabled={worktreePending}
            onClick={() => void deleteWorktree()}
            title="Delete task worktree"
            variant="toolbar"
          >
            <Trash2 size={15} /> Delete Worktree
          </AppButton>
          </>
        ) : null}
      </div>

      {worktreeDialogOpen ? (
        <div className="worktree-dialog">
          <form
            aria-labelledby="worktree-dialog-title"
            aria-modal="true"
            onSubmit={(event) => {
              event.preventDefault();
              void createWorktree();
            }}
            role="dialog"
          >
            <header>
              <h3 id="worktree-dialog-title">Enable worktree</h3>
              <button
                aria-label="Close worktree dialog"
                disabled={worktreePending}
                onClick={() => setWorktreeDialogOpen(false)}
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <label className="form-field">
              <span>Worktree name</span>
              <input
                aria-label="Worktree name"
                disabled={worktreePending}
                onChange={(event) => setWorktreeName(event.currentTarget.value)}
                value={worktreeName}
              />
            </label>
            <footer>
              <AppButton
                disabled={worktreePending}
                onClick={() => setWorktreeDialogOpen(false)}
                variant="secondary"
              >
                Cancel
              </AppButton>
              <AppButton disabled={worktreePending || !worktreeName.trim()} type="submit" variant="primary">
                <FolderOpen size={15} /> Create Worktree
              </AppButton>
            </footer>
          </form>
        </div>
      ) : null}

      {error ? <p className="execution-error">{error}</p> : null}

      <div aria-label="Execution terminals" className="execution-tabs" role="tablist">
        <span
          className={`execution-tab-item artifact-tab ${activeTabId === artifactTabId ? 'active' : ''}`}
        >
          <button
            aria-controls="execution-panel-artifacts"
            aria-haspopup="menu"
            aria-selected={activeTabId === artifactTabId}
            className={activeTabId === artifactTabId ? 'active' : ''}
            id="execution-tab-artifacts"
            onClick={() => setActiveTabId(artifactTabId)}
            onContextMenu={openArtifactContextMenu}
            role="tab"
            type="button"
          >
            <FileText aria-hidden="true" size={14} />
            <span>Artifacts</span>
          </button>
        </span>
        {tabs.map((tab) => (
          <span
            className={`execution-tab-item ${activeTabId === terminalTabId(tab) ? 'active' : ''}`}
            key={terminalTabId(tab)}
          >
            {editingTab?.ptyId === tab.ptyId ? (
              <input
                aria-label={`Rename ${tab.label} terminal`}
                autoFocus
                className="execution-tab-rename-input"
                disabled={renamingPtyId === tab.ptyId}
                onBlur={() => void commitRename(tab)}
                onChange={(event) =>
                  setEditingTab({ ptyId: tab.ptyId, label: event.currentTarget.value })
                }
                onClick={(event) => event.stopPropagation()}
                onKeyDown={handleRenameKeyDown(tab)}
                value={editingTab.label}
              />
            ) : (
              <button
                aria-controls={`execution-panel-${terminalTabId(tab)}`}
                aria-selected={activeTabId === terminalTabId(tab)}
                className={activeTabId === terminalTabId(tab) ? 'active' : ''}
                id={`execution-tab-${terminalTabId(tab)}`}
                onClick={() => setActiveTabId(terminalTabId(tab))}
                onContextMenu={openTerminalContextMenu(tab)}
                onDoubleClick={() => beginRename(tab)}
                role="tab"
                title="Double-click to rename"
                type="button"
              >
                {tab.label}
              </button>
            )}
            <button
              aria-label={`Close ${tab.label} terminal`}
              className="execution-tab-close"
              onClick={() => closeTab(tab)}
              type="button"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {startingKind ? (
          <span
            className={`execution-tab-item ${
              activeTabId === PENDING_TERMINAL_TAB_ID ? 'active' : ''
            }`}
          >
            <button
              aria-controls={`execution-panel-${PENDING_TERMINAL_TAB_ID}`}
              aria-selected={activeTabId === PENDING_TERMINAL_TAB_ID}
              className={activeTabId === PENDING_TERMINAL_TAB_ID ? 'active' : ''}
              id={`execution-tab-${PENDING_TERMINAL_TAB_ID}`}
              onClick={() => setActiveTabId(PENDING_TERMINAL_TAB_ID)}
              role="tab"
              type="button"
            >
              {EXECUTION_KIND_LABELS[startingKind]}
            </button>
          </span>
        ) : null}
        <button
          aria-label="New Terminal"
          className="execution-tab-add"
          disabled={!canStart || startingKind !== null}
          onClick={() => void startTerminal('terminal')}
          title="New Terminal"
          type="button"
        >
          <SquareTerminal aria-hidden="true" size={17} />
        </button>
      </div>
      {artifactContextMenu ? (
        <ArtifactTabContextMenu
          onClose={() => setArtifactContextMenu(null)}
          onCopyLink={onCopyArtifactLink}
          onOpen={onOpenArtifact}
          x={artifactContextMenu.x}
          y={artifactContextMenu.y}
        />
      ) : null}
      {terminalContextMenu ? (
        <TerminalTabContextMenu
          onClose={() => setTerminalContextMenu(null)}
          onOpenExternal={() => void openExternalTerminal(terminalContextMenu.tab)}
          x={terminalContextMenu.x}
          y={terminalContextMenu.y}
        />
      ) : null}

      <div className="execution-terminal-stack">
        <div
          aria-hidden={activeTabId !== artifactTabId}
          aria-labelledby="execution-tab-artifacts"
          className={`execution-terminal-pane artifact-pane ${
            activeTabId === artifactTabId ? 'active' : ''
          }`}
          id="execution-panel-artifacts"
          ref={artifactPaneRef}
          role="tabpanel"
        >
          <div className="artifact-panel">
            {artifactActivated ? (
              <DeferredMount>
                <MarkdownEditor
                  ariaLabel="Artifacts Markdown"
                  attachmentTarget={artifactAttachmentTarget}
                  conflictLabel="Artifacts changed outside this window."
                  fontFamily={markdownEditorFontFamily}
                  fontSize={markdownEditorFontSize}
                  maxImageHeight={markdownEditorMaxImageHeight}
                  markdown={artifact.markdown}
                  onOpenImage={onOpenImage}
                  onSave={(artifactMarkdown) => onSaveArtifact(todoId, artifactMarkdown)}
                  onTocHiddenChange={onArtifactTocHiddenChange}
                  onTocWidthChange={onArtifactTocWidthChange}
                  placeholder="AI Summary + other artifacts will be shown here"
                  scrollKey={`todo:${todoId}:artifact`}
                  tocHidden={artifactTocHidden}
                  tocWidth={artifactTocWidth}
                />
              </DeferredMount>
            ) : null}
          </div>
        </div>
        {tabs.map((tab) => {
          const id = terminalTabId(tab);
          const active = activeTabId === id;
          const mounted = active || mountedTabIds.includes(id);
          return (
            <div
              aria-hidden={!active}
              aria-labelledby={`execution-tab-${id}`}
              className={`execution-terminal-pane ${active ? 'active' : ''}`}
              id={`execution-panel-${id}`}
              key={id}
              role="tabpanel"
            >
              {mounted ? (
                <DeferredMount
                  fallback={
                    <div className={`terminal-shell ${theme}`}>
                      <div
                        aria-label={`Loading ${tab.label}`}
                        className="terminal-surface terminal-surface-starting"
                      >
                        <span>Loading {tab.label}…</span>
                      </div>
                    </div>
                  }
                  strategy="idle"
                >
                  <TerminalSurface
                    active={active}
                    attachmentTarget={attachmentTarget}
                    focusNonce={tabContentFocusNonce}
                    label={tab.label}
                    ptyId={tab.ptyId}
                    theme={theme}
                  />
                </DeferredMount>
              ) : null}
            </div>
          );
        })}
        {startingKind ? (
          <div
            aria-hidden={activeTabId !== PENDING_TERMINAL_TAB_ID}
            aria-labelledby={`execution-tab-${PENDING_TERMINAL_TAB_ID}`}
            className={`execution-terminal-pane ${
              activeTabId === PENDING_TERMINAL_TAB_ID ? 'active' : ''
            }`}
            id={`execution-panel-${PENDING_TERMINAL_TAB_ID}`}
            role="tabpanel"
          >
            <div className={`terminal-shell ${theme}`}>
              <div
                aria-label={`Starting ${EXECUTION_KIND_LABELS[startingKind]}`}
                className="terminal-surface terminal-surface-starting"
              >
                <span>Starting {EXECUTION_KIND_LABELS[startingKind]}…</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function terminalTabId(terminal: ExecutionTerminalSummary) {
  return `${terminal.kind}-${terminal.ptyId}`;
}

function focusFirstExecutionPaneTarget(container: HTMLElement | null) {
  const target = [
    '.markdown-textarea',
    '.tiptap-editor [contenteditable="true"]',
    '.tiptap-editor .ProseMirror',
    'textarea',
    '[contenteditable="true"]',
    'input:not([type="hidden"])',
    'select',
    'button',
    '[tabindex]:not([tabindex="-1"])',
  ].reduce<HTMLElement | null>(
    (match, selector) => match ?? container?.querySelector<HTMLElement>(selector) ?? null,
    null,
  );
  target?.focus({ preventScroll: true });
}

type TerminalTabContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onOpenExternal: () => void;
};

function TerminalTabContextMenu({
  x,
  y,
  onClose,
  onOpenExternal,
}: TerminalTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  return (
    <div
      aria-label="Terminal tab actions"
      className="task-context-menu artifact-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: x, top: y }}
      tabIndex={-1}
    >
      <button onClick={onOpenExternal} role="menuitem" type="button">
        <ExternalLink aria-hidden="true" size={14} />
        Open in external terminal
      </button>
    </div>
  );
}

type ArtifactTabContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onCopyLink: () => void;
  onOpen: () => void;
};

function ArtifactTabContextMenu({
  x,
  y,
  onClose,
  onCopyLink,
  onOpen,
}: ArtifactTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div
      aria-label="Artifact file actions"
      className="task-context-menu artifact-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: x, top: y }}
      tabIndex={-1}
    >
      <button onClick={run(onCopyLink)} role="menuitem" type="button">
        Copy Link
      </button>
      <button onClick={run(onOpen)} role="menuitem" type="button">
        Open
      </button>
    </div>
  );
}
