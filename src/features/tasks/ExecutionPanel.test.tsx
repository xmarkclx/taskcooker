import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExecutionTerminalSummary,
} from '../../domain/domain';
import { ExecutionPanel } from './ExecutionPanel';

const deferredMountMock = vi.hoisted(() => ({
  strategies: [] as Array<string | undefined>,
}));

// These tests assert editor/terminal props synchronously; the two-frame paint
// deferral itself is pinned in src/ui/DeferredMount.test.tsx.
vi.mock('../../ui/DeferredMount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/DeferredMount')>();
  return {
    ...actual,
    DeferredMount: ({
      children,
      strategy,
    }: {
      children?: ReactNode;
      strategy?: string;
    }) => {
      deferredMountMock.strategies.push(strategy);
      return <>{children}</>;
    },
  };
});

vi.mock('../markdown/MarkdownEditor', () => ({
  MarkdownEditor: ({
    ariaLabel,
    markdown,
    onTocHiddenChange,
    onTocWidthChange,
    onSave,
    placeholder,
    tocHidden,
    tocWidth,
  }: {
    ariaLabel: string;
    markdown: string;
    onTocHiddenChange?: (hidden: boolean) => void;
    onTocWidthChange?: (width: number) => void;
    onSave: (markdown: string) => void;
    placeholder?: string;
    tocHidden?: boolean;
    tocWidth?: number;
  }) => (
    <div>
      {onTocHiddenChange ? (
        <button onClick={() => onTocHiddenChange(false)} type="button">
          Show artifacts toc mock
        </button>
      ) : null}
      {onTocWidthChange ? (
        <button onClick={() => onTocWidthChange(244)} type="button">
          Resize artifacts toc mock
        </button>
      ) : null}
      <textarea
        aria-label={ariaLabel}
        data-toc-hidden={tocHidden ? 'true' : 'false'}
        data-toc-width={tocWidth}
        onChange={(event) => onSave(event.currentTarget.value)}
        placeholder={placeholder}
        value={markdown}
      />
    </div>
  ),
}));

vi.mock('../terminal/TerminalSurface', async () => {
  const React = await import('react');
  return {
    TerminalSurface: ({
      active,
      focusNonce,
      label,
    }: {
      active?: boolean;
      focusNonce?: number;
      label: string;
    }) => {
      const ref = React.useRef<HTMLDivElement>(null);
      React.useEffect(() => {
        if (active && focusNonce) {
          ref.current?.focus();
        }
      }, [active, focusNonce]);

      return (
        <div
          data-active={active ? 'true' : 'false'}
          data-testid={`terminal-surface-${label}`}
          ref={ref}
          tabIndex={0}
        />
      );
    },
  };
});

describe('ExecutionPanel', () => {
  beforeEach(() => {
    deferredMountMock.strategies.length = 0;
  });

  it('keeps execution launch actions compact and puts new terminal beside the tabs', () => {
    const { container } = renderPanel();

    const tablist = screen.getByRole('tablist', { name: 'Execution terminals' });
    const newTerminalButton = within(tablist).getByRole('button', {
      name: 'New Terminal',
    });
    const promptButton = screen.getByRole('button', { name: 'Copy Agent Prompt' });

    expect(newTerminalButton).toHaveClass('execution-tab-add');
    expect(container.querySelector('.execution-tab-add .lucide-square-terminal')).toBeInTheDocument();
    expect(container.querySelector('.execution-tab-add-plus')).not.toBeInTheDocument();
    expect(screen.queryByText('New Terminal')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claude Code' })).not.toBeInTheDocument();
    expect(promptButton).toHaveTextContent('Prompt');
    expect(promptButton).toHaveAttribute('title', 'Copy Agent Prompt');
  });

  it('places terminal tabs on the left edge of the execution surface', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(/\.execution-tabs\s*{[^}]*padding:\s*0;/);
  });

  it('always renders a non-closable Artifacts tab even when no terminals are running', () => {
    renderPanel();

    const tablist = screen.getByRole('tablist', { name: 'Execution terminals' });
    const artifactsTab = within(tablist).getByRole('tab', { name: 'Artifacts' });

    expect(artifactsTab).toHaveAttribute('aria-selected', 'true');
    expect(within(tablist).queryByLabelText(/close artifacts/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Artifacts Markdown')).toHaveValue('# Handoff');
    expect(
      screen.queryByText(
        '~/Library/Application Support/com.marklopez.boomerangtasks/artifacts/project-1/T-128.md',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No terminal tabs running.')).not.toBeInTheDocument();
  });

  it('saves artifact edits with the current task id', () => {
    const onSaveArtifact = vi.fn();
    renderPanel([], { onSaveArtifact, todoId: 128 });

    fireEvent.change(screen.getByLabelText('Artifacts Markdown'), {
      target: { value: '# Updated handoff' },
    });

    expect(onSaveArtifact).toHaveBeenCalledWith(128, '# Updated handoff');
  });

  it('does not show resume actions for stopped provider sessions', () => {
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Resume Codex' })).not.toBeInTheDocument();
  });

  it('does not offer OpenCode as an execution launch action', () => {
    renderPanel();

    expect(screen.queryByRole('button', { name: 'OpenCode' })).not.toBeInTheDocument();
  });

  it('starts a new OMP terminal from the launch toolbar', async () => {
    const onStartExecutionTerminal = vi.fn().mockResolvedValue({
      exitCode: null,
      kind: 'omp',
      label: 'OMP',
      ptyId: 88,
      state: 'running',
      todoId: 128,
    });
    renderPanel([], { onStartExecutionTerminal });

    const toolbar = screen.getByRole('toolbar', { name: 'Execution launch actions' });
    const claude = within(toolbar).getByRole('button', { name: 'Claude' });
    const omp = within(toolbar).getByRole('button', { name: 'OMP' });
    const prompt = within(toolbar).getByRole('button', { name: 'Copy Agent Prompt' });

    expect(claude.compareDocumentPosition(omp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(omp.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(omp);

    await waitFor(() => {
      expect(onStartExecutionTerminal).toHaveBeenCalledWith('omp');
    });
  });

  it('shows one resume OMP button when the task has an OMP session id', async () => {
    const onStartExecutionTerminal = vi.fn().mockResolvedValue({
      exitCode: null,
      kind: 'omp',
      label: 'OMP',
      ptyId: 89,
      state: 'running',
      todoId: 128,
    });
    renderPanel([], {
      ompSessionId: '019efe10-60fc-7000-9f8e-6545a91a41ce',
      onStartExecutionTerminal,
    });

    const resumeButtons = screen.getAllByRole('button', { name: 'Resume OMP' });
    expect(resumeButtons).toHaveLength(1);

    fireEvent.click(resumeButtons[0]);

    await waitFor(() => {
      expect(onStartExecutionTerminal).toHaveBeenCalledWith('omp', {
        resumeSessionId: '019efe10-60fc-7000-9f8e-6545a91a41ce',
      });
    });
  });

  it('hides provider resume buttons while that provider already has a tab open for the task', () => {
    renderPanel(
      [
        {
          exitCode: null,
          kind: 'omp',
          label: 'OMP',
          ptyId: 90,
          state: 'running',
          todoId: 128,
        },
        {
          exitCode: null,
          kind: 'codex',
          label: 'Codex CLI',
          ptyId: 91,
          state: 'running',
          todoId: 128,
        },
        {
          exitCode: null,
          kind: 'claude',
          label: 'Claude Code CLI',
          ptyId: 92,
          state: 'running',
          todoId: 129,
        },
      ],
      {
        claudeSessionId: '3eabfd51-a2e3-4a01-ba30-27c72e19f3c5',
        codexSessionId: '019f016b-4fb4-79c1-9da5-f7bfb7a59092',
        ompSessionId: '019efe10-60fc-7000-9f8e-6545a91a41ce',
      },
    );

    expect(screen.queryByRole('button', { name: 'Resume OMP' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume Codex' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Claude' })).toBeInTheDocument();
  });

  it('resumes Codex and Claude from saved provider session ids', async () => {
    const onStartExecutionTerminal = vi.fn().mockImplementation(async (kind: string) => ({
      exitCode: null,
      kind,
      label: `${kind} CLI`,
      ptyId: kind === 'codex' ? 91 : 92,
      state: 'running',
      todoId: 128,
    }));
    renderPanel([], {
      claudeSessionId: '3eabfd51-a2e3-4a01-ba30-27c72e19f3c5',
      codexSessionId: '019f016b-4fb4-79c1-9da5-f7bfb7a59092',
      onStartExecutionTerminal,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume Codex' }));
    await waitFor(() => {
      expect(onStartExecutionTerminal).toHaveBeenCalledWith('codex', {
        resumeSessionId: '019f016b-4fb4-79c1-9da5-f7bfb7a59092',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume Claude' }));

    await waitFor(() => {
      expect(onStartExecutionTerminal).toHaveBeenCalledWith('claude', {
        resumeSessionId: '3eabfd51-a2e3-4a01-ba30-27c72e19f3c5',
      });
    });
  });

  it('uses a distinct placeholder for the Artifacts editor', () => {
    renderPanel([], {
      artifact: { markdown: '', markdownPath: '~/artifacts/project-1/T-128.md' },
    });

    expect(screen.getByLabelText('Artifacts Markdown')).toHaveAttribute(
      'placeholder',
      'AI Summary + other artifacts will be shown here',
    );
  });

  it('passes persisted artifact TOC width state to the Artifacts editor', () => {
    const onArtifactTocWidthChange = vi.fn();
    renderPanel([], {
      artifactTocWidth: 228,
      onArtifactTocWidthChange,
    });

    expect(screen.getByLabelText('Artifacts Markdown')).toHaveAttribute(
      'data-toc-width',
      '228',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resize artifacts toc mock' }));

    expect(onArtifactTocWidthChange).toHaveBeenCalledWith(244);
  });

  it('passes persisted artifact TOC visibility state to the Artifacts editor', () => {
    const onArtifactTocHiddenChange = vi.fn();
    renderPanel([], {
      artifactTocHidden: true,
      onArtifactTocHiddenChange,
    });

    expect(screen.getByLabelText('Artifacts Markdown')).toHaveAttribute(
      'data-toc-hidden',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show artifacts toc mock' }));

    expect(onArtifactTocHiddenChange).toHaveBeenCalledWith(false);
  });

  it('bounds the Artifacts editor so long markdown scrolls instead of clipping', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(/\.artifact-panel \.description-panel\s*{[^}]*height:\s*100%;/);
    expect(css).toMatch(/\.artifact-panel \.description-panel\s*{[^}]*min-height:\s*0;/);
    expect(css).toMatch(
      /\.artifact-panel \.tiptap-editor-wrap,\s*\.artifact-panel \.markdown-textarea\s*{[^}]*height:\s*100%;/,
    );
    expect(css).toMatch(
      /\.artifact-panel \.tiptap-editor-wrap,\s*\.artifact-panel \.markdown-textarea\s*{[^}]*overflow:\s*auto;/,
    );
  });

  it('keeps inactive execution panes from intercepting artifact scrolling', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(/\.execution-terminal-pane\s*{[^}]*visibility:\s*hidden;/);
    expect(css).toMatch(/\.execution-terminal-pane\.active\s*{[^}]*visibility:\s*visible;/);
  });

  it('opens artifact file actions from the Artifacts tab context menu', () => {
    const onCopyArtifactLink = vi.fn();
    const onOpenArtifact = vi.fn();
    renderPanel([], { onCopyArtifactLink, onOpenArtifact });

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Artifacts' }), {
      clientX: 24,
      clientY: 32,
    });

    const menu = screen.getByRole('menu', { name: 'Artifact file actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy Link' }));
    expect(onCopyArtifactLink).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Artifacts' }), {
      clientX: 24,
      clientY: 32,
    });
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Artifact file actions' })).getByRole('menuitem', {
        name: 'Open',
      }),
    );
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  });

  it('keeps the Artifacts tab beside terminal tabs and only renders close controls on terminals', () => {
    renderPanel([
      {
        exitCode: null,
        kind: 'codex',
        label: 'Codex CLI',
        ptyId: 42,
        state: 'running',
        todoId: 128,
      },
    ]);

    const tablist = screen.getByRole('tablist', { name: 'Execution terminals' });

    expect(within(tablist).getByRole('tab', { name: 'Artifacts' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: 'Codex CLI' })).toBeInTheDocument();
    expect(within(tablist).getByLabelText('Close Codex CLI terminal')).toBeInTheDocument();
    expect(within(tablist).queryByLabelText(/close artifacts/i)).not.toBeInTheDocument();
  });

  it('keeps recently used terminal surfaces mounted so switching back is instant', () => {
    renderPanel([
      {
        exitCode: null,
        kind: 'codex',
        label: 'Codex CLI',
        ptyId: 42,
        state: 'running',
        todoId: 128,
      },
      {
        exitCode: null,
        kind: 'terminal',
        label: 'Terminal',
        ptyId: 77,
        state: 'running',
        todoId: 128,
      },
    ]);

    // Never-visited tabs stay unmounted.
    expect(screen.getByTestId('terminal-surface-Codex CLI')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-surface-Terminal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));

    // The previous surface stays mounted (hidden) instead of being torn down,
    // so switching back needs no xterm/WebGL rebuild or PTY re-attach.
    expect(screen.getByTestId('terminal-surface-Terminal')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByTestId('terminal-surface-Codex CLI')).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('mounts terminal surfaces during browser idle time so task switching can paint first', () => {
    renderPanel([
      {
        exitCode: null,
        kind: 'codex',
        label: 'Codex CLI',
        ptyId: 42,
        state: 'running',
        todoId: 128,
      },
    ]);

    expect(deferredMountMock.strategies).toContain('idle');
  });

  it('unmounts the least recently used surface beyond the keep-alive cap', () => {
    const terminals: ExecutionTerminalSummary[] = [1, 2, 3, 4].map((n) => ({
      exitCode: null,
      kind: 'terminal',
      label: `Term ${n}`,
      ptyId: n,
      state: 'running',
      todoId: 128,
    }));
    renderPanel(terminals);

    fireEvent.click(screen.getByRole('tab', { name: 'Term 2' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Term 3' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Term 4' }));

    // Cap is 3 mounted surfaces: the oldest (Term 1) is evicted, the three
    // most recently used stay warm.
    expect(screen.queryByTestId('terminal-surface-Term 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-surface-Term 2')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-surface-Term 3')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-surface-Term 4')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('unmounts a kept-alive surface when its tab closes', () => {
    const onCloseExecutionTerminal = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      [
        {
          exitCode: null,
          kind: 'codex',
          label: 'Codex CLI',
          ptyId: 42,
          state: 'running',
          todoId: 128,
        },
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 77,
          state: 'running',
          todoId: 128,
        },
      ],
      { onCloseExecutionTerminal },
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    fireEvent.click(screen.getByLabelText('Close Terminal terminal'));

    expect(screen.queryByTestId('terminal-surface-Terminal')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-surface-Codex CLI')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('shows a pending terminal tab immediately while the terminal is starting', async () => {
    let resolveStart!: (terminal: ExecutionTerminalSummary) => void;
    const onStartExecutionTerminal = vi.fn().mockImplementation(
      () =>
        new Promise<ExecutionTerminalSummary>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const view = renderPanel([], { onStartExecutionTerminal });
    const toolbar = screen.getByRole('toolbar', { name: 'Execution launch actions' });

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Claude' }));

    const pendingTab = screen.getByRole('tab', { name: 'Claude' });
    expect(pendingTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Starting Claude…')).toBeInTheDocument();

    const terminal: ExecutionTerminalSummary = {
      exitCode: null,
      kind: 'claude',
      label: 'Claude CLI',
      ptyId: 91,
      state: 'running',
      todoId: 128,
    };
    // The shell adds the terminal to the snapshot before the start promise
    // resolves, so the real tab exists by the time the pending tab clears.
    view.rerender(
      <ExecutionPanel
        {...defaultPanelProps({ executionTerminals: [terminal], onStartExecutionTerminal })}
      />,
    );
    await act(async () => {
      resolveStart(terminal);
    });

    expect(screen.queryByText('Starting Claude…')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Claude CLI' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('drops the pending terminal tab and shows the error when starting fails', async () => {
    let rejectStart!: (error: Error) => void;
    const onStartExecutionTerminal = vi.fn().mockImplementation(
      () =>
        new Promise<ExecutionTerminalSummary>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    renderPanel([], { onStartExecutionTerminal });
    const toolbar = screen.getByRole('toolbar', { name: 'Execution launch actions' });

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Codex' }));
    expect(screen.getByRole('tab', { name: 'Codex' })).toBeInTheDocument();

    await act(async () => {
      rejectStart(new Error('spawn failed'));
    });

    expect(screen.queryByRole('tab', { name: 'Codex' })).not.toBeInTheDocument();
    expect(screen.getByText('spawn failed')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Artifacts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('switches away from a closed terminal tab without waiting for the backend close', () => {
    const onCloseExecutionTerminal = vi
      .fn()
      .mockReturnValue(new Promise<void>(() => {}));
    renderPanel(
      [
        {
          exitCode: null,
          kind: 'codex',
          label: 'Codex CLI',
          ptyId: 42,
          state: 'running',
          todoId: 128,
        },
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 77,
          state: 'running',
          todoId: 128,
        },
      ],
      { onCloseExecutionTerminal },
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    fireEvent.click(screen.getByLabelText('Close Terminal terminal'));

    expect(onCloseExecutionTerminal).toHaveBeenCalledWith(77);
    // The close command never resolved, yet the neighbouring tab is already
    // active again.
    expect(screen.getByRole('tab', { name: 'Codex CLI' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('opens a terminal tab in an external terminal only when tmux is enabled', async () => {
    const onOpenExternalTerminal = vi.fn().mockResolvedValue(undefined);

    renderPanel(
      [
        {
          exitCode: null,
          kind: 'codex',
          label: 'Codex CLI',
          ptyId: 42,
          state: 'running',
          todoId: 128,
        },
      ],
      {
        onOpenExternalTerminal,
        terminalTmuxEnabled: true,
      },
    );

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Codex CLI' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /open in external terminal/i }));

    await waitFor(() => expect(onOpenExternalTerminal).toHaveBeenCalledWith(42));
  });

  it('navigates execution tabs with keyboard shortcuts', () => {
    renderPanel([
      {
        exitCode: null,
        kind: 'codex',
        label: 'Codex CLI',
        ptyId: 42,
        state: 'running',
        todoId: 128,
      },
      {
        exitCode: null,
        kind: 'terminal',
        label: 'Terminal',
        ptyId: 77,
        state: 'running',
        todoId: 128,
      },
    ]);

    const tablist = screen.getByRole('tablist', { name: 'Execution terminals' });
    const artifactsTab = within(tablist).getByRole('tab', { name: 'Artifacts' });
    const codexTab = within(tablist).getByRole('tab', { name: 'Codex CLI' });
    const terminalTab = within(tablist).getByRole('tab', { name: 'Terminal' });

    // Tab order is [Artifacts, Codex CLI, Terminal]; first terminal starts active.
    expect(codexTab).toHaveAttribute('aria-selected', 'true');

    // Ctrl+Tab moves to the next tab.
    fireEvent.keyDown(tablist, { key: 'Tab', ctrlKey: true });
    expect(terminalTab).toHaveAttribute('aria-selected', 'true');

    // Ctrl+Tab wraps around to Artifacts.
    fireEvent.keyDown(tablist, { key: 'Tab', ctrlKey: true });
    expect(artifactsTab).toHaveAttribute('aria-selected', 'true');

    // Cmd+Shift+Tab moves to the previous tab (wrapping back to Terminal).
    fireEvent.keyDown(tablist, { key: 'Tab', metaKey: true, shiftKey: true });
    expect(terminalTab).toHaveAttribute('aria-selected', 'true');

    // Ctrl+PageUp moves to the previous tab.
    fireEvent.keyDown(tablist, { key: 'PageUp', ctrlKey: true });
    expect(codexTab).toHaveAttribute('aria-selected', 'true');

    // Ctrl+PageDown moves to the next tab.
    fireEvent.keyDown(tablist, { key: 'PageDown', ctrlKey: true });
    expect(terminalTab).toHaveAttribute('aria-selected', 'true');
  });

  it('moves focus into the active tab content after keyboard tab navigation', async () => {
    renderPanel([
      {
        exitCode: null,
        kind: 'codex',
        label: 'Codex CLI',
        ptyId: 42,
        state: 'running',
        todoId: 128,
      },
      {
        exitCode: null,
        kind: 'terminal',
        label: 'Terminal',
        ptyId: 77,
        state: 'running',
        todoId: 128,
      },
    ]);

    const codexSurface = screen.getByTestId('terminal-surface-Codex CLI');

    codexSurface.focus();
    expect(codexSurface).toHaveFocus();

    fireEvent.keyDown(codexSurface, { key: 'Tab', metaKey: true });
    const terminalSurface = await screen.findByTestId('terminal-surface-Terminal');
    await waitFor(() => expect(terminalSurface).toHaveFocus());

    fireEvent.keyDown(terminalSurface, { key: 'Tab', metaKey: true });
    const artifactsEditor = await screen.findByLabelText('Artifacts Markdown');
    await waitFor(() => expect(artifactsEditor).toHaveFocus());

    fireEvent.keyDown(artifactsEditor, { key: 'Tab', metaKey: true, shiftKey: true });
    await waitFor(() => expect(terminalSurface).toHaveFocus());
  });

  it('ignores tab navigation shortcuts while renaming a terminal tab', () => {
    renderPanel([
      {
        exitCode: null,
        kind: 'codex',
        label: 'Codex CLI',
        ptyId: 42,
        state: 'running',
        todoId: 128,
      },
    ]);

    const tablist = screen.getByRole('tablist', { name: 'Execution terminals' });
    const codexTab = within(tablist).getByRole('tab', { name: 'Codex CLI' });
    expect(codexTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.doubleClick(codexTab);
    const input = screen.getByRole('textbox', { name: 'Rename Codex CLI terminal' });
    fireEvent.keyDown(input, { key: 'Tab', ctrlKey: true });

    // Still renaming; the active tab did not change.
    expect(screen.getByRole('textbox', { name: 'Rename Codex CLI terminal' })).toBeInTheDocument();
  });

  it('renames terminal tabs inline', async () => {
    const onRenameExecutionTerminal = vi.fn().mockResolvedValue(undefined);
    renderPanel(
      [
        {
          exitCode: null,
          kind: 'terminal',
          label: 'Terminal',
          ptyId: 77,
          state: 'running',
          todoId: 128,
        },
      ],
      { onRenameExecutionTerminal },
    );

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Terminal' }));
    const input = screen.getByRole('textbox', { name: 'Rename Terminal terminal' });
    fireEvent.change(input, { target: { value: 'Build watcher' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onRenameExecutionTerminal).toHaveBeenCalledWith(77, 'Build watcher');
    });
  });

  it('opens the worktree modal with the suggested task worktree name', async () => {
    const onSuggestWorktreeName = vi.fn().mockResolvedValue({
      name: 'T-128-wire-up-mcp-server',
    });
    const onEnableWorktree = vi.fn().mockResolvedValue(undefined);
    renderPanel([], { onEnableWorktree, onSuggestWorktreeName });

    fireEvent.click(screen.getByRole('button', { name: 'Worktree' }));

    const dialog = await screen.findByRole('dialog', { name: 'Enable worktree' });
    expect(within(dialog).getByLabelText('Worktree name')).toHaveValue(
      'T-128-wire-up-mcp-server',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Worktree' }));

    await waitFor(() => {
      expect(onEnableWorktree).toHaveBeenCalledWith('T-128-wire-up-mcp-server');
    });
  });

  it('keeps worktree operations in the main execution toolbar without a separate actions row', async () => {
    const onOpenWorktreeDiff = vi.fn().mockResolvedValue(undefined);
    const onCommitAndMergeWorktree = vi.fn().mockResolvedValue({
      exitCode: null,
      kind: 'terminal',
      label: 'Commit & Merge',
      ptyId: 99,
      state: 'running',
      todoId: 128,
    });
    renderPanel([], {
      onCommitAndMergeWorktree,
      onOpenWorktreeDiff,
      worktree: {
        mainBranch: 'develop',
        name: 'T-128-wire-up-mcp-server',
        path: '~/p/T-128-wire-up-mcp-server',
      },
    });

    const toolbar = screen.getByRole('toolbar', { name: 'Execution launch actions' });
    expect(screen.queryByRole('toolbar', { name: 'Worktree actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Worktree Actions' })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Worktree' })).not.toBeInTheDocument();

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Open Diff' }));
    await act(async () => {
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Commit & Merge' }));
    });

    expect(onOpenWorktreeDiff).toHaveBeenCalled();
    expect(onCommitAndMergeWorktree).toHaveBeenCalled();
  });

  it('shows a delete worktree button beside worktree operations', async () => {
    const onDeleteWorktree = vi.fn().mockResolvedValue(undefined);
    renderPanel([], {
      onDeleteWorktree,
      worktree: {
        mainBranch: 'develop',
        name: 'T-128-wire-up-mcp-server',
        path: '~/p/T-128-wire-up-mcp-server',
      },
    });

    const toolbar = screen.getByRole('toolbar', { name: 'Execution launch actions' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Delete Worktree' }));

    await waitFor(() => {
      expect(onDeleteWorktree).toHaveBeenCalledTimes(1);
    });
  });

  it('does not render the paused task Actions button in the task view', () => {
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Task actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Deploy/ })).not.toBeInTheDocument();
  });
});

function renderPanel(
  executionTerminals: ExecutionTerminalSummary[] = [],
  overrides: Partial<ComponentProps<typeof ExecutionPanel>> = {},
) {
  return render(<ExecutionPanel {...defaultPanelProps({ ...overrides, executionTerminals })} />);
}

function defaultPanelProps(overrides: Partial<ComponentProps<typeof ExecutionPanel>> = {}) {
  return {
    artifact: {
      markdown: '# Handoff',
      markdownPath:
        '~/Library/Application Support/com.marklopez.boomerangtasks/artifacts/project-1/T-128.md',
    },
    artifactTocWidth: 180,
    attachmentTarget: { projectId: 1, todoId: 128 },
    canStart: true,
    executionTerminals: [],
    onCloseExecutionTerminal: vi.fn(),
    onOpenExternalTerminal: vi.fn(),
    onCopyArtifactLink: vi.fn(),
    onCopyPrompt: vi.fn(),
    onOpenArtifact: vi.fn(),
    onOpenWorktreeDiff: vi.fn(),
    onDeleteWorktree: vi.fn().mockResolvedValue(undefined),
    onPromptSettingsChange: vi.fn(),
    onSaveArtifact: vi.fn(),
    onArtifactTocHiddenChange: vi.fn(),
    onArtifactTocWidthChange: vi.fn(),
    onRenameExecutionTerminal: vi.fn().mockResolvedValue(undefined),
    onStartExecutionTerminal: vi.fn(),
    onSuggestWorktreeName: vi.fn().mockResolvedValue({ name: 'T-128-wire-up-mcp-server' }),
    onEnableWorktree: vi.fn().mockResolvedValue(undefined),
    onCommitAndMergeWorktree: vi.fn().mockResolvedValue({
      exitCode: null,
      kind: 'terminal',
      label: 'Commit & Merge',
      ptyId: 99,
      state: 'running',
      todoId: 128,
    }),
    promptSettings: {
      aiDefaultIncludeProjectNotes: false,
      aiTaskDescriptionMode: 'task',
    },
    artifactTocHidden: true,
    markdownEditorFontFamily: 'sans-serif',
    markdownEditorFontSize: '12px',
    markdownEditorMaxImageHeight: 'none',
    theme: 'light',
    terminalTmuxEnabled: false,
    todoId: 128,
    ...overrides,
  } satisfies ComponentProps<typeof ExecutionPanel>;
}
