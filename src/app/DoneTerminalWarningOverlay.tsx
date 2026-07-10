import { useAtom } from 'jotai';

import { DoneTerminalWarningDialog } from '../features/tasks/DoneTerminalWarningDialog';
import { pendingDoneTerminalWarningAtom } from './useMainAppUiState';

export function DoneTerminalWarningOverlay({
  onCancel,
  onCommitAndContinue,
  onConfirm,
}: {
  onCancel: () => void;
  onCommitAndContinue: () => void;
  onConfirm: () => void;
}) {
  const [pendingDoneTerminalWarning, setPendingDoneTerminalWarning] = useAtom(
    pendingDoneTerminalWarningAtom,
  );

  if (!pendingDoneTerminalWarning) {
    return null;
  }

  return (
    <DoneTerminalWarningDialog
      neverShowAgain={pendingDoneTerminalWarning.neverShowAgain}
      onCancel={onCancel}
      onCommitAndContinue={onCommitAndContinue}
      onConfirm={onConfirm}
      onNeverShowAgainChange={(neverShowAgain) =>
        setPendingDoneTerminalWarning((pending) =>
          pending ? { ...pending, neverShowAgain } : pending,
        )
      }
      terminalTabs={pendingDoneTerminalWarning.terminalTabs}
      worktrees={pendingDoneTerminalWarning.worktrees}
    />
  );
}
