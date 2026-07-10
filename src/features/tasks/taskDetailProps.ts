import type { QueryClient } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';

import type {
  AgentSessionSummary,
  AppSettingsSummary,
  AppSnapshot,
  ExecutionTerminalKind,
  ExecutionTerminalSummary,
  ProjectActionSummary,
  ProjectSummary,
  ResolvedAppTheme,
  TodoState,
  TodoSummary,
} from '../../domain/domain';
import {
  addManualTimeLogLocally,
  recordPromptCopiedLocally,
  removeTodoDependencyLocally,
  requestTodoChanges,
  setTodoTagsLocally,
  updateProjectPromptSettingsLocally,
  updateTimeLogDurationLocally,
  updateTodoArtifactLocally,
  updateTodoContextProjectLocally,
  updateTodoDeadlineLocally,
  updateTodoDescriptionLocally,
  updateTodoJournalLocally,
  updateTodoPriorityLocally,
  updateTodoStarredLocally,
  updateTodoTitleLocally,
  addTodoDependencyLocally,
  deleteTimeLogLocally,
} from '../../domain/snapshotActions';
import { copyText } from '../workspace/workspaceHelpers';
import { updateAppSettingsPreference } from '../../app/appSettingsPreferences';
import {
  todoTocVisibilityWithChange,
  updateTodoPanelVisibilityPreference,
  updateTodoTocVisibilityPreference,
  type TodoTocVisibilityTarget,
} from '../../app/appSnapshotPreferences';
import { countChildrenForParent } from '../../app/appShellHelpers';
import type { AppMutations } from '../../app/useAppMutations';
import { queryKeys } from '../../tauri/queryKeys';
import { generateTodoTitle, suggestTodoWorktreeName } from '../../tauri/commands';
import type { TaskDetailProps } from './TaskDetail';

export type TaskDetailPropDeps = {
  appSettings: AppSettingsSummary;
  buildSelectedTaskPrompt: (options?: {
    additionalPrompt?: string;
    includeProjectNotes?: boolean;
    taskDescriptionMode?: 'none' | 'task' | 'ancestry';
  }) => string;
  closeExecutionTerminalForSelectedTask: (ptyId: number) => Promise<void>;
  data: AppSnapshot;
  isTimerRunning: boolean;
  clearSelectedTodo: () => void;
  mutations: AppMutations;
  openExternalTerminalForPty: (ptyId: number) => Promise<void>;
  openMarkdownImage: (src: string) => void;
  openNewTaskDialog: (placement?: { parentId: number | null; position: number; projectId: number }) => void;
  pendingTitleGenerationTodoIds: ReadonlySet<number>;
  previewFallbacksEnabled: boolean;
  project?: ProjectSummary;
  projectActions: ProjectActionSummary[];
  queryClient: QueryClient;
  renameExecutionTerminalForSelectedTask: (ptyId: number, label: string) => Promise<void>;
  requestDeleteTodos: (todoIds: number[]) => void;
  requestTodoStateChange: (input: { todoId: number; state: TodoState; actorName?: string; message?: string; conversationId?: string }) => boolean;
  resolvedTheme: ResolvedAppTheme;
  runPreviewFallback: (callback: () => void) => void;
  runProjectActionFromUi: (
    action: ProjectActionSummary,
    values?: Record<string, string | boolean>,
    options?: { openInTask?: boolean; projectId?: number },
  ) => Promise<void | ExecutionTerminalSummary>;
  selectedSession?: AgentSessionSummary;
  selectedTodo: TodoSummary;
  selectedTodoProject?: ProjectSummary;
  selectTodo: (todoId: number) => void;
  setLocalSnapshot: Dispatch<SetStateAction<AppSnapshot | null>>;
  setPreviewSnapshot: (updater: (snapshot: AppSnapshot) => AppSnapshot) => void;
  showToast: (toast: { title: string }) => void;
  startExecutionTerminalForSelectedTask: (
    kind: ExecutionTerminalKind,
    options?: { resumeSessionId?: string },
  ) => Promise<ExecutionTerminalSummary>;
  startTimerWithFallback: (todoId: number) => void;
  stopTimerWithFallback: () => void;
  taskActionProject?: ProjectSummary;
  taskProjectActions: ProjectActionSummary[];
  taskProject?: ProjectSummary;
};

export function buildTaskDetailProps({
  appSettings,
  buildSelectedTaskPrompt,
  clearSelectedTodo,
  closeExecutionTerminalForSelectedTask,
  data,
  isTimerRunning,
  mutations,
  openExternalTerminalForPty,
  openMarkdownImage,
  openNewTaskDialog,
  pendingTitleGenerationTodoIds,
  previewFallbacksEnabled,
  project,
  projectActions,
  queryClient,
  renameExecutionTerminalForSelectedTask,
  requestDeleteTodos,
  requestTodoStateChange,
  resolvedTheme,
  runPreviewFallback,
  runProjectActionFromUi,
  selectedSession,
  selectedTodo,
  selectedTodoProject,
  selectTodo,
  setLocalSnapshot,
  setPreviewSnapshot,
  showToast,
  startExecutionTerminalForSelectedTask,
  startTimerWithFallback,
  stopTimerWithFallback,
  taskActionProject,
  taskProjectActions,
  taskProject,
}: TaskDetailPropDeps): TaskDetailProps {
  const {
    addDependencyMutation,
    addManualTimeLogMutation,
    commitAndMergeTodoWorktreeMutation,
    deleteTimeLogMutation,
    updateContextProjectMutation,
    deleteTodoWorktreeMutation,
    enableTodoWorktreeMutation,
    messageTodoMutation,
    openTodoArtifactMutation,
    openTodoWorktreeDiffMutation,
    openTodoWorktreeFolderMutation,
    recordPromptCopiedMutation,
    removeDependencyMutation,
    reorderTodoMutation,
    setMarkdownTocWidthMutation,
    setTagsMutation,
    setTaskDetailDescriptionWidthMutation,
    setTaskDetailsRailHiddenMutation,
    setTodoPanelVisibilityMutation,
    setTodoStarredMutation,
    setTodoTocVisibilityMutation,
    updateArtifactMutation,
    updateDeadlineMutation,
    updateDescriptionMutation,
    updateJournalMutation,
    updatePriorityMutation,
    updateProjectPromptSettingsMutation,
    updateTimeLogDurationMutation,
    updateTitleMutation,
  } = mutations;

  const updateMarkdownTocWidth = (target: 'description' | 'artifact', width: number) => {
    updateAppSettingsPreference({
      appSettings,
      input: { target, width },
      key: target === 'description' ? 'markdownDescriptionTocWidth' : 'markdownArtifactTocWidth',
      mutate: setMarkdownTocWidthMutation.mutate,
      previewFallbacksEnabled,
      queryClient,
      value: width,
    });
  };
  const updateSelectedTodoTocVisibility = (target: TodoTocVisibilityTarget, hidden: boolean) => {
    updateTodoTocVisibilityPreference({
      mutate: setTodoTocVisibilityMutation.mutate,
      previewFallbacksEnabled,
      queryClient,
      setLocalSnapshot,
      snapshot: data,
      todo: selectedTodo,
      visibility: todoTocVisibilityWithChange(selectedTodo, target, hidden),
    });
  };

  return {
    appSettings,
    executionTerminals: data.executionTerminals,
    resolvedTheme,
    onTaskDetailDescriptionWidthChange: (width) => {
      updateAppSettingsPreference({
        appSettings,
        input: { width },
        key: 'taskDetailDescriptionWidth',
        mutate: setTaskDetailDescriptionWidthMutation.mutate,
        previewFallbacksEnabled,
        queryClient,
        value: width,
      });
    },
    onDescriptionTocWidthChange: (width) => updateMarkdownTocWidth('description', width),
    onArtifactTocWidthChange: (width) => updateMarkdownTocWidth('artifact', width),
    onDescriptionTocHiddenChange: (hidden) => updateSelectedTodoTocVisibility('description', hidden),
    onArtifactTocHiddenChange: (hidden) => updateSelectedTodoTocVisibility('artifact', hidden),
    onOpenImage: openMarkdownImage,
    onProjectPromptSettingsChange: (settings) => {
      const selectedProject = selectedTodoProject ?? project;
      if (!selectedProject) return;

      const input = { ...settings, projectId: selectedProject.id };
      runPreviewFallback(() => {
        const optimistic = updateProjectPromptSettingsLocally(data, input);
        setLocalSnapshot(optimistic);
        queryClient.setQueryData(queryKeys.appSnapshot(), optimistic);
      });
      updateProjectPromptSettingsMutation.mutate(input, {
        onError: () =>
          setPreviewSnapshot((snapshot) => updateProjectPromptSettingsLocally(snapshot, input)),
      });
    },
    project: selectedTodoProject ?? project,
    projectActions: taskProjectActions,
    isTimerRunning,
    snapshot: data,
    todo: selectedTodo,
    onAddDependency: (dependsOnTodoId) => {
      addDependencyMutation.mutate(
        { todoId: selectedTodo.id, dependsOnTodoId },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              addTodoDependencyLocally(snapshot, selectedTodo.id, dependsOnTodoId),
            ),
        },
      );
    },
    onRemoveDependency: (dependsOnTodoId) => {
      removeDependencyMutation.mutate(
        { todoId: selectedTodo.id, dependsOnTodoId },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              removeTodoDependencyLocally(snapshot, selectedTodo.id, dependsOnTodoId),
            ),
        },
      );
    },
    onSetParent: (parentId) => {
      reorderTodoMutation.mutate({
        todoId: selectedTodo.id,
        newParentId: parentId,
        newIndex: countChildrenForParent(data.todos, selectedTodo.projectId, parentId, selectedTodo.id),
      });
    },
    onCreateSubtask: () => {
      openNewTaskDialog({
        parentId: selectedTodo.id,
        position: selectedTodo.subtasks.length,
        projectId: selectedTodo.projectId,
      });
    },
    onAddManualTimeLog: (durationSeconds) => {
      addManualTimeLogMutation.mutate(
        { todoId: selectedTodo.id, durationSeconds },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              addManualTimeLogLocally(snapshot, selectedTodo.id, durationSeconds),
            ),
        },
      );
    },
    onUpdateTimeLogDuration: (timeLogId, durationSeconds) => {
      updateTimeLogDurationMutation.mutate(
        { timeLogId, durationSeconds },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              updateTimeLogDurationLocally(snapshot, timeLogId, durationSeconds),
            ),
        },
      );
    },
    onDeleteTimeLog: (timeLogId) => {
      deleteTimeLogMutation.mutate(
        { timeLogId },
        { onError: () => setPreviewSnapshot((snapshot) => deleteTimeLogLocally(snapshot, timeLogId)) },
      );
    },
    onSelectTodo: selectTodo,
    onAcceptDone: () => {
      requestTodoStateChange({
        todoId: selectedTodo.id,
        state: 'Done',
        message: 'Accepted as done.',
        conversationId: 'local-review',
      });
    },
    onArchive: () => {
      requestTodoStateChange({ todoId: selectedTodo.id, state: 'Archived', actorName: 'Mark' });
    },
    onDelete: () => requestDeleteTodos([selectedTodo.id]),
    onTaskDetailsRailHiddenChange: (hidden) => {
      updateAppSettingsPreference({
        appSettings,
        input: { hidden },
        key: 'taskDetailsRailHidden',
        mutate: setTaskDetailsRailHiddenMutation.mutate,
        previewFallbacksEnabled,
        queryClient,
        value: hidden,
      });
    },
    onTodoPanelVisibilityChange: (visibility) => {
      updateTodoPanelVisibilityPreference({
        mutate: setTodoPanelVisibilityMutation.mutate,
        previewFallbacksEnabled,
        queryClient,
        setLocalSnapshot,
        snapshot: data,
        todo: selectedTodo,
        visibility,
      });
    },
    onRequestChanges: () => {
      const message = 'Requested changes.';
      messageTodoMutation.mutate(
        {
          todoId: selectedTodo.id,
          message,
          actorName: 'Mark',
          conversationId: selectedSession?.conversationId,
        },
        {
          onSuccess: () => {
            requestTodoStateChange({ todoId: selectedTodo.id, state: 'Delegated', actorName: 'Mark' });
          },
          onError: () =>
            setPreviewSnapshot((snapshot) => requestTodoChanges(snapshot, selectedTodo.id)),
        },
      );
    },
    onStateChange: (state) => {
      requestTodoStateChange({ todoId: selectedTodo.id, state, actorName: 'Mark' });
    },
    onPriorityChange: (priority) => {
      updatePriorityMutation.mutate(
        { todoId: selectedTodo.id, priority, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) => updateTodoPriorityLocally(snapshot, selectedTodo.id, priority)),
        },
      );
    },
    onContextProjectChange: (contextProjectId) => {
      updateContextProjectMutation.mutate(
        { todoId: selectedTodo.id, contextProjectId, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              updateTodoContextProjectLocally(snapshot, selectedTodo.id, contextProjectId),
            ),
        },
      );
    },
    onStarredChange: (starred) => {
      setTodoStarredMutation.mutate(
        { todoId: selectedTodo.id, starred, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) => updateTodoStarredLocally(snapshot, selectedTodo.id, starred)),
        },
      );
    },
    onDeadlineChange: (deadline) => {
      updateDeadlineMutation.mutate(
        { todoId: selectedTodo.id, deadline, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) => updateTodoDeadlineLocally(snapshot, selectedTodo.id, deadline)),
        },
      );
    },
    onTagsChange: (tags) => {
      setTagsMutation.mutate(
        { todoId: selectedTodo.id, tags, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) => setTodoTagsLocally(snapshot, selectedTodo.id, tags)),
        },
      );
    },
    onTitleChange: (title) => {
      updateTitleMutation.mutate(
        { todoId: selectedTodo.id, title, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) => updateTodoTitleLocally(snapshot, selectedTodo.id, title)),
        },
      );
    },
    onGenerateTitle: () => {
      void generateTodoTitle({ todoId: selectedTodo.id }).catch(() => {
        showToast({ title: 'Autotitle could not start' });
      });
    },
    titleGenerationPending: pendingTitleGenerationTodoIds.has(selectedTodo.id),
    onSaveDescription: (todoId, descriptionMarkdown) => {
      updateDescriptionMutation.mutate(
        { todoId, descriptionMarkdown, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              updateTodoDescriptionLocally(snapshot, todoId, descriptionMarkdown),
            ),
        },
      );
    },
    onSaveJournal: (todoId, journalMarkdown) => {
      updateJournalMutation.mutate(
        { todoId, journalMarkdown, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) => updateTodoJournalLocally(snapshot, todoId, journalMarkdown)),
        },
      );
    },
    onSaveArtifact: (todoId, artifactMarkdown) => {
      updateArtifactMutation.mutate(
        { todoId, artifactMarkdown, actorName: 'Mark' },
        {
          onError: () =>
            setPreviewSnapshot((snapshot) =>
              updateTodoArtifactLocally(snapshot, todoId, artifactMarkdown),
            ),
        },
      );
    },
    onCopyPrompt: () => {
      if (!taskProject) return;

      void copyText(buildSelectedTaskPrompt()).then(() => {
        showToast({ title: 'Agent Prompt copied' });
        recordPromptCopiedMutation.mutate(
          { todoId: selectedTodo.id, actorName: 'Mark' },
          {
            onError: () =>
              setPreviewSnapshot((snapshot) => recordPromptCopiedLocally(snapshot, selectedTodo.id)),
          },
        );
      });
    },
    onBackToList: clearSelectedTodo,
    onCloseExecutionTerminal: closeExecutionTerminalForSelectedTask,
    onOpenExternalTerminal: openExternalTerminalForPty,
    onRenameExecutionTerminal: renameExecutionTerminalForSelectedTask,
    onCopyArtifactLink: () => void copyText(selectedTodo.artifactMarkdownPath),
    onOpenArtifact: () => openTodoArtifactMutation.mutate({ todoId: selectedTodo.id }),
    onOpenWorktreeFolder: () => openTodoWorktreeFolderMutation.mutateAsync({ todoId: selectedTodo.id }),
    onOpenWorktreeDiff: () => openTodoWorktreeDiffMutation.mutateAsync({ todoId: selectedTodo.id }),
    onRunTaskAction: (action, values) =>
      runProjectActionFromUi(action, values, {
        openInTask: true,
        projectId: taskActionProject?.id,
      }),
    onRunWorktreeAction: (action, values) =>
      runProjectActionFromUi(action, values, {
        openInTask: true,
        projectId: taskActionProject?.id,
      }),
    onSuggestWorktreeName: () => suggestTodoWorktreeName({ todoId: selectedTodo.id }),
    onEnableWorktree: (worktreeName) =>
      enableTodoWorktreeMutation.mutateAsync({ todoId: selectedTodo.id, worktreeName }).then(() => undefined),
    onCommitAndMergeWorktree: () => commitAndMergeTodoWorktreeMutation.mutateAsync({ todoId: selectedTodo.id }),
    onDeleteWorktree: () =>
      deleteTodoWorktreeMutation.mutateAsync({ todoId: selectedTodo.id }).then(() => undefined),
    onStartExecutionTerminal: startExecutionTerminalForSelectedTask,
    onStartTimer: () => startTimerWithFallback(selectedTodo.id),
    onStopTimer: stopTimerWithFallback,
  };
}
