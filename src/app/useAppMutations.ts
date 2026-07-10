import { type QueryClient, useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';

import type { AppSnapshot, ProjectSummary } from '../domain/domain';
import { addExecutionTerminalLocally } from '../domain/snapshotActions';
import {
  addManualTimeLog,
  addTodoDependency,
  chooseProjectBackgroundImage,
  commitAndMergeTodoWorktree,
  clearProjectBackgroundImage,
  createProject,
  createProjectActionsDirectory,
  createTodo,
  closeExecutionTerminal,
  deleteTodoWorktree,
  deleteProjectAction,
  deleteTodos,
  deleteTimeLog,
  enableTodoWorktree,
  getTodoWorktreeStatus,
  linkTodo,
  markTodoMessagesRead,
  messageTodo,
  openProjectAction,
  openProjectActionsDirectory,
  openProjectFolder,
  openTodoArtifact,
  openTodoWorktreeDiff,
  openTodoWorktreeFolder,
  recordPromptCopied,
  reorderProjectLink,
  regenerateMcpToken,
  removeTodoDependency,
  reorderTodo,
  runProjectAction,
  setTodoTags,
  setTodoStarred,
  setMarkdownTocWidth,
  setTaskListAccordionState,
  setTaskDetailDescriptionWidth,
  setTaskDetailsRailHidden,
  setTaskListWidth,
  setTodoPanelVisibility,
  setTodoTocVisibility,
  startTimer,
  stopTimer,
  updateTimeLogDuration,
  updateAppSettings,
  updateTodoArtifact,
  updateTodoContextProject,
  updateTodoDeadline,
  updateProjectNotes,
  updateProjectPromptSettings,
  updateProjectSettings,
  updateTodoDescription,
  updateTodoJournal,
  updateTodoPriority,
  updateTodoState,
  updateTodosState,
  updateTodoTitle,
} from '../tauri/commands';
import { queryKeys } from '../tauri/queryKeys';
import { openTerminalWindow } from '../tauri/windows';
import { actionRunExecutionTerminal } from './appShellHelpers';

export type RunActionMutationInput = Parameters<typeof runProjectAction>[0] & {
  openInTask?: boolean;
};

export type AppMutationsDeps = {
  applySnapshot: (snapshot: AppSnapshot) => void;
  getProject: () => ProjectSummary | undefined;
  navigateToSnapshotSelection: (snapshot: AppSnapshot) => void;
  queryClient: QueryClient;
  setLocalSnapshot: Dispatch<SetStateAction<AppSnapshot | null>>;
};

export type AppMutations = ReturnType<typeof useAppMutations>;

/**
 * Owns every TanStack mutation used by the workspace shell. Each mutation keeps
 * its original cache/preview behavior; the shell wires the results back into
 * navigation and optimistic fallbacks through the injected callbacks.
 */
export function useAppMutations({
  applySnapshot,
  getProject,
  navigateToSnapshotSelection,
  queryClient,
  setLocalSnapshot,
}: AppMutationsDeps) {
  const createProjectMutation = useMutation({
    mutationFn: (input: Parameters<typeof createProject>[0]) => createProject(input),
    onSuccess: applySnapshot,
  });
  const updateStateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoState>[0]) => updateTodoState(input),
    onSuccess: applySnapshot,
  });
  const updateTodosStateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodosState>[0]) => updateTodosState(input),
    onSuccess: applySnapshot,
  });
  const updatePriorityMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoPriority>[0]) =>
      updateTodoPriority(input),
    onSuccess: applySnapshot,
  });
  const updateContextProjectMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoContextProject>[0]) =>
      updateTodoContextProject(input),
    onSuccess: applySnapshot,
  });
  const setTodoStarredMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTodoStarred>[0]) => setTodoStarred(input),
    onSuccess: applySnapshot,
  });
  const updateTitleMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoTitle>[0]) => updateTodoTitle(input),
    onSuccess: applySnapshot,
  });
  const updateDeadlineMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoDeadline>[0]) =>
      updateTodoDeadline(input),
    onSuccess: applySnapshot,
  });
  const setTagsMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTodoTags>[0]) => setTodoTags(input),
    onSuccess: applySnapshot,
  });
  const updateDescriptionMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoDescription>[0]) =>
      updateTodoDescription(input),
    onSuccess: applySnapshot,
  });
  const updateJournalMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoJournal>[0]) =>
      updateTodoJournal(input),
    onSuccess: applySnapshot,
  });
  const updateArtifactMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTodoArtifact>[0]) =>
      updateTodoArtifact(input),
    onSuccess: applySnapshot,
  });
  const updateProjectNotesMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateProjectNotes>[0]) =>
      updateProjectNotes(input),
    onSuccess: applySnapshot,
  });
  const updateProjectSettingsMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateProjectSettings>[0]) =>
      updateProjectSettings(input),
    onSuccess: (snapshot, input) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectActionsDirectory(input.projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectActions(input.projectId),
      });
    },
  });
  const chooseProjectBackgroundImageMutation = useMutation({
    mutationFn: (input: Parameters<typeof chooseProjectBackgroundImage>[0]) =>
      chooseProjectBackgroundImage(input),
    onSuccess: applySnapshot,
  });
  const clearProjectBackgroundImageMutation = useMutation({
    mutationFn: (input: Parameters<typeof clearProjectBackgroundImage>[0]) =>
      clearProjectBackgroundImage(input),
    onSuccess: applySnapshot,
  });
  const updateProjectPromptSettingsMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateProjectPromptSettings>[0]) =>
      updateProjectPromptSettings(input),
    onSuccess: applySnapshot,
  });
  const updateAppSettingsMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateAppSettings>[0]) =>
      updateAppSettings(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const setTaskDetailsRailHiddenMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTaskDetailsRailHidden>[0]) =>
      setTaskDetailsRailHidden(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const setTaskListWidthMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTaskListWidth>[0]) =>
      setTaskListWidth(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const setTaskListAccordionStateMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTaskListAccordionState>[0]) =>
      setTaskListAccordionState(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const setTaskDetailDescriptionWidthMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTaskDetailDescriptionWidth>[0]) =>
      setTaskDetailDescriptionWidth(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const setMarkdownTocWidthMutation = useMutation({
    mutationFn: (input: Parameters<typeof setMarkdownTocWidth>[0]) =>
      setMarkdownTocWidth(input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const setTodoPanelVisibilityMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTodoPanelVisibility>[0]) =>
      setTodoPanelVisibility(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const setTodoTocVisibilityMutation = useMutation({
    mutationFn: (input: Parameters<typeof setTodoTocVisibility>[0]) =>
      setTodoTocVisibility(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const regenerateMcpTokenMutation = useMutation({
    mutationFn: () => regenerateMcpToken(),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.appSettings(), settings);
    },
  });
  const startTimerMutation = useMutation({
    mutationFn: (todoId: number) => startTimer({ todoId }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const stopTimerMutation = useMutation({
    mutationFn: () => stopTimer(),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const addDependencyMutation = useMutation({
    mutationFn: (input: Parameters<typeof addTodoDependency>[0]) =>
      addTodoDependency(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const removeDependencyMutation = useMutation({
    mutationFn: (input: Parameters<typeof removeTodoDependency>[0]) =>
      removeTodoDependency(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const addManualTimeLogMutation = useMutation({
    mutationFn: (input: Parameters<typeof addManualTimeLog>[0]) =>
      addManualTimeLog(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const updateTimeLogDurationMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTimeLogDuration>[0]) =>
      updateTimeLogDuration(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const deleteTimeLogMutation = useMutation({
    mutationFn: (input: Parameters<typeof deleteTimeLog>[0]) => deleteTimeLog(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const createTodoMutation = useMutation({
    mutationFn: (input: Parameters<typeof createTodo>[0]) => createTodo(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const reorderTodoMutation = useMutation({
    mutationFn: (input: Parameters<typeof reorderTodo>[0]) => reorderTodo(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const linkTodoMutation = useMutation({
    mutationFn: (input: Parameters<typeof linkTodo>[0]) => linkTodo(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const reorderProjectLinkMutation = useMutation({
    mutationFn: (input: Parameters<typeof reorderProjectLink>[0]) =>
      reorderProjectLink(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const deleteTodosMutation = useMutation({
    mutationFn: (input: Parameters<typeof deleteTodos>[0]) => deleteTodos(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
      navigateToSnapshotSelection(snapshot);
    },
  });
  const messageTodoMutation = useMutation({
    mutationFn: (input: Parameters<typeof messageTodo>[0]) => messageTodo(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const markMessagesReadMutation = useMutation({
    mutationFn: (input: Parameters<typeof markTodoMessagesRead>[0]) =>
      markTodoMessagesRead(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const recordPromptCopiedMutation = useMutation({
    mutationFn: (input: Parameters<typeof recordPromptCopied>[0]) =>
      recordPromptCopied(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  // No onSuccess snapshot swap: callers remove the tab optimistically and the
  // backend's `todos:changed` emit drives the coalesced snapshot refetch.
  const closeExecutionTerminalMutation = useMutation({
    mutationFn: (input: Parameters<typeof closeExecutionTerminal>[0]) => closeExecutionTerminal(input),
  });
  const runActionMutation = useMutation({
    mutationFn: ({ openInTask: _openInTask, ...input }: RunActionMutationInput) => runProjectAction(input),
    onSuccess: (run, variables) => {
      if (variables.openInTask) {
        const terminal = actionRunExecutionTerminal(run);
        if (terminal) {
          queryClient.setQueryData<AppSnapshot>(queryKeys.appSnapshot(), (snapshot) =>
            snapshot ? addExecutionTerminalLocally(snapshot, terminal) : snapshot,
          );
          setLocalSnapshot((snapshot) =>
            snapshot ? addExecutionTerminalLocally(snapshot, terminal) : snapshot,
          );
        }
      } else if (run.ptyId !== null) {
        void openTerminalWindow(
          run.ptyId,
          `Action · ${run.actionTitle}`,
          run.todoId !== null
            ? { projectId: run.projectId, todoId: run.todoId }
            : undefined,
        );
      }
      const project = getProject();
      if (project) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projectActions(project.id),
        });
      }
    },
  });
  const createActionsDirectoryMutation = useMutation({
    mutationFn: (input: Parameters<typeof createProjectActionsDirectory>[0]) => createProjectActionsDirectory(input),
    onSuccess: (summary, input) => {
      queryClient.setQueryData(queryKeys.projectActionsDirectory(input.projectId), summary);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectActions(input.projectId),
      });
    },
  });
  const openActionsDirectoryMutation = useMutation({
    mutationFn: (input: Parameters<typeof openProjectActionsDirectory>[0]) => openProjectActionsDirectory(input),
  });
  const openProjectActionMutation = useMutation({
    mutationFn: (input: Parameters<typeof openProjectAction>[0]) => openProjectAction(input),
  });
  const deleteProjectActionMutation = useMutation({
    mutationFn: (input: Parameters<typeof deleteProjectAction>[0]) => deleteProjectAction(input),
    onSuccess: (actions, input) => {
      queryClient.setQueryData(queryKeys.projectActions(input.projectId), actions);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectActions(input.projectId),
      });
    },
  });
  const openProjectFolderMutation = useMutation({
    mutationFn: (input: Parameters<typeof openProjectFolder>[0]) => openProjectFolder(input),
  });
  const openTodoArtifactMutation = useMutation({
    mutationFn: (input: Parameters<typeof openTodoArtifact>[0]) => openTodoArtifact(input),
  });
  const enableTodoWorktreeMutation = useMutation({
    mutationFn: (input: Parameters<typeof enableTodoWorktree>[0]) => enableTodoWorktree(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      setLocalSnapshot(snapshot);
    },
  });
  const openTodoWorktreeFolderMutation = useMutation({
    mutationFn: (input: Parameters<typeof openTodoWorktreeFolder>[0]) => openTodoWorktreeFolder(input),
  });
  const getTodoWorktreeStatusMutation = useMutation({
    mutationFn: (input: Parameters<typeof getTodoWorktreeStatus>[0]) => getTodoWorktreeStatus(input),
  });
  const deleteTodoWorktreeMutation = useMutation({
    mutationFn: (input: Parameters<typeof deleteTodoWorktree>[0]) => deleteTodoWorktree(input),
    onSuccess: applySnapshot,
  });
  const openTodoWorktreeDiffMutation = useMutation({
    mutationFn: (input: Parameters<typeof openTodoWorktreeDiff>[0]) => openTodoWorktreeDiff(input),
    onSuccess: (terminal) => {
      queryClient.setQueryData<AppSnapshot>(queryKeys.appSnapshot(), (snapshot) =>
        snapshot ? addExecutionTerminalLocally(snapshot, terminal) : snapshot,
      );
      setLocalSnapshot((snapshot) =>
        snapshot ? addExecutionTerminalLocally(snapshot, terminal) : snapshot,
      );
    },
  });
  const commitAndMergeTodoWorktreeMutation = useMutation({
    mutationFn: (input: Parameters<typeof commitAndMergeTodoWorktree>[0]) => commitAndMergeTodoWorktree(input),
    onSuccess: (terminal) => {
      queryClient.setQueryData<AppSnapshot>(queryKeys.appSnapshot(), (snapshot) =>
        snapshot ? addExecutionTerminalLocally(snapshot, terminal) : snapshot,
      );
      setLocalSnapshot((snapshot) =>
        snapshot ? addExecutionTerminalLocally(snapshot, terminal) : snapshot,
      );
    },
  });

  return {
    addDependencyMutation,
    addManualTimeLogMutation,
    chooseProjectBackgroundImageMutation,
    clearProjectBackgroundImageMutation,
    closeExecutionTerminalMutation,
    commitAndMergeTodoWorktreeMutation,
    createActionsDirectoryMutation,
    createProjectMutation,
    createTodoMutation,
    deleteProjectActionMutation,
    deleteTimeLogMutation,
    deleteTodosMutation,
    deleteTodoWorktreeMutation,
    enableTodoWorktreeMutation,
    getTodoWorktreeStatusMutation,
    linkTodoMutation,
    markMessagesReadMutation,
    messageTodoMutation,
    openActionsDirectoryMutation,
    openProjectActionMutation,
    openProjectFolderMutation,
    openTodoArtifactMutation,
    openTodoWorktreeDiffMutation,
    openTodoWorktreeFolderMutation,
    recordPromptCopiedMutation,
    regenerateMcpTokenMutation,
    removeDependencyMutation,
    reorderProjectLinkMutation,
    reorderTodoMutation,
    runActionMutation,
    setMarkdownTocWidthMutation,
    setTaskListAccordionStateMutation,
    setTagsMutation,
    setTaskDetailDescriptionWidthMutation,
    setTaskDetailsRailHiddenMutation,
    setTaskListWidthMutation,
    setTodoPanelVisibilityMutation,
    setTodoStarredMutation,
    setTodoTocVisibilityMutation,
    startTimerMutation,
    stopTimerMutation,
    updateAppSettingsMutation,
    updateArtifactMutation,
    updateContextProjectMutation,
    updateDeadlineMutation,
    updateDescriptionMutation,
    updateJournalMutation,
    updatePriorityMutation,
    updateProjectNotesMutation,
    updateProjectPromptSettingsMutation,
    updateProjectSettingsMutation,
    updateStateMutation,
    updateTimeLogDurationMutation,
    updateTitleMutation,
    updateTodosStateMutation,
  };
}
