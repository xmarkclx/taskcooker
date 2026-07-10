import { ArrowUpRight, Plus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import type { AppSettingsSummary, ProjectSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import type { ProjectSettingsSubmit } from './ProjectSettingsDialog';

export type FocusedProjectDetailProps = {
  clientOptions: string[];
  isSubproject: boolean;
  markdownEditorMode?: AppSettingsSummary['markdownEditorMode'];
  markdownEditorFontFamily?: AppSettingsSummary['markdownEditorFontFamily'];
  markdownEditorFontSize?: string;
  markdownEditorMaxImageHeight?: string;
  markdownTocHidden?: boolean;
  markdownTocWidth?: number;
  onMarkdownEditorModeChange?: (mode: AppSettingsSummary['markdownEditorMode']) => void;
  onMarkdownTocHiddenChange?: (hidden: boolean) => void;
  onMarkdownTocWidthChange?: (width: number) => void;
  onNewRootTask: () => void;
  onOpenImage?: (src: string) => void;
  onOpenProject: () => void;
  onSaveNotes: (notesMarkdown: string) => void;
  onSubmitSettings: (value: ProjectSettingsSubmit) => void;
  project: ProjectSummary;
};

type FocusedProjectTab = 'notes' | 'settings';

export function FocusedProjectDetail({
  clientOptions,
  isSubproject,
  markdownEditorMode,
  markdownEditorFontFamily,
  markdownEditorFontSize,
  markdownEditorMaxImageHeight,
  markdownTocHidden,
  markdownTocWidth,
  onMarkdownEditorModeChange,
  onMarkdownTocHiddenChange,
  onMarkdownTocWidthChange,
  onNewRootTask,
  onOpenImage,
  onOpenProject,
  onSaveNotes,
  onSubmitSettings,
  project,
}: FocusedProjectDetailProps) {
  const [activeTab, setActiveTab] = useState<FocusedProjectTab>('notes');
  const [settings, setSettings] = useState(() => projectSettingsDraft(project));
  const clientListId = useId();

  useEffect(() => {
    setActiveTab('notes');
    setSettings(projectSettingsDraft(project));
  }, [project.id]);

  const updateSetting = <Key extends keyof ProjectSettingsSubmit>(
    key: Key,
    value: ProjectSettingsSubmit[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const normalizedSettings = normalizeProjectSettings(settings, isSubproject);
  const canSave =
    normalizedSettings.actionsDirectory.length > 0 &&
    normalizedSettings.displayIdPrefix.length > 0 &&
    normalizedSettings.mainBranch.length > 0 &&
    normalizedSettings.name.length > 0 &&
    normalizedSettings.projectFolderOpenApp.length > 0 &&
    normalizedSettings.workingDirectory.length > 0;

  return (
    <section
      aria-label={`Focused project ${project.name}`}
      className="detail-pane focused-project-detail"
      role="region"
    >
      <header className="detail-header focused-project-header">
        <div className="detail-id-row">
          <span className="copy-id">{project.displayIdPrefix}</span>
          <span className={`state-badge ${project.status.toLowerCase().replace(/\s+/g, '-')}`}>
            {project.status}
          </span>
        </div>
        <h1 className="detail-title-heading">{project.name}</h1>
        <p className="focused-project-meta">{project.workingDirectory}</p>
        <div className="detail-actions focused-project-actions">
          <AppButton
            aria-label="Open focused project"
            className="task-header-action-button"
            onClick={onOpenProject}
            title="Open Project"
            variant="secondary"
          >
            <ArrowUpRight size={15} />
            Open Project
          </AppButton>
          <AppButton
            aria-label="New root task"
            className="task-header-action-button"
            onClick={onNewRootTask}
            title="New root task"
            variant="secondary"
          >
            <Plus size={15} />
            New Root Task
          </AppButton>
        </div>
      </header>

      <div className="focused-project-body">
        <div aria-label="Focused project sections" className="project-settings-tabs" role="tablist">
          <button
            aria-selected={activeTab === 'notes'}
            className={activeTab === 'notes' ? 'active' : undefined}
            onClick={() => setActiveTab('notes')}
            role="tab"
            type="button"
          >
            Project Notes
          </button>
          <button
            aria-selected={activeTab === 'settings'}
            className={activeTab === 'settings' ? 'active' : undefined}
            onClick={() => setActiveTab('settings')}
            role="tab"
            type="button"
          >
            Project Settings
          </button>
        </div>

        {activeTab === 'notes' ? (
          <div className="focused-project-notes" role="tabpanel">
            <MarkdownEditor
              ariaLabel="Project Notes Markdown"
              attachmentTarget={{
                projectId: project.id,
                scope: 'project-notes',
              }}
              conflictLabel="Project notes changed elsewhere."
              fontFamily={markdownEditorFontFamily}
              fontSize={markdownEditorFontSize}
              maxImageHeight={markdownEditorMaxImageHeight}
              markdown={project.notesMarkdown}
              mode={markdownEditorMode}
              onModeChange={onMarkdownEditorModeChange}
              onOpenImage={onOpenImage}
              onSave={onSaveNotes}
              onTocHiddenChange={onMarkdownTocHiddenChange}
              onTocWidthChange={onMarkdownTocWidthChange}
              scrollKey={`project:${project.id}:focused-notes`}
              tocHidden={markdownTocHidden}
              tocWidth={markdownTocWidth}
            />
          </div>
        ) : (
          <form
            className="dialog-form focused-project-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) {
                onSubmitSettings(normalizedSettings);
              }
            }}
            role="tabpanel"
          >
            <label className="form-field">
              <span>Project name</span>
              <input
                aria-label="Project name"
                onChange={(event) => updateSetting('name', event.target.value)}
                value={settings.name}
              />
            </label>

            <label className="form-field">
              <span>Client</span>
              <input
                aria-label="Client"
                list={clientListId}
                onChange={(event) => updateSetting('client', event.target.value)}
                value={settings.client}
              />
              <datalist id={clientListId}>
                {uniqueClientOptions(clientOptions).map((client) => (
                  <option key={client} value={client} />
                ))}
              </datalist>
            </label>

            <label className="form-field">
              <span>Working directory</span>
              <input
                aria-label="Working directory"
                onChange={(event) => updateSetting('workingDirectory', event.target.value)}
                value={settings.workingDirectory}
              />
            </label>

            <div className="form-grid">
              <label className="form-field">
                <span>Display ID prefix</span>
                <input
                  aria-label="Display ID prefix"
                  onChange={(event) => updateSetting('displayIdPrefix', event.target.value)}
                  value={settings.displayIdPrefix}
                />
              </label>

              <label className="form-field">
                <span>Actions directory</span>
                <input
                  aria-label="Actions directory"
                  onChange={(event) => updateSetting('actionsDirectory', event.target.value)}
                  value={settings.actionsDirectory}
                />
              </label>
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>Project folder open app</span>
                <input
                  aria-label="Project folder open app"
                  onChange={(event) => updateSetting('projectFolderOpenApp', event.target.value)}
                  value={settings.projectFolderOpenApp}
                />
              </label>

              <label className="form-field">
                <span>Main branch</span>
                <input
                  aria-label="Main branch"
                  onChange={(event) => updateSetting('mainBranch', event.target.value)}
                  value={settings.mainBranch}
                />
              </label>
            </div>

            {isSubproject ? (
              <label className="form-check">
                <input
                  aria-label="Inherit parent folder and notes"
                  checked={settings.inheritParent ?? false}
                  onChange={(event) => updateSetting('inheritParent', event.target.checked)}
                  type="checkbox"
                />
                <span>Inherit parent folder and notes</span>
              </label>
            ) : null}

            <footer className="dialog-actions">
              <AppButton disabled={!canSave} type="submit" variant="primary">
                Save Project Settings
              </AppButton>
            </footer>
          </form>
        )}
      </div>
    </section>
  );
}

function projectSettingsDraft(project: ProjectSummary): ProjectSettingsSubmit {
  return {
    actionsDirectory: project.actionsDirectory,
    client: project.client,
    displayIdPrefix: project.displayIdPrefix,
    inheritParent: project.inheritParent,
    mainBranch: project.mainBranch,
    name: project.name,
    projectFolderOpenApp: project.projectFolderOpenApp,
    terminalWslEnabled: project.terminalWslEnabled,
    workingDirectory: project.workingDirectory,
  };
}

function normalizeProjectSettings(
  settings: ProjectSettingsSubmit,
  isSubproject: boolean,
): ProjectSettingsSubmit {
  return {
    actionsDirectory: settings.actionsDirectory.trim(),
    client: settings.client.trim(),
    displayIdPrefix: settings.displayIdPrefix.trim().toUpperCase(),
    mainBranch: settings.mainBranch.trim(),
    name: settings.name.trim(),
    projectFolderOpenApp: settings.projectFolderOpenApp.trim(),
    terminalWslEnabled: settings.terminalWslEnabled,
    workingDirectory: settings.workingDirectory.trim(),
    ...(isSubproject ? { inheritParent: settings.inheritParent } : {}),
  };
}

function uniqueClientOptions(options: string[]): string[] {
  return Array.from(new Set(options.map((option) => option.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}
