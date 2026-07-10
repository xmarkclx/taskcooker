import { useMemo } from 'react';
import { useAtom } from 'jotai';

import type { AppSnapshot, ProjectStatus, ProjectSummary, TodoState } from '../domain/domain';
import type { TaskFilter } from '../features/workspace/workspaceHelpers';
import { visibleChildProjects } from '../features/projects/projectChildren';
import { unlinkProject, updateProjectStatus } from '../tauri/commands';
import { linkProjectParentIdAtom, newProjectOpenAtom, newProjectParentAtom } from './useMainAppUiState';

type SnapshotApplier = (snapshot: AppSnapshot) => void;
type NavigationHandler = (snapshot: AppSnapshot, todoId?: number) => void;
type ToastFn = (payload: { kind?: 'info' | 'warning' | 'error'; title: string }) => void;

export function useSubprojectActions({
  project,
  isAllProjects,
  projects,
  taskFilter,
  taskStateFilter,
  applySnapshot,
  selectTodoAfterMutation,
  showToast,
  closeTopLevelPopups,
}: {
  project: ProjectSummary | undefined;
  isAllProjects: boolean;
  projects: ProjectSummary[];
  taskFilter: TaskFilter;
  taskStateFilter: TodoState | '';
  applySnapshot: SnapshotApplier;
  selectTodoAfterMutation: NavigationHandler;
  showToast: ToastFn;
  closeTopLevelPopups: () => void;
}) {
  const [linkProjectParentId, setLinkProjectParentId] = useAtom(linkProjectParentIdAtom);
  const [, setNewProjectParent] = useAtom(newProjectParentAtom);
  const [, setNewProjectOpen] = useAtom(newProjectOpenAtom);

  const childProjects = useMemo(
    () =>
      project && !isAllProjects
        ? visibleChildProjects(project, projects, taskFilter, taskStateFilter)
        : [],
    [project, isAllProjects, projects, taskFilter, taskStateFilter],
  );

  const visibleChildProjectIds = useMemo(
    () => new Set(childProjects.map((child) => child.id)),
    [childProjects],
  );

  const onAddSubproject = (parentId: number) => {
    closeTopLevelPopups();
    const parent = projects.find((p) => p.id === parentId);
    setNewProjectParent(parent ?? null);
    setNewProjectOpen(true);
  };

  const onLinkProject = (parentId: number) => {
    closeTopLevelPopups();
    setLinkProjectParentId(parentId);
  };

  const onUnlinkProject = (parentId: number, childId: number) => {
    unlinkProject({ parentProjectId: parentId, childProjectId: childId })
      .then((snapshot) => {
        applySnapshot(snapshot);
        selectTodoAfterMutation(snapshot);
      })
      .catch((error) => {
        showToast({ kind: 'error', title: String(error) });
      });
  };

  const onUpdateProjectStatus = (projectId: number, status: ProjectStatus) => {
    updateProjectStatus({ projectId, status })
      .then((snapshot) => {
        applySnapshot(snapshot);
        selectTodoAfterMutation(snapshot);
      })
      .catch((error) => {
        showToast({ kind: 'error', title: String(error) });
      });
  };

  const linkProjectParent = linkProjectParentId
    ? projects.find((p) => p.id === linkProjectParentId)
    : undefined;

  return {
    childProjects,
    visibleChildProjectIds,
    onAddSubproject,
    onLinkProject,
    onUnlinkProject,
    onUpdateProjectStatus,
    linkProjectParentId,
    setLinkProjectParentId,
    linkProjectParent,
  };
}
