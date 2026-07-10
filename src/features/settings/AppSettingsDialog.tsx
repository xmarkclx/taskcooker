import { useForm } from '@tanstack/react-form';
import { Copy, RefreshCw, X } from 'lucide-react';

import type {
  AppSettingsSummary,
  AppThemePreference,
  ProjectSummary,
  TaskTitler,
} from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { AppSelect } from '../../ui/Select';
import { AppSegmentedControl } from '../../ui/SegmentedControl';

export type AppSettingsSubmit = {
  appContextMarkdown: string;
  folderOpenApp: string;
  mcpEnabled: boolean;
  theme: AppThemePreference;
  claudePath: string;
  codexPath: string;
  taskTitler: TaskTitler;
  deepLinkFallback: boolean;
  homeProjectId: number;
  markdownEditorFontFamily: string;
  markdownEditorFontSize: string;
  markdownEditorMaxImageHeight: string;
  projectAccentBorderWidth: number;
  slowdownProfilerEnabled: boolean;
  terminalTmuxEnabled: boolean;
  externalTerminalOpeners: string;
};

const MIN_PROJECT_BORDER_WIDTH = 1;
const MAX_PROJECT_BORDER_WIDTH = 12;

type AppSettingsDialogProps = {
  doneTerminalWarningEnabled?: boolean;
  onClose: () => void;
  onCopyToken: () => void;
  onDoneTerminalWarningEnabledChange?: (enabled: boolean) => void;
  onRegenerateToken: () => void;
  onSubmit: (value: AppSettingsSubmit) => void;
  projects?: ProjectSummary[];
  settings: AppSettingsSummary;
};

export function AppSettingsDialog({
  doneTerminalWarningEnabled = true,
  onClose,
  onCopyToken,
  onDoneTerminalWarningEnabledChange,
  onRegenerateToken,
  onSubmit,
  projects = [],
  settings,
}: AppSettingsDialogProps) {
  const mcpConnectionUrl = `http://127.0.0.1:${settings.mcpPort}/mcp`;
  const mcpStatus = settings.mcpEnabled ? 'Running' : 'Stopped';
  const form = useForm({
    defaultValues: {
      appContextMarkdown: settings.appContextMarkdown,
      folderOpenApp: settings.folderOpenApp,
      claudePath: settings.claudePath,
      codexPath: settings.codexPath,
      deepLinkFallback: settings.deepLinkFallback,
      homeProjectId: settings.homeProjectId,
      markdownEditorFontFamily: settings.markdownEditorFontFamily,
      markdownEditorFontSize: settings.markdownEditorFontSize,
      markdownEditorMaxImageHeight: settings.markdownEditorMaxImageHeight,
      mcpEnabled: settings.mcpEnabled,
      projectAccentBorderWidth: settings.projectAccentBorderWidth,
      slowdownProfilerEnabled: settings.slowdownProfilerEnabled,
      terminalTmuxEnabled: settings.terminalTmuxEnabled,
      externalTerminalOpeners: settings.externalTerminalOpeners,
      taskTitler: settings.taskTitler,
      theme: settings.theme,
    },
    onSubmit: ({ value }: { value: AppSettingsSubmit }) => {
      const next = {
        appContextMarkdown: value.appContextMarkdown.trim(),
        folderOpenApp: value.folderOpenApp.trim(),
        claudePath: value.claudePath.trim(),
        codexPath: value.codexPath.trim(),
        deepLinkFallback: value.deepLinkFallback,
        homeProjectId: value.homeProjectId,
        markdownEditorFontFamily: value.markdownEditorFontFamily.trim(),
        markdownEditorFontSize: value.markdownEditorFontSize.trim(),
        markdownEditorMaxImageHeight: value.markdownEditorMaxImageHeight.trim(),
        mcpEnabled: value.mcpEnabled,
        projectAccentBorderWidth: clampProjectBorderWidth(value.projectAccentBorderWidth),
        slowdownProfilerEnabled: value.slowdownProfilerEnabled,
        terminalTmuxEnabled: value.terminalTmuxEnabled,
        externalTerminalOpeners: value.externalTerminalOpeners.trim(),
        taskTitler: value.taskTitler,
        theme: value.theme,
      };

      if (!next.claudePath || !next.codexPath || !next.externalTerminalOpeners || !next.folderOpenApp) {
        return;
      }

      onSubmit(next);
    },
  });

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="app-settings-title"
        aria-modal="true"
        className="app-settings-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="app-settings-title">App Settings</h2>
            <p>MCP status: {mcpStatus}</p>
            <p>{mcpConnectionUrl}</p>
          </div>
          <AppButton aria-label="Close app settings" onClick={onClose} variant="icon">
            <X size={16} />
          </AppButton>
        </header>

        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="mcpEnabled">
            {(field) => (
              <label className="form-check">
                <input
                  aria-label="Enable MCP server"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                  type="checkbox"
                />
                <span>Enable MCP server</span>
              </label>
            )}
          </form.Field>

          <div className="settings-token-row">
            <code>{settings.mcpToken}</code>
            <AppButton aria-label="Copy MCP token" onClick={onCopyToken} variant="secondary">
              <Copy size={14} />
              Copy
            </AppButton>
            <AppButton onClick={onRegenerateToken} variant="secondary">
              <RefreshCw size={14} />
              Regenerate
            </AppButton>
          </div>

          <form.Field name="theme">
            {(field) => (
              <div className="form-field">
                <span>Theme</span>
                <AppSegmentedControl
                  aria-label="Theme"
                  onChange={(value) => field.handleChange(value as AppThemePreference)}
                  options={[
                    { label: 'System', value: 'system' },
                    { label: 'Light', value: 'light' },
                    { label: 'Dark', value: 'dark' },
                  ]}
                  value={field.state.value}
                />
              </div>
            )}
          </form.Field>

          <div className="form-grid">
            <form.Field name="claudePath">
              {(field) => (
                <label className="form-field">
                  <span>Claude path</span>
                  <input
                    aria-label="Claude path"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <form.Field name="folderOpenApp">
              {(field) => (
                <label className="form-field">
                  <span>Folder open app</span>
                  <input
                    aria-label="Folder open app"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <form.Field name="codexPath">
              {(field) => (
                <label className="form-field">
                  <span>Codex path</span>
                  <input
                    aria-label="Codex path"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>
          </div>

          <form.Field name="taskTitler">
            {(field) => (
              <div className="form-field">
                <span>Task titler</span>
                <AppSegmentedControl
                  aria-label="Task titler"
                  onChange={(value) => field.handleChange(value as TaskTitler)}
                  options={[
                    { label: 'Codex Spark', value: 'codex-spark' },
                    { label: 'Local fallback', value: 'local-fallback' },
                  ]}
                  value={field.state.value}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="homeProjectId">
            {(field) => (
              <label className="form-field">
                <span>Home project</span>
                <AppSelect
                  aria-label="Home project"
                  onChange={(event) => field.handleChange(Number(event.target.value))}
                  options={[
                    { label: 'All Projects', value: '0' },
                    ...projects.map((project) => ({
                      label: project.name,
                      value: String(project.id),
                    })),
                  ]}
                  value={String(field.state.value)}
                />
              </label>
            )}
          </form.Field>

          <form.Field name="appContextMarkdown">
            {(field) => (
              <label className="form-field">
                <span>App-wide context</span>
                <textarea
                  aria-label="App-wide context"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  rows={5}
                  value={field.state.value}
                />
              </label>
            )}
          </form.Field>

          <div className="form-grid">
            <form.Field name="markdownEditorFontFamily">
              {(field) => (
                <label className="form-field">
                  <span>Markdown editor font</span>
                  <input
                    aria-label="Markdown editor font"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <form.Field name="markdownEditorFontSize">
              {(field) => (
                <label className="form-field">
                  <span>Markdown editor font size</span>
                  <input
                    aria-label="Markdown editor font size"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>

            <form.Field name="markdownEditorMaxImageHeight">
              {(field) => (
                <label className="form-field">
                  <span>Markdown editor max image height</span>
                  <input
                    aria-label="Markdown editor max image height"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                </label>
              )}
            </form.Field>
          </div>

          <form.Field name="projectAccentBorderWidth">
            {(field) => (
              <label className="form-field">
                <span>Project border width</span>
                <input
                  aria-label="Project border width"
                  max={MAX_PROJECT_BORDER_WIDTH}
                  min={MIN_PROJECT_BORDER_WIDTH}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(Number(event.target.value))}
                  type="number"
                  value={field.state.value}
                />
              </label>
            )}
          </form.Field>

          <form.Field name="deepLinkFallback">
            {(field) => (
              <label className="form-check">
                <input
                  aria-label="Show deep-link fallbacks"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                  type="checkbox"
                />
                <span>Show deep-link fallbacks</span>
              </label>
            )}
          </form.Field>

          <form.Field name="slowdownProfilerEnabled">
            {(field) => (
              <label className="form-check">
                <input
                  aria-label="Enable slowdown profiler"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                  type="checkbox"
                />
                <span>Enable slowdown profiler</span>
              </label>
            )}
          </form.Field>

          <form.Field name="terminalTmuxEnabled">
            {(field) => (
              <label className="form-check">
                <input
                  aria-label="Enable tmux external terminals"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                  type="checkbox"
                />
                <span>Enable tmux external terminals</span>
              </label>
            )}
          </form.Field>

          <form.Field name="externalTerminalOpeners">
            {(field) => (
              <label className="form-field">
                <span>External terminal openers</span>
                <textarea
                  aria-label="External terminal openers"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  rows={3}
                  value={field.state.value}
                />
              </label>
            )}
          </form.Field>

          <label className="form-check">
            <input
              aria-label="Show single-terminal Done warning"
              checked={doneTerminalWarningEnabled}
              onChange={(event) =>
                onDoneTerminalWarningEnabledChange?.(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>Show single-terminal Done warning</span>
          </label>

          <footer className="dialog-actions">
            <AppButton onClick={onClose} variant="secondary">
              Cancel
            </AppButton>
            <form.Subscribe
              selector={(state) => ({
                claudePath: state.values.claudePath,
                codexPath: state.values.codexPath,
                externalTerminalOpeners: state.values.externalTerminalOpeners,
                folderOpenApp: state.values.folderOpenApp,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ claudePath, codexPath, externalTerminalOpeners, folderOpenApp, isSubmitting }) => (
                <AppButton
                  disabled={
                    isSubmitting ||
                    !claudePath.trim() ||
                    !codexPath.trim() ||
                    !externalTerminalOpeners.trim() ||
                    !folderOpenApp.trim()
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
      </DialogPanel>
    </DialogBackdrop>
  );
}

function clampProjectBorderWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return 4;
  }

  return Math.min(MAX_PROJECT_BORDER_WIDTH, Math.max(MIN_PROJECT_BORDER_WIDTH, Math.round(width)));
}
