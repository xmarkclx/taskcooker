import {
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from '@tauri-apps/api/menu';

import type { ProjectStatus, ProjectSummary } from '../../domain/domain';
import {
  canUseNativeContextMenu,
  nativeContextMenuApi,
  openNativeContextMenu,
  type NativeContextMenuApi,
} from './nativeContextMenu';

type SubprojectRowContextMenuActions = {
  parentName: string;
  parentProjectId: number;
  project: ProjectSummary;
  onProjectSelect: (projectId: number) => void;
  onNewRootTask: (projectId: number) => void;
  onAddSubproject: (parentId: number) => void;
  onLinkProject: (parentId: number) => void;
  onProjectStatusChange: (projectId: number, status: ProjectStatus) => void;
  onUnlink: (parentId: number, childId: number) => void;
};

type OpenNativeSubprojectRowContextMenuInput = SubprojectRowContextMenuActions & {
  x: number;
  y: number;
};

export async function openNativeSubprojectRowContextMenu(
  input: OpenNativeSubprojectRowContextMenuInput,
  api: NativeContextMenuApi = nativeContextMenuApi,
): Promise<boolean> {
  return openNativeContextMenu(
    {
      text: 'Project row actions',
      items: subprojectRowContextMenuItems(input),
      x: input.x,
      y: input.y,
    },
    api,
  );
}

export function canUseNativeSubprojectRowContextMenu(
  api: NativeContextMenuApi = nativeContextMenuApi,
): boolean {
  return canUseNativeContextMenu(api);
}

function subprojectRowContextMenuItems({
  parentName,
  parentProjectId,
  project,
  onProjectSelect,
  onNewRootTask,
  onAddSubproject,
  onLinkProject,
  onProjectStatusChange,
  onUnlink,
}: SubprojectRowContextMenuActions): SubmenuOptions['items'] {
  return [
    menuItem(
      'subproject-open-project',
      'Open Project',
      () => onProjectSelect(project.id),
    ),
    menuItem(
      'subproject-new-task',
      'New task',
      () => onNewRootTask(project.id),
    ),
    separator(),
    menuItem(
      'subproject-add-subproject',
      'Add Subproject',
      () => onAddSubproject(project.id),
    ),
    menuItem(
      'subproject-link-project',
      'Link Project…',
      () => onLinkProject(project.id),
    ),
    separator(),
    ...projectStatusActions(project.status).map((action) =>
      menuItem(
        `subproject-status-${action.status.toLowerCase()}`,
        action.label,
        () => onProjectStatusChange(project.id, action.status),
      ),
    ),
    separator(),
    menuItem(
      'subproject-unlink',
      `Unlink from ${parentName}`,
      () => onUnlink(parentProjectId, project.id),
    ),
  ];
}

export function projectStatusActions(
  current: ProjectStatus,
): Array<{ status: ProjectStatus; label: string }> {
  const labeled: Array<{ status: ProjectStatus; label: string }> = [
    { label: 'Reactivate', status: 'Active' },
    { label: 'Mark Blocked', status: 'Blocked' },
    { label: 'Mark Done', status: 'Done' },
    { label: 'Archive', status: 'Archived' },
  ];
  return labeled.filter((entry) => entry.status !== current);
}

function menuItem(id: string, text: string, action: () => void): MenuItemOptions {
  return { id, text, action };
}

function separator(): PredefinedMenuItemOptions {
  return { item: 'Separator' };
}
