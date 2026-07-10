import { useEffect } from 'react';

import type { ExecutionTerminalSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';

export type DoneWarningWorktree = {
  dirty: boolean | null;
  displayId: string;
  path: string;
  title: string;
  todoId: number;
};

export function DoneTerminalWarningDialog({
  neverShowAgain,
  onCancel,
  onCommitAndContinue,
  onConfirm,
  onNeverShowAgainChange,
  terminalTabs,
  worktrees,
}: {
  neverShowAgain: boolean;
  onCancel: () => void;
  onCommitAndContinue: () => void;
  onConfirm: () => void;
  onNeverShowAgainChange: (neverShowAgain: boolean) => void;
  terminalTabs: ExecutionTerminalSummary[];
  worktrees: DoneWarningWorktree[];
}) {
  const count = terminalTabs.length;
  const plural = count === 1 ? 'terminal tab' : 'terminal tabs';
  const hasWorktrees = worktrees.length > 0;
  const hasDirtyWorktree = worktrees.some((worktree) => worktree.dirty);
  useEffect(() => {
    document.getElementById('done-terminal-warning-panel')?.focus();
  }, []);

  return (
    <DialogBackdrop persistent>
      <DialogPanel
        aria-labelledby="done-terminal-warning-title"
        aria-modal="true"
        className="delete-tasks-dialog"
        id="done-terminal-warning-panel"
        onCancel={onCancel}
        persistent
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <h2 id="done-terminal-warning-title">
              {hasWorktrees ? 'Finish worktree task' : 'Close terminal tabs'}
            </h2>
            <p>
              Setting this task to Done
              {count > 0 ? ` will close ${count} ${plural}` : ''}
              {hasWorktrees ? ' and delete the task worktree' : ''}. Continue only if
              nothing important is still running or uncommitted.
            </p>
            {hasDirtyWorktree ? (
              <p>This worktree is dirty. Continuing will delete its uncommitted files.</p>
            ) : null}
          </div>
        </header>
        {terminalTabs.length > 0 || hasWorktrees ? (
          <div className="delete-tasks-list">
            {terminalTabs.map((terminal) => (
            <div className="delete-tasks-list-row" key={terminal.ptyId}>
              <span>{terminal.label}</span>
            </div>
            ))}
            {worktrees.map((worktree) => (
              <div className="delete-tasks-list-row" key={worktree.todoId}>
                <span>
                  {worktree.displayId} worktree
                  {worktree.dirty === null ? ' (checking...)' : worktree.dirty ? ' (dirty)' : ' (clean)'}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {count === 1 ? (
          <label className="form-check">
            <input
              checked={neverShowAgain}
              onChange={(event) => onNeverShowAgainChange(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>Never show this single-terminal warning again</span>
          </label>
        ) : null}
        <footer className="dialog-actions">
          <AppButton onClick={onCancel} variant="secondary">
            Cancel
          </AppButton>
          {hasWorktrees ? (
            <AppButton onClick={onCommitAndContinue} variant="secondary">
              Commit & Merge and Continue
            </AppButton>
          ) : null}
          <AppButton onClick={onConfirm} variant="primary">
            Continue
          </AppButton>
        </footer>
      </DialogPanel>
    </DialogBackdrop>
  );
}
