import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectActionsDirectorySummary, ProjectSummary } from '../../domain/domain';
import { isWindowsPlatform } from '../../tauri/platform';
import { AppButton } from '../../ui/Button';
import { BoomerangMark } from '../../ui/BoomerangMark';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';

export type NewProjectDialogSubmit = {
  name: string;
  workingDirectory: string;
  displayIdPrefix: string;
  terminalWslEnabled: boolean;
  parentProjectId?: number;
  inheritParent?: boolean;
};

type DirectoryStatus =
  | { state: 'idle' | 'checking' | 'creating' }
  | { state: 'ready' | 'missing'; summary: ProjectActionsDirectorySummary }
  | { state: 'error'; message: string };

type NewProjectDialogProps = {
  existingProjects: ProjectSummary[];
  onChooseWorkingDirectory?: (currentPath: string) => Promise<string | null>;
  onClose: () => void;
  onCreateWorkingDirectory: (path: string) => Promise<ProjectActionsDirectorySummary>;
  onSubmit: (value: NewProjectDialogSubmit) => void;
  onWorkingDirectoryStatus: (path: string) => Promise<ProjectActionsDirectorySummary>;
  parentProject?: ProjectSummary;
};

export function NewProjectDialog({
  existingProjects,
  onChooseWorkingDirectory,
  onClose,
  onCreateWorkingDirectory,
  onSubmit,
  onWorkingDirectoryStatus,
  parentProject,
}: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('~/p/');
  const [displayIdPrefix, setDisplayIdPrefix] = useState(
    uniqueProjectPrefix('', existingProjects),
  );
  const [workingDirectoryEdited, setWorkingDirectoryEdited] = useState(false);
  const [prefixEdited, setPrefixEdited] = useState(false);
  const [inheritParent, setInheritParent] = useState(true);
  const [terminalWslEnabled, setTerminalWslEnabled] = useState(false);
  const [directoryStatus, setDirectoryStatus] = useState<DirectoryStatus>({
    state: 'idle',
  });
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const usedPrefixes = useMemo(
    () =>
      new Set(
        existingProjects.map((project) => project.displayIdPrefix.trim().toUpperCase()),
      ),
    [existingProjects],
  );
  const prefixConflict = usedPrefixes.has(displayIdPrefix.trim().toUpperCase());
  const inheriting = Boolean(parentProject) && inheritParent;
  const showWslTerminalSetting = isWindowsPlatform();
  const canSubmit =
    name.trim().length > 0 &&
    (inheriting ||
      (workingDirectory.trim().length > 0 && directoryStatus.state === 'ready')) &&
    displayIdPrefix.trim().length > 0 &&
    !prefixConflict;

  useEffect(() => {
    if (inheriting) {
      return;
    }
    const path = workingDirectory.trim();
    if (!path || path === '~/p/') {
      setDirectoryStatus({ state: 'idle' });
      return;
    }

    let active = true;
    setDirectoryStatus({ state: 'checking' });
    void onWorkingDirectoryStatus(path)
      .then((summary) => {
        if (!active) {
          return;
        }

        setDirectoryStatus({
          state: summary.exists ? 'ready' : 'missing',
          summary,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setDirectoryStatus({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
    };
  }, [inheriting, onWorkingDirectoryStatus, workingDirectory]);

  const updateName = (value: string) => {
    setName(value);
    if (!workingDirectoryEdited) {
      setWorkingDirectory(suggestWorkingDirectory(value));
    }
    if (!prefixEdited) {
      setDisplayIdPrefix(uniqueProjectPrefix(value, existingProjects));
    }
  };

  const createWorkingDirectory = async () => {
    const path = workingDirectory.trim();
    if (!path) {
      return;
    }

    setDirectoryStatus({ state: 'creating' });
    try {
      const summary = await onCreateWorkingDirectory(path);
      setDirectoryStatus({
        state: summary.exists ? 'ready' : 'missing',
        summary,
      });
    } catch (error) {
      setDirectoryStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const chooseWorkingDirectory = async () => {
    if (!onChooseWorkingDirectory) {
      directoryInputRef.current?.focus();
      directoryInputRef.current?.select();
      return;
    }

    try {
      const selectedDirectory = await onChooseWorkingDirectory(workingDirectory.trim());
      if (!selectedDirectory) {
        return;
      }

      setWorkingDirectoryEdited(true);
      setWorkingDirectory(selectedDirectory);
    } catch (error) {
      setDirectoryStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <DialogBackdrop className="new-project-backdrop">
      <DialogPanel
        aria-labelledby="new-project-title"
        aria-modal="true"
        className="new-project-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="new-project-header">
          <BoomerangMark />
          <div>
            <h2 id="new-project-title">New Project</h2>
            <p>Create a workspace with its own tasks, actions, notes, and task ID prefix.</p>
            {parentProject ? (
              <p className="new-project-hint">Subproject of {parentProject.name}</p>
            ) : null}
          </div>
          <AppButton aria-label="Close new project" onClick={onClose} variant="icon">
            <X size={18} />
          </AppButton>
        </header>
        <form
          className="new-project-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) {
              return;
            }

            onSubmit({
              displayIdPrefix: displayIdPrefix.trim().toUpperCase(),
              name: name.trim(),
              terminalWslEnabled: showWslTerminalSetting ? terminalWslEnabled : false,
              workingDirectory: workingDirectory.trim(),
              ...(parentProject ? { parentProjectId: parentProject.id, inheritParent } : {}),
            });
          }}
        >
          <label className="new-project-field">
            <span>
              <strong>Name</strong>
              <em>Required</em>
            </span>
            <input
              aria-label="Project name"
              autoFocus
              onChange={(event) => updateName(event.target.value)}
              placeholder="Project name"
              value={name}
            />
            <small>Shown in the project switcher and used to suggest the working directory.</small>
          </label>

          <div className="new-project-grid">
            {parentProject ? (
              <label className="form-field new-project-inherit">
                <input
                  aria-label="Inherit parent folder and notes"
                  checked={inheritParent}
                  onChange={(event) => setInheritParent(event.target.checked)}
                  type="checkbox"
                />
                <span>Inherit parent folder and notes</span>
              </label>
            ) : null}
            {!inheriting ? (
              <label className="new-project-field new-project-directory-field">
                <span>
                  <strong>Working directory</strong>
                </span>
                <div className="new-project-directory-row">
                  <input
                    aria-label="Project working directory"
                    onChange={(event) => {
                      setWorkingDirectoryEdited(true);
                      setWorkingDirectory(event.target.value);
                    }}
                    ref={directoryInputRef}
                    value={workingDirectory}
                  />
                  <AppButton
                    onClick={() => void chooseWorkingDirectory()}
                    type="button"
                    variant="secondary"
                  >
                    Choose
                  </AppButton>
                </div>
                <small>Project actions and agent sessions launch from this folder.</small>
              </label>
            ) : null}

            {showWslTerminalSetting ? (
              <label className="form-check">
                <input
                  aria-label="Run terminals in WSL"
                  checked={terminalWslEnabled}
                  onChange={(event) => setTerminalWslEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span>Run terminals in WSL</span>
              </label>
            ) : null}

            <label className="new-project-field">
              <span>
                <strong>Task prefix</strong>
              </span>
              <input
                aria-label="Project task prefix"
                maxLength={8}
                onChange={(event) => {
                  setPrefixEdited(true);
                  setDisplayIdPrefix(sanitizePrefix(event.target.value));
                }}
                value={displayIdPrefix}
              />
              <small>Example: {displayIdPrefix || 'T'}-001</small>
            </label>
          </div>

          {prefixConflict ? (
            <p className="new-project-inline-error">
              Task prefix already exists. Choose another prefix.
            </p>
          ) : null}

          {!inheriting ? (
            <DirectoryStatusCard
              status={directoryStatus}
              workingDirectory={workingDirectory}
              onCreateWorkingDirectory={createWorkingDirectory}
            />
          ) : null}

          <footer className="new-project-footer">
            <p>Project settings can be changed later.</p>
            <div>
              <AppButton onClick={onClose} variant="secondary">
                Cancel
              </AppButton>
              <AppButton disabled={!canSubmit} type="submit" variant="primary">
                Create Project
              </AppButton>
            </div>
          </footer>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}

function DirectoryStatusCard({
  status,
  workingDirectory,
  onCreateWorkingDirectory,
}: {
  status: DirectoryStatus;
  workingDirectory: string;
  onCreateWorkingDirectory: () => void;
}) {
  if (status.state === 'idle') {
    return null;
  }

  if (status.state === 'checking' || status.state === 'creating') {
    return (
      <div className="new-project-status-card neutral">
        <AlertCircle size={18} />
        <div>
          <strong>
            {status.state === 'creating' ? 'Creating working directory' : 'Checking working directory'}
          </strong>
          <p>{workingDirectory}</p>
        </div>
      </div>
    );
  }

  if (status.state === 'ready') {
    return (
      <div className="new-project-status-card ready">
        <CheckCircle2 size={18} />
        <div>
          <strong>Working directory ready</strong>
          <p>{status.summary.path}</p>
        </div>
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="new-project-status-card missing">
        <AlertCircle size={18} />
        <div>
          <strong>Could not check working directory</strong>
          <p>{status.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="new-project-status-card missing">
      <AlertCircle size={18} />
      <div>
        <strong>Working directory not found</strong>
        <p>{workingDirectory.trim()} does not exist yet. Create it now or choose another folder.</p>
      </div>
      <AppButton onClick={onCreateWorkingDirectory} type="button" variant="primary">
        Create folder
      </AppButton>
    </div>
  );
}

function suggestWorkingDirectory(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.join('-');

  return slug ? `~/p/${slug}` : '~/p/';
}

function uniqueProjectPrefix(name: string, projects: ProjectSummary[]): string {
  const used = new Set(
    projects.map((project) => project.displayIdPrefix.trim().toUpperCase()),
  );
  const base = prefixFromName(name);
  if (!used.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, Math.max(1, 8 - suffixText.length))}${suffixText}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return base;
}

function prefixFromName(name: string): string {
  const parts = name.match(/[A-Za-z0-9]+/g) ?? [];
  if (parts.length >= 2) {
    return sanitizePrefix(parts.map((part) => part[0]).join('')) || 'T';
  }

  return sanitizePrefix(parts[0]?.slice(0, 1) ?? 'T') || 'T';
}

function sanitizePrefix(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
}
