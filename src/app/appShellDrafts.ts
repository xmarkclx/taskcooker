type NewTaskDialogDraftState = {
  kind: 'action' | 'task' | 'worktree-task';
};

export function newTaskDialogDraftStorageKey(
  dialog: NewTaskDialogDraftState,
  projectId: number,
  parentId: number | null,
): string | undefined {
  if (!projectId) {
    return undefined;
  }

  if (dialog.kind === 'action') {
    return `boomerang:new-task-dialog-draft:action:${projectId}`;
  }

  return `boomerang:new-task-dialog-draft:task:${projectId}:parent:${parentId ?? 'root'}`;
}

function newTaskParentStorageKey(projectId: number): string | undefined {
  if (!projectId) {
    return undefined;
  }

  return `boomerang:new-task-dialog-parent:${projectId}`;
}

/**
 * Reads the parent task last chosen in the New Task dialog for a project.
 * The caller is responsible for discarding a value that is no longer a valid
 * parent (e.g. the task was deleted or archived) so it falls back to none.
 */
export function readNewTaskParentId(projectId: number): number | null {
  const key = newTaskParentStorageKey(projectId);
  if (!key) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function persistNewTaskParentId(projectId: number, parentId: number | null): void {
  const key = newTaskParentStorageKey(projectId);
  if (!key) {
    return;
  }

  try {
    if (parentId == null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(parentId));
    }
  } catch {
    // Losing the remembered parent should not prevent task creation.
  }
}

export function clearNewTaskDialogDraft(draftStorageKey?: string): void {
  if (!draftStorageKey) {
    return;
  }

  try {
    window.localStorage.removeItem(draftStorageKey);
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}
