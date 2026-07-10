/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app shell architecture', () => {
  it('keeps feature UI components outside the route orchestrator', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const lineCount = appSource.split('\n').length;

    expect(lineCount).toBeLessThanOrEqual(300);
    const mainAppSource = readFileSync(resolve(process.cwd(), 'src/app/MainApp.tsx'), 'utf8');
    expect(mainAppSource.split('\n').length).toBeLessThanOrEqual(2_000);
    expect(appSource).not.toContain('function TaskDetail(');
    expect(appSource).not.toContain('function TaskList(');
    expect(appSource).not.toContain('function AgentSessions(');
  });

  it('keeps heavy project-window surfaces behind lazy islands', () => {
    const mainAppSource = readFileSync(resolve(process.cwd(), 'src/app/MainApp.tsx'), 'utf8');
    const lazySurfacesSource = readFileSync(
      resolve(process.cwd(), 'src/app/lazySurfaces.ts'),
      'utf8',
    );

    expect(lazySurfacesSource.split('\n').length).toBeLessThanOrEqual(120);
    expect(lazySurfacesSource).toContain('lazy(');
    expect(mainAppSource).not.toMatch(
      /import\s+\{\s*(?:[^}]*\bTaskDetail\b|[^}]*\bProjectNotesOverlay\b)[^}]*\}\s+from\s+['"][^'"]+WorkspaceSurfaces['"]/,
    );
    for (const modulePath of [
      '../features/tasks/TaskDetail',
      '../features/projects/FocusedProjectDetail',
      './NewTaskOverlay',
      './NewProjectOverlay',
      './ProjectSettingsOverlay',
      './ProjectActionsOverlay',
      './ProjectActionRunOverlay',
      './AppSettingsOverlay',
      './GlobalSearchOverlay',
      './RemoteConnectOverlay',
    ]) {
      expect(mainAppSource).not.toContain(`from '${modulePath}'`);
    }
  });

  it('uses Jotai for app-shell local UI state', () => {
    const uiStateSource = readFileSync(
      resolve(process.cwd(), 'src/app/useMainAppUiState.ts'),
      'utf8',
    );
    const agentGuide = readFileSync(resolve(process.cwd(), 'AGENTS.md'), 'utf8');

    expect(uiStateSource).toContain("from 'jotai'");
    expect(uiStateSource).not.toContain('useState(');
    expect(agentGuide).toContain('Jotai');
  });

  it('keeps backend service and command shells small enough to scan', () => {
    for (const filePath of ['src-tauri/src/core.rs', 'src-tauri/src/commands.rs']) {
      const source = readFileSync(resolve(process.cwd(), filePath), 'utf8');

      expect(source.split('\n').length).toBeLessThanOrEqual(3_000);
    }
  });

  it('uses theme colors for low and none task-list timer icons', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.task-timer-button\.priority-low\s*{[^}]*color:\s*var\(--priority-low\);/s,
    );
    expect(styles).toMatch(
      /\.task-timer-button\.priority-none\s*{[^}]*color:\s*var\(--priority-none\);/s,
    );
  });

  it('uses wood theme tokens for the header divider and dark contents rail', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.top-divider\s*{[^}]*background:\s*var\(--line\);/s);
    expect(styles).toMatch(
      /\.app-shell\[data-theme='dark'\]\s+\.editor-body nav\s*{[^}]*background:\s*var\(--ground\);/s,
    );
  });

  it('raises app toasts off the dark shell surface', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.app-shell\[data-theme='dark'\]\s+\.app-toast\.info\s*{[^}]*background:\s*var\(--color-surface-muted\);/s,
    );
  });

  it('smooths theme changes without ignoring reduced motion', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/--theme-transition-duration:\s*180ms;/);
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    expect(styles).toMatch(/\.app-shell,\s*\.app-shell::after/s);
    expect(styles).toMatch(/transition:[^;]*background[^;]*border-color[^;]*box-shadow[^;]*color/s);
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(styles).toMatch(/--theme-transition-duration:\s*0ms;/);
  });

  it('draws the project window accent border from project accent variables', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /--project-accent-color-light:\s*hsl\(var\(--project-accent-hue\)\s+var\(--project-accent-saturation\)\s+34%\);/s,
    );
    expect(styles).toMatch(
      /--project-accent-color-dark:\s*hsl\(var\(--project-accent-hue\)\s+var\(--project-accent-saturation\)\s+42%\);/s,
    );
    expect(styles).toMatch(
      /--project-window-border:\s*var\(--project-accent-color-light\);/s,
    );
    expect(styles).toMatch(
      /\.app-shell\s*{[^}]*--project-window-border:\s*var\(--project-accent-color-light\);/s,
    );
    expect(styles).toMatch(
      /\.app-shell\[data-theme='dark'\]\s*{[^}]*--project-window-border:\s*var\(--project-accent-color-dark\);/s,
    );
    expect(styles).toMatch(
      /\.app-shell\[data-project-accent\]::after\s*{[^}]*border:\s*var\(--project-window-border-width\) solid var\(--project-window-border\);/s,
    );
    expect(styles).toMatch(/\.project-dot\s*{[^}]*background:\s*var\(--project-accent-color-light\);/s);
    expect(styles).toMatch(
      /\.app-shell\[data-theme='dark'\]\s+\.project-dot:not\(\.all-projects-dot\)\s*{[^}]*background:\s*var\(--project-accent-color-dark\);/s,
    );
    expect(styles).not.toMatch(
      /\.app-shell\[data-project-accent\]::after\s*{[^}]*(?:#[0-9a-fA-F]{3,8}|rgb\()/s,
    );
  });

  it('uses theme tokens when editing the selected task title', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.task-title-input:focus\s*{[^}]*background:\s*var\(--color-surface-warm\);[^}]*border-color:\s*var\(--cedar\);[^}]*box-shadow:\s*0 0 0 3px var\(--focus-ring\);/s,
    );
    expect(styles).not.toMatch(
      /\.task-title-input:focus\s*{[^}]*(?:#[0-9a-fA-F]{3,8}|rgb\()/s,
    );
  });

  it('keeps project action menu and card text compact and clipped', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.actions-menu-wrap\s*{[^}]*display:\s*flex;[^}]*gap:\s*8px;[^}]*position:\s*relative;/s,
    );
    expect(styles).toMatch(
      /\.actions-menu-row strong\s*{[^}]*font-size:\s*14px;[^}]*font-weight:\s*650;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(/\.actions-menu-row small\s*{[^}]*font-weight:\s*500;/s);
    expect(styles).toMatch(
      /\.project-action-card h3\s*{[^}]*font-size:\s*14px;[^}]*font-weight:\s*650;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.project-action-card-meta\s*{[^}]*font:\s*500 11px\/14px var\(--font-mono\);[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
  });

  it('keeps task metadata controls readable in dark mode', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.tag-editor input\s*{[^}]*background:\s*var\(--color-surface-raised\);[^}]*border:\s*1px solid var\(--hairline\);[^}]*border-radius:\s*6px;[^}]*padding:\s*7px 9px;/s,
    );
    expect(styles).toMatch(
      /\.custom-time-range\s*{[^}]*gap:\s*10px;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(112px,\s*0\.9fr\);/s,
    );
    expect(styles).toMatch(
      /\.custom-time-range input,\s*\.custom-time-range select,\s*\.custom-time-range \.app-select\s*{[^}]*font:\s*600 12px\/18px Inter,\s*sans-serif;[^}]*min-height:\s*36px;[^}]*padding:\s*8px 10px;/s,
    );
  });
});
