import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ptyBridge from './ptyBridge';
import { TerminalSurface } from './TerminalSurface';

describe('TerminalSurface find', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      },
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
    vi.spyOn(ptyBridge, 'attachPty').mockResolvedValue({
      claimInput: vi.fn(),
      close: vi.fn(),
      dispose: vi.fn(),
      releaseInput: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    });
  });

  afterEach(() => {
    restoreNavigator();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const savedNavigatorDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];

  // The find shortcut is platform-specific (Cmd+F on mac, Ctrl+F elsewhere),
  // so pin the platform per test instead of inheriting the host's. Applied
  // after render — TerminalSurface reads the platform at keydown time.
  function mockNavigatorPlatform(overrides: { platform: string; userAgent: string }) {
    for (const [key, value] of Object.entries(overrides)) {
      savedNavigatorDescriptors.push([
        key,
        Object.getOwnPropertyDescriptor(window.navigator, key),
      ]);
      Object.defineProperty(window.navigator, key, { configurable: true, value });
    }
  }

  function restoreNavigator() {
    for (const [key, descriptor] of savedNavigatorDescriptors.splice(0)) {
      if (descriptor) {
        Object.defineProperty(window.navigator, key, descriptor);
      } else {
        delete (window.navigator as unknown as Record<string, unknown>)[key];
      }
    }
  }

  function mockMacPlatform() {
    mockNavigatorPlatform({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
  }

  function mockWindowsPlatform() {
    mockNavigatorPlatform({
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
  }

  async function renderTerminal() {
    const view = render(<TerminalSurface label="Terminal" ptyId={7} />);
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  }

  it('opens a terminal-scoped find bar on Cmd+F without reaching the page find shortcut', async () => {
    const documentKeydown = vi.fn();
    document.addEventListener('keydown', documentKeydown);

    try {
      await renderTerminal();
      mockMacPlatform();

      fireEvent.keyDown(screen.getByLabelText('Terminal'), {
        key: 'f',
        code: 'KeyF',
        metaKey: true,
      });

      expect(screen.getByRole('search', { name: 'Find in terminal' })).toBeInTheDocument();
      expect(screen.getByLabelText('Find in terminal input')).toHaveFocus();
      // The page-level Cmd+F handler lives on document; the terminal must
      // swallow the shortcut so both find bars never open together.
      expect(documentKeydown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', documentKeydown);
    }
  });

  it('searches the terminal buffer and closes with Escape', async () => {
    await renderTerminal();
    mockWindowsPlatform();

    fireEvent.keyDown(screen.getByLabelText('Terminal'), {
      key: 'f',
      code: 'KeyF',
      ctrlKey: true,
    });

    const input = screen.getByLabelText('Find in terminal input');
    fireEvent.change(input, { target: { value: 'error' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('search', { name: 'Find in terminal' })).not.toBeInTheDocument();
  });

  it('opens find on Ctrl+F from inside the xterm textarea on non-mac platforms', async () => {
    const { container } = await renderTerminal();
    mockWindowsPlatform();

    // Focus lives in xterm's hidden textarea while typing in a terminal.
    // Without special handling xterm consumes Ctrl+F as the ^F control byte
    // and stops propagation, so the shortcut must be excluded from xterm's
    // key handling for the find bar to ever see it.
    const textarea = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    fireEvent.keyDown(textarea, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(screen.getByRole('search', { name: 'Find in terminal' })).toBeInTheDocument();
  });

  it('keeps Ctrl+F as shell input on mac instead of opening find', async () => {
    await renderTerminal();
    mockMacPlatform();

    fireEvent.keyDown(screen.getByLabelText('Terminal'), {
      key: 'f',
      code: 'KeyF',
      ctrlKey: true,
    });

    expect(screen.queryByRole('search', { name: 'Find in terminal' })).not.toBeInTheDocument();
  });

  it('does not open the find bar for plain typing', async () => {
    await renderTerminal();

    fireEvent.keyDown(screen.getByLabelText('Terminal'), { key: 'f', code: 'KeyF' });

    expect(screen.queryByRole('search', { name: 'Find in terminal' })).not.toBeInTheDocument();
  });
});
