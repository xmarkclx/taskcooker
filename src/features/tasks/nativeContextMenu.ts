import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Submenu, type SubmenuOptions } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { isTauriRuntime } from '../../tauri/runtime';

type NativePopupMenu = {
  close?: () => Promise<void>;
  popup: (at: unknown, window: unknown) => Promise<void>;
};

export type NativeContextMenuApi = {
  getCurrentWindow: () => unknown;
  isTauriRuntime: () => boolean;
  logicalPosition: (x: number, y: number) => unknown;
  Submenu: {
    new: (options: SubmenuOptions) => Promise<NativePopupMenu>;
  };
};

export const nativeContextMenuApi: NativeContextMenuApi = {
  getCurrentWindow,
  isTauriRuntime,
  logicalPosition: (x, y) => new LogicalPosition(x, y),
  Submenu: {
    new: async (options) => Submenu.new(options) as Promise<NativePopupMenu>,
  },
};

export function canUseNativeContextMenu(api: NativeContextMenuApi = nativeContextMenuApi): boolean {
  return api.isTauriRuntime();
}

// Tauri's `plugin:menu|popup` holds the webview resource-table mutex for as
// long as the native menu is on screen, while sync menu IPC (`Submenu.new`)
// runs on the macOS main thread. Building a menu while another popup is in
// flight can therefore deadlock the whole app (B-246), so menu IPC must be
// serialized: never create or close a menu until the previous popup settles.
let menuTurn: Promise<void> = Promise.resolve();
let latestRequestId = 0;

export function resetNativeContextMenuQueueForTests(): void {
  menuTurn = Promise.resolve();
  latestRequestId = 0;
}

export async function openNativeContextMenu(
  {
    text,
    items,
    x,
    y,
  }: {
    text: string;
    items: SubmenuOptions['items'];
    x: number;
    y: number;
  },
  api: NativeContextMenuApi = nativeContextMenuApi,
): Promise<boolean> {
  if (!canUseNativeContextMenu(api)) {
    return false;
  }

  const requestId = ++latestRequestId;
  const previousTurn = menuTurn;
  let releaseTurn!: () => void;
  menuTurn = new Promise((resolve) => {
    releaseTurn = resolve;
  });

  try {
    await previousTurn;
    if (requestId !== latestRequestId) {
      // A newer right-click superseded this one while the previous menu was
      // open; report handled so the caller does not open a fallback menu.
      return true;
    }

    const menu = await api.Submenu.new({ text, items });
    try {
      await menu.popup(api.logicalPosition(x, y), api.getCurrentWindow());
    } finally {
      await menu.close?.();
    }

    return true;
  } finally {
    releaseTurn();
  }
}
