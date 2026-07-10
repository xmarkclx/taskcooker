import type { KeyboardEvent } from 'react';

import type { TodoSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';

type DeleteTasksDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  todos: TodoSummary[];
};

export function DeleteTasksDialog({ onCancel, onConfirm, todos }: DeleteTasksDialogProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== 'Enter' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('button, input, textarea, select, a, [contenteditable="true"]')
    ) {
      return;
    }

    event.preventDefault();
    onConfirm();
  };

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="delete-tasks-dialog-title"
        aria-modal="true"
        className="delete-tasks-dialog"
        id="delete-tasks-dialog-panel"
        onCancel={onCancel}
        onKeyDown={handleKeyDown}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <h2 id="delete-tasks-dialog-title">
              {todos.length > 1 ? 'Delete tasks' : 'Delete task'}
            </h2>
            <p>
              {todos.length > 1
                ? 'This permanently removes the selected tasks.'
                : 'This permanently removes this task.'}
            </p>
          </div>
        </header>
        <div className="delete-tasks-list">
          {todos.map((todo) => (
            <div className="delete-tasks-list-row" key={todo.id}>
              <span>
                {todo.displayId} {todo.title}
              </span>
            </div>
          ))}
        </div>
        <footer className="dialog-actions">
          <AppButton onClick={onCancel} variant="secondary">
            Cancel
          </AppButton>
          <AppButton onClick={onConfirm} variant="primary">
            {todos.length > 1 ? `Delete ${todos.length} Tasks` : 'Delete Task'}
          </AppButton>
        </footer>
      </DialogPanel>
    </DialogBackdrop>
  );
}
