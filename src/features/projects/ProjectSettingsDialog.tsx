import { useForm } from '@tanstack/react-form';
import {
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  ImageOff,
  Wrench,
  X,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type {
  ProjectActionsDirectorySummary,
  ProjectActionSummary,
  ProjectSummary,
} from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { AppSegmentedControl } from '../../ui/SegmentedControl';

export type ProjectSettingsSubmit = {
  name: string;
  client: string;
  workingDirectory: string;
  displayIdPrefix: string;
  actionsDirectory: string;
  projectFolderOpenApp: string;
  mainBranch: string;
  terminalWslEnabled: boolean;
  inheritParent?: boolean;
};

export type ProjectGitRepositorySummary = {
  fullName: string;
  htmlUrl: string;
  remoteUrl: string;
};

export type ConnectGitHubRepositorySubmit = {
  owner: string;
  repoName: string;
  visibility: 'public' | 'private';
};

type ProjectSettingsDialogProps = {
  actionsDirectory: ProjectActionsDirectorySummary | null;
  clientOptions: string[];
  onClose: () => void;
  onChooseBackgroundImage: () => void;
  onClearBackgroundImage: () => void;
  onConnectGitHub: (value: ConnectGitHubRepositorySubmit) => void;
  onCreateActionsDirectory: () => void;
  onOpenActionsDirectory: () => void;
  onOpenGitHub: (url: string) => void;
  onOpenProjectFolder: () => void;
  onPushGitHub: () => void;
  onSubmit: (value: ProjectSettingsSubmit) => void;
  projectActions: ProjectActionSummary[];
  gitRepository: ProjectGitRepositorySummary | null;
  ownerOptions: string[];
  project: ProjectSummary;
  isSubproject?: boolean;
};

export function ProjectSettingsDialog({
  actionsDirectory,
  clientOptions,
  onClose,
  onChooseBackgroundImage,
  onClearBackgroundImage,
  onConnectGitHub,
  onCreateActionsDirectory,
  onOpenActionsDirectory,
  onOpenGitHub,
  onOpenProjectFolder,
  onPushGitHub,
  onSubmit,
  projectActions,
  gitRepository,
  ownerOptions,
  project,
  isSubproject,
}: ProjectSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'git'>('settings');
  const [gitHubFormOpen, setGitHubFormOpen] = useState(false);
  const nativeOpenFolder = projectActions.find(
    (action) => action.fileName === 'boomerang:open-folder',
  );
  const form = useForm({
    defaultValues: {
      actionsDirectory: project.actionsDirectory,
      client: project.client,
      displayIdPrefix: project.displayIdPrefix,
      inheritParent: project.inheritParent,
      mainBranch: project.mainBranch,
      name: project.name,
      projectFolderOpenApp: project.projectFolderOpenApp,
      terminalWslEnabled: project.terminalWslEnabled,
      workingDirectory: project.workingDirectory,
    },
    onSubmit: ({ value }: { value: ProjectSettingsSubmit }) => {
      const next: ProjectSettingsSubmit = {
        actionsDirectory: value.actionsDirectory.trim(),
        client: value.client.trim(),
        displayIdPrefix: value.displayIdPrefix.trim().toUpperCase(),
        mainBranch: value.mainBranch.trim(),
        name: value.name.trim(),
        projectFolderOpenApp: value.projectFolderOpenApp.trim(),
        terminalWslEnabled: value.terminalWslEnabled,
        workingDirectory: value.workingDirectory.trim(),
        ...(isSubproject ? { inheritParent: value.inheritParent } : {}),
      };

      if (
        !next.actionsDirectory ||
        !next.displayIdPrefix ||
        !next.mainBranch ||
        !next.name ||
        !next.projectFolderOpenApp ||
        !next.workingDirectory
      ) {
        return;
      }

      onSubmit(next);
    },
  });
  const showWslTerminalSetting = isWindowsRuntime();

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="project-settings-title"
        aria-modal="true"
        className="project-settings-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="project-settings-title">Project Settings</h2>
            <p>{project.name}</p>
          </div>
          <AppButton
            aria-label="Close project settings"
            onClick={onClose}
            variant="icon"
          >
            <X size={16} />
          </AppButton>
        </header>

        <div
          aria-label="Project settings sections"
          className="project-settings-tabs"
          role="tablist"
        >
          <button
            aria-selected={activeTab === 'settings'}
            className={activeTab === 'settings' ? 'active' : undefined}
            onClick={() => setActiveTab('settings')}
            role="tab"
            type="button"
          >
            Settings
          </button>
          <button
            aria-selected={activeTab === 'git'}
            className={activeTab === 'git' ? 'active' : undefined}
            onClick={() => setActiveTab('git')}
            role="tab"
            type="button"
          >
            Git Config
          </button>
        </div>

        {activeTab === 'settings' ? (
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Field name="name">
              {(field) => (
                <label className="form-field">
                  <span>Project name</span>
                  <input
                    aria-label="Project name"
                    autoFocus
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <form.Field name="client">
              {(field) => (
                <div className="form-field">
                  <span>Client</span>
                  <ClientCombobox
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                    options={clientOptions}
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="workingDirectory">
              {(field) => (
                <label className="form-field">
                  <span>Working directory</span>
                  <input
                    aria-label="Working directory"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <div className="form-grid">
              <form.Field name="displayIdPrefix">
                {(field) => (
                  <label className="form-field">
                    <span>Display ID prefix</span>
                    <input
                      aria-label="Display ID prefix"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      value={field.state.value}
                    />
                  </label>
                )}
              </form.Field>

              <form.Field name="actionsDirectory">
                {(field) => (
                  <label className="form-field">
                    <span>Actions directory</span>
                    <input
                      aria-label="Actions directory"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      value={field.state.value}
                    />
                  </label>
                )}
              </form.Field>
            </div>

            <form.Field name="projectFolderOpenApp">
              {(field) => (
                <label className="form-field">
                  <span>Project folder open app</span>
                  <input
                    aria-label="Project folder open app"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="cursor"
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <form.Field name="mainBranch">
              {(field) => (
                <label className="form-field">
                  <span>Main branch</span>
                  <input
                    aria-label="Main branch"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="main"
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            {isSubproject ? (
              <form.Field name="inheritParent">
                {(field) => (
                  <label className="form-check">
                    <input
                      aria-label="Inherit parent folder and notes"
                      checked={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Inherit parent folder and notes</span>
                  </label>
                )}
              </form.Field>
            ) : null}

            {showWslTerminalSetting ? (
              <form.Field name="terminalWslEnabled">
                {(field) => (
                  <label className="form-check">
                    <input
                      aria-label="Run terminals in WSL"
                      checked={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>Run terminals in WSL</span>
                  </label>
                )}
              </form.Field>
            ) : null}

            <section className="project-settings-actions">
              <div className="project-settings-actions-header">
                <div>
                  <span>Task header background</span>
                  <code>
                    {project.backgroundImagePath || 'No image selected'}
                  </code>
                </div>
                <span
                  className={`directory-status ${project.backgroundImagePath ? 'exists' : 'missing'}`}
                >
                  {project.backgroundImagePath ? 'Set' : 'Not set'}
                </span>
              </div>

              <div className="project-settings-action-buttons">
                <AppButton
                  onClick={onChooseBackgroundImage}
                  type="button"
                  variant="secondary"
                >
                  <ImageIcon size={15} />
                  Choose Background Image
                </AppButton>
                {project.backgroundImagePath ? (
                  <AppButton
                    onClick={onClearBackgroundImage}
                    type="button"
                    variant="secondary"
                  >
                    <ImageOff size={15} />
                    Clear Background Image
                  </AppButton>
                ) : null}
              </div>
            </section>

            <section className="project-settings-actions">
              <div className="project-settings-actions-header">
                <div>
                  <span>Resolved actions directory</span>
                  <code>{actionsDirectory?.path ?? 'Resolving...'}</code>
                </div>
                <span
                  className={`directory-status ${actionsDirectory?.exists ? 'exists' : 'missing'}`}
                >
                  {actionsDirectory?.exists ? 'Exists' : 'Not created'}
                </span>
              </div>

              <div className="project-settings-action-buttons">
                <AppButton
                  onClick={onOpenProjectFolder}
                  type="button"
                  variant="secondary"
                >
                  <Folder size={15} />
                  Open Folder
                </AppButton>
                {actionsDirectory?.exists ? (
                  <AppButton
                    onClick={onOpenActionsDirectory}
                    type="button"
                    variant="secondary"
                  >
                    <FolderOpen size={15} />
                    Open Actions Directory
                  </AppButton>
                ) : (
                  <AppButton
                    onClick={onCreateActionsDirectory}
                    type="button"
                    variant="secondary"
                  >
                    <FolderOpen size={15} />
                    Create Actions Directory
                  </AppButton>
                )}
              </div>

              <div className="native-action-summary">
                <Wrench size={15} />
                <div>
                  <strong>{nativeOpenFolder?.title ?? 'Open Folder'}</strong>
                  <span>
                    native · 0 args ·{' '}
                    {nativeOpenFolder?.fileName ?? 'boomerang:open-folder'}
                  </span>
                  <small>
                    The built-in Open Folder action is always available.
                  </small>
                </div>
              </div>
            </section>

            <footer className="dialog-actions">
              <AppButton onClick={onClose} variant="secondary">
                Cancel
              </AppButton>
              <form.Subscribe
                selector={(state) => ({
                  actionsDirectory: state.values.actionsDirectory,
                  displayIdPrefix: state.values.displayIdPrefix,
                  isSubmitting: state.isSubmitting,
                  mainBranch: state.values.mainBranch,
                  name: state.values.name,
                  projectFolderOpenApp: state.values.projectFolderOpenApp,
                  workingDirectory: state.values.workingDirectory,
                })}
              >
                {({
                  actionsDirectory,
                  displayIdPrefix,
                  isSubmitting,
                  mainBranch,
                  name,
                  projectFolderOpenApp,
                  workingDirectory,
                }) => (
                  <AppButton
                    disabled={
                      isSubmitting ||
                      !actionsDirectory.trim() ||
                      !displayIdPrefix.trim() ||
                      !mainBranch.trim() ||
                      !name.trim() ||
                      !projectFolderOpenApp.trim() ||
                      !workingDirectory.trim()
                    }
                    type="submit"
                    variant="primary"
                  >
                    Save Settings
                  </AppButton>
                )}
              </form.Subscribe>
            </footer>
          </form>
        ) : (
          <GitConfigPanel
            gitRepository={gitRepository}
            onConnectGitHub={() => setGitHubFormOpen(true)}
            onOpenGitHub={onOpenGitHub}
            onPushGitHub={onPushGitHub}
          />
        )}

        {gitHubFormOpen ? (
          <ConnectGitHubDialog
            defaultRepoName={project.name}
            ownerOptions={ownerOptions}
            onCancel={() => setGitHubFormOpen(false)}
            onSubmit={(value) => {
              onConnectGitHub(value);
              setGitHubFormOpen(false);
            }}
          />
        ) : null}
      </DialogPanel>
    </DialogBackdrop>
  );
}

function GitConfigPanel({
  gitRepository,
  onConnectGitHub,
  onOpenGitHub,
  onPushGitHub,
}: {
  gitRepository: ProjectGitRepositorySummary | null;
  onConnectGitHub: () => void;
  onOpenGitHub: (url: string) => void;
  onPushGitHub: () => void;
}) {
  return (
    <div className="dialog-form">
      <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-warm)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-xs font-extrabold uppercase tracking-wide text-[var(--color-text-muted)]">
              Assigned repository
            </span>
            <strong className="truncate text-base font-extrabold text-[var(--color-text-strong)]">
              {gitRepository?.fullName ?? 'No GitHub repository connected'}
            </strong>
            <code className="break-all font-mono text-xs font-semibold text-[var(--color-text-muted)]">
              {gitRepository?.remoteUrl ?? 'origin remote not found'}
            </code>
          </div>
          <span
            className={`directory-status ${gitRepository ? 'exists' : 'missing'}`}
          >
            {gitRepository ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <p className="m-0 max-w-[46rem] text-sm leading-6 text-[var(--color-text-muted)]">
          {gitRepository
            ? 'This project folder is linked to GitHub through its origin remote.'
            : 'Create a GitHub repository and attach it as the origin remote for this project folder.'}
        </p>

        <div className="flex flex-wrap gap-2">
          {gitRepository ? (
            <>
              <AppButton
                onClick={() => onOpenGitHub(gitRepository.htmlUrl)}
                type="button"
                variant="secondary"
              >
                <ExternalLink size={15} />
                Open in GitHub
              </AppButton>
              <AppButton onClick={onPushGitHub} type="button" variant="primary">
                <GitBranch size={15} />
                Push to GitHub
              </AppButton>
            </>
          ) : (
            <AppButton
              onClick={onConnectGitHub}
              type="button"
              variant="primary"
            >
              <GitBranch size={15} />
              Connect with Github
            </AppButton>
          )}
        </div>
      </section>
    </div>
  );
}

function isWindowsRuntime() {
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    '';
  return /win/i.test(platform) || /windows/i.test(navigator.userAgent);
}

function ConnectGitHubDialog({
  defaultRepoName,
  onCancel,
  onSubmit,
  ownerOptions,
}: {
  defaultRepoName: string;
  onCancel: () => void;
  onSubmit: (value: ConnectGitHubRepositorySubmit) => void;
  ownerOptions: string[];
}) {
  const defaultOwner = ownerOptions[0] ?? '';
  const [owner, setOwner] = useState(defaultOwner);
  const [repoName, setRepoName] = useState(slugifyRepoName(defaultRepoName));
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const canSubmit = owner.trim().length > 0 && repoName.trim().length > 0;

  return (
    <DialogBackdrop className="nested-dialog-backdrop">
      <DialogPanel
        aria-labelledby="connect-github-title"
        aria-modal="true"
        className="min-h-[480px] w-[min(560px,100%)] max-w-[min(560px,100%)]"
        onCancel={onCancel}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="connect-github-title">Connect with Github</h2>
            <p>Create a repository for this project folder.</p>
          </div>
          <AppButton
            aria-label="Cancel GitHub connection"
            onClick={onCancel}
            variant="icon"
          >
            <X size={16} />
          </AppButton>
        </header>

        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) {
              return;
            }
            onSubmit({
              owner: owner.trim(),
              repoName: repoName.trim(),
              visibility,
            });
          }}
        >
          <div className="form-field">
            <span>Owner</span>
            <ClientCombobox
              ariaLabel="Owner"
              onBlur={() => undefined}
              onChange={setOwner}
              options={ownerOptions}
              placeholder="GitHub owner"
              value={owner}
            />
          </div>

          <label className="form-field">
            <span>Repo name</span>
            <input
              aria-label="Repo name"
              onChange={(event) =>
                setRepoName(slugifyRepoName(event.target.value))
              }
              value={repoName}
              placeholder="lowercase-dashes"
            />
          </label>

          <div className="form-field">
            <span>Visibility</span>
            <AppSegmentedControl
              aria-label="Visibility"
              onChange={(value) => setVisibility(value as 'public' | 'private')}
              options={[
                { label: 'Public', value: 'public' },
                { label: 'Private', value: 'private' },
              ]}
              value={visibility}
            />
          </div>

          <footer className="dialog-actions">
            <AppButton onClick={onCancel} type="button" variant="secondary">
              Cancel
            </AppButton>
            <AppButton disabled={!canSubmit} type="submit" variant="primary">
              Create repository
            </AppButton>
          </footer>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}

function slugifyRepoName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ClientCombobox({
  ariaLabel = 'Client',
  onBlur,
  onChange,
  options,
  placeholder = 'Client name',
  value,
}: {
  ariaLabel?: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  value: string;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState('');
  const clientOptions = useMemo(() => uniqueClientOptions(options), [options]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return clientOptions;
    }

    return clientOptions.filter((option) =>
      option.toLowerCase().includes(normalizedQuery),
    );
  }, [clientOptions, query]);
  const listOpen = open && filteredOptions.length > 0;
  const activeOptionIndex = Math.min(
    activeIndex,
    Math.max(filteredOptions.length - 1, 0),
  );
  const activeOption = filteredOptions[activeOptionIndex];

  const selectOption = (option: string) => {
    onChange(option);
    setActiveIndex(0);
    setQuery('');
    setOpen(false);
  };

  return (
    <div
      className="client-combobox"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setOpen(false);
        }
        onBlur();
      }}
    >
      <input
        aria-activedescendant={
          listOpen && activeOption
            ? clientOptionId(listboxId, activeOptionIndex)
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={listOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          setActiveIndex(0);
          setQuery('');
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)),
            );
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.max(index - 1, 0));
          }

          if (event.key === 'Enter' && listOpen && activeOption) {
            event.preventDefault();
            selectOption(activeOption);
          }

          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        role="combobox"
        value={value}
      />
      {listOpen ? (
        <div className="client-combobox-list" id={listboxId} role="listbox">
          {filteredOptions.map((option, index) => (
            <button
              aria-selected={index === activeOptionIndex}
              className="client-combobox-option"
              id={clientOptionId(listboxId, index)}
              key={option}
              onMouseDown={(event) => {
                event.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function uniqueClientOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const option of options) {
    const client = option.trim();
    const key = client.toLowerCase();
    if (!client || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(client);
  }

  return unique.sort((left, right) => left.localeCompare(right));
}

function clientOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}
