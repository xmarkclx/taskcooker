import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import {
  type ComponentProps,
  type CSSProperties,
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  AppSnapshot,
  AppSettingsSummary,
  ExecutionTerminalKind,
  ExecutionTerminalSummary,
  ProjectActionSummary,
  ResolvedAppTheme,
  TaskDescriptionPromptMode,
  TodoPriority,
  TodoState,
  TodoSummary,
} from '../domain/domain';
import { emptySnapshot } from '../data/seed';
import {
  acceptTodoDone,
  addExecutionTerminalLocally,
  createProjectLocally,
  createTodoLocally,
  removeExecutionTerminalLocally,
  startTaskTimer,
  stopTaskTimer,
  updateProjectNotesLocally,
  updateProjectSettingsLocally,
  updateTodoPriorityLocally,
  updateTodoStateLocally,
} from '../domain/snapshotActions';
import { buildTaskPrompt } from '../features/ai/prompt';
import {
  saveRecentRemoteServer,
  type RemoteServerInput,
} from '../features/remote/remoteServers';
import {
  dismissDoneTerminalWarning,
} from '../features/tasks/doneTerminalWarningStorage';
import { useSlowdownProfiler, useSlowdownRenderProbe } from '../features/performance/slowdownProfiler';
import type { ProjectActionArgumentValues } from '../features/projects/ProjectActionRunDialog';
import type { NewProjectDialogSubmit } from '../features/projects/NewProjectDialog';
import type { ProjectSettingsSubmit } from '../features/projects/ProjectSettingsDialog';
import { useSubprojectActions } from './useSubprojectActions';
import { useFindShortcut } from '../features/find/useFindInPage';
import { useGlobalSearchShortcut } from '../features/search/GlobalSearchDialog';
import type { AppSearchResult } from '../features/search/globalSearch';
import type { NewTaskDialogSubmit } from '../features/tasks/NewTaskDialog';
import { buildTaskDetailProps } from '../features/tasks/taskDetailProps';
import { useTitleGenerationTracking } from './titleGenerationState';
import { EmptyDetail } from '../features/tasks/EmptyDetail';
import { buildTaskRows, TaskList, type TaskListAccordionState } from '../features/tasks/TaskList';
import { TopBar } from '../features/workspace/TopBar';
import { TimeTrackingPage } from '../features/time/TimeTrackingPage';
import {
  copyText,
  defaultProjectActions,
  defaultProjectActionsDirectory,
  filterTasks,
  isTasksFilterTodo,
  newActionTaskDescription,
  sortTasks,
} from '../features/workspace/workspaceHelpers';
import {
  createRemoteInvokeClient,
  fallbackAppSettings,
  getProjectActionsDirectory,
  listProjectActions,
  loadAppSettings,
  loadAppSnapshot,
  openExternalTerminal,
  recordProjectUse,
  renameExecutionTerminal,
  setActiveInvokeClient,
  startExecutionTerminal,
  suggestTodoWorktreeName,
  startRemoteTunnel,
  stopRemoteTunnel,
} from '../tauri/commands';
import { queryKeys } from '../tauri/queryKeys';
import { appWindowChrome, currentTauriWindowLabel, isTauriRuntime } from '../tauri/runtime';
import {
  actionRunExecutionTerminal,
  confirmUnfinishedDependencyWarning,
  deleteTodosOptimistically,
  projectAccentStyle,
  resolveNewTaskDialogCopy,
  resolveNewTaskParentSelection,
  resolveTaskActionProject,
  todosVisibleInProjectScope,
  useHistoryNavigationState,
  useMarkSelectedTodoMessagesRead,
  usePreventBrowserBackspaceNavigation,
  useResolvedTheme,
  withTimerState,
} from './appShellHelpers';
import {
  useAppEventBridge,
  useRemoteConnectRequestListener,
  useScrollbackPrefetch,
  useSettingsShortcut,
} from './appShellEffects';
import { useProjectGitHub } from './useProjectGitHub';
import { useAppMutations } from './useAppMutations';
import {
  clearNewTaskDialogDraft,
  newTaskDialogDraftStorageKey,
  persistNewTaskParentId,
} from './appShellDrafts';
import { appSettingsUpdateInput, updateAppSettingsPreference } from './appSettingsPreferences';
import { AppToasts } from './AppToasts';
import { RemoteConnectionBar } from './RemoteConnectionBar';
import { IslandSpinner } from '../ui/DeferredMount';
import {
  focusOpenAppWindow,
  listOpenAppWindows,
  openProjectWindow,
  openImageWindow,
  openTaskWindow,
  openWorkspaceWindow,
} from '../tauri/windows';
import type {
  NewTaskPlacement,
  PendingDoneTerminalWarning,
  RunActionMutationInput,
  TodoStateMutationInput,
} from './types';
import {
  AppSettingsOverlayIsland,
  DeleteProjectActionOverlayIsland,
  DeleteTasksOverlayIsland,
  DoneTerminalWarningOverlayIsland,
  FindOverlayIsland,
  FocusedProjectDetailIsland,
  GlobalSearchOverlayIsland,
  LinkProjectDialogIsland,
  NewProjectOverlayIsland,
  NewTaskOverlayIsland,
  ProjectActionRunOverlayIsland,
  ProjectActionsOverlayIsland,
  ProjectNotesOverlayIsland,
  ProjectSettingsOverlayIsland,
  RemoteConnectOverlayIsland,
  TaskDetailIsland,
} from './lazySurfaces';
import { useMainAppUiState } from './useMainAppUiState';
import { useStableCallbackProps } from './useStableCallbackProps';

function sortedPositiveIds(ids: Iterable<number>): number[] {
  return Array.from(new Set(Array.from(ids).filter((id) => Number.isInteger(id) && id > 0))).sort(
    (left, right) => left - right,
  );
}

function taskListAccordionStateFromSettings(
  appSettings: AppSettingsSummary,
): TaskListAccordionState {
  return {
    collapsedProjectIds: new Set(appSettings.taskListCollapsedProjectIds),
    collapsedSubprojectIds: new Set(appSettings.taskListCollapsedSubprojectIds),
    collapsedTodoIds: new Set(appSettings.taskListCollapsedTodoIds),
  };
}

export function MainApp() {
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/' });
  const navigate = useNavigate({ from: '/' });
  const router = useRouter();
  usePreventBrowserBackspaceNavigation();
  const historyNavigationState = useHistoryNavigationState(router.history);
  const {
    closeTopLevelPopups,
    deleteActionDialog,
    deleteTasksDialog,
    newTaskDialog,
    appSettingsOpen,
    doneTerminalWarningEnabled,
    findOpen,
    globalSearchOpen,
    lastStoppedTimer,
    newProjectOpen,
    projectActionsOpen,
    remoteDialogOpen,
    openOnlyTopLevelPopup,
    localSnapshot,
    setDoneTerminalWarningEnabled,
    pendingAction,
    pendingDoneTerminalWarning,
    projectNotesOpen,
    projectSettingsOpen,
    recentRemoteServers,
    remoteConnectError,
    remoteConnectPending,
    setAppSettingsOpen,
    setDeleteActionDialog,
    setDeleteTasksDialog,
    setFindOpen,
    setGlobalSearchOpen,
    setLastStoppedTimer,
    setLocalSnapshot,
    setNewProjectOpen,
    setNewProjectParent,
    setNewTaskDialog,
    setPendingAction,
    setPendingDoneTerminalWarning,
    setProjectActionsOpen,
    setProjectNotesOpen,
    setProjectSettingsOpen,
    setRecentRemoteServers,
    setRemoteConnectError,
    setRemoteConnectPending,
    setRemoteConnection,
    setRemoteDialogOpen,
    setHideDelegatedTasks,
    setTaskFilter,
    setTaskSearch,
    setShowStarredOnly,
    setTaskSortMode,
    setTaskStateFilter,
    setTaskTagFilter,
    showToast,
    hideDelegatedTasks,
    showStarredOnly,
    taskFilter,
    taskSearch,
    taskSortMode,
    taskStateFilter,
    taskTagFilter,
  } = useMainAppUiState();
  const { pendingTitleGenerationTodoIds, onTitleGeneration } = useTitleGenerationTracking();
  useAppEventBridge(queryClient, showToast, onTitleGeneration);

  const {
    data: serverSnapshot = emptySnapshot,
    isPlaceholderData: appSnapshotIsPlaceholder,
  } = useQuery({
    queryKey: queryKeys.appSnapshot(),
    queryFn: () => loadAppSnapshot(),
    // Never flash the demo "tmatrix" seed — that was only for browser preview /
    // tests. A slow first paint (common on Windows cold start) must look empty.
    placeholderData: emptySnapshot,
    // Tauri events (`todos:changed` etc.) drive freshness; polling is only a
    // safety net. A short interval multiplied across many open windows was a
    // constant source of full-snapshot refetch churn.
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
  const { data: appSettings = fallbackAppSettings } = useQuery({
    queryKey: queryKeys.appSettings(),
    queryFn: () => loadAppSettings(),
    placeholderData: fallbackAppSettings,
  });
  const resolvedTheme = useResolvedTheme(appSettings.theme);
  const settingsTaskListAccordionState = useMemo(
    () => taskListAccordionStateFromSettings(appSettings),
    [
      appSettings.taskListCollapsedProjectIds,
      appSettings.taskListCollapsedSubprojectIds,
      appSettings.taskListCollapsedTodoIds,
    ],
  );
  const [optimisticTaskListAccordionState, setOptimisticTaskListAccordionState] =
    useState<TaskListAccordionState | null>(null);
  useEffect(() => {
    setOptimisticTaskListAccordionState(null);
  }, [
    appSettings.taskListCollapsedProjectIds,
    appSettings.taskListCollapsedSubprojectIds,
    appSettings.taskListCollapsedTodoIds,
  ]);
  const taskListAccordionState =
    optimisticTaskListAccordionState ?? settingsTaskListAccordionState;
  const taskWindowMode = Boolean(search.taskWindow && search.todoId);
  const taskListSuppressed = taskWindowMode;
  const tauriRuntime = isTauriRuntime();
  const profilerRoute = [
    search.taskWindow ? 'task-window' : 'workspace',
    search.projectId ? `project:${search.projectId}` : null,
    search.todoId ? `todo:${search.todoId}` : null,
  ]
    .filter(Boolean)
    .join('/');
  useSlowdownProfiler({
    enabled: tauriRuntime && appSettings.slowdownProfilerEnabled,
    route: profilerRoute,
    windowLabel: currentTauriWindowLabel(),
  });
  useSlowdownRenderProbe('app', profilerRoute);
  const previewFallbacksEnabled = !tauriRuntime;
  const windowChrome = appWindowChrome();
  const runPreviewFallback = (callback: () => void) => { if (previewFallbacksEnabled) callback(); };
  const openMarkdownImage = (src: string) => void openImageWindow(src);
  const setPreviewSnapshot = (updater: (snapshot: AppSnapshot) => AppSnapshot) => {
    runPreviewFallback(() => {
      setLocalSnapshot((snapshot) => updater(snapshot ?? serverSnapshot));
    });
  };
  const applySnapshot = (snapshot: AppSnapshot) => {
    queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
    setLocalSnapshot(snapshot);
  };
  const recordProjectUseFromUi = (projectId: number) => {
    if (projectId <= 0) {
      return;
    }

    void recordProjectUse({ projectId })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.appSnapshot(),
        }),
      )
      .catch(() => undefined);
  };
  const openProjectWindowFromUi = (targetProject: AppSnapshot['projects'][number]) => {
    recordProjectUseFromUi(targetProject.id);
    void openProjectWindow(targetProject);
  };
  useEffect(() => {
    if (search.projectId === undefined) {
      return;
    }

    recordProjectUseFromUi(search.projectId);
  }, [search.projectId]);
  const navigateToSnapshotSelection = (snapshot: AppSnapshot) => {
    void navigate({
      search: {
        projectId: snapshot.selectedProjectId,
        todoId: snapshot.selectedTodoId,
      },
    });
  };
  const connectRemoteServer = async (input: RemoteServerInput) => {
    const sshHost = input.sshHost.trim();
    const remotePath = input.remotePath.trim();
    if (!sshHost || !remotePath || !Number.isInteger(input.serverPort) || input.serverPort <= 0) {
      setRemoteConnectError('SSH host, server port, and remote project path are required.');
      return;
    }

    const server = { sshHost, serverPort: input.serverPort, remotePath };
    setRemoteConnectPending(true);
    setRemoteConnectError(null);
    try {
      const tunnel = await startRemoteTunnel({
        sshHost: server.sshHost,
        serverPort: server.serverPort,
      });
      const connection = {
        ...server,
        baseUrl: tunnel.baseUrl,
      };
      setActiveInvokeClient(
        createRemoteInvokeClient({
          baseUrl: connection.baseUrl,
          remotePath: connection.remotePath,
          sshHost: connection.sshHost,
        }),
      );
      setRemoteConnection(connection);
      setRecentRemoteServers(saveRecentRemoteServer(server));
      setRemoteDialogOpen(false);

      const [snapshot, settings] = await Promise.all([loadAppSnapshot(), loadAppSettings()]);
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      queryClient.setQueryData(queryKeys.appSettings(), settings);
      setLocalSnapshot(snapshot);
      void queryClient.invalidateQueries({ queryKey: ['projectActions'] });
      void queryClient.invalidateQueries({ queryKey: ['projectActionsDirectory'] });
    } catch (error) {
      setActiveInvokeClient(null);
      setRemoteConnection(null);
      await stopRemoteTunnel().catch(() => undefined);
      setRemoteConnectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoteConnectPending(false);
    }
  };
  const disconnectRemoteServer = async () => {
    setRemoteConnectError(null);
    await stopRemoteTunnel().catch((error) => {
      setRemoteConnectError(error instanceof Error ? error.message : String(error));
    });
    setActiveInvokeClient(null);
    setRemoteConnection(null);
    setLocalSnapshot(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.appSnapshot() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
    void queryClient.invalidateQueries({ queryKey: ['projectActions'] });
    void queryClient.invalidateQueries({ queryKey: ['projectActionsDirectory'] });
  };
  useRemoteConnectRequestListener(() => {
    setRemoteConnectError(null);
    openOnlyTopLevelPopup(setRemoteDialogOpen);
  });
  useSettingsShortcut(() => openOnlyTopLevelPopup(setAppSettingsOpen));
  useGlobalSearchShortcut(() => openOnlyTopLevelPopup(setGlobalSearchOpen));
  useFindShortcut(() => setFindOpen(true));
  const appMutations = useAppMutations({
    applySnapshot,
    getProject: () => project,
    navigateToSnapshotSelection,
    queryClient,
    setLocalSnapshot,
  });
  const {
    chooseProjectBackgroundImageMutation,
    clearProjectBackgroundImageMutation,
    closeExecutionTerminalMutation,
    commitAndMergeTodoWorktreeMutation,
    createActionsDirectoryMutation,
    createProjectMutation,
    createTodoMutation,
    deleteProjectActionMutation,
    deleteTodosMutation,
    deleteTodoWorktreeMutation,
    enableTodoWorktreeMutation,
    getTodoWorktreeStatusMutation,
    linkTodoMutation,
    markMessagesReadMutation,
    openActionsDirectoryMutation,
    openProjectActionMutation,
    openProjectFolderMutation,
    reorderProjectLinkMutation,
    reorderTodoMutation,
    runActionMutation,
    setMarkdownTocWidthMutation,
    setTaskListAccordionStateMutation,
    setTaskListWidthMutation,
    startTimerMutation,
    stopTimerMutation,
    updateAppSettingsMutation,
    updateProjectNotesMutation,
    updateProjectSettingsMutation,
    updatePriorityMutation,
    updateStateMutation,
    updateTodosStateMutation,
  } = appMutations;
  const data = previewFallbacksEnabled ? (localSnapshot ?? serverSnapshot) : serverSnapshot;
  useScrollbackPrefetch(data.executionTerminals);
  const selectedProjectId = search.projectId ?? data.selectedProjectId;
  const isAllProjects = selectedProjectId === 0 && data.projects.length > 0;
  const project = isAllProjects
    ? undefined
    : data.projects.find((item) => item.id === selectedProjectId) ?? data.projects[0];
  const focusedProject = useMemo(() => {
    if (!project || search.focusedProjectId === undefined) {
      return undefined;
    }
    const isChildOfCurrentProject = project.subprojects.some(
      (edge) => edge.childProjectId === search.focusedProjectId,
    );
    if (!isChildOfCurrentProject) {
      return undefined;
    }
    return data.projects.find((item) => item.id === search.focusedProjectId);
  }, [data.projects, project, search.focusedProjectId]);
  const focusedProjectIsSubproject = focusedProject
    ? data.projects.some((parent) =>
        parent.subprojects.some(
          (edge) => edge.kind === 'subproject' && edge.childProjectId === focusedProject.id,
        ),
      )
    : false;
  const projectShellStyle = useMemo(
    () =>
      ({
        ...projectAccentStyle(project, data.projects),
        '--project-window-border-width': `${appSettings.projectAccentBorderWidth}px`,
      }) as CSSProperties & { '--project-window-border-width': string },
    [project, data.projects, appSettings.projectAccentBorderWidth],
  );
  const clientOptions = useMemo(() => data.projects.map((item) => item.client), [data.projects]);
  const { data: projectActions = project ? defaultProjectActions(project) : [] } = useQuery({
    enabled: Boolean(project),
    queryKey: queryKeys.projectActions(project?.id ?? 0),
    queryFn: async () => {
      if (!project) {
        return [];
      }

      try {
        return await listProjectActions({ projectId: project.id });
      } catch (error) {
        if (!previewFallbacksEnabled) {
          throw error;
        }

        return defaultProjectActions(project);
      }
    },
  });
  const { data: projectActionsDirectory = project ? defaultProjectActionsDirectory(project) : null } = useQuery({
    enabled: Boolean(project),
    queryKey: queryKeys.projectActionsDirectory(project?.id ?? 0),
    queryFn: async () => {
      if (!project) {
        return null;
      }

      try {
        return await getProjectActionsDirectory({ projectId: project.id });
      } catch (error) {
        if (!previewFallbacksEnabled) {
          throw error;
        }

        return defaultProjectActionsDirectory(project);
      }
    },
  });
  const projectGitHubProps = useProjectGitHub({ previewFallbacksEnabled, project });
  const selectTodoAfterMutation = (snapshot: AppSnapshot, todoId?: number) => {
    if (!todoId || !snapshot.todos.some((todo) => todo.id === todoId)) {
      return;
    }

    void navigate({
      search: (previous) => ({
        ...previous,
        focusedProjectId: undefined,
        projectId: isAllProjects ? 0 : (project?.id ?? selectedProjectId),
        todoId,
      }),
    });
  };
  const {
    childProjects,
    visibleChildProjectIds,
    onAddSubproject,
    onLinkProject,
    onUnlinkProject,
    onUpdateProjectStatus,
    linkProjectParentId,
    setLinkProjectParentId,
    linkProjectParent,
  } = useSubprojectActions({
    project,
    isAllProjects,
    projects: data.projects,
    taskFilter,
    taskStateFilter,
    applySnapshot,
    selectTodoAfterMutation,
    showToast,
    closeTopLevelPopups,
  });
  const projectTodos = useMemo(
    () =>
      todosVisibleInProjectScope({
        isAllProjects,
        projectId: project?.id,
        todos: data.todos,
        visibleChildProjectIds,
      }),
    [data.todos, isAllProjects, project?.id, visibleChildProjectIds],
  );
  const stateFilterCounts = useMemo(() => {
    const counts: Partial<Record<TodoState, number>> = {};
    for (const todo of projectTodos) {
      counts[todo.state] = (counts[todo.state] ?? 0) + 1;
    }
    return counts;
  }, [projectTodos]);
  const archivedCount = stateFilterCounts.Archived ?? 0;
  const delegatedCount = stateFilterCounts.Delegated ?? 0;
  const starredCount = useMemo(
    () => projectTodos.filter((todo) => todo.starred === true).length,
    [projectTodos],
  );
  const unreadTodoIds = useMemo(
    () => new Set(data.messages.filter((message) => message.unread).map((message) => message.todoId)),
    [data.messages],
  );
  const projectTags = useMemo(
    () =>
      Array.from(new Set(projectTodos.flatMap((todo) => todo.tags))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [projectTodos],
  );
  const visibleTodos = useMemo(
    () =>
      sortTasks(
        filterTasks(
          projectTodos,
          taskFilter,
          taskStateFilter,
          taskSearch,
          taskTagFilter,
          unreadTodoIds,
          hideDelegatedTasks,
          showStarredOnly,
        ),
        taskSortMode,
        unreadTodoIds,
      ),
    [
      projectTodos,
      taskFilter,
      taskStateFilter,
      taskSearch,
      taskTagFilter,
      taskSortMode,
      unreadTodoIds,
      hideDelegatedTasks,
      showStarredOnly,
    ],
  );
  const visibleTodoIdsInTaskListOrder = () =>
    buildTaskRows({
      collapsedProjectIds: new Set(),
      collapsedSubprojectIds: new Set(),
      collapsedTodoIds: new Set(),
      projects: data.projects,
      showProjectRoots: isAllProjects,
      todos: visibleTodos,
      treeView: taskSortMode === 'manual',
    }).flatMap((row) => (row.type === 'todo' ? [row.todo.id] : []));
  const nextTodoIdInTaskListOrder = (todoId: number) => {
    const visibleTodoIds = visibleTodoIdsInTaskListOrder();
    const currentIndex = visibleTodoIds.indexOf(todoId);
    return currentIndex >= 0 ? visibleTodoIds[currentIndex + 1] : undefined;
  };
  const selectedId = search.todoId ?? (focusedProject ? undefined : data.selectedTodoId);
  const selectedTodo = selectedId
    ? search.todoId
      ? data.todos.find((todo) => todo.id === selectedId)
      : projectTodos.find((todo) => todo.id === selectedId)
    : undefined;
  const selectedTodoProject = selectedTodo
    ? data.projects.find((item) => item.id === selectedTodo.projectId)
    : project;
  const taskProject = project ?? selectedTodoProject;
  const selectedTodoContextProject = selectedTodo?.effectiveContextProjectId
    ? data.projects.find((item) => item.id === selectedTodo.effectiveContextProjectId)
    : undefined;
  const taskActionProject = resolveTaskActionProject({
    selectedProject: project,
    selectedTodoContextProject,
    selectedTodoProject,
  });
  const topBarActionProject = selectedTodoContextProject ?? project ?? selectedTodoProject;
  const { data: taskProjectActions = taskActionProject
    ? defaultProjectActions(taskActionProject)
    : [] } = useQuery({
    enabled: Boolean(taskActionProject),
    queryKey: queryKeys.projectActions(taskActionProject?.id ?? 0),
    queryFn: async () => {
      if (!taskActionProject) {
        return [];
      }

      try {
        return await listProjectActions({ projectId: taskActionProject.id });
      } catch (error) {
        if (!previewFallbacksEnabled) {
          throw error;
        }

        return defaultProjectActions(taskActionProject);
      }
    },
  });
  const { data: topBarProjectActions = topBarActionProject
    ? defaultProjectActions(topBarActionProject)
    : [] } = useQuery({
    enabled: Boolean(topBarActionProject),
    queryKey: queryKeys.projectActions(topBarActionProject?.id ?? 0),
    queryFn: async () => {
      if (!topBarActionProject) {
        return [];
      }

      try {
        return await listProjectActions({ projectId: topBarActionProject.id });
      } catch (error) {
        if (!previewFallbacksEnabled) {
          throw error;
        }

        return defaultProjectActions(topBarActionProject);
      }
    },
  });
  const selectedTodoSessions = useMemo(
    () => data.sessions.filter((session) => session.todoId === selectedTodo?.id),
    [data.sessions, selectedTodo?.id],
  );
  const runningSession = selectedTodoSessions.find((session) => session.state === 'running');
  const selectedSession = runningSession ?? selectedTodoSessions[0];
  const todosById = useMemo(
    () => new Map(data.todos.map((todo) => [todo.id, todo])),
    [data.todos],
  );
  const runningTimerForTopBar = data.runningTimer
    ? withTimerState(data.runningTimer, todosById.get(data.runningTimer.todoId))
    : null;
  const lastStoppedTimerForTopBar =
    !runningTimerForTopBar && lastStoppedTimer
      ? {
          ...lastStoppedTimer,
          state: todosById.get(lastStoppedTimer.todoId)?.state ?? lastStoppedTimer.state,
        }
      : null;
  useMarkSelectedTodoMessagesRead({
    appSnapshotIsPlaceholder,
    markMessagesRead: markMessagesReadMutation.mutate,
    markMessagesReadPending: markMessagesReadMutation.isPending,
    previewFallbacksEnabled,
    selectedTodo,
    setPreviewSnapshot,
    unreadTodoIds,
  });
  const requestDeleteTodos = (todoIds: number[]) => {
    const existingIds = Array.from(new Set(todoIds)).filter((todoId) => todosById.has(todoId));
    if (existingIds.length === 0) {
      return;
    }
    setDeleteTasksDialog({ todoIds: existingIds });
  };
  const deleteDialogTodos = deleteTasksDialog
    ? deleteTasksDialog.todoIds
        .map((todoId) => todosById.get(todoId))
        .filter((todo): todo is TodoSummary => Boolean(todo))
    : [];
  const confirmDeleteTodos = () => {
    if (!deleteTasksDialog) {
      return;
    }

    const todoIds = deleteTasksDialog.todoIds;
    setDeleteTasksDialog(null);
    deleteTodosOptimistically({
      applySnapshot,
      deleteTodos: deleteTodosMutation.mutate,
      navigateToSnapshotSelection,
      previousSnapshot: localSnapshot ?? serverSnapshot,
      previewFallbacksEnabled,
      showToast,
      todoIds,
    });
  };
  useEffect(() => {
    if (!deleteTasksDialog) {
      return;
    }

    document.getElementById('delete-tasks-dialog-panel')?.focus();
  }, [deleteTasksDialog]);
  const latestSnapshot = () =>
    queryClient.getQueryData<AppSnapshot>(queryKeys.appSnapshot()) ??
    localSnapshot ??
    serverSnapshot;
  /**
   * Remembers the current states of the todos so an optimistic Done/state
   * change can be undone (dialog cancelled, mutation failed) without
   * clobbering unrelated snapshot updates that arrived in between.
   */
  const captureTodoStateRevert = (todoIds: number[]) => {
    const previousStates = todoIds.flatMap((todoId) => {
      const todo = todosById.get(todoId);
      return todo ? [{ state: todo.state, todoId }] : [];
    });
    return () => {
      applySnapshot(
        previousStates.reduce(
          (snapshot, entry) => updateTodoStateLocally(snapshot, entry.todoId, entry.state),
          latestSnapshot(),
        ),
      );
    };
  };
  const revertOptimisticStateChange = (revert: () => void, error: unknown) => {
    revert();
    void queryClient.invalidateQueries({ queryKey: queryKeys.appSnapshot() });
    showToast({
      body: error instanceof Error ? error.message : String(error),
      kind: 'error',
      title: 'Could not update task state',
    });
  };
  const mutateTodoStateWithFallback = (
    input: TodoStateMutationInput,
    nextTodoId?: number,
  ) => {
    const revert = captureTodoStateRevert([input.todoId]);
    // Transition: on long lists the optimistic snapshot removes/reorders
    // rows, which re-renders every sortable row. Deferring it lets the
    // click's own feedback (checkbox completing state) paint first (B-253).
    startTransition(() => {
      const optimistic =
        input.state === 'Done' && input.message
          ? acceptTodoDone(latestSnapshot(), input.todoId)
          : updateTodoStateLocally(latestSnapshot(), input.todoId, input.state);
      applySnapshot(optimistic);
      selectTodoAfterMutation(optimistic, nextTodoId);
    });
    updateStateMutation.mutate(input, {
      onError: (error) => {
        if (previewFallbacksEnabled) {
          // Preview mode keeps the optimistic snapshot as its offline fallback.
          return;
        }
        revertOptimisticStateChange(revert, error);
      },
    });
  };
  const mutateTodosStateWithFallback = (todoIds: number[], state: TodoState) => {
    const existingIds = Array.from(new Set(todoIds)).filter((todoId) => todosById.has(todoId));
    if (existingIds.length === 0) {
      return;
    }

    const revert = captureTodoStateRevert(existingIds);
    startTransition(() => {
      applySnapshot(
        existingIds.reduce(
          (snapshot, todoId) => updateTodoStateLocally(snapshot, todoId, state),
          latestSnapshot(),
        ),
      );
    });
    updateTodosStateMutation.mutate(
      {
        todoIds: existingIds,
        state,
        actorName: 'Mark',
      },
      {
        onError: (error) => {
          if (previewFallbacksEnabled) {
            return;
          }
          revertOptimisticStateChange(revert, error);
        },
      },
    );
  };
  const terminalTabsForTodos = (todoIds: number[]) => {
    const ids = new Set(todoIds);
    return (localSnapshot ?? data).executionTerminals.filter((terminal) =>
      ids.has(terminal.todoId),
    );
  };
  const closeTerminalTabsForDone = async (terminalTabs: ExecutionTerminalSummary[]) => {
    const ptyIds = Array.from(new Set(terminalTabs.map((terminal) => terminal.ptyId)));
    if (ptyIds.length === 0) {
      return;
    }

    // latestSnapshot(), not render-closure state: the optimistic Done from
    // the same handler tick must survive this cache write.
    const currentSnapshot = latestSnapshot();
    const nextSnapshot = ptyIds.reduce(
      (snapshot, ptyId) => removeExecutionTerminalLocally(snapshot, ptyId),
      currentSnapshot,
    );
    queryClient.setQueryData(queryKeys.appSnapshot(), nextSnapshot);
    setLocalSnapshot(nextSnapshot);
    try {
      await Promise.all(
        ptyIds.map((ptyId) => closeExecutionTerminalMutation.mutateAsync({ ptyId })),
      );
    } catch (error) {
      queryClient.setQueryData(queryKeys.appSnapshot(), currentSnapshot);
      setLocalSnapshot(currentSnapshot);
      throw error;
    }
  };
  const runDoneStateChange = async (pending: PendingDoneTerminalWarning) => {
    try {
      // The state change is what the user is waiting on; terminal/worktree
      // cleanup runs after so the task closes without waiting on it.
      if (pending.change.kind === 'single') {
        mutateTodoStateWithFallback(pending.change.input, pending.nextTodoId);
      } else {
        mutateTodosStateWithFallback(pending.change.input.todoIds, pending.change.input.state);
      }
      await closeTerminalTabsForDone(pending.terminalTabs);
      await Promise.all(
        pending.worktrees.map((worktree) =>
          deleteTodoWorktreeMutation.mutateAsync({ todoId: worktree.todoId }),
        ),
      );
    } catch (error) {
      showToast({
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
        title: 'Could not close terminal tabs',
      });
    }
  };
  const commitAndMergeBeforeDone = async (pending: PendingDoneTerminalWarning) => {
    const worktree = pending.worktrees[0];
    if (!worktree) {
      void runDoneStateChange(pending);
      return;
    }
    // Commit & Merge takes over instead of the Done change, so undo the
    // optimistic Done until the merge flow completes it for real.
    pending.revertOptimisticDone?.();
    setPendingDoneTerminalWarning(null);
    try {
      await commitAndMergeTodoWorktreeMutation.mutateAsync({ todoId: worktree.todoId });
    } catch (error) {
      showToast({
        body: error instanceof Error ? error.message : String(error),
        kind: 'error',
        title: 'Could not start Commit & Merge',
      });
    }
  };
  const requestDoneStateChange = (
    change: PendingDoneTerminalWarning['change'],
    todoIds: number[],
    nextTodoId?: number,
  ): boolean => {
    const terminalTabs = terminalTabsForTodos(todoIds);
    const worktrees = todoIds.flatMap((todoId) => {
      const todo = todosById.get(todoId);
      return todo?.worktreeName && todo.worktreePath && !todo.worktreeMergedAt
        ? [{ dirty: null, displayId: todo.displayId, path: todo.worktreePath, title: todo.title, todoId }]
        : [];
    });
    if (terminalTabs.length === 0 && worktrees.length === 0) {
      if (change.kind === 'single') {
        mutateTodoStateWithFallback(change.input, nextTodoId);
      } else {
        mutateTodosStateWithFallback(change.input.todoIds, change.input.state);
      }
      return true;
    }

    if (terminalTabs.length === 1 && worktrees.length === 0 && !doneTerminalWarningEnabled) {
      void runDoneStateChange({ change, neverShowAgain: false, nextTodoId, terminalTabs, worktrees });
      return true;
    }

    // Show the todo as Done immediately; cancelling the dialog puts it back.
    const revertOptimisticDone = captureTodoStateRevert(todoIds);
    applySnapshot(
      todoIds.reduce(
        (snapshot, todoId) => updateTodoStateLocally(snapshot, todoId, change.input.state),
        latestSnapshot(),
      ),
    );
    const pending = {
      change,
      neverShowAgain: false,
      nextTodoId,
      revertOptimisticDone,
      terminalTabs,
      worktrees,
    };
    setPendingDoneTerminalWarning(pending);
    if (worktrees.length > 0) {
      void Promise.all(
        worktrees.map(async (worktree) => ({
          ...worktree,
          dirty: (await getTodoWorktreeStatusMutation.mutateAsync({ todoId: worktree.todoId })).dirty,
        })),
      ).then((nextWorktrees) => {
        setPendingDoneTerminalWarning((current) =>
          current === pending ? { ...current, worktrees: nextWorktrees } : current,
        );
      });
    }
    return false;
  };
  const requestTodoStateChange = (input: TodoStateMutationInput): boolean => {
    if (input.state !== 'Done') {
      mutateTodoStateWithFallback(input);
      return true;
    }

    return requestDoneStateChange(
      { input, kind: 'single' },
      [input.todoId],
      nextTodoIdInTaskListOrder(input.todoId),
    );
  };
  const setTodosStateWithFallback = (todoIds: number[], state: TodoState) => {
    if (state !== 'Done') {
      mutateTodosStateWithFallback(todoIds, state);
      return;
    }

    const existingIds = Array.from(new Set(todoIds)).filter((todoId) => todosById.has(todoId));
    if (existingIds.length === 0) {
      return;
    }
    if (existingIds.length === 1) {
      const todoId = existingIds[0];
      if (todoId === undefined) {
        return;
      }
      requestDoneStateChange(
        {
          input: {
            actorName: 'Mark',
            state,
            todoId,
          },
          kind: 'single',
        },
        existingIds,
        nextTodoIdInTaskListOrder(todoId),
      );
      return;
    }

    requestDoneStateChange(
      {
        input: {
          actorName: 'Mark',
          state,
          todoIds: existingIds,
        },
        kind: 'bulk',
      },
      existingIds,
    );
  };
  const setTodoPriorityWithFallback = (todoId: number, priority: TodoPriority) => {
    updatePriorityMutation.mutate(
      { todoId, priority, actorName: 'Mark' },
      {
        onError: () =>
          setLocalSnapshot((snapshot) =>
            updateTodoPriorityLocally(snapshot ?? serverSnapshot, todoId, priority),
          ),
      },
    );
  };
  const cancelDoneTerminalWarning = () => {
    pendingDoneTerminalWarning?.revertOptimisticDone?.();
    setPendingDoneTerminalWarning(null);
  };
  const confirmDoneTerminalWarning = () => {
    if (!pendingDoneTerminalWarning) {
      return;
    }

    const pending = pendingDoneTerminalWarning;
    setPendingDoneTerminalWarning(null);
    if (pending.neverShowAgain && pending.terminalTabs.length === 1) {
      dismissDoneTerminalWarning();
      setDoneTerminalWarningEnabled(false);
    }
    void runDoneStateChange(pending);
  };
  const commitAndContinueDoneWarning = () => {
    if (!pendingDoneTerminalWarning) {
      return;
    }
    void commitAndMergeBeforeDone(pendingDoneTerminalWarning);
  };
  useEffect(() => {
    const handleNewWindowAndTaskShortcuts = (event: KeyboardEvent) => {
      const isCommandShortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
      const isNewShortcut =
        (event.code === 'KeyN' || event.key.toLowerCase() === 'n') &&
        isCommandShortcut;
      const isWorktreeTaskShortcut =
        (event.code === 'Digit3' || event.key === '3') &&
        isCommandShortcut &&
        !event.shiftKey;
      if (!isNewShortcut && !isWorktreeTaskShortcut) {
        return;
      }

      if (isNewShortcut && event.shiftKey) {
        event.preventDefault();
        const taskWindowProject = selectedTodo ? (selectedTodoProject ?? project) : undefined;
        if (selectedTodo && taskWindowProject) {
          void openTaskWindow(taskWindowProject, selectedTodo);
          return;
        }
        if (project) {
          openProjectWindowFromUi(project);
          return;
        }
        void openWorkspaceWindow();
        return;
      }

      if (!taskProject) {
        return;
      }

      event.preventDefault();
      if (newTaskDialog) {
        return;
      }
      if (isWorktreeTaskShortcut) {
        openNewWorktreeTaskDialog();
        return;
      }
      openNewTaskDialog();
    };

    document.addEventListener('keydown', handleNewWindowAndTaskShortcuts);
    return () => {
      document.removeEventListener('keydown', handleNewWindowAndTaskShortcuts);
    };
  }, [newTaskDialog, project, selectedTodo, selectedTodoProject, taskProject]);
  const buildSelectedTaskPrompt = (options?: {
    additionalPrompt?: string;
    includeProjectNotes?: boolean;
    taskDescriptionMode?: TaskDescriptionPromptMode;
  }) => {
    if (!selectedTodo || !taskProject) {
      return '';
    }

    return buildTaskPrompt({
      additionalPrompt: options?.additionalPrompt,
      appSettings,
      binaryPath: data.boomerangBinaryPath,
      contextProject: selectedTodoContextProject,
      includeProjectNotes:
        options?.includeProjectNotes ?? taskProject.aiDefaultIncludeProjectNotes,
      messages: data.messages,
      project: taskProject,
      taskDescriptionMode: options?.taskDescriptionMode ?? taskProject.aiTaskDescriptionMode,
      todo: selectedTodo,
      todos: data.todos,
    });
  };
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
  const toggleThemePreference = () => {
    const theme: ResolvedAppTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    updateAppSettingsPreference({
      appSettings,
      input: appSettingsUpdateInput(appSettings, { theme }),
      key: 'theme',
      mutate: updateAppSettingsMutation.mutate,
      previewFallbacksEnabled,
      queryClient,
      value: theme,
    });
  };
  const startExecutionTerminalForSelectedTask = async (
    kind: ExecutionTerminalKind,
    options?: { resumeSessionId?: string },
  ): Promise<ExecutionTerminalSummary> => {
    if (!selectedTodo || !taskProject) {
      throw new Error('No task selected.');
    }
    if (kind !== 'terminal' && !confirmUnfinishedDependencyWarning(selectedTodo)) {
      throw new Error('Execution start canceled.');
    }

    const input =
      kind === 'terminal'
        ? {
            kind,
            todoId: selectedTodo.id,
          }
        : options?.resumeSessionId
          ? {
              kind,
              resumeSessionId: options.resumeSessionId,
              todoId: selectedTodo.id,
            }
          : {
              kind,
              prompt: buildSelectedTaskPrompt(),
              todoId: selectedTodo.id,
            };

    const terminal = await startExecutionTerminal(input);
    const currentSnapshot = localSnapshot ?? data;
    const nextSnapshot = addExecutionTerminalLocally(currentSnapshot, terminal);
    queryClient.setQueryData(queryKeys.appSnapshot(), nextSnapshot);
    setLocalSnapshot(nextSnapshot);
    return terminal;
  };
  const openExternalTerminalForPty = async (ptyId: number): Promise<void> => {
    await openExternalTerminal({ ptyId });
  };
  const closeExecutionTerminalForSelectedTask = async (ptyId: number): Promise<void> => {
    const currentSnapshot = localSnapshot ?? data;
    const nextSnapshot = removeExecutionTerminalLocally(currentSnapshot, ptyId);
    queryClient.setQueryData(queryKeys.appSnapshot(), nextSnapshot);
    setLocalSnapshot(nextSnapshot);
    try {
      await closeExecutionTerminalMutation.mutateAsync({ ptyId });
    } catch (error) {
      queryClient.setQueryData(queryKeys.appSnapshot(), currentSnapshot);
      setLocalSnapshot(currentSnapshot);
      throw error;
    }
  };
  const renameExecutionTerminalForSelectedTask = async (
    ptyId: number,
    label: string,
  ): Promise<void> => {
    const snapshot = await renameExecutionTerminal({ label, ptyId });
    queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
    setLocalSnapshot(snapshot);
  };
  const tasksCount = projectTodos.filter(isTasksFilterTodo).length;

  const selectProject = (projectId: number) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        focusedProjectId: undefined,
        projectId,
        todoId: undefined,
      }),
    });
  };

  const selectTodo = (todoId: number) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        focusedProjectId: undefined,
        projectId: project?.id ?? selectedProjectId,
        todoId,
      }),
    });
  };

  const selectGlobalSearchResult = (result: AppSearchResult) => {
    setGlobalSearchOpen(false);
    if (result.kind === 'project-notes') {
      setProjectNotesOpen(true);
      return;
    }

    void navigate({
      search: (previous) => ({
        ...previous,
        focusedProjectId: undefined,
        projectId: result.projectId,
        todoId: result.todoId,
      }),
    });
  };

  const openTodoWindow = (todoId: number) => {
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) {
      return;
    }
    const todoProject = data.projects.find((item) => item.id === todo.projectId);
    if (!todoProject) {
      return;
    }
    void openTaskWindow(todoProject, todo);
  };

  const selectTimerTodo = async (todoId: number, projectId: number) => {
    const existingTaskWindow = (await listOpenAppWindows()).find(
      (window) => window.kind === 'task' && window.label.startsWith(`task-${todoId}-`),
    );
    if (existingTaskWindow && (await focusOpenAppWindow(existingTaskWindow.label))) {
      return;
    }

    const todo = todosById.get(todoId);
    const timerProject = data.projects.find((item) => item.id === projectId);
    if (todo && timerProject) {
      void openTaskWindow(timerProject, todo);
    }
  };

  const submitNewProject = (input: NewProjectDialogSubmit) => {
    const navigateAfterProjectCreate = (snapshot: AppSnapshot) => {
      setNewProjectOpen(false);
      setNewProjectParent(null);
      if (input.parentProjectId && snapshot.selectedProjectId) {
        void navigate({
          search: (previous) => ({
            ...previous,
            focusedProjectId: snapshot.selectedProjectId,
            projectId: input.parentProjectId,
            todoId: undefined,
          }),
        });
        return;
      }
      navigateToSnapshotSelection(snapshot);
    };

    createProjectMutation.mutate(input, {
      onSuccess: navigateAfterProjectCreate,
      onError: () =>
        runPreviewFallback(() => {
          const fallback = createProjectLocally(localSnapshot ?? serverSnapshot, input);
          setLocalSnapshot(fallback);
          navigateAfterProjectCreate(fallback);
        }),
    });
  };

  const clearSelectedTodo = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        focusedProjectId: undefined,
        projectId: project?.id ?? selectedProjectId,
        todoId: undefined,
      }),
    });
  };

  const focusProject = (projectId: number) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        focusedProjectId: projectId,
        projectId: project?.id ?? selectedProjectId,
        todoId: undefined,
      }),
    });
  };

  const goBackInHistory = () => {
    router.history.back();
  };

  const goForwardInHistory = () => {
    router.history.forward();
  };

  const runProjectActionFromUi = (
    action: ProjectActionSummary,
    values?: ProjectActionArgumentValues,
    options: { openInTask?: boolean; projectId?: number } = {},
  ): Promise<void | ExecutionTerminalSummary> => {
    const actionProject =
      (options.projectId
        ? data.projects.find((item) => item.id === options.projectId)
        : undefined) ?? topBarActionProject;
    if (!actionProject) {
      return Promise.resolve();
    }
    const runInSelectedWorktree = Boolean(selectedTodo?.worktreeName) && !options.openInTask;
    const openInTask = Boolean(options.openInTask || runInSelectedWorktree);
    if (openInTask && !selectedTodo) {
      return Promise.reject(new Error('No task selected.'));
    }

    if (action.arguments.length > 0 && !values) {
      setPendingAction({ action, options: { openInTask, projectId: actionProject.id } });
      return Promise.resolve();
    }

    if (action.fileName === 'boomerang:open-folder') {
      const folderOpenApp = actionProject.projectFolderOpenApp.trim() || 'configured app';
      showToast({
        durationMs: 5000,
        title: `Opening with ${folderOpenApp}...`,
      });
    }

    const input: RunActionMutationInput = {
      arguments: values,
      fileName: action.fileName,
      openInTask,
      projectId: actionProject.id,
    };
    if (openInTask) {
      if (!selectedTodo) {
        return Promise.reject(new Error('No task selected.'));
      }
      input.todoId = selectedTodo.id;
    }

    return runActionMutation.mutateAsync(input).then((run) =>
      openInTask ? (actionRunExecutionTerminal(run) ?? undefined) : undefined,
    );
  };

  const copyCreateActionPromptFromUi = () => {
    const actionProject = topBarActionProject;
    if (!actionProject) {
      return;
    }

    void copyText(newActionTaskDescription(actionProject)).then(() => {
      showToast({
        title: 'Create Action Prompt copied',
      });
    });
  };

  const editProjectActionFromUi = (action: ProjectActionSummary) => {
    const actionProject = topBarActionProject;
    if (!actionProject || action.runtime === 'native') {
      return;
    }

    openProjectActionMutation.mutate({
      projectId: actionProject.id,
      fileName: action.fileName,
    });
  };

  const requestDeleteProjectActionFromUi = (action: ProjectActionSummary) => {
    const actionProject = topBarActionProject;
    if (!actionProject || action.runtime === 'native') {
      return;
    }

    setDeleteActionDialog({
      action,
      project: actionProject,
    });
  };

  const confirmDeleteProjectAction = () => {
    if (!deleteActionDialog) {
      return;
    }

    const { action, project: actionProject } = deleteActionDialog;
    setDeleteActionDialog(null);
    deleteProjectActionMutation.mutate({
      projectId: actionProject.id,
      fileName: action.fileName,
    });
  };

  const startTimerWithFallback = (todoId: number) => {
    setLastStoppedTimer(null);
    startTimerMutation.mutate(todoId, {
      onError: () =>
        setPreviewSnapshot((snapshot) => startTaskTimer(snapshot, todoId)),
    });
  };

  const stopTimerWithFallback = () => {
    if (runningTimerForTopBar) {
      setLastStoppedTimer(runningTimerForTopBar);
    }
    stopTimerMutation.mutate(undefined, {
      onError: () =>
        setPreviewSnapshot((snapshot) => stopTaskTimer(snapshot)),
    });
  };

  const openNewTaskDialog = (placement?: NewTaskPlacement) => {
    closeTopLevelPopups();
    setNewTaskDialog(placement ? { kind: 'task', placement } : { kind: 'task' });
  };

  const openFocusedProjectRootTaskDialog = () => {
    if (!focusedProject) {
      return;
    }
    const rootTaskCount = data.todos.filter(
      (todo) => todo.projectId === focusedProject.id && (todo.parentId ?? null) === null,
    ).length;
    openNewTaskDialog({
      parentId: null,
      position: rootTaskCount,
      projectId: focusedProject.id,
    });
  };

  const openNewWorktreeTaskDialog = () => {
    closeTopLevelPopups();
    setNewTaskDialog({ kind: 'worktree-task' });
  };

  const enableWorktreeForCreatedTask = async (snapshot: AppSnapshot) => {
    const todoId = snapshot.selectedTodoId;
    if (!todoId) {
      navigateToSnapshotSelection(snapshot);
      return;
    }

    try {
      const suggestion = await suggestTodoWorktreeName({ todoId });
      const enabled = await enableTodoWorktreeMutation.mutateAsync({
        todoId,
        worktreeName: suggestion.name,
      });
      navigateToSnapshotSelection(enabled);
    } catch (nextError) {
      navigateToSnapshotSelection(snapshot);
      showToast({
        title: 'Worktree creation failed',
        body: nextError instanceof Error ? nextError.message : String(nextError),
        kind: 'error',
      });
    }
  };

  const submitNewTask = (value: NewTaskDialogSubmit) => {
    const placement = newTaskDialog?.kind === 'task' ? newTaskDialog.placement : undefined;
    const createWorktree = newTaskDialog?.kind === 'worktree-task';
    const targetProjectId = placement?.projectId ?? taskProject?.id;
    if (!newTaskDialog || !targetProjectId) {
      return;
    }
    const parentProjectId = project?.id ?? selectedProjectId;
    const isChildProjectTask =
      placement?.projectId !== undefined &&
      project?.subprojects.some((edge) => edge.childProjectId === placement.projectId);
    const navigateAfterTaskCreate = (snapshot: AppSnapshot) => {
      if (isChildProjectTask && placement?.projectId) {
        void navigate({
          search: (previous) => ({
            ...previous,
            focusedProjectId: placement.projectId,
            projectId: parentProjectId,
            todoId: snapshot.selectedTodoId || undefined,
          }),
        });
        return;
      }

      navigateToSnapshotSelection(snapshot);
    };
    const draftStorageKey = newTaskDialogDraftStorageKey(
      newTaskDialog,
      targetProjectId,
      placement?.parentId ?? null,
    );

    const input = {
      projectId: targetProjectId,
      title: value.title,
      descriptionMarkdown: value.descriptionMarkdown,
      parentId: value.parentId ?? placement?.parentId,
      position: placement?.position,
    };

    createTodoMutation.mutate(input, {
      onSuccess: (snapshot) => {
        clearNewTaskDialogDraft(draftStorageKey);
        setNewTaskDialog(null);
        if (createWorktree) {
          void enableWorktreeForCreatedTask(snapshot);
        } else {
          navigateAfterTaskCreate(snapshot);
        }
      },
      onError: () =>
        runPreviewFallback(() => {
          const fallback = createTodoLocally(localSnapshot ?? serverSnapshot, input);
          setLocalSnapshot(fallback);
          clearNewTaskDialogDraft(draftStorageKey);
          setNewTaskDialog(null);
          if (createWorktree) {
            void enableWorktreeForCreatedTask(fallback);
          } else {
            navigateAfterTaskCreate(fallback);
          }
      }),
    });
  };
  const newTaskPlacement = newTaskDialog?.kind === 'task' ? newTaskDialog.placement : undefined;
  const newTaskParent = newTaskPlacement?.parentId
    ? data.todos.find((todo) => todo.id === newTaskPlacement.parentId)
    : undefined;
  const newTaskProject = newTaskPlacement
    ? data.projects.find((item) => item.id === newTaskPlacement.projectId)
    : taskProject;
  const isSubtaskDialog = Boolean(newTaskPlacement?.parentId);
  const {
    title: newTaskDialogTitle,
    description: newTaskDialogDescription,
    submitLabel: newTaskDialogSubmitLabel,
  } = resolveNewTaskDialogCopy(
    newTaskDialog?.kind,
    isSubtaskDialog,
    newTaskParent?.displayId,
    newTaskProject?.name,
  );
  const newTaskDraftStorageKey = newTaskDialog
    ? newTaskDialogDraftStorageKey(
        newTaskDialog,
        newTaskProject?.id ?? taskProject?.id ?? 0,
        newTaskPlacement?.parentId ?? null,
      )
    : undefined;
  const newTaskAttachmentProjectId = newTaskProject?.id ?? taskProject?.id;
  const newTaskAttachmentTarget = newTaskAttachmentProjectId
    ? { projectId: newTaskAttachmentProjectId, scope: 'project-notes' as const }
    : undefined;
  const { parentOptions: newTaskParentOptions, initialParentId: newTaskInitialParentId } =
    resolveNewTaskParentSelection(newTaskDialog?.kind === 'task' && !isSubtaskDialog, newTaskAttachmentProjectId, data.todos);

  // TaskList and TaskDetail are memo components; useStableCallbackProps keeps
  // every callback prop referentially stable (while calling the latest
  // closure), so re-renders of this shell — search typing, dialogs, timer
  // ticks — no longer cascade into the two heaviest surfaces.
  const updateTaskListAccordionState = (state: TaskListAccordionState) => {
    setOptimisticTaskListAccordionState(state);
    const input = {
      collapsedProjectIds: sortedPositiveIds(state.collapsedProjectIds),
      collapsedSubprojectIds: sortedPositiveIds(state.collapsedSubprojectIds),
      collapsedTodoIds: sortedPositiveIds(state.collapsedTodoIds),
    };
    const previousSettings = appSettings;
    const optimistic = {
      ...appSettings,
      taskListCollapsedProjectIds: input.collapsedProjectIds,
      taskListCollapsedSubprojectIds: input.collapsedSubprojectIds,
      taskListCollapsedTodoIds: input.collapsedTodoIds,
    };
    queryClient.setQueryData(queryKeys.appSettings(), optimistic);
    setTaskListAccordionStateMutation.mutate(input, {
      onError: () => {
        queryClient.setQueryData(
          queryKeys.appSettings(),
          previewFallbacksEnabled ? optimistic : previousSettings,
        );
      },
    });
  };
  const taskListProps = useStableCallbackProps<ComponentProps<typeof TaskList>>({
    accordionState: taskListAccordionState,
    canCreateTask: Boolean(taskProject),
    filter: taskFilter,
    hideDelegated: hideDelegatedTasks,
    showStarredOnly,
    onFilterChange: setTaskFilter,
    onHideDelegatedChange: setHideDelegatedTasks,
    onShowStarredOnlyChange: setShowStarredOnly,
    onNewTask: () => openNewTaskDialog(),
    onOpenCreateTodo: openNewTaskDialog,
    onWidthChange: (width) => {
      updateAppSettingsPreference({
        appSettings,
        input: { width },
        key: 'taskListWidth',
        mutate: setTaskListWidthMutation.mutate,
        previewFallbacksEnabled,
        queryClient,
        value: width,
      });
    },
    onSearchChange: setTaskSearch,
    onSortModeChange: setTaskSortMode,
    onStateFilterChange: setTaskStateFilter,
    onTagFilterChange: setTaskTagFilter,
    onStartTimer: startTimerWithFallback,
    onStopTimer: stopTimerWithFallback,
    archivedCount,
    childProjects,
    delegatedCount,
    starredCount,
    focusedProjectId: focusedProject?.id,
    selectedProjectId,
    onProjectSelect: selectProject,
    onProjectFocus: focusProject,
    onAddSubproject,
    onAccordionStateChange: updateTaskListAccordionState,
    onLinkProject,
    onUnlinkProject,
    onUpdateProjectStatus,
    projects: data.projects,
    runningTimerTodoId: data.runningTimer?.todoId ?? null,
    searchValue: taskSearch,
    showProjectRoots: isAllProjects && taskSortMode === 'manual',
    sortMode: taskSortMode,
    stateFilter: taskStateFilter,
    tagFilter: taskTagFilter,
    tags: projectTags,
    width: appSettings.taskListWidth,
    todos: visibleTodos,
    tasksCount,
    selectedTodo,
    unreadTodoIds,
    onReorder: (todoId, newParentId, newIndex, newProjectId) =>
      reorderTodoMutation.mutate({ todoId, newProjectId, newParentId, newIndex }),
    onLinkTodo: (input) => linkTodoMutation.mutate(input),
    onReorderProjectLink: selectedProjectId !== undefined && selectedProjectId !== 0
      ? (childProjectId, newIndex) =>
          reorderProjectLinkMutation.mutate({
            parentProjectId: selectedProjectId,
            childProjectId,
            newIndex,
          })
      : undefined,
    onSetTodoState: (todoId, state) =>
      requestTodoStateChange({
        todoId,
        state,
        actorName: 'Mark',
      }),
    onSetTodosState: setTodosStateWithFallback,
    onSetTodoPriority: setTodoPriorityWithFallback,
    onDeleteTodos: requestDeleteTodos,
    onSelect: selectTodo,
    onOpenTaskWindow: openTodoWindow,
  });
  const saveFocusedProjectNotes = (notesMarkdown: string) => {
    if (!focusedProject) {
      return;
    }
    runPreviewFallback(() => {
      const optimistic = updateProjectNotesLocally(data, focusedProject.id, notesMarkdown);
      setLocalSnapshot(optimistic);
      queryClient.setQueryData(queryKeys.appSnapshot(), optimistic);
    });
    updateProjectNotesMutation.mutate(
      {
        projectId: focusedProject.id,
        notesMarkdown,
      },
      {
        onError: () =>
          setPreviewSnapshot((snapshot) =>
            updateProjectNotesLocally(snapshot, focusedProject.id, notesMarkdown),
          ),
      },
    );
  };
  const submitFocusedProjectSettings = (value: ProjectSettingsSubmit) => {
    if (!focusedProject) {
      return;
    }
    const input = { ...value, projectId: focusedProject.id };
    runPreviewFallback(() => {
      const optimistic = updateProjectSettingsLocally(data, input);
      setLocalSnapshot(optimistic);
      queryClient.setQueryData(queryKeys.appSnapshot(), optimistic);
    });
    updateProjectSettingsMutation.mutate(input as never, {
      onError: () =>
        setPreviewSnapshot((snapshot) => updateProjectSettingsLocally(snapshot, input)),
    });
  };
  const taskDetailProps = useStableCallbackProps(
    selectedTodo
      ? buildTaskDetailProps({
          appSettings,
          buildSelectedTaskPrompt,
          clearSelectedTodo,
          closeExecutionTerminalForSelectedTask,
          data,
          isTimerRunning: data.runningTimer?.todoId === selectedTodo.id,
          mutations: appMutations,
          openExternalTerminalForPty,
          openMarkdownImage,
          openNewTaskDialog,
          pendingTitleGenerationTodoIds,
          previewFallbacksEnabled,
          project,
          projectActions,
          taskActionProject,
          taskProjectActions,
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
          taskProject,
        })
      : null,
  );

  return (
    <main
      className="app-shell"
      data-project-accent={project?.name}
      data-theme={resolvedTheme}
      data-theme-preference={appSettings.theme}
      data-window-chrome={windowChrome}
      style={projectShellStyle}
    >
      <TopBar
        activeWorkspaceView={search.view === 'time' ? 'time' : 'tasks'}
        canGoBack={historyNavigationState.canGoBack}
        canGoForward={historyNavigationState.canGoForward}
        canCreateTask={Boolean(taskProject)}
        project={project}
        projectActions={topBarProjectActions}
        projects={data.projects}
        selectedProjectId={selectedProjectId}
        onProjectSelect={selectProject}
        onCopyActionPrompt={copyCreateActionPromptFromUi}
        onDeleteAction={requestDeleteProjectActionFromUi}
        onEditAction={editProjectActionFromUi}
        onGoBack={goBackInHistory}
        onGoForward={goForwardInHistory}
        onGoHome={() => {
          const homeProjectId = data.projects.some((item) => item.id === appSettings.homeProjectId)
            ? appSettings.homeProjectId
            : 0;
          closeTopLevelPopups();
          void navigate({
            search: (previous) => ({
              ...previous,
              focusedProjectId: undefined,
              projectId: homeProjectId,
              todoId: undefined,
            }),
          });
        }}
        onNewActionTask={() => {
          closeTopLevelPopups();
          setNewTaskDialog({ kind: 'action' });
        }}
        onNewProject={() => openOnlyTopLevelPopup(setNewProjectOpen)}
        onNewTask={() => openNewTaskDialog()}
        onNewWorktreeTask={openNewWorktreeTaskDialog}
        onOpenAppSettings={() => openOnlyTopLevelPopup(setAppSettingsOpen)}
        onOpenGlobalSearch={() => openOnlyTopLevelPopup(setGlobalSearchOpen)}
        onWorkspaceViewSelect={(view) => {
          closeTopLevelPopups();
          void navigate({
            search: (previous) => ({
              ...previous,
              focusedProjectId: undefined,
              todoId: undefined,
              view: view === 'time' ? 'time' : undefined,
            }),
          });
        }}
        onOpenProjectFolder={() => {
          if (topBarActionProject) {
            const openFolderAction =
              topBarProjectActions.find((action) => action.fileName === 'boomerang:open-folder') ??
              defaultProjectActions(topBarActionProject)[0];
            if (openFolderAction) {
              void runProjectActionFromUi(openFolderAction);
            }
          }
        }}
        onOpenProjectActions={() => openOnlyTopLevelPopup(setProjectActionsOpen)}
        onOpenProjectNotes={() => openOnlyTopLevelPopup(setProjectNotesOpen)}
        onOpenProjectSettings={() => openOnlyTopLevelPopup(setProjectSettingsOpen)}
        onOpenProjectWindow={openProjectWindowFromUi}
        onRefreshActions={() => {
          if (topBarActionProject) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.projectActions(topBarActionProject.id),
            });
          }
        }}
        onRunAction={runProjectActionFromUi}
        onStartRunningTimer={startTimerWithFallback}
        onStopRunningTimer={stopTimerWithFallback}
        onTimerTaskSelect={selectTimerTodo}
        lastStoppedTimer={lastStoppedTimerForTopBar}
        runningTimer={runningTimerForTopBar}
        resolvedTheme={resolvedTheme}
        themePreference={appSettings.theme}
        onThemeToggle={toggleThemePreference}
      />
      <RemoteConnectionBar onDisconnect={() => void disconnectRemoteServer()} />
      <AppToasts />
      {globalSearchOpen ? (
        <Suspense fallback={null}>
          <GlobalSearchOverlayIsland
            onSelectResult={selectGlobalSearchResult}
            selectedProjectId={selectedProjectId}
            snapshot={data}
          />
        </Suspense>
      ) : null}
      {findOpen ? (
        <Suspense fallback={null}>
          <FindOverlayIsland />
        </Suspense>
      ) : null}
      {search.view === 'time' && !taskWindowMode ? (
        <TimeTrackingPage
          onProjectSelect={selectProject}
          onTaskSelect={selectTodo}
          projects={data.projects}
          selectedProjectId={selectedProjectId}
          todos={data.todos}
        />
      ) : <section
        className={`workspace ${search.todoId || focusedProject ? 'detail-mode' : 'list-mode'} ${
          taskListSuppressed ? 'task-list-hidden' : ''
        }`}
        data-tauri-drag-region=""
      >
        {taskWindowMode ? null : <TaskList {...taskListProps} />}
        {taskDetailProps ? (
          <Suspense fallback={<IslandSpinner label="Loading task detail" />}>
            <TaskDetailIsland {...taskDetailProps} />
          </Suspense>
        ) : focusedProject ? (
          <Suspense fallback={<IslandSpinner label="Loading focused project" />}>
            <FocusedProjectDetailIsland
              clientOptions={clientOptions}
              isSubproject={focusedProjectIsSubproject}
              markdownEditorMode={appSettings.markdownEditorMode}
              markdownEditorFontFamily={appSettings.markdownEditorFontFamily}
              markdownEditorFontSize={appSettings.markdownEditorFontSize}
              markdownEditorMaxImageHeight={appSettings.markdownEditorMaxImageHeight}
              markdownTocHidden={appSettings.markdownTocHidden}
              markdownTocWidth={appSettings.markdownDescriptionTocWidth}
              onMarkdownTocWidthChange={(width) => updateMarkdownTocWidth('description', width)}
              onNewRootTask={openFocusedProjectRootTaskDialog}
              onOpenImage={openMarkdownImage}
              onOpenProject={() => selectProject(focusedProject.id)}
              onSaveNotes={saveFocusedProjectNotes}
              onSubmitSettings={submitFocusedProjectSettings}
              project={focusedProject}
            />
          </Suspense>
        ) : (
          <EmptyDetail
            hasProject={data.projects.length > 0}
            onNewProject={() => openOnlyTopLevelPopup(setNewProjectOpen)}
            onNewTask={() => openNewTaskDialog()}
          />
        )}
      </section>}
      <Suspense fallback={null}>
        {deleteTasksDialog ? (
          <DeleteTasksOverlayIsland onConfirm={confirmDeleteTodos} todos={deleteDialogTodos} />
        ) : null}
        {deleteActionDialog ? (
          <DeleteProjectActionOverlayIsland
            appMutations={appMutations}
            onConfirm={confirmDeleteProjectAction}
          />
        ) : null}
        {newTaskDialog ? (
          <NewTaskOverlayIsland
            attachmentTarget={newTaskAttachmentTarget}
            description={newTaskDialogDescription}
            draftStorageKey={newTaskDraftStorageKey}
            initialDescriptionMarkdown={
              newTaskDialog.kind === 'action' && topBarActionProject
                ? newActionTaskDescription(topBarActionProject)
                : ''
            }
            initialParentId={newTaskInitialParentId}
            initialTitle={newTaskDialog.kind === 'action' ? 'Create project action' : ''}
            markdownEditorFontFamily={appSettings.markdownEditorFontFamily}
            markdownEditorFontSize={appSettings.markdownEditorFontSize}
            markdownEditorMaxImageHeight={appSettings.markdownEditorMaxImageHeight}
            markdownTocWidth={appSettings.markdownDescriptionTocWidth}
            onMarkdownTocWidthChange={(width) => updateMarkdownTocWidth('description', width)}
            onOpenImage={openMarkdownImage}
            onParentChange={(parentId) =>
              persistNewTaskParentId(newTaskAttachmentProjectId ?? 0, parentId)
            }
            onSubmit={submitNewTask}
            parentOptions={newTaskParentOptions}
            submitLabel={newTaskDialogSubmitLabel}
            title={newTaskDialogTitle}
          />
        ) : null}
        {newProjectOpen ? (
          <NewProjectOverlayIsland existingProjects={data.projects} onSubmit={submitNewProject} />
        ) : null}
        {linkProjectParent ? (
          <LinkProjectDialogIsland
            parent={linkProjectParent}
            projects={data.projects}
            onClose={() => setLinkProjectParentId(null)}
            onLinked={(snapshot, childProjectId) => {
              applySnapshot(snapshot);
              setLinkProjectParentId(null);
              void navigate({
                search: (previous) => ({
                  ...previous,
                  focusedProjectId: childProjectId,
                  projectId: linkProjectParent.id,
                  todoId: undefined,
                }),
              });
            }}
          />
        ) : null}
        {projectNotesOpen && project ? (
          <ProjectNotesOverlayIsland
            markdownEditorFontFamily={appSettings.markdownEditorFontFamily}
            markdownEditorFontSize={appSettings.markdownEditorFontSize}
            markdownEditorMaxImageHeight={appSettings.markdownEditorMaxImageHeight}
            markdownTocWidth={appSettings.markdownDescriptionTocWidth}
            onMarkdownTocWidthChange={(width) => updateMarkdownTocWidth('description', width)}
            onOpenImage={openMarkdownImage}
            project={project}
            onClose={() => setProjectNotesOpen(false)}
            onSave={(notesMarkdown) => {
              runPreviewFallback(() => {
                const optimistic = updateProjectNotesLocally(data, project.id, notesMarkdown);
                setLocalSnapshot(optimistic);
                queryClient.setQueryData(queryKeys.appSnapshot(), optimistic);
              });
              updateProjectNotesMutation.mutate(
                {
                  projectId: project.id,
                  notesMarkdown,
                },
                {
                  onError: () =>
                    setPreviewSnapshot((snapshot) =>
                      updateProjectNotesLocally(snapshot, project.id, notesMarkdown),
                    ),
                },
              );
            }}
          />
        ) : null}
        {projectSettingsOpen && project ? (
          <ProjectSettingsOverlayIsland
            isSettingsOpen={projectSettingsOpen}
            project={project}
            projectGitHubProps={projectGitHubProps}
            projectActionsDirectory={projectActionsDirectory}
            clientOptions={clientOptions}
            projectActions={projectActions}
            snapshot={data}
            queryClient={queryClient}
            setSettingsOpen={setProjectSettingsOpen}
            setLocalSnapshot={setLocalSnapshot}
            setPreviewSnapshot={setPreviewSnapshot}
            runPreviewFallback={runPreviewFallback}
            appMutations={appMutations}
            updateProjectSettingsMutation={updateProjectSettingsMutation}
            updateProjectSettingsLocally={updateProjectSettingsLocally}
          />
        ) : null}
        {projectActionsOpen && topBarActionProject ? (
          <ProjectActionsOverlayIsland
            actions={topBarProjectActions}
            onNewActionTask={() => {
              setProjectActionsOpen(false);
              setNewTaskDialog({ kind: 'action' });
            }}
            onRefresh={() => {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.projectActions(topBarActionProject.id),
              });
            }}
            onRunAction={(action) => {
              setProjectActionsOpen(false);
              runProjectActionFromUi(action);
            }}
            project={topBarActionProject}
          />
        ) : null}
        {pendingAction ? (
          <ProjectActionRunOverlayIsland onRunAction={runProjectActionFromUi} />
        ) : null}
        {appSettingsOpen ? (
          <AppSettingsOverlayIsland
            appMutations={appMutations}
            appSettings={appSettings}
            projects={data.projects}
            queryClient={queryClient}
            runPreviewFallback={runPreviewFallback}
          />
        ) : null}
        {remoteDialogOpen ? (
          <RemoteConnectOverlayIsland
            error={remoteConnectError}
            onConnect={(input) => void connectRemoteServer(input)}
            pending={remoteConnectPending}
            recentServers={recentRemoteServers}
          />
        ) : null}
        {pendingDoneTerminalWarning ? (
          <DoneTerminalWarningOverlayIsland
            onCancel={cancelDoneTerminalWarning}
            onCommitAndContinue={commitAndContinueDoneWarning}
            onConfirm={confirmDoneTerminalWarning}
          />
        ) : null}
      </Suspense>
    </main>
  );
}
