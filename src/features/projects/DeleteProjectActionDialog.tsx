import { Trash2 } from 'lucide-react';

import type { ProjectActionSummary, ProjectSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';

type DeleteProjectActionDialogProps = {
  action: ProjectActionSummary;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  project: ProjectSummary;
};

export function DeleteProjectActionDialog({
  action,
  isDeleting,
  onCancel,
  onConfirm,
  project,
}: DeleteProjectActionDialogProps) {
  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="delete-action-dialog-title"
        aria-modal="true"
        className="delete-action-dialog"
        onCancel={onCancel}
        role="dialog"
      >
        <header className="delete-action-header">
          <span className="delete-action-icon" aria-hidden="true">
            <Trash2 size={20} />
          </span>
          <div>
            <h2 id="delete-action-dialog-title">Delete action?</h2>
            <p>This removes the project action definition from the actions directory.</p>
          </div>
        </header>
        <section className="delete-action-summary" aria-label="Action">
          <span>ACTION</span>
          <strong>{action.title}</strong>
          <code>{action.path ?? `${project.actionsDirectory}/${action.fileName}`}</code>
        </section>
        <p className="delete-action-warning">
          Task history and terminal logs stay intact. The action will no longer appear in
          the Actions menu.
        </p>
        <footer className="dialog-actions">
          <AppButton onClick={onCancel} variant="secondary">
            Cancel
          </AppButton>
          <AppButton disabled={isDeleting} onClick={onConfirm} variant="primary">
            Delete action
          </AppButton>
        </footer>
      </DialogPanel>
    </DialogBackdrop>
  );
}
