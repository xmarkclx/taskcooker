import { useAtom } from 'jotai';

import type { ProjectActionSummary, ProjectSummary } from '../domain/domain';
import { ProjectActionsDialog } from '../features/projects/ProjectActionsDialog';
import { projectActionsOpenAtom } from './useMainAppUiState';

export function ProjectActionsOverlay({
  actions,
  onNewActionTask,
  onRefresh,
  onRunAction,
  project,
}: {
  actions: ProjectActionSummary[];
  onNewActionTask: () => void;
  onRefresh: () => void;
  onRunAction: (action: ProjectActionSummary) => void;
  project?: ProjectSummary;
}) {
  const [projectActionsOpen, setProjectActionsOpen] = useAtom(projectActionsOpenAtom);

  if (!projectActionsOpen || !project) {
    return null;
  }

  return (
    <ProjectActionsDialog
      actions={actions}
      onClose={() => setProjectActionsOpen(false)}
      onNewActionTask={onNewActionTask}
      onRefresh={onRefresh}
      onRunAction={onRunAction}
      project={project}
    />
  );
}
