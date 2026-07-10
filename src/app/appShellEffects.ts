import type { QueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import type { ExecutionTerminalSummary } from '../domain/domain';
import { prefetchPtyScrollback } from '../features/terminal/ptyBridge';
import { registerAppEventBridge, type AppNotificationPayload } from '../tauri/events';
import { isTauriRuntime } from '../tauri/runtime';
import { closeCurrentAppWindow } from '../tauri/windows';

/**
 * Bridges backend app-wide Tauri events into the TanStack Query cache and the
 * toast surface for the lifetime of the shell.
 */
export function useAppEventBridge(
  queryClient: QueryClient,
  showToast: (payload: AppNotificationPayload) => void,
  onTitleGeneration?: (todoId: number, pending: boolean) => void,
) {
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void registerAppEventBridge(queryClient, undefined, showToast, onTitleGeneration)
      .then((nextCleanup) => {
        if (cancelled) {
          nextCleanup();
          return;
        }
        cleanup = nextCleanup;
      })
      .catch(() => {
        cleanup = null;
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [queryClient, showToast, onTitleGeneration]);
}

/**
 * Warms the PTY scrollback cache for every open terminal so selecting a task
 * with a running terminal paints xterm without waiting on the scrollback IPC.
 */
export function useScrollbackPrefetch(executionTerminals: ExecutionTerminalSummary[]) {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    for (const terminal of executionTerminals) {
      void prefetchPtyScrollback(terminal.ptyId);
    }
  }, [executionTerminals]);
}

/** Opens the remote-connect dialog when the backend emits the request event. */
export function useRemoteConnectRequestListener(onRequested: () => void) {
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void listen('remote:connect-requested', () => {
      onRequested();
    }).then((nextCleanup) => {
      if (cancelled) {
        nextCleanup();
        return;
      }
      cleanup = nextCleanup;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Cmd/Ctrl+, opens App Settings. */
export function useSettingsShortcut(onOpen: () => void) {
  useEffect(() => {
    const openSettingsFromShortcut = (event: KeyboardEvent) => {
      if ((event.key !== ',' && event.code !== 'Comma') || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      onOpen();
    };

    document.addEventListener('keydown', openSettingsFromShortcut);
    return () => {
      document.removeEventListener('keydown', openSettingsFromShortcut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Cmd+W closes the current window. */
export function useCloseWindowShortcut() {
  useEffect(() => {
    const closeWindowFromShortcut = (event: KeyboardEvent) => {
      const isCloseShortcut =
        (event.code === 'KeyW' || event.key.toLowerCase() === 'w') &&
        event.metaKey &&
        !event.altKey;
      if (!isCloseShortcut || !isTauriRuntime()) {
        return;
      }

      event.preventDefault();
      void closeCurrentAppWindow();
    };

    document.addEventListener('keydown', closeWindowFromShortcut, true);
    return () => {
      document.removeEventListener('keydown', closeWindowFromShortcut, true);
    };
  }, []);
}
