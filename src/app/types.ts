import type {
  AppNotificationPayload,
} from '../tauri/events';
import type {
  ExecutionTerminalSummary,
  ProjectActionSummary,
  ProjectSummary,
  RunningTimerSummary,
  TodoState,
} from '../domain/domain';
import type { DoneWarningWorktree } from '../features/tasks/DoneTerminalWarningDialog';
import type { runProjectAction, updateTodoState, updateTodosState } from '../tauri/commands';

export type NewTaskPlacement = {
  parentId: number | null;
  position: number;
  projectId: number;
};

export type NewTaskDialogState =
  | {
      kind: 'task';
      placement?: NewTaskPlacement;
    }
  | {
      kind: 'worktree-task';
    }
  | {
      kind: 'action';
    };

export type AppToast = AppNotificationPayload & {
  id: string;
};

export type DeleteTasksDialogState = {
  todoIds: number[];
};

export type PendingActionDialogState = {
  action: ProjectActionSummary;
  options: { openInTask?: boolean; projectId?: number };
};

export type DeleteActionDialogState = {
  action: ProjectActionSummary;
  project: ProjectSummary;
};

export type RunActionMutationInput = Parameters<typeof runProjectAction>[0] & {
  openInTask?: boolean;
};

export type TodoStateMutationInput = Parameters<typeof updateTodoState>[0];
export type TodosStateMutationInput = Parameters<typeof updateTodosState>[0];

export type PendingDoneTerminalWarning = {
  change:
    | {
        input: TodoStateMutationInput;
        kind: 'single';
      }
    | {
        input: TodosStateMutationInput;
        kind: 'bulk';
      };
  neverShowAgain: boolean;
  nextTodoId?: number;
  /** Undoes the optimistic Done applied when the warning dialog opened. */
  revertOptimisticDone?: () => void;
  terminalTabs: ExecutionTerminalSummary[];
  worktrees: DoneWarningWorktree[];
};

export type TimerDisplaySummary = RunningTimerSummary & {
  state: TodoState;
};
