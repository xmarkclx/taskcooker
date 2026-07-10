import { useAtom } from 'jotai';

import type { ExecutionTerminalSummary, ProjectActionSummary } from '../domain/domain';
import {
  ProjectActionRunDialog,
  type ProjectActionArgumentValues,
} from '../features/projects/ProjectActionRunDialog';
import { pendingActionAtom } from './useMainAppUiState';

export function ProjectActionRunOverlay({
  onRunAction,
}: {
  onRunAction: (
    action: ProjectActionSummary,
    values?: ProjectActionArgumentValues,
    options?: { openInTask?: boolean; projectId?: number },
  ) => Promise<void | ExecutionTerminalSummary>;
}) {
  const [pendingAction, setPendingAction] = useAtom(pendingActionAtom);

  if (!pendingAction) {
    return null;
  }

  return (
    <ProjectActionRunDialog
      action={pendingAction.action}
      onClose={() => setPendingAction(null)}
      onRun={(values) => {
        void onRunAction(pendingAction.action, values, pendingAction.options);
        setPendingAction(null);
      }}
    />
  );
}
