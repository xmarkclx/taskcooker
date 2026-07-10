import { describe, expect, it, vi } from 'vitest';

import { openNativeTaskRowContextMenu } from './nativeTaskRowContextMenu';

describe('openNativeTaskRowContextMenu', () => {
  it('opens a native popup menu with task actions and a status submenu', async () => {
    const popup = vi.fn().mockResolvedValue(undefined);
    const position = vi.fn((x: number, y: number) => ({ x, y, kind: 'logical' }));
    const window = { label: 'main' };
    const actions = {
      onCopyTaskLink: vi.fn(),
      onCreateAbove: vi.fn(),
      onCreateBelow: vi.fn(),
      onCreateSubtask: vi.fn(),
      onDelete: vi.fn(),
      onPasteTaskLink: vi.fn(),
      onSetPriority: vi.fn(),
      onSetState: vi.fn(),
    };
    const submenuNew = vi.fn().mockResolvedValue({ popup });

    const opened = await openNativeTaskRowContextMenu(
      {
        ...actions,
        pasteTaskLabel: 'Paste B-264 task',
        x: 42,
        y: 96,
      },
      {
        getCurrentWindow: () => window,
        isTauriRuntime: () => true,
        logicalPosition: position,
        Submenu: { new: submenuNew },
      },
    );

    expect(opened).toBe(true);
    expect(submenuNew).toHaveBeenCalledWith({
      text: 'Task actions',
      items: expect.arrayContaining([
        expect.objectContaining({ text: 'New task above' }),
        expect.objectContaining({ text: 'New task below' }),
        expect.objectContaining({ text: 'New subtask' }),
        expect.objectContaining({ text: 'Copy task link' }),
        expect.objectContaining({ text: 'Paste B-264 task' }),
        expect.objectContaining({ item: 'Separator' }),
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ text: 'Icebox' }),
            expect.objectContaining({ text: 'Ready to Test' }),
          ]),
          text: 'Set status',
        }),
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ text: '⚪ None' }),
            expect.objectContaining({ text: '🔴 Urgent' }),
          ]),
          text: 'Set priority',
        }),
        expect.objectContaining({ text: 'Delete task' }),
      ]),
    });
    expect(position).toHaveBeenCalledWith(42, 96);
    expect(popup).toHaveBeenCalledWith({ x: 42, y: 96, kind: 'logical' }, window);

    const menuItems = submenuNew.mock.calls[0]?.[0].items;
    expect(menuItems.slice(0, 3).map((item: { text: string }) => item.text)).toEqual([
      'New subtask',
      'New task above',
      'New task below',
    ]);
    menuItems[0].action();
    menuItems[4].action();
    menuItems[5].action();
    menuItems[7].items[2].action();
    menuItems[9].items[4].action();
    menuItems[11].action();

    expect(actions.onCreateSubtask).toHaveBeenCalledOnce();
    expect(actions.onCopyTaskLink).toHaveBeenCalledOnce();
    expect(actions.onPasteTaskLink).toHaveBeenCalledOnce();
    expect(actions.onSetState).toHaveBeenCalledWith('Doing');
    expect(actions.onSetPriority).toHaveBeenCalledWith('Urgent');
    expect(actions.onDelete).toHaveBeenCalledOnce();
  });

  it('falls back to the React menu outside Tauri', async () => {
    const opened = await openNativeTaskRowContextMenu(
      {
        onCopyTaskLink: vi.fn(),
        onCreateAbove: vi.fn(),
        onCreateBelow: vi.fn(),
        onCreateSubtask: vi.fn(),
        onDelete: vi.fn(),
        onPasteTaskLink: vi.fn(),
        onSetPriority: vi.fn(),
        onSetState: vi.fn(),
        x: 0,
        y: 0,
      },
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
