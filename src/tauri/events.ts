import { listen as tauriListen } from '@tauri-apps/api/event';
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './queryKeys';

export type TodoChangedPayload = {
  todoId: number;
  changeType: string;
};

export type ProjectChangedPayload = {
  projectId: number;
  changeType: string;
};

export type SettingsChangedPayload = {
  changeType: string;
  previousPort?: number;
  port?: number;
};

export type AppNotificationPayload = {
  kind?: 'info' | 'warning' | 'error';
  title: string;
  body?: string;
  durationMs?: number;
};

type MinimalQueryClient = Pick<QueryClient, 'invalidateQueries'>;

type EventClient = {
  listen: (
    eventName: string,
    handler: (event: {
      payload:
        | TodoChangedPayload
        | ProjectChangedPayload
        | SettingsChangedPayload
        | AppNotificationPayload;
    }) => void,
  ) => Promise<() => void>;
};

const defaultEventClient: EventClient = {
  listen: tauriListen,
};

/**
 * Agent-driven sessions emit `todos:changed` in rapid bursts, and every open
 * window refetches the full app snapshot per invalidation. Coalescing to a
 * leading-edge call plus one trailing call per window caps that refetch storm
 * without making a lone remote change feel laggy.
 */
export const SNAPSHOT_INVALIDATE_COALESCE_MS = 500;

export async function registerAppEventBridge(
  queryClient: MinimalQueryClient,
  eventClient: EventClient = defaultEventClient,
  onNotification?: (payload: AppNotificationPayload) => void,
  onTitleGeneration?: (todoId: number, pending: boolean) => void,
): Promise<() => void> {
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let trailingInvalidatePending = false;

  const invalidateSnapshotCoalesced = () => {
    if (coalesceTimer !== null) {
      trailingInvalidatePending = true;
      return;
    }

    void queryClient.invalidateQueries({ queryKey: queryKeys.appSnapshot() });
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      if (trailingInvalidatePending) {
        trailingInvalidatePending = false;
        invalidateSnapshotCoalesced();
      }
    }, SNAPSHOT_INVALIDATE_COALESCE_MS);
  };

  const unlistenTodoChanged = await eventClient.listen(
    'todos:changed',
    (event) => {
      const payload = event.payload as TodoChangedPayload;
      // Generation progress is UI-only state; the snapshot refetch happens
      // via the separate title_changed event when the title actually swaps.
      if (payload.changeType === 'title_generation_started') {
        onTitleGeneration?.(payload.todoId, true);
        return;
      }
      if (payload.changeType === 'title_generation_finished') {
        onTitleGeneration?.(payload.todoId, false);
        return;
      }
      invalidateSnapshotCoalesced();
    },
  );
  const unlistenProjectChanged = await eventClient.listen(
    'projects:changed',
    (event) => {
      const payload = event.payload as ProjectChangedPayload;
      invalidateSnapshotCoalesced();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectActions(payload.projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectActionsDirectory(payload.projectId),
      });
    },
  );
  const unlistenSettingsChanged = await eventClient.listen(
    'settings:changed',
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
    },
  );
  const unlistenNotification = await eventClient.listen(
    'notifications:show',
    (event) => {
      onNotification?.(event.payload as AppNotificationPayload);
    },
  );

  return () => {
    if (coalesceTimer !== null) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
    trailingInvalidatePending = false;
    unlistenTodoChanged();
    unlistenProjectChanged();
    unlistenSettingsChanged();
    unlistenNotification();
  };
}
