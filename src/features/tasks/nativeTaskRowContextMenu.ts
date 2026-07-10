import {
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from '@tauri-apps/api/menu';

import {
  PRIORITY_EMOJI,
  TODO_PRIORITIES,
  TODO_STATES,
  type TodoPriority,
  type TodoState,
} from '../../domain/domain';
import {
  canUseNativeContextMenu,
  nativeContextMenuApi,
  openNativeContextMenu,
  type NativeContextMenuApi,
} from './nativeContextMenu';

type TaskRowContextMenuActions = {
  onCopyTaskLink?: () => void;
  onCreateAbove: () => void;
  onCreateBelow: () => void;
  onCreateSubtask: () => void;
  onDelete: () => void;
  onPasteTaskLink?: () => void;
  onSetPriority: (priority: TodoPriority) => void;
  onSetState: (state: TodoState) => void;
  pasteTaskLabel?: string | null;
  selectedCount?: number;
};

type OpenNativeTaskRowContextMenuInput = TaskRowContextMenuActions & {
  x: number;
  y: number;
};

export async function openNativeTaskRowContextMenu(
  input: OpenNativeTaskRowContextMenuInput,
  api: NativeContextMenuApi = nativeContextMenuApi,
): Promise<boolean> {
  return openNativeContextMenu(
    {
      text: 'Task actions',
      items: taskRowContextMenuItems(input),
      x: input.x,
      y: input.y,
    },
    api,
  );
}

export function canUseNativeTaskRowContextMenu(
  api: NativeContextMenuApi = nativeContextMenuApi,
): boolean {
  return canUseNativeContextMenu(api);
}

function taskRowContextMenuItems({
  onCopyTaskLink,
  onCreateAbove,
  onCreateBelow,
  onCreateSubtask,
  onDelete,
  onPasteTaskLink,
  onSetPriority,
  onSetState,
  pasteTaskLabel,
  selectedCount = 1,
}: TaskRowContextMenuActions): SubmenuOptions['items'] {
  const linkItems: SubmenuOptions['items'] = [];
  if (onCopyTaskLink) {
    linkItems.push(menuItem('task-copy-link', 'Copy task link', onCopyTaskLink));
  }
  if (pasteTaskLabel && onPasteTaskLink) {
    linkItems.push(menuItem('task-paste-link', pasteTaskLabel, onPasteTaskLink));
  }

  return [
    menuItem('task-new-subtask', 'New subtask', onCreateSubtask),
    menuItem('task-new-above', 'New task above', onCreateAbove),
    menuItem('task-new-below', 'New task below', onCreateBelow),
    ...(linkItems.length > 0 ? [separator(), ...linkItems] : []),
    separator(),
    {
      id: 'task-set-status',
      text: 'Set status',
      items: TODO_STATES.map((state) =>
        menuItem(`task-set-status-${state.toLowerCase().replaceAll(' ', '-')}`, state, () =>
          onSetState(state),
        ),
      ),
    },
    separator(),
    {
      id: 'task-set-priority',
      text: 'Set priority',
      items: TODO_PRIORITIES.map((priority) =>
        menuItem(
          `task-set-priority-${priority.toLowerCase()}`,
          `${PRIORITY_EMOJI[priority]} ${priority}`,
          () => onSetPriority(priority),
        ),
      ),
    },
    separator(),
    menuItem('task-delete', selectedCount > 1 ? `Delete ${selectedCount} tasks` : 'Delete task', onDelete),
  ];
}

function menuItem(id: string, text: string, action: () => void): MenuItemOptions {
  return { id, text, action };
}

function separator(): PredefinedMenuItemOptions {
  return { item: 'Separator' };
}
