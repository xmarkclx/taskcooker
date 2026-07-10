import { useAtom } from 'jotai';

import type { TodoSummary } from '../domain/domain';
import { DeleteTasksDialog } from '../features/tasks/DeleteTasksDialog';
import { deleteTasksDialogAtom } from './useMainAppUiState';

export function DeleteTasksOverlay({
  onConfirm,
  todos,
}: {
  onConfirm: () => void;
  todos: TodoSummary[];
}) {
  const [deleteTasksDialog, setDeleteTasksDialog] = useAtom(deleteTasksDialogAtom);

  if (!deleteTasksDialog) {
    return null;
  }

  return (
    <DeleteTasksDialog
      onCancel={() => setDeleteTasksDialog(null)}
      onConfirm={onConfirm}
      todos={todos}
    />
  );
}
