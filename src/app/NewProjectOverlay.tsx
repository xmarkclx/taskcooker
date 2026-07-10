import { useAtom } from 'jotai';

import { NewProjectDialog, type NewProjectDialogSubmit } from '../features/projects/NewProjectDialog';
import type { ProjectSummary } from '../domain/domain';
import { chooseWorkingDirectory, createWorkingDirectory, getWorkingDirectory } from '../tauri/commands';
import { newProjectOpenAtom, newProjectParentAtom } from './useMainAppUiState';

export function NewProjectOverlay({
  existingProjects,
  onSubmit,
}: {
  existingProjects: ProjectSummary[];
  onSubmit: (input: NewProjectDialogSubmit) => void;
}) {
  const [newProjectOpen, setNewProjectOpen] = useAtom(newProjectOpenAtom);
  const [newProjectParent, setNewProjectParent] = useAtom(newProjectParentAtom);

  if (!newProjectOpen) {
    return null;
  }

  return (
    <NewProjectDialog
      existingProjects={existingProjects}
      onChooseWorkingDirectory={(currentPath) => chooseWorkingDirectory({ currentPath })}
      onClose={() => {
        setNewProjectOpen(false);
        setNewProjectParent(null);
      }}
      onCreateWorkingDirectory={(path) => createWorkingDirectory({ path })}
      onSubmit={onSubmit}
      onWorkingDirectoryStatus={(path) => getWorkingDirectory({ path })}
      parentProject={newProjectParent ?? undefined}
    />
  );
}
