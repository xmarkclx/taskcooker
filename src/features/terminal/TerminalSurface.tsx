import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ILink, type ILinkProvider } from '@xterm/xterm';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from 'jotai';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type TouchEvent,
  type WheelEvent,
} from 'react';

import { attachPty } from './ptyBridge';
import type { AttachedPty } from './ptyBridge';
import { terminalWindowFocusRestoreNonceAtom } from './terminalFocusState';
import {
  TerminalFindBar,
  type TerminalFindDirection,
  type TerminalFindResults,
} from './TerminalFindBar';
import { openExternalUrl, openPathOrUrl, saveEditorImage } from '../../tauri/commands';
import { listenForDroppedPathsWhenFocused } from '../../tauri/dropPaths';
import { isMacPlatform } from '../../tauri/platform';
import { isTauriRuntime } from '../../tauri/runtime';
import {
  fileToBase64,
  formatTerminalImageReferences,
  type ReplyAttachmentReference,
} from '../messages/replyAttachments';
import {
  recordSlowdownProfilerEvent,
  useSlowdownRenderProbe,
} from '../performance/slowdownProfiler';

type TerminalVisualTheme = 'light' | 'dark';

type TerminalSurfaceProps = {
  active?: boolean;
  attachmentTarget?: {
    projectId: number;
    todoId: number;
  };
  focusNonce?: number;
  label: string;
  ptyId: number;
  theme?: TerminalVisualTheme;
};

const terminalFontStack =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace';
const TERMINAL_ATTACH_TIMEOUT_MS = 8_000;
const TERMINAL_OUTPUT_BURST_WINDOW_MS = 1_000;
const TERMINAL_OUTPUT_BURST_BYTES = 128 * 1024;
const TERMINAL_DISPOSE_FALLBACK_DELAY_MS = 0;

/**
 * The WebGL renderer only creates its GL context once the terminal renders, so a
 * `try/catch` around `loadAddon` does not catch "WebGL2 not supported". Feature
 * detect up front instead. This also lets machines without a usable GPU (and the
 * jsdom test environment) fall back to xterm's default renderer cleanly.
 *
 * GPU capability is static per machine, so the result is cached to avoid
 * creating a throwaway GL context on every terminal mount — except in test
 * mode, where suites simulate both GPU-present and GPU-absent environments.
 */
let cachedWebgl2Support: boolean | null = null;

function supportsWebgl2(): boolean {
  if (cachedWebgl2Support !== null) {
    return cachedWebgl2Support;
  }

  let supported = false;
  try {
    supported = Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    supported = false;
  }
  if (import.meta.env.MODE !== 'test') {
    cachedWebgl2Support = supported;
  }
  return supported;
}

export function TerminalSurface({
  active = true,
  attachmentTarget,
  focusNonce = 0,
  label,
  ptyId,
  theme = 'dark',
}: TerminalSurfaceProps) {
  useSlowdownRenderProbe('terminal-surface', `${label}/pty:${ptyId}`);
  const terminalFocusStore = useStore();
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<AttachedPty | null>(null);
  const activeRef = useRef(active);
  const hasInputFocusRef = useRef(false);
  const focusInputRef = useRef<(() => void) | null>(null);
  const pendingInputFocusRef = useRef(false);
  const reclaimInputRef = useRef<(() => void) | null>(null);
  const restoreInputAfterSetupRef = useRef(false);
  const suspendInputRef = useRef<(() => void) | null>(null);
  const windowHasFocusRef = useRef(document.hasFocus());
  const refitRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachPending, setAttachPending] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusNonce, setFindFocusNonce] = useState(0);
  const [findResults, setFindResults] = useState<TerminalFindResults | null>(null);
  activeRef.current = active;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    setAttachError(null);
    setAttachPending(true);
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily: terminalFontFamilyFromCss(container),
      fontSize: 12,
      minimumContrastRatio: 4.5,
      scrollback: 20_000,
      theme: terminalThemeFromCss(container, theme),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const search = new SearchAddon();
    terminal.loadAddon(search);
    const searchResultsDisposable = search.onDidChangeResults((event) => {
      setFindResults(event);
    });
    searchAddonRef.current = search;
    terminalRef.current = terminal;
    // On Windows/Linux the find shortcut is Ctrl+F, which xterm would
    // otherwise turn into a ^F byte for the shell. Returning false skips
    // xterm's handling while the event still bubbles to the shell keydown
    // handler that opens the find bar. On mac the shortcut is Cmd+F, which
    // xterm ignores anyway, and Ctrl+F stays a readline key.
    terminal.attachCustomKeyEventHandler(
      (event) =>
        !(
          event.type === 'keydown' &&
          (isTerminalFindShortcut(event) || isTerminalTabNavigationShortcut(event))
        ),
    );
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!isTerminalLinkActivation(event)) {
          return;
        }

        void openExternalUrl({ url: uri });
      }),
    );
    if (supportsWebgl2()) {
      try {
        terminal.loadAddon(new WebglAddon());
      } catch {
        // WebGL is an optional renderer; xterm falls back to its default renderer.
      }
    }
    const filePathLinksDisposable = terminal.registerLinkProvider(
      createFilePathLinkProvider(terminal, (path) => {
        void openPathOrUrl({ target: path });
      }),
    );
    terminal.open(container);
    const fitTerminal = () => {
      fit.fit();
      terminal.refresh(0, terminal.rows - 1);
    };
    let fitFrame: number | null = null;
    const scheduleFitTerminal = () => {
      if (fitFrame !== null) {
        return;
      }

      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        fitTerminal();
      });
    };
    fitTerminal();
    refitRef.current = fitTerminal;

    let attached: Awaited<ReturnType<typeof attachPty>> | null = null;
    let disposed = false;
    let attachFinished = false;
    const attachTimeout = window.setTimeout(() => {
      if (disposed || attachFinished) {
        return;
      }

      const message = 'Timed out waiting for the backend terminal session to respond.';
      setAttachPending(false);
      setAttachError(message);
      terminal.writeln('');
      terminal.writeln(`[Terminal session is not responding: ${message}]`);
    }, TERMINAL_ATTACH_TIMEOUT_MS);
    let lastSentPtySize: { cols: number; rows: number } | null = null;
    let outputBurst = { bytes: 0, startedAt: performance.now() };
    const resizeAttachedPty = (size: { cols: number; rows: number }) => {
      if (!attached) {
        return;
      }

      if (
        lastSentPtySize?.cols === size.cols &&
        lastSentPtySize.rows === size.rows
      ) {
        return;
      }

      lastSentPtySize = size;
      recordSlowdownProfilerEvent({
        detail: `${label}/pty:${ptyId}/${size.cols}x${size.rows}`,
        kind: 'terminal-resize-sync',
        surface: 'terminal',
      });
      void attached.resize(size.cols, size.rows);
    };
    let inputOwnershipTransition: Promise<void> = Promise.resolve();
    const queueInputOwnershipTransition = (transition: () => Promise<void>) => {
      const next = inputOwnershipTransition.catch(() => undefined).then(transition);
      inputOwnershipTransition = next;
      void next.catch(() => undefined);
      return next;
    };
    const claimAttachedInput = (target = attachedRef.current) =>
      target
        ? queueInputOwnershipTransition(() => target.claimInput())
        : inputOwnershipTransition;
    const releaseAttachedInput = (target = attachedRef.current) => {
      if (target) {
        void queueInputOwnershipTransition(() => target.releaseInput());
      }
    };
    const terminalOwnsLiveInput = () => {
      const documentHasFocus = document.hasFocus();
      const domOwnsInput = container.contains(document.activeElement);
      if (documentHasFocus && domOwnsInput) {
        // A real key event is authoritative if a native focus notification was
        // missed; inactive webviews report document.hasFocus() as false.
        windowHasFocusRef.current = true;
      }
      return documentHasFocus && (hasInputFocusRef.current || domOwnsInput);
    };
    const writeTerminalInput = async (data: string) => {
      const target = attachedRef.current;
      if (!target || !terminalOwnsLiveInput()) {
        return;
      }

      try {
        if (!hasInputFocusRef.current) {
          hasInputFocusRef.current = true;
          await claimAttachedInput(target);
        } else {
          try {
            await inputOwnershipTransition;
          } catch {
            if (!terminalOwnsLiveInput() || attachedRef.current !== target) {
              return;
            }
            // A rejected claim/release must not poison the ownership queue
            // forever while the real xterm textarea remains focused.
            await claimAttachedInput(target);
          }
        }
        if (!terminalOwnsLiveInput() || attachedRef.current !== target) {
          return;
        }
        await target.write(data);
      } catch (error) {
        if (
          !isPtyInputOwnershipError(error) ||
          !terminalOwnsLiveInput() ||
          attachedRef.current !== target
        ) {
          return;
        }

        try {
          await claimAttachedInput(target);
          if (terminalOwnsLiveInput() && attachedRef.current === target) {
            await target.write(data);
          }
        } catch {
          // A closed terminal cannot accept input; the exit/attach UI owns that state.
        }
      }
    };
    let inputWriteTransition: Promise<void> = Promise.resolve();
    const writeDisposable = terminal.onData((data) => {
      const next = inputWriteTransition.catch(() => undefined).then(() =>
        writeTerminalInput(data),
      );
      inputWriteTransition = next;
      void next.catch(() => undefined);
    });
    const resizeDisposable = terminal.onResize((size) => {
      resizeAttachedPty(size);
    });
    const resizeObserver = new ResizeObserver(() => {
      scheduleFitTerminal();
    });
    resizeObserver.observe(container);
    let inputClaimSequence = 0;
    const claimInput = () => {
      if (!windowHasFocusRef.current || !document.hasFocus()) {
        hasInputFocusRef.current = false;
        return;
      }

      hasInputFocusRef.current = true;
      inputClaimSequence += 1;
      void claimAttachedInput();
    };
    reclaimInputRef.current = claimInput;
    const focusInput = () => {
      if (!windowHasFocusRef.current || !document.hasFocus()) {
        hasInputFocusRef.current = false;
        pendingInputFocusRef.current = true;
        return;
      }

      const claimSequenceBeforeFocus = inputClaimSequence;
      terminal.focus();
      if (
        container.contains(document.activeElement) &&
        inputClaimSequence === claimSequenceBeforeFocus
      ) {
        // WebView focus and Fast Refresh do not always emit a new focusin.
        // Reconcile the real textarea focus with backend PTY ownership.
        claimInput();
      }
      if (container.contains(document.activeElement)) {
        pendingInputFocusRef.current = false;
      }
    };
    focusInputRef.current = focusInput;
    const suspendInput = () => {
      hasInputFocusRef.current = false;
      releaseAttachedInput();
    };
    suspendInputRef.current = suspendInput;
    const releaseInput = () => {
      window.setTimeout(() => {
        if (disposed) {
          return;
        }

        if (
          windowHasFocusRef.current &&
          document.hasFocus() &&
          container.contains(document.activeElement)
        ) {
          return;
        }

        suspendInput();
      }, 0);
    };
    container.addEventListener('focusin', claimInput);
    container.addEventListener('focusout', releaseInput);
    if (restoreInputAfterSetupRef.current) {
      restoreInputAfterSetupRef.current = false;
      focusInput();
    }

    recordSlowdownProfilerEvent({
      detail: `${label}/pty:${ptyId}`,
      kind: 'terminal-attach-started',
      surface: 'terminal',
    });
    void attachPty(ptyId, {
      onData: (data) => {
        const now = performance.now();
        if (now - outputBurst.startedAt > TERMINAL_OUTPUT_BURST_WINDOW_MS) {
          outputBurst = { bytes: 0, startedAt: now };
        }
        outputBurst.bytes += data.byteLength;
        if (outputBurst.bytes >= TERMINAL_OUTPUT_BURST_BYTES) {
          recordSlowdownProfilerEvent({
            count: outputBurst.bytes,
            detail: `${label}/pty:${ptyId}`,
            durationMs: Math.round(now - outputBurst.startedAt),
            kind: 'terminal-output-burst',
            surface: 'terminal',
          });
          outputBurst = { bytes: 0, startedAt: now };
        }
        terminal.write(data);
      },
      onExit: (code) => {
        terminal.writeln('');
        terminal.writeln(`[${label} exited with code ${code}]`);
      },
      // Cached scrollback previews replay through onData before the fresh
      // buffer arrives; a diverging fresh buffer clears the preview first.
      onReset: () => {
        terminal.reset();
      },
    }).then((next) => {
      if (disposed) {
        next.dispose();
        return;
      }

      attachFinished = true;
      window.clearTimeout(attachTimeout);
      setAttachError(null);
      setAttachPending(false);
      attached = next;
      attachedRef.current = next;
      recordSlowdownProfilerEvent({
        detail: `${label}/pty:${ptyId}`,
        kind: 'terminal-attached',
        surface: 'terminal',
      });
      lastSentPtySize = null;
      resizeAttachedPty({ cols: terminal.cols, rows: terminal.rows });
      if (
        windowHasFocusRef.current &&
        document.hasFocus() &&
        (hasInputFocusRef.current || container.contains(document.activeElement))
      ) {
        hasInputFocusRef.current = true;
        void claimAttachedInput(next);
      }
    }).catch((nextError: unknown) => {
      if (disposed) {
        return;
      }

      attachFinished = true;
      window.clearTimeout(attachTimeout);
      const message = terminalAttachErrorMessage(nextError);
      setAttachPending(false);
      setAttachError(message);
      terminal.writeln('');
      terminal.writeln(`[Terminal session is no longer available: ${message}]`);
    });

    return () => {
      disposed = true;
      recordSlowdownProfilerEvent({
        detail: `${label}/pty:${ptyId}`,
        kind: 'terminal-detached',
        surface: 'terminal',
      });
      const oldTerminalOwnedDomFocus = container.contains(document.activeElement);
      restoreInputAfterSetupRef.current =
        restoreInputAfterSetupRef.current ||
        (activeRef.current &&
          windowHasFocusRef.current &&
          document.hasFocus() &&
          oldTerminalOwnedDomFocus);
      if (oldTerminalOwnedDomFocus) {
        terminal.blur();
      }
      suspendInput();
      attachedRef.current = null;
      if (reclaimInputRef.current === claimInput) {
        reclaimInputRef.current = null;
      }
      if (focusInputRef.current === focusInput) {
        focusInputRef.current = null;
      }
      if (suspendInputRef.current === suspendInput) {
        suspendInputRef.current = null;
      }
      refitRef.current = null;
      searchAddonRef.current = null;
      terminalRef.current = null;
      window.clearTimeout(attachTimeout);
      if (fitFrame !== null) {
        cancelAnimationFrame(fitFrame);
      }
      attached?.dispose();
      writeDisposable.dispose();
      resizeDisposable.dispose();
      searchResultsDisposable.dispose();
      filePathLinksDisposable.dispose();
      resizeObserver.disconnect();
      container.removeEventListener('focusin', claimInput);
      container.removeEventListener('focusout', releaseInput);
      scheduleTerminalDispose(terminal, `${label}/pty:${ptyId}`);
    };
  }, [label, ptyId, theme]);

  // xterm can render with stale geometry while its tab is hidden; refit and
  // repaint once it becomes active again so wrapping/layout stay correct.
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      refitRef.current?.();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [active]);

  // Track native focus even while this terminal tab is inactive, so a tab
  // activated in a background webview cannot claim PTY input. Open Folder
  // actions explicitly request restoration because their toolbar button owns
  // DOM focus before Explorer takes over.
  useEffect(() => {
    let lastFocusRestoreNonce = terminalFocusStore.get(
      terminalWindowFocusRestoreNonceAtom,
    );
    let windowBlurred = false;
    let restoreInputOnWindowFocus = false;
    let reclaimedSinceWindowBlur = false;
    const terminalOwnedFocusBeforeBlur = () => {
      const container = containerRef.current;
      const activeElement = document.activeElement;
      if (container?.contains(activeElement)) {
        return true;
      }

      const webviewClearedActiveElement =
        activeElement === document.body || activeElement === document.documentElement;
      return webviewClearedActiveElement && hasInputFocusRef.current;
    };
    const reclaimFocusedInput = () => {
      windowHasFocusRef.current = true;
      if (!active) {
        windowBlurred = false;
        restoreInputOnWindowFocus = false;
        reclaimedSinceWindowBlur = false;
        return;
      }

      if (reclaimedSinceWindowBlur) {
        return;
      }

      if (windowBlurred) {
        const shouldRestoreInput =
          restoreInputOnWindowFocus || pendingInputFocusRef.current;
        windowBlurred = false;
        restoreInputOnWindowFocus = false;
        if (shouldRestoreInput) {
          focusInputRef.current?.();
          reclaimedSinceWindowBlur = !pendingInputFocusRef.current;
          if (reclaimedSinceWindowBlur) {
            return;
          }
        }
      } else if (pendingInputFocusRef.current) {
        focusInputRef.current?.();
        reclaimedSinceWindowBlur = !pendingInputFocusRef.current;
        if (reclaimedSinceWindowBlur) {
          return;
        }
      }

      const container = containerRef.current;
      if (document.hasFocus() && container?.contains(document.activeElement)) {
        reclaimedSinceWindowBlur = true;
        reclaimInputRef.current?.();
      }
    };
    const markWindowBlurred = () => {
      const alreadyBlurred = windowBlurred;
      const focusRestoreNonce = terminalFocusStore.get(
        terminalWindowFocusRestoreNonceAtom,
      );
      const externalActionRequested = focusRestoreNonce !== lastFocusRestoreNonce;
      lastFocusRestoreNonce = focusRestoreNonce;
      restoreInputOnWindowFocus =
        restoreInputOnWindowFocus ||
        (active && (externalActionRequested || terminalOwnedFocusBeforeBlur()));
      windowBlurred = true;
      reclaimedSinceWindowBlur = false;
      windowHasFocusRef.current = false;
      if (!alreadyBlurred) {
        suspendInputRef.current?.();
      }
    };

    window.addEventListener('blur', markWindowBlurred);
    window.addEventListener('focus', reclaimFocusedInput);

    if (!isTauriRuntime()) {
      return () => {
        window.removeEventListener('blur', markWindowBlurred);
        window.removeEventListener('focus', reclaimFocusedInput);
      };
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          reclaimFocusedInput();
        } else {
          markWindowBlurred();
        }
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      window.removeEventListener('blur', markWindowBlurred);
      window.removeEventListener('focus', reclaimFocusedInput);
      unlisten?.();
    };
  }, [active, terminalFocusStore]);

  useEffect(() => {
    if (!active || focusNonce === 0) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      focusInputRef.current?.();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [active, focusNonce]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return undefined;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listenForDroppedPathsWhenFocused(shell, (paths) => {
      const attached = attachedRef.current;
      if (!attached) {
        return;
      }

      void attached.write(formatTerminalDroppedPaths(paths));
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten?.();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const findInTerminal = (
    term: string,
    direction: TerminalFindDirection,
    incremental = false,
  ) => {
    const search = searchAddonRef.current;
    if (!search) {
      return;
    }
    if (!term) {
      search.clearDecorations();
      setFindResults(null);
      return;
    }

    const options = {
      decorations: terminalFindDecorations(theme),
      incremental: direction === 'next' ? incremental : undefined,
    };
    try {
      if (direction === 'next') {
        search.findNext(term, options);
      } else {
        search.findPrevious(term, options);
      }
    } catch {
      // Decorations need a fully rendered terminal; fall back to plain search.
      if (direction === 'next') {
        search.findNext(term, { incremental });
      } else {
        search.findPrevious(term);
      }
    }
  };

  const closeFind = () => {
    searchAddonRef.current?.clearDecorations();
    setFindResults(null);
    setFindOpen(false);
    terminalRef.current?.focus();
  };

  const handleShellKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isTerminalFindShortcut(event.nativeEvent)) {
      return;
    }

    // Swallow the shortcut so the page-level Cmd+F handler on document never
    // opens the DOM find bar over terminal content it cannot search.
    event.preventDefault();
    event.stopPropagation();
    setFindOpen(true);
    setFindFocusNonce((nonce) => nonce + 1);
  };

  const sendImageFiles = async (files: File[]) => {
    if (!attachmentTarget || !attachedRef.current) {
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      return;
    }

    const saved = await Promise.all(
      imageFiles.map(async (file) => {
        const base64Data = await fileToBase64(file);
        const result = await saveEditorImage({
          base64Data,
          fileName: file.name || 'terminal-image',
          mimeType: file.type,
          projectId: attachmentTarget.projectId,
          scope: 'message',
          todoId: attachmentTarget.todoId,
        });
        return {
          fileName: file.name || 'terminal-image',
          markdownPath: result.markdownPath,
        } satisfies ReplyAttachmentReference;
      }),
    );
    const attached = attachedRef.current;
    if (!attached) {
      return;
    }

    await attached.write(formatTerminalImageReferences(saved));
  };

  return (
    <div
      className={`terminal-shell ${theme}`}
      onKeyDown={handleShellKeyDown}
      onTouchMove={containTerminalScroll}
      onWheel={containTerminalScroll}
      ref={shellRef}
      onDragOver={(event) => {
        if (attachmentTarget) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (!attachmentTarget) {
          return;
        }

        event.preventDefault();
        void sendImageFiles(Array.from(event.dataTransfer.files));
      }}
      onPaste={(event) => {
        if (!attachmentTarget) {
          return;
        }

        const files = imageFilesFromClipboard(event.clipboardData);
        if (files.length) {
          event.preventDefault();
          void sendImageFiles(files);
        }
      }}
    >
      {findOpen ? (
        <TerminalFindBar
          focusNonce={findFocusNonce}
          onClose={closeFind}
          onFind={findInTerminal}
          results={findResults}
        />
      ) : null}
      <div aria-label={label} className="terminal-surface" ref={containerRef}>
        {attachError ? (
          <div className="terminal-surface-error" role="alert">
            <span>Terminal session is no longer available</span>
            <p>{attachError}</p>
          </div>
        ) : attachPending ? (
          <div className="terminal-surface-status" role="status">
            Connecting to terminal...
          </div>
        ) : null}
      </div>
    </div>
  );
}

// SearchAddon decorations require #RRGGBB values, so these mirror the wood
// theme's terminal selection/cursor fallbacks instead of reading CSS vars.
function terminalFindDecorations(theme: TerminalVisualTheme) {
  if (theme === 'light') {
    return {
      activeMatchBackground: '#d69a3c',
      activeMatchColorOverviewRuler: '#a96334',
      matchBackground: '#f1dfc4',
      matchOverviewRuler: '#d69a3c',
    };
  }

  return {
    activeMatchBackground: '#f0c878',
    activeMatchColorOverviewRuler: '#f0c878',
    matchBackground: '#4b3527',
    matchOverviewRuler: '#dcae63',
  };
}

function containTerminalScroll(event: WheelEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) {
  event.stopPropagation();
}

function terminalAttachErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPtyInputOwnershipError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('terminal view does not own focused input');
}

function scheduleTerminalDispose(terminal: Terminal, detail: string) {
  recordSlowdownProfilerEvent({
    detail,
    kind: 'terminal-dispose-scheduled',
    surface: 'terminal',
  });

  // Two frames let the newly selected task paint before xterm/WebGL teardown
  // runs. Never cancelled: the detached instance must release its GL context
  // and event listeners.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        const startedAt = performance.now();
        terminal.dispose();
        recordSlowdownProfilerEvent({
          detail,
          durationMs: Math.round(performance.now() - startedAt),
          kind: 'terminal-disposed',
          surface: 'terminal',
        });
      }, TERMINAL_DISPOSE_FALLBACK_DELAY_MS);
    });
  });
}

function formatTerminalDroppedPaths(paths: string[]): string {
  return paths.map(escapeTerminalPath).join(' ');
}

// Backslash-escape like macOS Terminal so the path stays one shell word
// without wrapping quotes.
function escapeTerminalPath(path: string): string {
  return path.replace(/[^A-Za-z0-9/._~:@%+=,-]/g, '\\$&');
}

const localFilePathPattern = /(^|[\s([{"'`])((?:~\/|\/(?!\/))[^\s<>"'`]+)/g;
const trailingPathPunctuation = /[),.;:!?}\]]+$/;

function createFilePathLinkProvider(
  terminal: Terminal,
  openPath: (path: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const links = filePathLinksFromLine(
        line.translateToString(true),
        bufferLineNumber,
        openPath,
      );
      callback(links.length ? links : undefined);
    },
  };
}

function filePathLinksFromLine(
  line: string,
  bufferLineNumber: number,
  openPath: (path: string) => void,
): ILink[] {
  const links: ILink[] = [];
  for (const match of line.matchAll(localFilePathPattern)) {
    const rawPath = match[2] ?? '';
    const path = trimTerminalFilePath(rawPath);
    if (!isOpenableTerminalFilePath(path)) {
      continue;
    }

    const startIndex = (match.index ?? 0) + match[0].length - rawPath.length;
    links.push({
      activate: (event) => {
        if (!isTerminalLinkActivation(event)) {
          return;
        }

        openPath(path);
      },
      range: {
        end: {
          x: startIndex + path.length,
          y: bufferLineNumber,
        },
        start: {
          x: startIndex + 1,
          y: bufferLineNumber,
        },
      },
      text: path,
    });
  }

  return links;
}

// Links open only with the platform "follow link" modifier held (Cmd on
// macOS, Ctrl elsewhere) so a stray click in the terminal never fires one.
function isTerminalLinkActivation(event: MouseEvent): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

// Cmd+F on mac, Ctrl+F elsewhere. The off-platform modifier is deliberately
// rejected: on mac Ctrl+F must keep reaching the shell as readline ^F.
function isTerminalFindShortcut(event: KeyboardEvent): boolean {
  const modifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

  return modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
}

function isTerminalTabNavigationShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Tab';
}

function trimTerminalFilePath(path: string): string {
  return path.replace(trailingPathPunctuation, '');
}

function isOpenableTerminalFilePath(path: string): boolean {
  return path.startsWith('~/') || (path.startsWith('/') && path.length > 1);
}

function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  return files.length
    ? files
    : Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

function terminalFontFamilyFromCss(container: HTMLElement) {
  const style = getComputedStyle(container);
  const cssFontFamily = style.fontFamily.trim();
  const terminalFontFamily = style.getPropertyValue('--terminal-font-family').trim();

  return cssFontFamily || terminalFontFamily || terminalFontStack;
}

function terminalThemeFromCss(container: HTMLElement, theme: TerminalVisualTheme) {
  const style = getComputedStyle(container);
  const color = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  if (theme === 'light') {
    return {
      background: color('--terminal-background', '#fffdf8'),
      black: color('--terminal-black', '#2d2118'),
      blue: color('--terminal-blue', '#5d76a8'),
      brightBlack: color('--terminal-bright-black', '#8b7b6a'),
      brightBlue: color('--terminal-bright-blue', '#7895c9'),
      brightCyan: color('--terminal-bright-cyan', '#4eaaa4'),
      brightGreen: color('--terminal-bright-green', '#45a867'),
      brightMagenta: color('--terminal-bright-magenta', '#b68bcc'),
      brightRed: color('--terminal-bright-red', '#d76c5f'),
      brightWhite: color('--terminal-bright-white', '#2d2118'),
      brightYellow: color('--terminal-bright-yellow', '#d69a3c'),
      cursor: color('--terminal-cursor', '#a96334'),
      cyan: color('--terminal-cyan', '#3d918c'),
      foreground: color('--terminal-foreground', '#2d2118'),
      green: color('--terminal-green', '#2f8f4e'),
      magenta: color('--terminal-magenta', '#9b6fb0'),
      red: color('--terminal-red', '#b9463a'),
      selectionBackground: color('--terminal-selection', '#f1dfc4'),
      white: color('--terminal-white', '#75685b'),
      yellow: color('--terminal-yellow', '#a86f25'),
    };
  }

  return {
    background: color('--terminal-background', '#221914'),
    black: color('--terminal-black', '#241813'),
    blue: color('--terminal-blue', '#8ba7d8'),
    brightBlack: color('--terminal-bright-black', '#6d5a4d'),
    brightBlue: color('--terminal-bright-blue', '#aec5ec'),
    brightCyan: color('--terminal-bright-cyan', '#95d6d2'),
    brightGreen: color('--terminal-bright-green', '#9fcf96'),
    brightMagenta: color('--terminal-bright-magenta', '#dab5e7'),
    brightRed: color('--terminal-bright-red', '#ed9a89'),
    brightWhite: color('--terminal-bright-white', '#fff7ed'),
    brightYellow: color('--terminal-bright-yellow', '#f1c987'),
    cursor: color('--terminal-cursor', '#f0c878'),
    cyan: color('--terminal-cyan', '#6bb9b4'),
    foreground: color('--terminal-foreground', '#f8eadc'),
    green: color('--terminal-green', '#7fb071'),
    magenta: color('--terminal-magenta', '#c99bdd'),
    red: color('--terminal-red', '#d77b69'),
    selectionBackground: color('--terminal-selection', '#4b3527'),
    white: color('--terminal-white', '#f1dfcf'),
    yellow: color('--terminal-yellow', '#dcae63'),
  };
}
