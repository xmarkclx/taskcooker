import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openNativeContextMenu,
  resetNativeContextMenuQueueForTests,
  type NativeContextMenuApi,
} from './nativeContextMenu';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeApi() {
  const popups: Deferred[] = [];
  const closes: Array<ReturnType<typeof vi.fn>> = [];
  const submenuNew = vi.fn(async () => {
    const popupGate = deferred();
    popups.push(popupGate);
    const close = vi.fn().mockResolvedValue(undefined);
    closes.push(close);
    return {
      close,
      popup: vi.fn(() => popupGate.promise),
    };
  });
  const api: NativeContextMenuApi = {
    getCurrentWindow: () => ({ label: 'main' }),
    isTauriRuntime: () => true,
    logicalPosition: (x: number, y: number) => ({ x, y }),
    Submenu: { new: submenuNew },
  };
  return { api, closes, popups, submenuNew };
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe('openNativeContextMenu', () => {
  afterEach(() => {
    resetNativeContextMenuQueueForTests();
  });

  it('does not build a second menu while a popup is still open', async () => {
    const { api, popups, submenuNew } = makeApi();

    const first = openNativeContextMenu({ text: 'a', items: [], x: 0, y: 0 }, api);
    await flushMicrotasks();
    expect(submenuNew).toHaveBeenCalledTimes(1);

    // Second right-click while the first native menu is still open. Building
    // the menu now would issue a sync `plugin:menu|new` IPC that can deadlock
    // the app, so it must wait for the first popup to be dismissed.
    const second = openNativeContextMenu({ text: 'b', items: [], x: 1, y: 1 }, api);
    await flushMicrotasks();
    expect(submenuNew).toHaveBeenCalledTimes(1);

    popups[0]?.resolve();
    await first;
    await flushMicrotasks();
    expect(submenuNew).toHaveBeenCalledTimes(2);

    popups[1]?.resolve();
    await expect(second).resolves.toBe(true);
  });

  it('only opens the newest queued menu when right-clicks pile up', async () => {
    const { api, popups, submenuNew } = makeApi();

    const first = openNativeContextMenu({ text: 'a', items: [], x: 0, y: 0 }, api);
    await flushMicrotasks();
    const second = openNativeContextMenu({ text: 'b', items: [], x: 1, y: 1 }, api);
    const third = openNativeContextMenu({ text: 'c', items: [], x: 2, y: 2 }, api);

    popups[0]?.resolve();
    await first;
    await expect(second).resolves.toBe(true);
    await flushMicrotasks();

    expect(submenuNew).toHaveBeenCalledTimes(2);
    expect(submenuNew).toHaveBeenLastCalledWith({ text: 'c', items: [] });

    popups[1]?.resolve();
    await expect(third).resolves.toBe(true);
  });

  it('releases the menu resource after the popup is dismissed', async () => {
    const { api, closes, popups } = makeApi();

    const open = openNativeContextMenu({ text: 'a', items: [], x: 0, y: 0 }, api);
    await flushMicrotasks();
    expect(closes[0]).not.toHaveBeenCalled();

    popups[0]?.resolve();
    await open;
    expect(closes[0]).toHaveBeenCalledOnce();
  });

  it('keeps working after a menu fails to open', async () => {
    const { api, popups, submenuNew } = makeApi();
    submenuNew.mockRejectedValueOnce(new Error('boom'));

    await expect(openNativeContextMenu({ text: 'a', items: [], x: 0, y: 0 }, api)).rejects.toThrow(
      'boom',
    );

    const next = openNativeContextMenu({ text: 'b', items: [], x: 1, y: 1 }, api);
    await flushMicrotasks();
    expect(submenuNew).toHaveBeenCalledTimes(2);
    popups[0]?.resolve();
    await expect(next).resolves.toBe(true);
  });

  it('returns false outside the Tauri runtime', async () => {
    const { api, submenuNew } = makeApi();
    const opened = await openNativeContextMenu(
      { text: 'a', items: [], x: 0, y: 0 },
      { ...api, isTauriRuntime: () => false },
    );
    expect(opened).toBe(false);
    expect(submenuNew).not.toHaveBeenCalled();
  });
});
