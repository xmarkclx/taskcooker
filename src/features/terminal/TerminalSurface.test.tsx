import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalSurface } from './TerminalSurface';
import { openExternalUrl, openPathOrUrl, saveEditorImage } from '../../tauri/commands';
import { attachPty } from './ptyBridge';
import { terminalWindowFocusRestoreNonceAtom } from './terminalFocusState';

const appStyles = readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');
const fitAddonMock = vi.hoisted(() => ({
  instances: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
  }>,
  nextFitSize: null as { cols: number; rows: number } | null,
}));
const terminalMock = vi.hoisted(() => ({
  instances: [] as Array<{
    blur: ReturnType<typeof vi.fn>;
    customKeyHandler?: (event: KeyboardEvent) => boolean;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    helper?: HTMLTextAreaElement;
    lineText: string;
    linkProviders: Array<{
      provideLinks: (line: number, callback: (links: unknown[] | undefined) => void) => void;
    }>;
    onDataHandler?: (data: string) => void;
    onResizeHandler?: (size: { cols: number; rows: number }) => void;
    options: Record<string, unknown>;
    write: ReturnType<typeof vi.fn>;
  }>,
}));
const webLinksAddonMock = vi.hoisted(() => ({
  instances: [] as Array<{
    activate: ReturnType<typeof vi.fn>;
    handler: (event: MouseEvent, uri: string) => void;
  }>,
}));
const webglAddonMock = vi.hoisted(() => ({
  failActivation: false,
  instances: [] as Array<{
    activate: ReturnType<typeof vi.fn>;
    onContextLoss: ReturnType<typeof vi.fn>;
  }>,
}));
const webviewMock = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  return {
    handlers,
    onDragDropEvent: vi.fn((handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return Promise.resolve(vi.fn());
    }),
  };
});
const appWindowMock = vi.hoisted(() => {
  const focusHandlers: Array<(event: { payload: boolean }) => void> = [];
  const unlisten = vi.fn();
  return {
    focusHandlers,
    hasDocumentFocus: true,
    isTauriRuntime: false,
    onFocusChanged: vi.fn((handler: (event: { payload: boolean }) => void) => {
      focusHandlers.push(handler);
      return Promise.resolve(unlisten);
    }),
    unlisten,
  };
});

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class WebglAddon {
    activate = vi.fn(() => {
      if (webglAddonMock.failActivation) {
        throw new Error('WebGL unavailable');
      }
    });
    onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));

    constructor() {
      webglAddonMock.instances.push({
        activate: this.activate,
        onContextLoss: this.onContextLoss,
      });
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    terminal?: { resize: (cols: number, rows: number) => void };
    activate = vi.fn((terminal: { resize: (cols: number, rows: number) => void }) => {
      this.terminal = terminal;
    });
    fit = vi.fn(() => {
      if (!fitAddonMock.nextFitSize) {
        return;
      }

      this.terminal?.resize(fitAddonMock.nextFitSize.cols, fitAddonMock.nextFitSize.rows);
    });

    constructor() {
      fitAddonMock.instances.push(this);
    }
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class WebLinksAddon {
    activate = vi.fn();

    constructor(handler: (event: MouseEvent, uri: string) => void) {
      webLinksAddonMock.instances.push({
        activate: this.activate,
        handler,
      });
    }
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class Terminal {
    instance!: {
      blur: ReturnType<typeof vi.fn>;
      customKeyHandler?: (event: KeyboardEvent) => boolean;
      dispose: ReturnType<typeof vi.fn>;
      focus: ReturnType<typeof vi.fn>;
      helper?: HTMLTextAreaElement;
      lineText: string;
      linkProviders: Array<{
        provideLinks: (line: number, callback: (links: unknown[] | undefined) => void) => void;
      }>;
      onDataHandler?: (data: string) => void;
      onResizeHandler?: (size: { cols: number; rows: number }) => void;
      options: Record<string, unknown>;
      write: ReturnType<typeof vi.fn>;
    };
    blur = vi.fn(() => {
      this.instance.helper?.blur();
    });
    cols = 80;
    buffer = {
      active: {
        getLine: (lineIndex: number) =>
          lineIndex === 0
            ? {
                translateToString: () => this.instance.lineText,
              }
            : undefined,
      },
    };
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.instance.customKeyHandler = handler;
    });
    dispose = vi.fn();
    focus = vi.fn(() => {
      this.instance.helper?.focus();
    });
    loadAddon = vi.fn((addon: { activate?: (terminal: unknown) => void }) => {
      addon.activate?.(this);
    });
    onData = vi.fn((handler: (data: string) => void) => {
      this.instance.onDataHandler = handler;
      return { dispose: vi.fn() };
    });
    onResize = vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
      this.instance.onResizeHandler = handler;
      return { dispose: vi.fn() };
    });
    // Required by SearchAddon.activate.
    onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }));
    refresh = vi.fn();
    registerLinkProvider = vi.fn(
      (provider: {
        provideLinks: (
          line: number,
          callback: (links: unknown[] | undefined) => void,
        ) => void;
      }) => {
        this.instance.linkProviders.push(provider);
        return { dispose: vi.fn() };
      },
    );
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
      this.instance.onResizeHandler?.({ cols, rows });
    });
    rows = 24;
    write = vi.fn();
    writeln = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.cols = Number(options.cols ?? this.cols);
      this.rows = Number(options.rows ?? this.rows);
      this.instance = {
        blur: this.blur,
        dispose: this.dispose,
        focus: this.focus,
        lineText: '',
        linkProviders: [],
        options,
        write: this.write,
      };
      terminalMock.instances.push(this.instance);
    }

    open(container: HTMLElement) {
      const terminal = document.createElement('div');
      terminal.className = 'xterm';
      const helper = document.createElement('textarea');
      helper.className = 'xterm-helper-textarea';
      const viewport = document.createElement('div');
      viewport.className = 'xterm-viewport';
      terminal.append(helper);
      terminal.append(viewport);
      container.append(terminal);
      this.instance.helper = helper;
    }
  },
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: webviewMock.onDragDropEvent,
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: appWindowMock.onFocusChanged,
  }),
}));

vi.mock('../../tauri/runtime', () => ({
  isTauriRuntime: () => appWindowMock.isTauriRuntime,
}));

vi.mock('../../tauri/commands', () => ({
  openExternalUrl: vi.fn(),
  openPathOrUrl: vi.fn(),
  saveEditorImage: vi.fn(),
}));

vi.mock('./ptyBridge', () => ({
  attachPty: vi.fn(),
}));

function runAnimationFramesImmediately() {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

describe('TerminalSurface', () => {
  beforeEach(() => {
    getDefaultStore().set(terminalWindowFocusRestoreNonceAtom, 0);
    appWindowMock.hasDocumentFocus = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(
      () => appWindowMock.hasDocumentFocus,
    );
    vi.stubGlobal('WebGL2RenderingContext', class WebGL2RenderingContext {});
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      },
    });
    vi.mocked(attachPty).mockClear();
    vi.mocked(attachPty).mockResolvedValue({
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    });
    fitAddonMock.instances.length = 0;
    fitAddonMock.nextFitSize = null;
    terminalMock.instances.length = 0;
    webLinksAddonMock.instances.length = 0;
    webglAddonMock.failActivation = false;
    webglAddonMock.instances.length = 0;
    webviewMock.handlers.length = 0;
    webviewMock.onDragDropEvent.mockClear();
    appWindowMock.focusHandlers.length = 0;
    appWindowMock.isTauriRuntime = false;
    appWindowMock.onFocusChanged.mockClear();
    appWindowMock.unlisten.mockClear();
    vi.mocked(saveEditorImage).mockReset().mockResolvedValue({
      absolutePath: '/Users/markcl/Library/Application Support/Boomerang/terminal.png',
      markdownPath: '~/Library/Application Support/Boomerang/terminal.png',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('contains terminal wheel scrolling inside the terminal surface', async () => {
    const outerScroll = vi.fn();

    render(
      <div onWheel={outerScroll}>
        <TerminalSurface label="Task terminal" ptyId={42} />
      </div>,
    );

    const surface = await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    fireEvent.wheel(surface, { deltaY: 80 });

    expect(outerScroll).not.toHaveBeenCalled();
  });

  it('keeps breathing room on the xterm element so FitAddon can size the grid', () => {
    expect(cssRule('.terminal-surface')).toContain('padding: 0;');
    expect(cssRule('.terminal-surface')).not.toContain('padding: 12px 14px;');
    expect(appStyles).toMatch(/\.terminal-surface \.xterm\s*{[^}]*padding: 12px 14px;/s);
  });

  it('uses the terminal theme behind the inset xterm screen', () => {
    expect(cssRule('.terminal-surface .xterm-viewport')).toContain(
      'background: var(--terminal-background);',
    );
  });

  it('overlays terminal attach status above the xterm viewport', () => {
    expect(cssRule('.terminal-surface')).toContain('position: relative;');
    expect(cssRule('.terminal-surface-error,\n.terminal-surface-status')).toContain(
      'position: absolute;',
    );
    expect(cssRule('.terminal-surface-error,\n.terminal-surface-status')).toContain(
      'inset: 0;',
    );
  });

  it('only shows the terminal viewport scrollbar when scrollback overflows', () => {
    const viewportRule = cssRule('.terminal-surface .xterm-viewport');

    expect(viewportRule).toContain('overflow-y: auto;');
    expect(viewportRule).not.toContain('overflow-y: scroll;');
  });

  it('lets the terminal surface shrink without fixed minimum dimensions', () => {
    expect(cssRule('.terminal-shell')).not.toContain('--terminal-min-cols');
    expect(cssRule('.terminal-shell')).not.toContain('--terminal-min-rows');
    expect(cssRule('.terminal-shell')).not.toContain('--terminal-min-width');
    expect(cssRule('.terminal-shell')).not.toContain('--terminal-min-height');
    expect(cssRule('.terminal-surface')).not.toContain('min-width:');
    expect(cssRule('.terminal-surface')).toContain('min-height: 0;');
  });

  it('resizes the backing PTY to the fitted terminal grid without clamping upward', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));
    await waitFor(() => expect(terminalMock.instances[0]?.onResizeHandler).toBeDefined());

    terminalMock.instances[0]?.onResizeHandler?.({ cols: 72, rows: 12 });

    expect(attached.resize).toHaveBeenCalledWith(72, 12);
  });

  it('keeps PTY output in native terminal mode without frontend newline conversion', async () => {
    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');

    expect(terminalMock.instances[0]?.options).not.toHaveProperty('convertEol', true);
  });

  it('keeps more xterm history available for manual scrollback', async () => {
    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');

    expect(terminalMock.instances[0]?.options.scrollback).toBe(20_000);
  });

  it('lets Ctrl+Tab terminal tab shortcuts bubble out of focused xterm', async () => {
    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');

    const handler = terminalMock.instances[0]?.customKeyHandler;
    expect(handler).toBeDefined();
    expect(handler!(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Tab' }))).toBe(false);
    expect(
      handler!(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Tab', shiftKey: true })),
    ).toBe(false);
    expect(handler!(new KeyboardEvent('keydown', { key: 'Tab', metaKey: true }))).toBe(false);
    expect(
      handler!(new KeyboardEvent('keydown', { key: 'Tab', metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(handler!(new KeyboardEvent('keyup', { ctrlKey: true, key: 'Tab' }))).toBe(true);
  });

  it('shows an attach error when the backend no longer has the PTY session', async () => {
    vi.mocked(attachPty).mockRejectedValue(new Error('unknown pty session: 42'));

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Terminal session is no longer available',
    );
    expect(screen.getByText('unknown pty session: 42')).toBeInTheDocument();
  });

  it('shows progress while terminal attach is still pending', async () => {
    vi.mocked(attachPty).mockReturnValue(new Promise(() => {}));

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    expect(await screen.findByText('Connecting to terminal...')).toBeInTheDocument();
  });

  it('defers xterm disposal past the immediate cleanup timer so task selection can paint first', async () => {
    vi.useFakeTimers();
    try {
      let frameCallbacks: FrameRequestCallback[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          frameCallbacks.push(callback);
          return frameCallbacks.length;
        }),
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const view = render(<TerminalSurface label="Task terminal" ptyId={42} />);

      expect(screen.getByLabelText('Task terminal')).toBeInTheDocument();
      const dispose = terminalMock.instances.at(-1)?.dispose;
      expect(dispose).toBeDefined();

      view.unmount();

      vi.runOnlyPendingTimers();
      expect(dispose).not.toHaveBeenCalled();

      const firstFrame = frameCallbacks;
      frameCallbacks = [];
      firstFrame.forEach((callback) => callback(performance.now()));
      vi.runOnlyPendingTimers();
      expect(dispose).not.toHaveBeenCalled();

      const secondFrame = frameCallbacks;
      frameCallbacks = [];
      secondFrame.forEach((callback) => callback(performance.now()));
      vi.runOnlyPendingTimers();
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes PTY output to xterm immediately in arrival order', async () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));
    const handlers = vi.mocked(attachPty).mock.calls.at(-1)?.[1];
    expect(handlers).toBeDefined();

    const firstChunk = new TextEncoder().encode('older output');
    const inputEcho = new TextEncoder().encode('x');

    handlers!.onData(firstChunk);
    fireEvent.focusIn(surface);
    const terminalInstance = terminalMock.instances.at(-1);
    terminalInstance?.onDataHandler?.('x');

    await waitFor(() => expect(attached.write).toHaveBeenCalledWith('x'));
    handlers!.onData(inputEcho);

    expect(terminalInstance?.write).toHaveBeenNthCalledWith(1, firstChunk);
    expect(terminalInstance?.write).toHaveBeenNthCalledWith(2, inputEcho);
  });

  it('writes bash/readline erase echo to xterm immediately', async () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));
    const handlers = vi.mocked(attachPty).mock.calls.at(-1)?.[1];
    expect(handlers).toBeDefined();

    fireEvent.focusIn(surface);
    const terminalInstance = terminalMock.instances.at(-1);
    terminalInstance?.onDataHandler?.('\x7f');
    const eraseEcho = new Uint8Array([0x08, 0x20, 0x08]);
    handlers!.onData(eraseEcho);

    await waitFor(() => expect(attached.write).toHaveBeenCalledWith('\x7f'));
    expect(terminalInstance?.write).toHaveBeenCalledWith(eraseEcho);
  });

  it('reclaims PTY input before writing when the app window regains focus', async () => {
    let resolveReclaim!: () => void;
    const reclaim = new Promise<void>((resolve) => {
      resolveReclaim = resolve;
    });
    const attached = {
      claimInput: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(reclaim),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    surface.tabIndex = -1;
    // A DOM focus signal can arrive before WebView focus restoration makes
    // xterm active. It must not suppress the later useful focus signal.
    window.dispatchEvent(new FocusEvent('focus'));
    surface.focus();
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledTimes(1));

    // Opening an external folder can blur the webview without changing its
    // active DOM element. The returning window must reclaim backend ownership.
    window.dispatchEvent(new FocusEvent('focus'));
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledTimes(2));
    terminalMock.instances.at(-1)?.onDataHandler?.('x');

    expect(attached.write).not.toHaveBeenCalled();

    resolveReclaim();
    await waitFor(() => expect(attached.write).toHaveBeenCalledWith('x'));
  });

  it('reclaims PTY input from the native Tauri window focus signal', async () => {
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    const { unmount } = render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    surface.tabIndex = -1;
    surface.focus();
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());

    appWindowMock.focusHandlers[0]?.({ payload: false });
    appWindowMock.focusHandlers[0]?.({ payload: true });

    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledTimes(2));
    unmount();
    expect(appWindowMock.unlisten).toHaveBeenCalledOnce();
  });

  it('releases PTY ownership on native blur even when xterm stays DOM-focused', async () => {
    runAnimationFramesImmediately();
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    render(<TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    const terminalInstance = terminalMock.instances.at(-1);
    await waitFor(() => expect(terminalInstance?.helper).toHaveFocus());
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());

    appWindowMock.hasDocumentFocus = false;
    appWindowMock.focusHandlers[0]?.({ payload: false });

    await waitFor(() => expect(attached.releaseInput).toHaveBeenCalledOnce());
    expect(terminalInstance?.helper).toHaveFocus();
  });

  it('does not focus or claim input from an inactive native window', async () => {
    runAnimationFramesImmediately();
    appWindowMock.hasDocumentFocus = false;
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    render(<TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    await waitFor(() => expect(attachPty).toHaveBeenCalledOnce());

    expect(terminalMock.instances.at(-1)?.focus).not.toHaveBeenCalled();
    expect(attached.claimInput).not.toHaveBeenCalled();
  });

  it('remembers native blur while its terminal tab is inactive', async () => {
    runAnimationFramesImmediately();
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    const view = render(
      <TerminalSurface
        active={false}
        focusNonce={0}
        label="Task terminal"
        ptyId={42}
      />,
    );

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    appWindowMock.hasDocumentFocus = false;
    appWindowMock.focusHandlers[0]?.({ payload: false });

    view.rerender(
      <TerminalSurface active focusNonce={1} label="Task terminal" ptyId={42} />,
    );

    expect(terminalMock.instances.at(-1)?.focus).not.toHaveBeenCalled();
    expect(attached.claimInput).not.toHaveBeenCalled();
  });

  it('defers a background terminal focus request until its window returns', async () => {
    runAnimationFramesImmediately();
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    const view = render(
      <TerminalSurface
        active={false}
        focusNonce={0}
        label="Task terminal"
        ptyId={42}
      />,
    );

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    appWindowMock.hasDocumentFocus = false;
    appWindowMock.focusHandlers.at(-1)?.({ payload: false });

    view.rerender(
      <TerminalSurface active focusNonce={1} label="Task terminal" ptyId={42} />,
    );
    expect(terminalMock.instances.at(-1)?.focus).not.toHaveBeenCalled();
    expect(attached.claimInput).not.toHaveBeenCalled();

    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledTimes(2));
    appWindowMock.hasDocumentFocus = true;
    appWindowMock.focusHandlers.at(-1)?.({ payload: true });

    await waitFor(() => expect(terminalMock.instances.at(-1)?.helper).toHaveFocus());
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());
  });

  it('drops local xterm data while its native window is blurred', async () => {
    runAnimationFramesImmediately();
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    render(<TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    const terminalInstance = terminalMock.instances.at(-1);
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());

    appWindowMock.hasDocumentFocus = false;
    appWindowMock.focusHandlers[0]?.({ payload: false });
    terminalInstance?.onDataHandler?.('x');
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(attached.write).not.toHaveBeenCalled();
  });

  it('reconciles a DOM-focused xterm whose local focus signal was missed', async () => {
    runAnimationFramesImmediately();
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    render(
      <>
        <button type="button">Outside terminal</button>
        <TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} />
      </>,
    );

    await screen.findByLabelText('Task terminal');
    const terminalInstance = terminalMock.instances.at(-1);
    await waitFor(() => expect(terminalInstance?.helper).toHaveFocus());
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());

    screen.getByRole('button', { name: 'Outside terminal' }).focus();
    await waitFor(() => expect(attached.releaseInput).toHaveBeenCalledOnce());
    attached.claimInput.mockClear();
    const activeElement = vi
      .spyOn(document, 'activeElement', 'get')
      .mockReturnValue(terminalInstance?.helper ?? null);

    terminalInstance?.onDataHandler?.('x');

    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());
    await waitFor(() => expect(attached.write).toHaveBeenCalledWith('x'));
    activeElement.mockRestore();
  });

  it('transfers focus to a replacement xterm after a focused setup restarts', async () => {
    runAnimationFramesImmediately();
    const firstAttached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    const nextAttached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty)
      .mockResolvedValueOnce(firstAttached)
      .mockResolvedValueOnce(nextAttached);
    const view = render(
      <TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} theme="dark" />,
    );

    await screen.findByLabelText('Task terminal');
    const firstTerminal = terminalMock.instances.at(-1);
    await waitFor(() => expect(firstTerminal?.helper).toHaveFocus());
    await waitFor(() => expect(firstAttached.claimInput).toHaveBeenCalledOnce());

    view.rerender(
      <TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} theme="light" />,
    );

    const nextTerminal = terminalMock.instances.at(-1);
    expect(nextTerminal).not.toBe(firstTerminal);
    await waitFor(() => expect(nextTerminal?.helper).toHaveFocus());
    await waitFor(() => expect(nextAttached.claimInput).toHaveBeenCalledOnce());
    expect(firstTerminal?.helper).not.toHaveFocus();

    nextTerminal?.onDataHandler?.('x');
    await waitFor(() => expect(nextAttached.write).toHaveBeenCalledWith('x'));
  });

  it('focuses the real xterm input when focusNonce changes', async () => {
    runAnimationFramesImmediately();
    const view = render(
      <TerminalSurface focusNonce={0} label="Task terminal" ptyId={42} />,
    );

    await screen.findByLabelText('Task terminal');
    const terminalInstance = terminalMock.instances.at(-1);
    expect(terminalInstance?.focus).not.toHaveBeenCalled();

    view.rerender(
      <TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} />,
    );

    await waitFor(() => expect(terminalInstance?.focus).toHaveBeenCalledOnce());
    expect(terminalInstance?.helper).toHaveFocus();
  });

  it('restores xterm focus when its native window is reactivated', async () => {
    runAnimationFramesImmediately();
    appWindowMock.isTauriRuntime = true;
    render(
      <>
        <button type="button">Outside terminal</button>
        <TerminalSurface focusNonce={1} label="Task terminal" ptyId={42} />
      </>,
    );

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    const terminalInstance = terminalMock.instances.at(-1);
    await waitFor(() => expect(terminalInstance?.focus).toHaveBeenCalledOnce());

    appWindowMock.focusHandlers[0]?.({ payload: false });
    screen.getByRole('button', { name: 'Outside terminal' }).focus();
    appWindowMock.focusHandlers[0]?.({ payload: true });

    await waitFor(() => expect(terminalInstance?.focus).toHaveBeenCalledTimes(2));
    expect(terminalInstance?.helper).toHaveFocus();
  });

  it('preserves an external-action focus request until the window returns', async () => {
    runAnimationFramesImmediately();
    appWindowMock.isTauriRuntime = true;
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);
    render(
      <>
        <button type="button">Open Folder</button>
        <TerminalSurface
          focusNonce={1}
          label="Task terminal"
          ptyId={42}
        />
      </>,
    );

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(appWindowMock.onFocusChanged).toHaveBeenCalledOnce());
    const terminalInstance = terminalMock.instances.at(-1);
    await waitFor(() => expect(terminalInstance?.focus).toHaveBeenCalledOnce());

    screen.getByRole('button', { name: 'Open Folder' }).focus();
    await waitFor(() => expect(attached.releaseInput).toHaveBeenCalledOnce());
    getDefaultStore().set(terminalWindowFocusRestoreNonceAtom, 1);
    appWindowMock.focusHandlers[0]?.({ payload: false });
    appWindowMock.focusHandlers[0]?.({ payload: true });

    await waitFor(() => expect(terminalInstance?.focus).toHaveBeenCalledTimes(2));
    expect(terminalInstance?.helper).toHaveFocus();
  });

  it('keeps rapid terminal writes ordered while ownership checks are pending', async () => {
    let resolveFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    });
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn().mockReturnValueOnce(firstWrite).mockResolvedValue(undefined),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    surface.tabIndex = -1;
    surface.focus();
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());

    const terminalInstance = terminalMock.instances.at(-1);
    terminalInstance?.onDataHandler?.('a');
    terminalInstance?.onDataHandler?.('b');

    await waitFor(() => expect(attached.write).toHaveBeenCalledTimes(1));
    expect(attached.write).toHaveBeenNthCalledWith(1, 'a');

    resolveFirstWrite();
    await waitFor(() => expect(attached.write).toHaveBeenNthCalledWith(2, 'b'));
  });

  it('reclaims and writes after an earlier input claim failed', async () => {
    const attached = {
      claimInput: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary input claim failure'))
        .mockResolvedValue(undefined),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    surface.tabIndex = -1;
    surface.focus();
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());

    terminalMock.instances.at(-1)?.onDataHandler?.('x');

    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(attached.write).toHaveBeenCalledWith('x'));
  });

  it('retries a focused write once after stale PTY ownership is reported', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi
        .fn()
        .mockRejectedValueOnce(
          new Error('pty_write: terminal view does not own focused input'),
        )
        .mockResolvedValue(undefined),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    surface.tabIndex = -1;
    surface.focus();
    await waitFor(() => expect(attached.claimInput).toHaveBeenCalledOnce());

    terminalMock.instances.at(-1)?.onDataHandler?.('x');

    await waitFor(() => expect(attached.write).toHaveBeenCalledTimes(2));
    expect(attached.claimInput).toHaveBeenCalledTimes(2);
    expect(attached.write).toHaveBeenNthCalledWith(1, 'x');
    expect(attached.write).toHaveBeenNthCalledWith(2, 'x');
  });

  it('resizes the attached PTY to the fitted terminal grid on startup', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    fitAddonMock.nextFitSize = { cols: 148, rows: 32 };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    await waitFor(() => expect(attached.resize).toHaveBeenCalledWith(148, 32));
  });

  it('loads xterm WebGL rendering when available', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Chrome');
    // jsdom has no GPU, so a WebGL2 context is unavailable by default and the
    // surface skips the renderer. Simulate an environment where it is available.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      ((contextId: string) =>
        contextId === 'webgl2' ? ({} as WebGL2RenderingContext) : null) as HTMLCanvasElement['getContext'],
    );

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    expect(webglAddonMock.instances).toHaveLength(1);
  });

  it('skips the xterm WebGL renderer when WebGL2 is unavailable', async () => {
    // jsdom has no GPU: getContext('webgl2') returns null, so the renderer must
    // be skipped rather than throwing "WebGL2 not supported" during rendering.
    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    expect(webglAddonMock.instances).toHaveLength(0);
  });

  it('pastes dropped file paths into the focused terminal without quotes', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    const surface = await screen.findByLabelText('Task terminal');
    const shell = surface.closest('.terminal-shell') as HTMLElement;
    expect(shell).toBeInstanceOf(HTMLElement);
    shell.tabIndex = -1;
    shell.focus();
    await waitFor(() => expect(webviewMock.onDragDropEvent).toHaveBeenCalled());
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    webviewMock.handlers[0]?.({
      payload: {
        paths: ['/Users/markcl/My Folder/report.txt'],
        position: { x: 42, y: 64 },
        type: 'drop',
      },
    });

    expect(attached.write).toHaveBeenCalledWith('/Users/markcl/My\\ Folder/report.txt');
  });

  it('pastes dropped image file paths as plain paths even with an attachment target', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(
      <TerminalSurface
        attachmentTarget={{ projectId: 7, todoId: 42 }}
        label="Task terminal"
        ptyId={42}
      />,
    );

    const surface = await screen.findByLabelText('Task terminal');
    const shell = surface.closest('.terminal-shell') as HTMLElement;
    expect(shell).toBeInstanceOf(HTMLElement);
    shell.tabIndex = -1;
    shell.focus();
    await waitFor(() => expect(webviewMock.onDragDropEvent).toHaveBeenCalled());
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    webviewMock.handlers[0]?.({
      payload: {
        paths: ['/Users/markcl/Desktop/shot.png', '/Users/markcl/My Folder/report.txt'],
        position: { x: 42, y: 64 },
        type: 'drop',
      },
    });

    expect(attached.write).toHaveBeenCalledWith(
      '/Users/markcl/Desktop/shot.png /Users/markcl/My\\ Folder/report.txt',
    );
    expect(saveEditorImage).not.toHaveBeenCalled();
  });

  it('ignores dropped paths while the terminal does not own focus', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(
      <div>
        <input aria-label="Elsewhere" />
        <TerminalSurface label="Task terminal" ptyId={42} />
      </div>,
    );

    await screen.findByLabelText('Task terminal');
    screen.getByLabelText('Elsewhere').focus();
    await waitFor(() => expect(webviewMock.onDragDropEvent).toHaveBeenCalled());
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    webviewMock.handlers[0]?.({
      payload: {
        paths: ['/Users/markcl/My Folder/report.txt'],
        position: { x: 42, y: 64 },
        type: 'drop',
      },
    });

    expect(attached.write).not.toHaveBeenCalled();
  });

  it('pastes images from clipboard items into the attached terminal', async () => {
    const attached = {
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(attachPty).mockResolvedValue(attached);

    render(
      <TerminalSurface
        attachmentTarget={{ projectId: 7, todoId: 42 }}
        label="Task terminal"
        ptyId={42}
      />,
    );

    const surface = await screen.findByLabelText('Task terminal');
    const shell = surface.closest('.terminal-shell');
    expect(shell).toBeInstanceOf(HTMLElement);
    await waitFor(() => expect(attachPty).toHaveBeenCalledWith(42, expect.any(Object)));

    const image = new File(['image bytes'], 'screen.png', { type: 'image/png' });
    fireEvent.paste(shell!, {
      clipboardData: {
        files: [],
        items: [
          {
            getAsFile: () => image,
            kind: 'file',
            type: 'image/png',
          },
        ],
      },
    });

    await waitFor(() =>
      expect(saveEditorImage).toHaveBeenCalledWith({
        base64Data: expect.any(String),
        fileName: 'screen.png',
        mimeType: 'image/png',
        projectId: 7,
        scope: 'message',
        todoId: 42,
      }),
    );
    expect(attached.write).toHaveBeenCalledWith(
      '\r\n[Image attachments saved by TaskCooker]\r\n- screen.png: ~/Library/Application Support/Boomerang/terminal.png\r\n',
    );
  });

  it('opens xterm web links in the default browser on Cmd/Ctrl click', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(webLinksAddonMock.instances).toHaveLength(1));

    webLinksAddonMock.instances[0]?.handler(
      new MouseEvent('click', { metaKey: true }),
      'http://cdc-charter.test/charter/charter-enquiries/?LSCWP_CTRL=before_optm',
    );

    expect(openExternalUrl).toHaveBeenCalledWith({
      url: 'http://cdc-charter.test/charter/charter-enquiries/?LSCWP_CTRL=before_optm',
    });
  });

  it('ignores plain clicks on xterm web links so misclicks do not open them', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(webLinksAddonMock.instances).toHaveLength(1));
    vi.mocked(openExternalUrl).mockClear();

    webLinksAddonMock.instances[0]?.handler(
      new MouseEvent('click'),
      'http://cdc-charter.test/charter/charter-enquiries/?LSCWP_CTRL=before_optm',
    );

    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('opens detected local file paths from terminal output on Cmd/Ctrl click', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

    render(<TerminalSurface label="Task terminal" ptyId={42} />);

    await screen.findByLabelText('Task terminal');
    await waitFor(() => expect(terminalMock.instances[0]?.linkProviders).toHaveLength(1));

    terminalMock.instances[0]!.lineText =
      'Created ~/p/screenshot-alt/REQUIREMENTS.md, capturing everything.';

    let links: Array<{ activate: (event: MouseEvent, text: string) => void; text: string }> = [];
    terminalMock.instances[0]!.linkProviders[0]!.provideLinks(1, (nextLinks) => {
      links = (nextLinks ?? []) as typeof links;
    });

    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe('~/p/screenshot-alt/REQUIREMENTS.md');

    vi.mocked(openPathOrUrl).mockClear();
    links[0]?.activate(new MouseEvent('click'), links[0].text);
    expect(openPathOrUrl).not.toHaveBeenCalled();

    links[0]?.activate(new MouseEvent('click', { metaKey: true }), links[0].text);
    expect(openPathOrUrl).toHaveBeenCalledWith({
      target: '~/p/screenshot-alt/REQUIREMENTS.md',
    });
  });
});

function cssRule(selector: string) {
  const rule = appStyles.match(new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*{(?<body>[^}]*)}`));

  return rule?.groups?.body ?? '';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
