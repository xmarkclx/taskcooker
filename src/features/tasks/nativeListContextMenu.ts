import { type MenuItemOptions, type PredefinedMenuItemOptions, type SubmenuOptions } from '@tauri-apps/api/menu';

import {
  canUseNativeContextMenu,
  nativeContextMenuApi,
  openNativeContextMenu,
  type NativeContextMenuApi,
} from './nativeContextMenu';

type ListContextMenuActions = {
  onNewTask: () => void;
  canCreateTask?: boolean;
  onAddSubproject?: () => void;
  onLinkProject?: () => void;
};

type OpenNativeListContextMenuInput = ListContextMenuActions & {
  x: number;
  y: number;
};

export async function openNativeListContextMenu(
  input: OpenNativeListContextMenuInput,
  api: NativeContextMenuApi = nativeContextMenuApi,
): Promise<boolean> {
  return openNativeContextMenu(
    {
      text: 'List actions',
      items: listContextMenuItems(input),
      x: input.x,
      y: input.y,
    },
    api,
  );
}

export function canUseNativeListContextMenu(
  api: NativeContextMenuApi = nativeContextMenuApi,
): boolean {
  return canUseNativeContextMenu(api);
}

function listContextMenuItems({
  onNewTask,
  canCreateTask = true,
  onAddSubproject,
  onLinkProject,
}: ListContextMenuActions): SubmenuOptions['items'] {
  const items: Array<MenuItemOptions | PredefinedMenuItemOptions> = [
    {
      id: 'list-new-task',
      text: 'New task',
      enabled: canCreateTask,
      action: onNewTask,
    },
  ];

  if (onAddSubproject) {
    items.push({
      id: 'list-add-subproject',
      text: 'Add Subproject',
      action: onAddSubproject,
    });
  }

  if (onLinkProject) {
    items.push({
      id: 'list-link-project',
      text: 'Link Project…',
      action: onLinkProject,
    });
  }

  return items;
}
