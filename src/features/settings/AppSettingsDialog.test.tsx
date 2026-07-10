import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { fallbackAppSettings } from '../../tauri/commands';
import { AppSettingsDialog } from './AppSettingsDialog';

describe('AppSettingsDialog', () => {
  it('keeps long settings content scrollable inside the dialog viewport', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(
      /\.app-settings-dialog\s*{[^}]*max-height:\s*calc\(100vh - var\(--top-bar-height\) - 40px\);/,
    );
    expect(css).toMatch(/\.app-settings-dialog\s*{[^}]*overflow:\s*auto;/);
  });

  it('submits the selected task titler with app settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Local fallback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: fallbackAppSettings.appContextMarkdown,
        folderOpenApp: fallbackAppSettings.folderOpenApp,
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize: fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight: fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled: fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled: fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners: fallbackAppSettings.externalTerminalOpeners,
        taskTitler: 'local-fallback',
        theme: fallbackAppSettings.theme,
      });
    });
  });

  it('allows the slowdown profiler to be disabled from app settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.click(screen.getByLabelText('Enable slowdown profiler'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: fallbackAppSettings.appContextMarkdown,
        folderOpenApp: fallbackAppSettings.folderOpenApp,
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize: fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight: fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled: false,
        terminalTmuxEnabled: fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners: fallbackAppSettings.externalTerminalOpeners,
        taskTitler: fallbackAppSettings.taskTitler,
        theme: fallbackAppSettings.theme,
      });
    });
  });

  it('submits the project border width from app settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project border width'), {
      target: { value: '6' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: fallbackAppSettings.appContextMarkdown,
        folderOpenApp: fallbackAppSettings.folderOpenApp,
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize: fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight: fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: 6,
        slowdownProfilerEnabled: fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled: fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners: fallbackAppSettings.externalTerminalOpeners,
        taskTitler: fallbackAppSettings.taskTitler,
        theme: fallbackAppSettings.theme,
      });
    });
  });

  it('submits markdown editor typography settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText('Markdown editor font'), {
      target: { value: 'Atkinson Hyperlegible, fantasy' },
    });
    fireEvent.change(screen.getByLabelText('Markdown editor font size'), {
      target: { value: 'clamp(14px, 1.2vw, 20px)' },
    });
    fireEvent.change(screen.getByLabelText('Markdown editor max image height'), {
      target: { value: '42vh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: fallbackAppSettings.appContextMarkdown,
        folderOpenApp: fallbackAppSettings.folderOpenApp,
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: 'Atkinson Hyperlegible, fantasy',
        markdownEditorFontSize: 'clamp(14px, 1.2vw, 20px)',
        markdownEditorMaxImageHeight: '42vh',
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled: fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled: fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners: fallbackAppSettings.externalTerminalOpeners,
        taskTitler: fallbackAppSettings.taskTitler,
        theme: fallbackAppSettings.theme,
      });
    });
  });

  it('submits the folder open app from app settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText('Folder open app'), {
      target: { value: 'code-insiders' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: fallbackAppSettings.appContextMarkdown,
        folderOpenApp: 'code-insiders',
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize: fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight: fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled: fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled: fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners: fallbackAppSettings.externalTerminalOpeners,
        taskTitler: fallbackAppSettings.taskTitler,
        theme: fallbackAppSettings.theme,
      });
    });
  });

  it('submits tmux external terminal settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.click(screen.getByLabelText('Enable tmux external terminals'));
    fireEvent.change(screen.getByLabelText('External terminal openers'), {
      target: { value: ' open -na Ghostty.app --args --command={tmuxCommand} ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: fallbackAppSettings.appContextMarkdown,
        folderOpenApp: fallbackAppSettings.folderOpenApp,
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize: fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight: fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled: fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled: true,
        externalTerminalOpeners: 'open -na Ghostty.app --args --command={tmuxCommand}',
        taskTitler: fallbackAppSettings.taskTitler,
        theme: fallbackAppSettings.theme,
      });
    });
  });

  it('submits app-wide context from app settings', async () => {
    const onSubmit = vi.fn();

    render(
      <AppSettingsDialog
        onClose={vi.fn()}
        onCopyToken={vi.fn()}
        onRegenerateToken={vi.fn()}
        onSubmit={onSubmit}
        settings={fallbackAppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText('App-wide context'), {
      target: { value: '  # Global context\n\nUse project guardrails.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        appContextMarkdown: '# Global context\n\nUse project guardrails.',
        folderOpenApp: fallbackAppSettings.folderOpenApp,
        claudePath: fallbackAppSettings.claudePath,
        codexPath: fallbackAppSettings.codexPath,
        deepLinkFallback: fallbackAppSettings.deepLinkFallback,
        homeProjectId: fallbackAppSettings.homeProjectId,
        markdownEditorFontFamily: fallbackAppSettings.markdownEditorFontFamily,
        markdownEditorFontSize: fallbackAppSettings.markdownEditorFontSize,
        markdownEditorMaxImageHeight: fallbackAppSettings.markdownEditorMaxImageHeight,
        mcpEnabled: fallbackAppSettings.mcpEnabled,
        projectAccentBorderWidth: fallbackAppSettings.projectAccentBorderWidth,
        slowdownProfilerEnabled: fallbackAppSettings.slowdownProfilerEnabled,
        terminalTmuxEnabled: fallbackAppSettings.terminalTmuxEnabled,
        externalTerminalOpeners: fallbackAppSettings.externalTerminalOpeners,
        taskTitler: fallbackAppSettings.taskTitler,
        theme: fallbackAppSettings.theme,
      });
    });
  });
});
