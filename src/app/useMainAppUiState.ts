import { useCallback } from 'react';
import { atom, useAtom } from 'jotai';
import type { AppSnapshot, ProjectSummary, TodoState } from '../domain/domain';
import { loadRecentRemoteServers, type RemoteConnectionState } from '../features/remote/remoteServers';
import { doneTerminalWarningDismissed } from '../features/tasks/doneTerminalWarningStorage';
import type { AppNotificationPayload } from '../tauri/events';
import type { TaskFilter, TaskSortMode } from '../features/workspace/workspaceHelpers';
import type {
  AppToast,
  DeleteActionDialogState,
  DeleteTasksDialogState,
  NewTaskDialogState,
  PendingActionDialogState,
  PendingDoneTerminalWarning,
  TimerDisplaySummary,
} from './types';

export const toastsAtom = atom<AppToast[]>([]);
const localSnapshotAtom = atom<AppSnapshot | null>(null);
export const newTaskDialogAtom = atom<NewTaskDialogState | null>(null);
export const deleteTasksDialogAtom = atom<DeleteTasksDialogState | null>(null);
export const newProjectOpenAtom = atom(false);
export const linkProjectParentIdAtom = atom<number | null>(null);
export const newProjectParentAtom = atom<ProjectSummary | null>(null);
const projectNotesOpenAtom = atom(false);
const projectSettingsOpenAtom = atom(false);
export const projectActionsOpenAtom = atom(false);
export const appSettingsOpenAtom = atom(false);
export const remoteDialogOpenAtom = atom(false);
export const globalSearchOpenAtom = atom(false);
// In-page find (Cmd+F). Kept independent of the top-level popup system so it
// coexists with other overlays, just like a browser's find bar.
export const findOpenAtom = atom(false);
export const pendingActionAtom = atom<PendingActionDialogState | null>(null);
export const deleteActionDialogAtom = atom<DeleteActionDialogState | null>(null);
export const recentRemoteServersAtom = atom(loadRecentRemoteServers());
export const remoteConnectionAtom = atom<RemoteConnectionState | null>(null);
const remoteConnectErrorAtom = atom<string | null>(null);
const remoteConnectPendingAtom = atom(false);
export const pendingDoneTerminalWarningAtom = atom<PendingDoneTerminalWarning | null>(null);
export const doneTerminalWarningEnabledAtom = atom(!doneTerminalWarningDismissed());
const lastStoppedTimerAtom = atom<TimerDisplaySummary | null>(null);
const taskSearchAtom = atom('');
const taskFilterAtom = atom<TaskFilter>('tasks');
const taskStateFilterAtom = atom<TodoState | ''>('');
const taskTagFilterAtom = atom('');
const taskSortModeAtom = atom<TaskSortMode>('manual');
const hideDelegatedTasksAtom = atom(false);
const showStarredOnlyAtom = atom(false);

export function useMainAppUiState() {
  const [toasts, setToasts] = useAtom(toastsAtom);
  const showToast = useCallback((payload: AppNotificationPayload) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const durationMs = payload.durationMs ?? 8000;
    setToasts((current) => [...current.slice(-2), { ...payload, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, durationMs);
  }, []);

  const [localSnapshot, setLocalSnapshot] = useAtom(localSnapshotAtom);
  const [newTaskDialog, setNewTaskDialog] = useAtom(newTaskDialogAtom);
  const [deleteTasksDialog, setDeleteTasksDialog] = useAtom(deleteTasksDialogAtom);
  const [newProjectOpen, setNewProjectOpen] = useAtom(newProjectOpenAtom);
  const [linkProjectParentId, setLinkProjectParentId] = useAtom(linkProjectParentIdAtom);
  const [newProjectParent, setNewProjectParent] = useAtom(newProjectParentAtom);
  const [projectNotesOpen, setProjectNotesOpen] = useAtom(projectNotesOpenAtom);
  const [projectSettingsOpen, setProjectSettingsOpen] = useAtom(projectSettingsOpenAtom);
  const [projectActionsOpen, setProjectActionsOpen] = useAtom(projectActionsOpenAtom);
  const [appSettingsOpen, setAppSettingsOpen] = useAtom(appSettingsOpenAtom);
  const [remoteDialogOpen, setRemoteDialogOpen] = useAtom(remoteDialogOpenAtom);
  const [globalSearchOpen, setGlobalSearchOpen] = useAtom(globalSearchOpenAtom);
  const [findOpen, setFindOpen] = useAtom(findOpenAtom);
  const [pendingAction, setPendingAction] = useAtom(pendingActionAtom);
  const [deleteActionDialog, setDeleteActionDialog] = useAtom(deleteActionDialogAtom);
  const [recentRemoteServers, setRecentRemoteServers] = useAtom(recentRemoteServersAtom);
  const [remoteConnection, setRemoteConnection] = useAtom(remoteConnectionAtom);
  const [remoteConnectError, setRemoteConnectError] = useAtom(remoteConnectErrorAtom);
  const [remoteConnectPending, setRemoteConnectPending] = useAtom(remoteConnectPendingAtom);
  const [pendingDoneTerminalWarning, setPendingDoneTerminalWarning] = useAtom(pendingDoneTerminalWarningAtom);
  const [doneTerminalWarningEnabled, setDoneTerminalWarningEnabled] = useAtom(doneTerminalWarningEnabledAtom);
  const [lastStoppedTimer, setLastStoppedTimer] = useAtom(lastStoppedTimerAtom);
  const [taskSearch, setTaskSearch] = useAtom(taskSearchAtom);
  const [taskFilter, setTaskFilter] = useAtom(taskFilterAtom);
  const [taskStateFilter, setTaskStateFilter] = useAtom(taskStateFilterAtom);
  const [taskTagFilter, setTaskTagFilter] = useAtom(taskTagFilterAtom);
  const [taskSortMode, setTaskSortMode] = useAtom(taskSortModeAtom);
  const [hideDelegatedTasks, setHideDelegatedTasks] = useAtom(hideDelegatedTasksAtom);
  const [showStarredOnly, setShowStarredOnly] = useAtom(showStarredOnlyAtom);
  const closeTopLevelPopups = () => {
    [
      setNewProjectOpen,
      setProjectNotesOpen,
      setProjectSettingsOpen,
      setProjectActionsOpen,
      setAppSettingsOpen,
      setRemoteDialogOpen,
      setGlobalSearchOpen,
    ].forEach((close) => close(false));
    setLinkProjectParentId(null);
    setNewProjectParent(null);
    setPendingAction(null);
    setDeleteActionDialog(null);
  };
  const openOnlyTopLevelPopup = (setter: (open: boolean) => void) => {
    closeTopLevelPopups();
    setter(true);
  };

  return {
    appSettingsOpen,
    closeTopLevelPopups,
    deleteActionDialog,
    deleteTasksDialog,
    doneTerminalWarningEnabled,
    findOpen,
    globalSearchOpen,
    lastStoppedTimer,
    localSnapshot,
    newProjectOpen,
    newProjectParent,
    linkProjectParentId,
    setLinkProjectParentId,
    setNewProjectParent,
    newTaskDialog,
    openOnlyTopLevelPopup,
    pendingAction,
    pendingDoneTerminalWarning,
    projectActionsOpen,
    projectNotesOpen,
    projectSettingsOpen,
    recentRemoteServers,
    remoteConnectError,
    remoteConnectPending,
    remoteConnection,
    remoteDialogOpen,
    setAppSettingsOpen,
    setDeleteActionDialog,
    setDeleteTasksDialog,
    setDoneTerminalWarningEnabled,
    setFindOpen,
    setGlobalSearchOpen,
    setLastStoppedTimer,
    setLocalSnapshot,
    setNewProjectOpen,
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
    setTaskFilter,
    setHideDelegatedTasks,
    setTaskSearch,
    setShowStarredOnly,
    setTaskSortMode,
    setTaskStateFilter,
    setTaskTagFilter,
    setToasts,
    showToast,
    hideDelegatedTasks,
    showStarredOnly,
    taskFilter,
    taskSearch,
    taskSortMode,
    taskStateFilter,
    taskTagFilter,
    toasts,
  };
}
