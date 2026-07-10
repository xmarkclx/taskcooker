import { lazy } from 'react';

export const TaskDetailIsland = lazy(() =>
  import('../features/tasks/TaskDetail').then((module) => ({ default: module.TaskDetail })),
);

export const FocusedProjectDetailIsland = lazy(() =>
  import('../features/projects/FocusedProjectDetail').then((module) => ({
    default: module.FocusedProjectDetail,
  })),
);

export const LinkProjectDialogIsland = lazy(() =>
  import('../features/projects/LinkProjectDialog').then((module) => ({
    default: module.LinkProjectDialog,
  })),
);

export const ProjectNotesOverlayIsland = lazy(() =>
  import('../features/projects/ProjectNotesOverlay').then((module) => ({
    default: module.ProjectNotesOverlay,
  })),
);

export const DeleteTasksOverlayIsland = lazy(() =>
  import('./DeleteTasksOverlay').then((module) => ({ default: module.DeleteTasksOverlay })),
);

export const DeleteProjectActionOverlayIsland = lazy(() =>
  import('./DeleteProjectActionOverlay').then((module) => ({
    default: module.DeleteProjectActionOverlay,
  })),
);

export const DoneTerminalWarningOverlayIsland = lazy(() =>
  import('./DoneTerminalWarningOverlay').then((module) => ({
    default: module.DoneTerminalWarningOverlay,
  })),
);

export const FindOverlayIsland = lazy(() =>
  import('./FindOverlay').then((module) => ({ default: module.FindOverlay })),
);

export const GlobalSearchOverlayIsland = lazy(() =>
  import('./GlobalSearchOverlay').then((module) => ({ default: module.GlobalSearchOverlay })),
);

export const ProjectActionRunOverlayIsland = lazy(() =>
  import('./ProjectActionRunOverlay').then((module) => ({
    default: module.ProjectActionRunOverlay,
  })),
);

export const ProjectActionsOverlayIsland = lazy(() =>
  import('./ProjectActionsOverlay').then((module) => ({ default: module.ProjectActionsOverlay })),
);

export const NewProjectOverlayIsland = lazy(() =>
  import('./NewProjectOverlay').then((module) => ({ default: module.NewProjectOverlay })),
);

export const NewTaskOverlayIsland = lazy(() =>
  import('./NewTaskOverlay').then((module) => ({ default: module.NewTaskOverlay })),
);

export const RemoteConnectOverlayIsland = lazy(() =>
  import('./RemoteConnectOverlay').then((module) => ({ default: module.RemoteConnectOverlay })),
);

export const ProjectSettingsOverlayIsland = lazy(() =>
  import('./ProjectSettingsOverlay').then((module) => ({ default: module.ProjectSettingsOverlay })),
);

export const AppSettingsOverlayIsland = lazy(() =>
  import('./AppSettingsOverlay').then((module) => ({ default: module.AppSettingsOverlay })),
);
