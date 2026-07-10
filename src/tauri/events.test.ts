import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAppEventBridge, SNAPSHOT_INVALIDATE_COALESCE_MS } from './events';
import { queryKeys } from './queryKeys';

type TodoChangedHandler = (event: {
  payload: { todoId: number; changeType: string };
}) => void;

type ProjectChangedHandler = (event: {
  payload: { projectId: number; changeType: string };
}) => void;

type SettingsChangedHandler = (event: {
  payload: { changeType: string };
}) => void;

type NotificationHandler = (event: {
  payload: { kind: 'warning'; title: string; body: string };
}) => void;

describe('Tauri app event bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invalidates snapshot and settings queries when app events arrive', async () => {
    const invalidateQueries = vi.fn();
    const unlistenTodo = vi.fn();
    const unlistenProject = vi.fn();
    const unlistenSettings = vi.fn();
    const unlistenNotification = vi.fn();
    const onNotification = vi.fn();
    let todoHandler: TodoChangedHandler | null = null;
    let projectHandler: ProjectChangedHandler | null = null;
    let settingsHandler: SettingsChangedHandler | null = null;
    let notificationHandler: NotificationHandler | null = null;

    const cleanup = await registerAppEventBridge(
      { invalidateQueries },
      {
        listen: async (eventName, nextHandler) => {
          if (eventName === 'todos:changed') {
            todoHandler = nextHandler as TodoChangedHandler;
            return unlistenTodo;
          }
          if (eventName === 'projects:changed') {
            projectHandler = nextHandler as ProjectChangedHandler;
            return unlistenProject;
          }
          if (eventName === 'settings:changed') {
            settingsHandler = nextHandler as SettingsChangedHandler;
            return unlistenSettings;
          }
          if (eventName === 'notifications:show') {
            notificationHandler = nextHandler as NotificationHandler;
            return unlistenNotification;
          }

          throw new Error(`unexpected event: ${eventName}`);
        },
      },
      onNotification,
    );

    const capturedTodoHandler = todoHandler as unknown as TodoChangedHandler;
    const capturedProjectHandler = projectHandler as unknown as ProjectChangedHandler;
    const capturedSettingsHandler = settingsHandler as unknown as SettingsChangedHandler;
    const capturedNotificationHandler = notificationHandler as unknown as NotificationHandler;
    capturedTodoHandler({ payload: { todoId: 128, changeType: 'state_changed' } });
    capturedProjectHandler({ payload: { projectId: 1, changeType: 'notes_changed' } });
    capturedSettingsHandler({ payload: { changeType: 'mcp_token_regenerated' } });
    capturedNotificationHandler({
      payload: {
        kind: 'warning',
        title: 'MCP port changed',
        body: 'Port 8787 was busy.',
      },
    });
    cleanup();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.appSnapshot(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.appSettings(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectActions(1),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectActionsDirectory(1),
    });
    // The project event's snapshot invalidation coalesces into the todo
    // event's pending window, so appSnapshot is invalidated once, not twice.
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    expect(onNotification).toHaveBeenCalledWith({
      kind: 'warning',
      title: 'MCP port changed',
      body: 'Port 8787 was busy.',
    });
    expect(unlistenTodo).toHaveBeenCalledTimes(1);
    expect(unlistenProject).toHaveBeenCalledTimes(1);
    expect(unlistenSettings).toHaveBeenCalledTimes(1);
    expect(unlistenNotification).toHaveBeenCalledTimes(1);
  });

  it('reports title generation progress without invalidating the snapshot', async () => {
    const invalidateQueries = vi.fn();
    const onTitleGeneration = vi.fn();
    let todoHandler: TodoChangedHandler | null = null;

    await registerAppEventBridge(
      { invalidateQueries },
      {
        listen: async (eventName, nextHandler) => {
          if (eventName === 'todos:changed') {
            todoHandler = nextHandler as TodoChangedHandler;
          }
          return () => undefined;
        },
      },
      undefined,
      onTitleGeneration,
    );

    const capturedTodoHandler = todoHandler as unknown as TodoChangedHandler;
    capturedTodoHandler({
      payload: { todoId: 7, changeType: 'title_generation_started' },
    });
    capturedTodoHandler({
      payload: { todoId: 7, changeType: 'title_generation_finished' },
    });

    expect(onTitleGeneration).toHaveBeenNthCalledWith(1, 7, true);
    expect(onTitleGeneration).toHaveBeenNthCalledWith(2, 7, false);
    // Generation progress is UI-only state; the snapshot refetch happens via
    // the separate title_changed event when the title actually swaps.
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('coalesces bursts of todo change events into at most two snapshot invalidations', async () => {
    const invalidateQueries = vi.fn();
    let todoHandler: TodoChangedHandler | null = null;

    await registerAppEventBridge(
      { invalidateQueries },
      {
        listen: async (eventName, nextHandler) => {
          if (eventName === 'todos:changed') {
            todoHandler = nextHandler as TodoChangedHandler;
          }
          return () => undefined;
        },
      },
    );

    const capturedTodoHandler = todoHandler as unknown as TodoChangedHandler;
    for (let index = 0; index < 20; index += 1) {
      capturedTodoHandler({ payload: { todoId: index, changeType: 'state_changed' } });
    }

    // Leading edge fires immediately so a lone remote change stays snappy.
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // The other 19 events collapse into one trailing invalidation.
    vi.advanceTimersByTime(SNAPSHOT_INVALIDATE_COALESCE_MS);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenLastCalledWith({
      queryKey: queryKeys.appSnapshot(),
    });
  });

  it('cancels a pending coalesced invalidation on cleanup', async () => {
    const invalidateQueries = vi.fn();
    let todoHandler: TodoChangedHandler | null = null;

    const cleanup = await registerAppEventBridge(
      { invalidateQueries },
      {
        listen: async (eventName, nextHandler) => {
          if (eventName === 'todos:changed') {
            todoHandler = nextHandler as TodoChangedHandler;
          }
          return () => undefined;
        },
      },
    );

    const capturedTodoHandler = todoHandler as unknown as TodoChangedHandler;
    capturedTodoHandler({ payload: { todoId: 1, changeType: 'state_changed' } });
    capturedTodoHandler({ payload: { todoId: 2, changeType: 'state_changed' } });
    cleanup();

    vi.advanceTimersByTime(SNAPSHOT_INVALIDATE_COALESCE_MS * 2);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
