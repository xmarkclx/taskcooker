import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Play,
  Sparkles,
  Square,
  Zap,
  X,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { atom, useAtom } from 'jotai';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';

import type {
  AppSettingsSummary,
  AppSnapshot,
  ExecutionTerminalKind,
  ExecutionTerminalSummary,
  ProjectActionSummary,
  ProjectSummary,
  ResolvedAppTheme,
  TaskDescriptionPromptMode,
  TodoPriority,
  TodoState,
  TodoSummary,
} from '../../domain/domain';
import { PRIORITY_EMOJI, TODO_PRIORITIES, TODO_STATES, formatDuration } from '../../domain/domain';
import { openTaskWindow } from '../../tauri/windows';
import { AppButton } from '../../ui/Button';
import { DeferredMount, useActivatedOnce } from '../../ui/DeferredMount';
import { AppSelect } from '../../ui/Select';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { useSlowdownRenderProbe } from '../performance/slowdownProfiler';
import { ProjectActionIcon } from '../projects/ProjectActionIcon';
import {
  summarizeTodoTime,
  type CustomTimeRangeUnit,
  type TimeLogEntry,
  type TimeRangeMode,
} from '../time/timeRange';
import { useLiveElapsedSeconds, useNow } from '../time/liveTime';
import { copyText } from '../workspace/workspaceHelpers';
import { ExecutionPanel } from './ExecutionPanel';
import { TaskContextDropdown, TaskStateDropdown } from './TaskHeaderDropdowns';
import { TaskTimerButton } from './TaskTimerButton';

const MIN_DESCRIPTION_PANEL_WIDTH = 320;
const MAX_DESCRIPTION_PANEL_WIDTH = 760;
const DESCRIPTION_PANEL_KEYBOARD_STEP = 20;
const TASK_HEADER_ACTION_CLASS = 'task-header-action-button';
const DEFAULT_DEADLINE_TIME = '12:00';
type DescriptionPanelTab = 'description' | 'journal';
const descriptionPanelTabByTodoAtom = atom<Record<number, DescriptionPanelTab>>({});
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DEADLINE_MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});
const DEADLINE_TRIGGER_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  year: 'numeric',
});
const DEADLINE_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
type ProjectActionArgumentValues = Record<string, string | boolean>;

export type TaskDetailProps = {
  appSettings: AppSettingsSummary;
  executionTerminals: ExecutionTerminalSummary[];
  project?: ProjectSummary;
  projectActions: ProjectActionSummary[];
  isTimerRunning: boolean;
  resolvedTheme?: ResolvedAppTheme;
  snapshot: AppSnapshot;
  todo: TodoSummary;
  onAcceptDone: () => void;
  onAddDependency: (dependsOnTodoId: number) => void;
  onAddManualTimeLog: (durationSeconds: number) => void;
  onArchive: () => void;
  onBackToList: () => void;
  onContextProjectChange: (contextProjectId: number | null) => void;
  onCreateSubtask: () => void;
  onDeadlineChange: (deadline: string | null) => void;
  onDelete: () => void;
  onDeleteTimeLog: (timeLogId: number) => void;
  onCloseExecutionTerminal: (ptyId: number) => Promise<void>;
  onOpenExternalTerminal: (ptyId: number) => Promise<void>;
  onRenameExecutionTerminal: (ptyId: number, label: string) => Promise<void>;
  onCopyArtifactLink: () => void;
  onOpenImage?: (src: string) => void;
  onOpenArtifact: () => void;
  onOpenWorktreeFolder: () => Promise<void>;
  onOpenWorktreeDiff: () => Promise<void | ExecutionTerminalSummary>;
  onProjectPromptSettingsChange: (settings: {
    aiDefaultIncludeProjectNotes: boolean;
    aiTaskDescriptionMode: TaskDescriptionPromptMode;
  }) => void;
  onSaveArtifact: (todoId: number, artifactMarkdown: string) => void;
  onPriorityChange: (priority: TodoPriority) => void;
  onRemoveDependency: (dependsOnTodoId: number) => void;
  onRequestChanges: () => void;
  onSetParent: (parentId: number | null) => void;
  onRunTaskAction: (
    action: ProjectActionSummary,
    values?: ProjectActionArgumentValues,
  ) => Promise<void | ExecutionTerminalSummary>;
  onRunWorktreeAction: (
    action: ProjectActionSummary,
    values?: ProjectActionArgumentValues,
  ) => Promise<void | ExecutionTerminalSummary>;
  onCopyPrompt: () => void;
  onStarredChange: (starred: boolean) => void;
  onDescriptionTocHiddenChange: (hidden: boolean) => void;
  onDescriptionTocWidthChange: (width: number) => void;
  onArtifactTocHiddenChange: (hidden: boolean) => void;
  onArtifactTocWidthChange: (width: number) => void;
  onTaskDetailDescriptionWidthChange: (width: number) => void;
  onTodoPanelVisibilityChange: (visibility: {
    descriptionPanelHidden: boolean;
    executionPanelHidden: boolean;
  }) => void;
  onSaveDescription: (todoId: number, descriptionMarkdown: string) => void;
  onSaveJournal: (todoId: number, journalMarkdown: string) => void;
  onSelectTodo: (todoId: number) => void;
  onStartExecutionTerminal: (
    kind: ExecutionTerminalKind,
    options?: { resumeSessionId?: string },
  ) => Promise<ExecutionTerminalSummary>;
  onSuggestWorktreeName: () => Promise<{ name: string }>;
  onEnableWorktree: (worktreeName: string) => Promise<void>;
  onGenerateTitle: () => void;
  titleGenerationPending: boolean;
  onCommitAndMergeWorktree: () => Promise<ExecutionTerminalSummary>;
  onDeleteWorktree: () => Promise<void>;
  onStartTimer: () => void;
  onStateChange: (state: TodoState) => void;
  onStopTimer: () => void;
  onTagsChange: (tags: string[]) => void;
  onTaskDetailsRailHiddenChange: (hidden: boolean) => void;
  onTitleChange: (title: string) => void;
  onUpdateTimeLogDuration: (timeLogId: number, durationSeconds: number) => void;
};

// Memoized so parent state churn (search typing, dialogs, timers) skips the
// whole detail pane; its callback props stay stable via useStableCallbackProps.
export const TaskDetail = memo(function TaskDetail({
  appSettings,
  executionTerminals,
  project,
  projectActions,
  isTimerRunning,
  resolvedTheme,
  snapshot,
  todo,
  onAcceptDone,
  onAddDependency,
  onAddManualTimeLog,
  onArchive,
  onBackToList,
  onContextProjectChange,
  onCreateSubtask,
  onDeadlineChange,
  onDelete,
  onDeleteTimeLog,
  onCloseExecutionTerminal,
  onOpenExternalTerminal,
  onRenameExecutionTerminal,
  onCopyArtifactLink,
  onOpenImage,
  onOpenArtifact,
  onOpenWorktreeFolder,
  onOpenWorktreeDiff,
  onProjectPromptSettingsChange,
  onPriorityChange,
  onRemoveDependency,
  onRequestChanges,
  onSetParent,
  onRunTaskAction,
  onRunWorktreeAction,
  onSaveArtifact,
  onSaveDescription,
  onSaveJournal,
  onCopyPrompt,
  onStarredChange,
  onDescriptionTocHiddenChange,
  onDescriptionTocWidthChange,
  onArtifactTocHiddenChange,
  onArtifactTocWidthChange,
  onTaskDetailDescriptionWidthChange,
  onTodoPanelVisibilityChange,
  onSelectTodo,
  onStartExecutionTerminal,
  onSuggestWorktreeName,
  onEnableWorktree,
  onGenerateTitle,
  titleGenerationPending,
  onCommitAndMergeWorktree,
  onDeleteWorktree,
  onStartTimer,
  onStateChange,
  onStopTimer,
  onTagsChange,
  onTaskDetailsRailHiddenChange,
  onTitleChange,
  onUpdateTimeLogDuration,
}: TaskDetailProps) {
  useSlowdownRenderProbe('task-detail', todo.displayId);
  const [tagDraft, setTagDraft] = useState('');
  const [subtasksOpen, setSubtasksOpen] = useState(true);
  const [manualMinutes, setManualMinutes] = useState('');
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const [timeRangeMode, setTimeRangeMode] = useState<TimeRangeMode>(
    readRememberedTimeRangeMode,
  );
  const [customRangeAmount, setCustomRangeAmount] = useState('24');
  const [customRangeUnit, setCustomRangeUnit] = useState<CustomTimeRangeUnit>('hours');
  const [customRangeStart, setCustomRangeStart] = useState('');
  const [customRangeEnd, setCustomRangeEnd] = useState('');
  const [taskActionsMenuOpen, setTaskActionsMenuOpen] = useState(false);
  const openFolderAction = projectActions.find(
    (action) => action.fileName === 'boomerang:open-folder',
  );
  const taskActionsMenuRef = useRef<HTMLSpanElement>(null);
  const [descriptionDragState, setDescriptionDragState] = useState<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const [descriptionDragWidth, setDescriptionDragWidth] = useState<number | null>(null);
  const onDescriptionWidthChangeRef = useRef(onTaskDetailDescriptionWidthChange);
  const committedDescriptionWidth = clampDescriptionPanelWidth(
    appSettings.taskDetailDescriptionWidth,
  );
  const visibleDescriptionWidth = descriptionDragWidth ?? committedDescriptionWidth;
  useEffect(() => {
    setTitleDraft(todo.title);
  }, [todo.id, todo.title]);
  useEffect(() => {
    setSubtasksOpen(true);
  }, [todo.id]);
  useEffect(() => {
    rememberTimeRangeMode(timeRangeMode);
  }, [timeRangeMode]);
  useEffect(() => {
    onDescriptionWidthChangeRef.current = onTaskDetailDescriptionWidthChange;
  }, [onTaskDetailDescriptionWidthChange]);
  useEffect(() => {
    if (!taskActionsMenuOpen) {
      return undefined;
    }

    const closeMenu = () => setTaskActionsMenuOpen(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && taskActionsMenuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [taskActionsMenuOpen]);
  useEffect(() => {
    if (!descriptionDragState) {
      setDescriptionDragWidth(null);
      return;
    }

    const resize = (clientX: number) =>
      clampDescriptionPanelWidth(
        descriptionDragState.startWidth + clientX - descriptionDragState.startX,
      );

    const handlePointerMove = (event: PointerEvent) => {
      setDescriptionDragWidth(resize(event.clientX));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const nextWidth = resize(event.clientX);
      setDescriptionDragWidth(nextWidth);
      setDescriptionDragState(null);
      onDescriptionWidthChangeRef.current(nextWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [descriptionDragState]);
  const doneSubtasks = todo.subtasks.filter((subtask) => subtask.done).length;
  const taskDetailsRailHidden = appSettings.taskDetailsRailHidden;
  const descriptionPanelHidden = todo.descriptionPanelHidden === true;
  const executionPanelHidden = todo.executionPanelHidden === true;
  const dependencyIds = new Set(todo.dependencies.map((dependency) => dependency.id));
  const dependencyOptions = snapshot.todos.filter(
    (item) =>
      item.projectId === todo.projectId &&
      item.id !== todo.id &&
      !dependencyIds.has(item.id) &&
      item.state !== 'Archived',
  );
  const descendantIds = collectDescendantTodoIds(todo, snapshot.todos);
  const parentOptions = snapshot.todos.filter(
    (item) =>
      item.projectId === todo.projectId &&
      item.id !== todo.id &&
      !descendantIds.has(item.id) &&
      item.state !== 'Archived',
  );
  const now = useNow(1_000);
  const runningLog = isTimerRunning
    ? todo.timeLogs.find((log) => log.running)
    : undefined;
  const liveRunningLogSeconds = useLiveElapsedSeconds(
    runningLog?.durationSeconds ?? 0,
    runningLog?.id ?? null,
  );
  const timeSummary = summarizeTodoTime(
    todo,
    snapshot.todos,
    {
      amount: Number(customRangeAmount),
      endLocal: customRangeEnd,
      mode: timeRangeMode,
      startLocal: customRangeStart,
      unit: customRangeUnit,
    },
    now,
  );
  const runningLogDeltaSeconds = runningLog
    ? Math.max(0, liveRunningLogSeconds - runningLog.durationSeconds)
    : 0;
  const visibleRunningLogDeltaSeconds =
    timeRangeMode === 'overall' ||
    Boolean(runningLog && timeSummary.visibleLogs.some((log) => log.id === runningLog.id))
      ? runningLogDeltaSeconds
      : 0;
  const headerBackgroundStyle = projectBackgroundImageStyle(project?.backgroundImagePath);

  return (
    <section aria-label={`Task detail ${todo.displayId}`} className="detail-pane">
      <header className={`detail-header ${headerBackgroundStyle ? 'has-background' : ''}`}>
        {headerBackgroundStyle ? (
          <div aria-hidden="true" className="detail-header-background" style={headerBackgroundStyle} />
        ) : null}
        <button className="mobile-back-button" onClick={onBackToList} type="button">
          <ArrowLeft size={15} />
          Back to task list
        </button>
        <div className="detail-id-row">
          <button
            aria-label={`Copy todo ID ${todo.displayId}`}
            className="copy-id"
            onClick={() => void copyText(todo.displayId)}
            title={`Copy ${todo.displayId}`}
            type="button"
          >
            {todo.displayId}
            <Copy size={13} />
          </button>
          <TaskStateDropdown
            ageLabel={todo.stateAgeLabel}
            onRequestChanges={onRequestChanges}
            onSelectState={(state) => {
              if (state === 'Done') {
                onAcceptDone();
              } else if (state === 'Archived') {
                onArchive();
              } else {
                onStateChange(state);
              }
            }}
            stale={todo.stale}
            state={todo.state}
          />
          <TaskContextDropdown
            onSelectContextProject={onContextProjectChange}
            projects={snapshot.projects}
            todo={todo}
          />
          <span className="detail-actions">
            <TaskTimerButton
              displayId={todo.displayId}
              isRunning={isTimerRunning}
              location="header"
              onStart={onStartTimer}
              onStop={onStopTimer}
            />
            <AppButton
              aria-label={todo.starred ? 'Unstar task' : 'Star task'}
              aria-pressed={todo.starred === true}
              className={`${TASK_HEADER_ACTION_CLASS} ${todo.starred ? 'starred' : ''}`}
              onClick={() => onStarredChange(todo.starred !== true)}
              title={todo.starred ? 'Unstar task' : 'Star task'}
              variant="icon"
            >
              {todo.starred ? 'Unstar' : 'Star'}
            </AppButton>
            <AppButton
              aria-label="Delete task"
              className={TASK_HEADER_ACTION_CLASS}
              onClick={onDelete}
              title="Delete"
              variant="icon"
            >
              Delete
            </AppButton>
            {project ? (
              <AppButton
                aria-label={`Open ${todo.displayId} in new window`}
                className={TASK_HEADER_ACTION_CLASS}
                onClick={() => void openTaskWindow(project, todo)}
                title={`Open ${todo.displayId} in new window`}
                variant="icon"
              >
                Open
              </AppButton>
            ) : null}
            <AppButton
              aria-label={
                descriptionPanelHidden ? 'Show description panel' : 'Hide description panel'
              }
              aria-pressed={!descriptionPanelHidden}
              className={TASK_HEADER_ACTION_CLASS}
              title={
                descriptionPanelHidden ? 'Show description panel' : 'Hide description panel'
              }
              onClick={() =>
                onTodoPanelVisibilityChange({
                  descriptionPanelHidden: !descriptionPanelHidden,
                  executionPanelHidden,
                })
              }
              variant="icon"
            >
              Description
            </AppButton>
            <AppButton
              aria-label={executionPanelHidden ? 'Show terminal panel' : 'Hide terminal panel'}
              aria-pressed={!executionPanelHidden}
              className={TASK_HEADER_ACTION_CLASS}
              title={executionPanelHidden ? 'Show terminal panel' : 'Hide terminal panel'}
              onClick={() =>
                onTodoPanelVisibilityChange({
                  descriptionPanelHidden,
                  executionPanelHidden: !executionPanelHidden,
                })
              }
              variant="icon"
            >
              Terminal
            </AppButton>
            <AppButton
              aria-label={
                taskDetailsRailHidden ? 'Show details sidebar' : 'Hide details sidebar'
              }
              className={TASK_HEADER_ACTION_CLASS}
              title={taskDetailsRailHidden ? 'Show details sidebar' : 'Hide details sidebar'}
              onClick={() => onTaskDetailsRailHiddenChange(!taskDetailsRailHidden)}
              variant="icon"
            >
              Details
            </AppButton>
          </span>
        </div>
        <h1 aria-label={todo.title} className="detail-title-heading">
          <input
            aria-label="Selected task title"
            className="task-title-input"
            onBlur={() => {
              const nextTitle = titleDraft.trim();
              if (nextTitle && nextTitle !== todo.title) {
                onTitleChange(nextTitle);
              } else {
                setTitleDraft(todo.title);
              }
            }}
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            value={titleDraft}
          />
          <AppButton
            aria-label={
              titleGenerationPending ? 'Generating title…' : 'Autotitle from description'
            }
            className="autotitle-button"
            disabled={titleGenerationPending}
            onClick={onGenerateTitle}
            title={
              titleGenerationPending ? 'Generating title…' : 'Autotitle from description'
            }
            variant="icon"
          >
            <Sparkles
              className={titleGenerationPending ? 'autotitle-icon-spinning' : undefined}
              size={16}
            />
          </AppButton>
          <span className="task-title-actions-menu-wrap" ref={taskActionsMenuRef}>
            <AppButton
              aria-expanded={taskActionsMenuOpen}
              aria-haspopup="menu"
              aria-label="Task actions"
              className="autotitle-button task-project-actions-button"
              disabled={projectActions.length === 0}
              onClick={() => setTaskActionsMenuOpen((open) => !open)}
              title="Task actions"
              variant="icon"
            >
              <Zap size={16} />
            </AppButton>
            {taskActionsMenuOpen ? (
              <span aria-label="Task project actions" className="task-project-actions-menu" role="menu">
                <span className="task-project-actions-menu-count">
                  {projectActions.length} {projectActions.length === 1 ? 'action' : 'actions'}
                </span>
                {projectActions.map((action) => (
                  <button
                    aria-label={`Run ${action.title}`}
                    className="task-project-actions-menu-row"
                    disabled={Boolean(action.validationError)}
                    key={action.fileName}
                    onClick={() => {
                      void onRunTaskAction(action);
                      setTaskActionsMenuOpen(false);
                    }}
                    role="menuitem"
                    title={action.validationError ?? `Run ${action.title}`}
                    type="button"
                  >
                    <ProjectActionIcon
                      action={action}
                      className="task-project-actions-menu-icon"
                      size={16}
                    />
                    <span className="task-project-actions-menu-copy">
                      <strong>{action.title}</strong>
                      <small>
                        {action.validationError ??
                          (action.runtime === 'native'
                            ? `${action.runtime} · ${action.arguments.length} args`
                            : `${action.runtime} · ${action.arguments.length} args · ${action.fileName}`)}
                      </small>
                    </span>
                  </button>
                ))}
              </span>
            ) : null}
          </span>
        </h1>
      </header>

      <div
        className={`detail-content ${
          taskDetailsRailHidden ? 'details-rail-hidden' : ''
        }`}
      >
        <div className="detail-main">
          <div
            className={`detail-workspace ${descriptionDragState ? 'resizing' : ''} ${
              descriptionPanelHidden ? 'description-panel-hidden' : ''
            } ${executionPanelHidden ? 'execution-panel-hidden' : ''}`}
            style={
              {
                '--description-panel-width': `${visibleDescriptionWidth}px`,
              } as CSSProperties
            }
          >
            {descriptionPanelHidden ? null : (
              <DescriptionPanel
                appSettings={appSettings}
                key={todo.id}
                onTocHiddenChange={onDescriptionTocHiddenChange}
                onTocWidthChange={onDescriptionTocWidthChange}
                onOpenImage={onOpenImage}
                project={project}
                tocHidden={todo.descriptionTocHidden ?? true}
                tocWidth={appSettings.markdownDescriptionTocWidth}
                todo={todo}
                onSave={onSaveDescription}
                onSaveJournal={onSaveJournal}
              />
            )}
            {descriptionPanelHidden || executionPanelHidden ? null : (
              <div
                aria-label="Resize description and terminal split"
                aria-orientation="vertical"
                aria-valuemax={MAX_DESCRIPTION_PANEL_WIDTH}
                aria-valuemin={MIN_DESCRIPTION_PANEL_WIDTH}
                aria-valuenow={visibleDescriptionWidth}
                className="detail-workspace-resize-handle"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                    return;
                  }

                  event.preventDefault();
                  const delta =
                    (event.key === 'ArrowRight' ? 1 : -1) *
                    (event.shiftKey
                      ? DESCRIPTION_PANEL_KEYBOARD_STEP * 2
                      : DESCRIPTION_PANEL_KEYBOARD_STEP);
                  onTaskDetailDescriptionWidthChange(
                    clampDescriptionPanelWidth(committedDescriptionWidth + delta),
                  );
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  setDescriptionDragWidth(committedDescriptionWidth);
                  setDescriptionDragState({
                    startWidth: committedDescriptionWidth,
                    startX: event.clientX,
                  });
                }}
                role="separator"
                tabIndex={0}
              />
            )}
            {executionPanelHidden ? null : (
              <ExecutionPanel
                attachmentTarget={project ? { projectId: project.id, todoId: todo.id } : undefined}
                artifact={{
                  markdown: todo.artifactMarkdown,
                  markdownPath: todo.artifactMarkdownPath,
                }}
                canStart={Boolean(project)}
                executionTerminals={executionTerminals}
                onCloseExecutionTerminal={onCloseExecutionTerminal}
                onOpenExternalTerminal={onOpenExternalTerminal}
                terminalTmuxEnabled={appSettings.terminalTmuxEnabled}
                onRenameExecutionTerminal={onRenameExecutionTerminal}
                onCopyArtifactLink={onCopyArtifactLink}
                onOpenImage={onOpenImage}
                onOpenArtifact={onOpenArtifact}
                onOpenWorktreeDiff={onOpenWorktreeDiff}
                promptSettings={
                  project
                    ? {
                        aiDefaultIncludeProjectNotes: project.aiDefaultIncludeProjectNotes,
                        aiTaskDescriptionMode: project.aiTaskDescriptionMode,
                      }
                    : undefined
                }
                onCopyPrompt={onCopyPrompt}
                onOpenFolder={() => {
                  if (openFolderAction) {
                    void onRunTaskAction(openFolderAction);
                  }
                }}
                openFolderDisabled={Boolean(openFolderAction?.validationError)}
                onPromptSettingsChange={onProjectPromptSettingsChange}
                onArtifactTocHiddenChange={onArtifactTocHiddenChange}
                onArtifactTocWidthChange={onArtifactTocWidthChange}
                onSaveArtifact={onSaveArtifact}
                onStartExecutionTerminal={onStartExecutionTerminal}
                ompSessionId={todo.ompSessionId}
                codexSessionId={todo.codexSessionId}
                claudeSessionId={todo.claudeSessionId}
                onSuggestWorktreeName={onSuggestWorktreeName}
                onEnableWorktree={onEnableWorktree}
                onCommitAndMergeWorktree={onCommitAndMergeWorktree}
                onDeleteWorktree={onDeleteWorktree}
                artifactTocHidden={todo.artifactTocHidden ?? true}
                artifactTocWidth={appSettings.markdownArtifactTocWidth}
                markdownEditorFontFamily={appSettings.markdownEditorFontFamily}
                markdownEditorFontSize={appSettings.markdownEditorFontSize}
                markdownEditorMaxImageHeight={appSettings.markdownEditorMaxImageHeight}
                theme={resolvedTheme ?? (appSettings.theme === 'dark' ? 'dark' : 'light')}
                todoId={todo.id}
                worktree={{
                  mainBranch: project?.mainBranch ?? 'main',
                  name: todo.worktreeName,
                  path: todo.worktreePath,
                }}
              />
            )}
          </div>
        </div>

        {taskDetailsRailHidden ? null : (
          <aside className="meta-rail">
            <MetaSelect
              label="State"
              dot="green"
              options={TODO_STATES}
              value={todo.state}
              onChange={onStateChange}
            />
            <div className="meta-section">
              <span className="meta-label">Tags</span>
              <div className="tag-list">
                {todo.tags.map((tag) => (
                  <button
                    aria-label={`Remove tag ${tag}`}
                    key={tag}
                    onClick={() => onTagsChange(todo.tags.filter((item) => item !== tag))}
                    type="button"
                  >
                    {tag}
                    <X size={11} />
                  </button>
                ))}
              </div>
              <form
                className="tag-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  const tag = tagDraft.trim();
                  if (!tag) {
                    return;
                  }

                  onTagsChange([...todo.tags, tag]);
                  setTagDraft('');
                }}
              >
                <input
                  aria-label="Add tag"
                  onChange={(event) => setTagDraft(event.target.value)}
                  placeholder="Add tag"
                  value={tagDraft}
                />
                <button disabled={!tagDraft.trim()} type="submit">
                  +
                </button>
              </form>
            </div>
            <PriorityMetaSelect value={todo.priority} onChange={onPriorityChange} />
            <div className="meta-section">
              <span className="meta-label">Parent</span>
              <label className="select-add-control">
                <AppSelect
                  aria-label="Set parent"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    onSetParent(value > 0 ? value : null);
                  }}
                  options={[
                    { label: 'No parent', value: '' },
                    ...parentOptions.map((item) => ({
                      label: `${item.displayId} ${item.title}`,
                      value: String(item.id),
                    })),
                  ]}
                  value={todo.parentId ? String(todo.parentId) : ''}
                />
                <ChevronDown size={13} />
              </label>
            </div>
            <div className="meta-section">
              <div className="meta-header-row">
                <span className="meta-label">Subtasks</span>
                <button
                  aria-controls={`subtasks-panel-${todo.id}`}
                  aria-expanded={subtasksOpen}
                  className="meta-toggle-button"
                  onClick={() => setSubtasksOpen((open) => !open)}
                  type="button"
                >
                  {subtasksOpen ? 'Collapse subtasks' : 'Expand subtasks'}
                </button>
              </div>
              <div className="progress-row">
                <div>
                  <span
                    style={{
                      width: `${
                        todo.subtasks.length ? (doneSubtasks / todo.subtasks.length) * 100 : 0
                      }%`,
                    }}
                  />
                </div>
                <span>
                  {doneSubtasks} / {todo.subtasks.length}
                </span>
              </div>
              {subtasksOpen ? (
                <div id={`subtasks-panel-${todo.id}`}>
                  <div className="subtask-list">
                    {todo.subtasks.map((subtask) => (
                      <button
                        className={subtask.done ? 'done' : ''}
                        key={subtask.displayId}
                        onClick={() => onSelectTodo(subtask.id)}
                        type="button"
                      >
                        <span>{subtask.done ? <Check size={11} /> : null}</span>
                        <p>{subtask.title}</p>
                        <code>{subtask.displayId}</code>
                      </button>
                    ))}
                  </div>
                  <button className="dashed-control" onClick={onCreateSubtask} type="button">
                    Add subtask
                  </button>
                </div>
              ) : null}
            </div>
            <div className="meta-section">
              <span className="meta-label">Deadline</span>
              <DeadlinePicker deadline={todo.deadline} onChange={onDeadlineChange} />
            </div>
            <div className="meta-section">
              <div className="meta-header-row">
                <div aria-label="Time range" className="segment" role="group">
                  <button
                    className={timeRangeMode === 'today' ? 'active' : ''}
                    onClick={() => setTimeRangeMode('today')}
                    type="button"
                  >
                    Today
                  </button>
                  <button
                    className={timeRangeMode === 'overall' ? 'active' : ''}
                    onClick={() => setTimeRangeMode('overall')}
                    type="button"
                  >
                    Overall
                  </button>
                  <button
                    className={timeRangeMode === 'custom' ? 'active' : ''}
                    onClick={() => setTimeRangeMode('custom')}
                    type="button"
                  >
                    Custom
                  </button>
                </div>
              </div>
              {timeRangeMode === 'custom' ? (
                <div className="custom-time-range">
                  <label>
                    <span>Last</span>
                    <input
                      aria-label="Custom time range amount"
                      min="1"
                      onChange={(event) => setCustomRangeAmount(event.target.value)}
                      type="number"
                      value={customRangeAmount}
                    />
                  </label>
                  <label>
                    <span>Unit</span>
                    <AppSelect
                      aria-label="Custom time range unit"
                      onChange={(event) =>
                        setCustomRangeUnit(event.target.value as CustomTimeRangeUnit)
                      }
                      options={[
                        { label: 'Hours', value: 'hours' },
                        { label: 'Days', value: 'days' },
                      ]}
                      value={customRangeUnit}
                    />
                  </label>
                  <label>
                    <span>Start</span>
                    <input
                      aria-label="Custom time range start"
                      onChange={(event) => setCustomRangeStart(event.target.value)}
                      type="datetime-local"
                      value={customRangeStart}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      aria-label="Custom time range end"
                      onChange={(event) => setCustomRangeEnd(event.target.value)}
                      type="datetime-local"
                      value={customRangeEnd}
                    />
                  </label>
                </div>
              ) : null}
              <div className="time-card">
                <div>
                  <strong>
                    {formatDuration(
                      timeSummary.ownTimeSeconds + visibleRunningLogDeltaSeconds,
                    )}
                  </strong>
                  <span>
                    {timeSummary.label} · rolled-up{' '}
                    {formatDuration(
                      timeSummary.rolledUpTimeSeconds + visibleRunningLogDeltaSeconds,
                    )}
                  </span>
                </div>
                {isTimerRunning ? (
                  <AppButton
                    onClick={onStopTimer}
                    aria-label={`Stop timer for ${todo.displayId}`}
                    variant="stop"
                  >
                    <Square size={15} />
                  </AppButton>
                ) : (
                  <AppButton
                    onClick={onStartTimer}
                    aria-label={`Start timer for ${todo.displayId}`}
                    variant="start"
                  >
                    <Play size={15} />
                  </AppButton>
                )}
              </div>
              <div className="time-log-list">
                {timeSummary.visibleLogEntries.length ? (
                  timeSummary.visibleLogEntries.map((entry) => (
                    <TimeLogRow
                      isEditable={entry.isOwnTodo}
                      key={`${entry.todoId}-${entry.log.id}`}
                      durationSecondsOverride={
                        runningLog?.id === entry.log.id && entry.isOwnTodo
                          ? liveRunningLogSeconds
                          : entry.isOwnTodo
                            ? undefined
                            : entry.visibleDurationSeconds
                      }
                      log={entry.log}
                      taskLabel={timeLogEntryTaskLabel(entry)}
                      onDelete={() => onDeleteTimeLog(entry.log.id)}
                      onSave={(durationSeconds) =>
                        onUpdateTimeLogDuration(entry.log.id, durationSeconds)
                      }
                    />
                  ))
                ) : (
                  <p className="empty-copy compact">No time logs in this range.</p>
                )}
              </div>
              <form
                className="inline-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const minutes = Number(manualMinutes);
                  if (!Number.isFinite(minutes) || minutes <= 0) {
                    return;
                  }

                  onAddManualTimeLog(Math.round(minutes * 60));
                  setManualMinutes('');
                }}
              >
                <input
                  aria-label="Manual time minutes"
                  min="1"
                  onChange={(event) => setManualMinutes(event.target.value)}
                  placeholder="Minutes"
                  type="number"
                  value={manualMinutes}
                />
                <button aria-label="Add manual time" disabled={!manualMinutes} type="submit">
                  Add
                </button>
              </form>
            </div>
            <div className="meta-section">
              <span className="meta-label">Dependencies</span>
              {todo.dependencies.length ? (
                todo.dependencies.map((dependency) => (
                  <div className="dependency-line editable" key={dependency.id}>
                    <button
                      onClick={() => onSelectTodo(dependency.id)}
                      title={`Open ${dependency.displayId}`}
                      type="button"
                    >
                      <span>{dependency.displayId}</span>
                      {dependency.title}
                    </button>
                    <button
                      aria-label={`Remove dependency ${dependency.displayId}`}
                      onClick={() => onRemoveDependency(dependency.id)}
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty-copy compact">No dependencies.</p>
              )}
              <label className="select-add-control">
                <AppSelect
                  aria-label="Add dependency"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (value > 0) {
                      onAddDependency(value);
                      event.currentTarget.value = '';
                    }
                  }}
                  options={[
                    { label: 'Add dependency...', value: '' },
                    ...dependencyOptions.map((item) => ({
                      label: `${item.displayId} ${item.title}`,
                      value: String(item.id),
                    })),
                  ]}
                  value=""
                />
                <ChevronDown size={13} />
              </label>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
});

function clampDescriptionPanelWidth(width: number) {
  return Math.min(
    MAX_DESCRIPTION_PANEL_WIDTH,
    Math.max(MIN_DESCRIPTION_PANEL_WIDTH, Math.round(width)),
  );
}

function projectBackgroundImageStyle(backgroundImagePath?: string): CSSProperties | undefined {
  const path = backgroundImagePath?.trim();
  if (!path) {
    return undefined;
  }

  try {
    return { backgroundImage: `url(${JSON.stringify(convertFileSrc(path))})` };
  } catch {
    return undefined;
  }
}

function DescriptionPanel({
  appSettings,
  onTocHiddenChange,
  onTocWidthChange,
  onOpenImage,
  project,
  tocHidden,
  tocWidth,
  todo,
  onSave,
  onSaveJournal,
}: {
  appSettings: AppSettingsSummary;
  onTocHiddenChange: (hidden: boolean) => void;
  onTocWidthChange: (width: number) => void;
  onOpenImage?: (src: string) => void;
  project?: ProjectSummary;
  tocHidden: boolean;
  tocWidth: number;
  todo: TodoSummary;
  onSave: (todoId: number, descriptionMarkdown: string) => void;
  onSaveJournal: (todoId: number, journalMarkdown: string) => void;
}) {
  const [activeTabByTodo, setActiveTabByTodo] = useAtom(descriptionPanelTabByTodoAtom);
  const activeTab = activeTabByTodo[todo.id] ?? 'description';
  const setActiveTab = (nextTab: DescriptionPanelTab) => {
    setActiveTabByTodo((current) =>
      current[todo.id] === nextTab ? current : { ...current, [todo.id]: nextTab },
    );
  };
  const isDescription = activeTab === 'description';
  // Mount each tab's editor on first activation only (and keep it mounted so
  // dirty buffers survive tab switches); defer the mount past first paint so
  // opening a task never blocks on Tiptap initialization.
  const descriptionActivated = useActivatedOnce(isDescription);
  const journalActivated = useActivatedOnce(!isDescription);
  const descriptionAttachmentTarget = project
    ? {
        projectId: project.id,
        scope: 'todo-description' as const,
        todoId: todo.id,
      }
    : undefined;

  return (
    <div className="description-panel description-panel-shell">
      <div aria-label="Description panel tabs" className="description-panel-tabs" role="tablist">
        <button
          aria-controls={`todo-${todo.id}-description-panel`}
          aria-selected={isDescription}
          className={isDescription ? 'active' : ''}
          id={`todo-${todo.id}-description-tab`}
          onClick={() => setActiveTab('description')}
          role="tab"
          type="button"
        >
          Description
        </button>
        <button
          aria-controls={`todo-${todo.id}-journal-panel`}
          aria-selected={!isDescription}
          className={!isDescription ? 'active' : ''}
          id={`todo-${todo.id}-journal-tab`}
          onClick={() => setActiveTab('journal')}
          role="tab"
          type="button"
        >
          Journal
        </button>
      </div>
      <div
        aria-labelledby={`todo-${todo.id}-description-tab`}
        className="description-panel-tab-content"
        hidden={!isDescription}
        id={`todo-${todo.id}-description-panel`}
        role="tabpanel"
      >
        {descriptionActivated ? (
          <DeferredMount>
            <MarkdownEditor
              ariaLabel="Description Markdown"
              attachmentTarget={descriptionAttachmentTarget}
              conflictLabel="Description changed outside this window."
              fontFamily={appSettings.markdownEditorFontFamily}
              fontSize={appSettings.markdownEditorFontSize}
              maxImageHeight={appSettings.markdownEditorMaxImageHeight}
              markdown={todo.descriptionMarkdown}
              onOpenImage={onOpenImage}
              onSave={(descriptionMarkdown) => onSave(todo.id, descriptionMarkdown)}
              scrollKey={`todo:${todo.id}:description`}
              tocHidden={tocHidden}
              tocWidth={tocWidth}
              onTocHiddenChange={onTocHiddenChange}
              onTocWidthChange={onTocWidthChange}
            />
          </DeferredMount>
        ) : null}
      </div>
      <div
        aria-labelledby={`todo-${todo.id}-journal-tab`}
        className="description-panel-tab-content"
        hidden={isDescription}
        id={`todo-${todo.id}-journal-panel`}
        role="tabpanel"
      >
        {journalActivated ? (
          <DeferredMount>
            <MarkdownEditor
              ariaLabel="Journal Markdown"
              attachmentTarget={descriptionAttachmentTarget}
              conflictLabel="Journal changed outside this window."
              fontFamily={appSettings.markdownEditorFontFamily}
              fontSize={appSettings.markdownEditorFontSize}
              maxImageHeight={appSettings.markdownEditorMaxImageHeight}
              markdown={todo.journalMarkdown ?? ''}
              onOpenImage={onOpenImage}
              onSave={(journalMarkdown) => onSaveJournal(todo.id, journalMarkdown)}
              scrollKey={`todo:${todo.id}:journal`}
              tocHidden={tocHidden}
              tocWidth={tocWidth}
              onTocHiddenChange={onTocHiddenChange}
              onTocWidthChange={onTocWidthChange}
            />
          </DeferredMount>
        ) : null}
      </div>
    </div>
  );
}

function DeadlinePicker({
  deadline,
  onChange,
}: {
  deadline: string | null;
  onChange: (deadline: string | null) => void;
}) {
  const selectedDate = deadlineToDate(deadline);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selectedDate ?? new Date()),
  );
  const triggerLabel = selectedDate
    ? DEADLINE_TRIGGER_FORMATTER.format(selectedDate)
    : 'No deadline';

  useEffect(() => {
    if (open) {
      setVisibleMonth(startOfMonth(selectedDate ?? new Date()));
    }
  }, [deadline, open]);

  const days = calendarDaysForMonth(visibleMonth);
  const monthLabel = DEADLINE_MONTH_FORMATTER.format(visibleMonth);

  return (
    <div aria-label="Deadline" className="deadline-picker">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Deadline: ${triggerLabel}`}
        className={`deadline-editor deadline-trigger ${selectedDate ? '' : 'empty'}`}
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        type="button"
      >
        <Calendar size={14} />
        <span>{triggerLabel}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div aria-label="Choose deadline" className="deadline-popover" role="dialog">
          <div className="deadline-calendar-header">
            <button
              aria-label="Previous deadline month"
              className="deadline-nav-button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
              type="button"
            >
              <ChevronLeft size={14} />
            </button>
            <strong>{monthLabel}</strong>
            <button
              aria-label="Next deadline month"
              className="deadline-nav-button"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
              type="button"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div aria-hidden="true" className="deadline-weekdays">
            {WEEKDAY_LABELS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div aria-label={monthLabel} className="deadline-calendar-grid">
            {days.map((day) => {
              const outsideMonth = day.getMonth() !== visibleMonth.getMonth();
              const selected = selectedDate ? isSameLocalDate(day, selectedDate) : false;
              return (
                <button
                  aria-label={DEADLINE_DAY_FORMATTER.format(day)}
                  aria-pressed={selected}
                  className={`deadline-day ${outsideMonth ? 'outside' : ''} ${
                    selected ? 'selected' : ''
                  }`}
                  key={day.toISOString()}
                  onClick={() => onChange(dateWithDeadlineTime(day, selectedDate).toISOString())}
                  type="button"
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <label className="deadline-time-row">
            <span>Time</span>
            <input
              aria-label="Deadline time"
              className="deadline-time-input"
              disabled={!selectedDate}
              onChange={(event) =>
                selectedDate
                  ? onChange(dateWithTimeInput(selectedDate, event.target.value).toISOString())
                  : undefined
              }
              type="time"
              value={selectedDate ? timeInputValue(selectedDate) : DEFAULT_DEADLINE_TIME}
            />
          </label>
          {selectedDate ? (
            <button
              className="deadline-clear-button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              type="button"
            >
              Clear deadline
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TimeLogRow({
  durationSecondsOverride,
  isEditable,
  log,
  onDelete,
  onSave,
  taskLabel,
}: {
  durationSecondsOverride?: number;
  isEditable: boolean;
  log: TodoSummary['timeLogs'][number];
  onDelete: () => void;
  onSave: (durationSeconds: number) => void;
  taskLabel: string;
}) {
  const [minutes, setMinutes] = useState(() =>
    Math.max(1, Math.round(log.durationSeconds / 60)).toString(),
  );
  const minutesValue = Number(minutes);
  const canSave =
    !log.running &&
    Number.isFinite(minutesValue) &&
    minutesValue > 0 &&
    Math.round(minutesValue * 60) !== log.durationSeconds;

  return (
    <div className={`time-log-row ${isEditable ? '' : 'read-only'}`}>
      <div>
        <strong>{formatDuration(durationSecondsOverride ?? log.durationSeconds)}</strong>
        <span className="time-log-task">{taskLabel}</span>
        <span>
          {log.source}
          {log.running ? ' · running' : ''}
        </span>
      </div>
      {isEditable ? (
        <>
          <input
            aria-label={`Duration minutes for log ${log.id}`}
            disabled={log.running}
            min="1"
            onChange={(event) => setMinutes(event.target.value)}
            type="number"
            value={minutes}
          />
          <button
            aria-label={`Save time log ${log.id}`}
            disabled={!canSave}
            onClick={() => onSave(Math.round(minutesValue * 60))}
            title={`Save time log ${log.id}`}
            type="button"
          >
            <Check size={12} />
          </button>
          <button
            aria-label={`Delete time log ${log.id}`}
            disabled={log.running}
            onClick={onDelete}
            type="button"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <span className="time-log-read-only">Rolled up</span>
      )}
    </div>
  );
}

function timeLogEntryTaskLabel(entry: TimeLogEntry): string {
  return `${entry.todoDisplayId} · ${entry.todoTitle}`;
}

function PriorityMetaSelect({
  onChange,
  value,
}: {
  onChange: (value: TodoPriority) => void;
  value: TodoPriority;
}) {
  return (
    <label className="meta-section">
      <span className="meta-label">Priority</span>
      <span className="meta-select">
        <select
          aria-label="Priority"
          className={`priority-select-${value.toLowerCase()}`}
          onChange={(event) => onChange(event.target.value as TodoPriority)}
          value={value}
        >
          {TODO_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {`${PRIORITY_EMOJI[priority]} ${priority}`}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </span>
    </label>
  );
}

function MetaSelect<TValue extends string>({
  label,
  dot,
  onChange,
  options,
  value,
}: {
  label: string;
  dot: 'green' | 'amber';
  onChange: (value: TValue) => void;
  options: readonly TValue[];
  value: TValue;
}) {
  return (
    <label className="meta-section">
      <span className="meta-label">{label}</span>
      <span className="meta-select">
        <span className={`select-dot ${dot}`} />
        <select
          aria-label={label}
          onChange={(event) => onChange(event.target.value as TValue)}
          value={value}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </span>
    </label>
  );
}

function collectDescendantTodoIds(todo: TodoSummary, todos: TodoSummary[]): Set<number> {
  const byId = new Map(todos.map((item) => [item.id, item]));
  const descendants = new Set<number>();
  const visit = (todoId: number) => {
    const current = byId.get(todoId);
    if (!current) {
      return;
    }

    const childIds = new Set<number>();
    for (const subtask of current.subtasks) {
      childIds.add(subtask.id);
    }
    for (const item of todos) {
      if ((item.parentId ?? null) === todoId) {
        childIds.add(item.id);
      }
    }

    for (const childId of childIds) {
      if (descendants.has(childId)) {
        continue;
      }
      descendants.add(childId);
      visit(childId);
    }
  };

  visit(todo.id);
  return descendants;
}

const TIME_RANGE_MODE_STORAGE_KEY = 'boomerang.timeRange.mode';

function readRememberedTimeRangeMode(): TimeRangeMode {
  try {
    const value = window.localStorage.getItem(TIME_RANGE_MODE_STORAGE_KEY);
    return value === 'today' || value === 'custom' || value === 'overall'
      ? value
      : 'overall';
  } catch {
    return 'overall';
  }
}

function rememberTimeRangeMode(mode: TimeRangeMode): void {
  try {
    window.localStorage.setItem(TIME_RANGE_MODE_STORAGE_KEY, mode);
  } catch {
    // Per-view preference only; storage failures should not affect task editing.
  }
}

function deadlineToDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function calendarDaysForMonth(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateWithDeadlineTime(day: Date, selectedDate: Date | null): Date {
  const [hours, minutes] = selectedDate
    ? [selectedDate.getHours(), selectedDate.getMinutes()]
    : parseDeadlineTime(DEFAULT_DEADLINE_TIME);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
}

function dateWithTimeInput(date: Date, value: string): Date {
  const [hours, minutes] = parseDeadlineTime(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
}

function parseDeadlineTime(value: string): [number, number] {
  const [hours, minutes] = value.split(':').map(Number);
  if (
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  ) {
    return [hours, minutes];
  }

  return [12, 0];
}

function timeInputValue(date: Date): string {
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

function padTimePart(value: number): string {
  return value.toString().padStart(2, '0');
}
