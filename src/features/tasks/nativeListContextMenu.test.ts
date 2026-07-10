import { describe, expect, it, vi } from 'vitest';

import { openNativeListContextMenu } from './nativeListContextMenu';

describe('openNativeListContextMenu', () => {
  it('opens a native popup menu with a New task action', async () => {
    const popup = vi.fn().mockResolvedValue(undefined);
    const position = vi.fn((x: number, y: number) => ({ x, y, kind: 'logical' }));
    const window = { label: 'main' };
    const onNewTask = vi.fn();
    const submenuNew = vi.fn().mockResolvedValue({ popup });

    const opened = await openNativeListContextMenu(
      { onNewTask, x: 42, y: 96 },
      {
        getCurrentWindow: () => window,
        isTauriRuntime: () => true,
        logicalPosition: position,
        Submenu: { new: submenuNew },
      },
    );

    expect(opened).toBe(true);
    expect(submenuNew).toHaveBeenCalledWith({
      text: 'List actions',
      items: [expect.objectContaining({ text: 'New task' })],
    });
    expect(position).toHaveBeenCalledWith(42, 96);
    expect(popup).toHaveBeenCalledWith({ x: 42, y: 96, kind: 'logical' }, window);

    const menuItems = submenuNew.mock.calls[0]?.[0].items;
    menuItems[0].action();
    expect(onNewTask).toHaveBeenCalledOnce();
  });

  it('disables the New task action when tasks cannot be created', async () => {
    const submenuNew = vi.fn().mockResolvedValue({ popup: vi.fn().mockResolvedValue(undefined) });

    await openNativeListContextMenu(
      { onNewTask: vi.fn(), canCreateTask: false, x: 0, y: 0 },
      {
        getCurrentWindow: vi.fn(),
        isTauriRuntime: () => true,
        logicalPosition: vi.fn((x: number, y: number) => ({ x, y })),
        Submenu: { new: submenuNew },
      },
    );

    const menuItems = submenuNew.mock.calls[0]?.[0].items;
    expect(menuItems[0]).toMatchObject({ text: 'New task', enabled: false });
  });

  it('falls back to the React menu outside Tauri', async () => {
    const opened = await openNativeListContextMenu(
      { onNewTask: vi.fn(), x: 0, y: 0 },
      {
        getCurrentWindow: vi.fn(),
        isTauriRuntime: () => false,
        logicalPosition: vi.fn(),
        Submenu: { new: vi.fn() },
      },
    );

    expect(opened).toBe(false);
  });
});
