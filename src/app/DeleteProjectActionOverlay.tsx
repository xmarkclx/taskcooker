import { useAtom } from 'jotai';

import { DeleteProjectActionDialog } from '../features/projects/DeleteProjectActionDialog';
import type { AppMutations } from './useAppMutations';
import { deleteActionDialogAtom } from './useMainAppUiState';

export function DeleteProjectActionOverlay({
  appMutations,
  onConfirm,
}: {
  appMutations: AppMutations;
  onConfirm: () => void;
}) {
  const [deleteActionDialog, setDeleteActionDialog] = useAtom(deleteActionDialogAtom);

  if (!deleteActionDialog) {
    return null;
  }

  return (
    <DeleteProjectActionDialog
      action={deleteActionDialog.action}
      isDeleting={appMutations.deleteProjectActionMutation.isPending}
      onCancel={() => setDeleteActionDialog(null)}
      onConfirm={onConfirm}
      project={deleteActionDialog.project}
    />
  );
}
