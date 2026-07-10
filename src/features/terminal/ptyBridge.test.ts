import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachPty,
  clearCachedPtyScrollback,
  prefetchPtyScrollback,
} from './ptyBridge';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

type PtyDataEvent = { payload: { data: string; ptyId: number } };
type PtyDataListener = (event: PtyDataEvent) => void;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

function scrollbackResponse(text: string) {
  return {
    data: Buffer.from(text, 'utf8').toString('base64'),
    exitCode: null,
    exited: false,
    ptyId: 0,
  };
}

function base64Text(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function mockScrollbackInvoke(text: string) {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'pty_scrollback') {
      return Promise.resolve(scrollbackResponse(text));
    }

    return Promise.resolve(undefined);
  });
  listenMock.mockResolvedValue(() => {});
}

function textOf(calls: Array<[Uint8Array]>): string[] {
  return calls.map(([bytes]) => Buffer.from(bytes).toString('utf8'));
}

describe('ptyBridge scrollback cache', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    listenMock.mockClear();
  });

  it('writes the fresh scrollback once when no cache entry exists', async () => {
    mockScrollbackInvoke('hello');
    const onData = vi.fn();
    const onReset = vi.fn();

    const attached = await attachPty(101, { onData, onReset });

    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual(['hello']);
    expect(onReset).not.toHaveBeenCalled();
    attached.dispose();
    clearCachedPtyScrollback(101);
  });

  it('registers both pty event listeners in parallel before fetching scrollback', async () => {
    const listenResolvers: Array<(unlisten: () => void) => void> = [];
    listenMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          listenResolvers.push(resolve);
        }),
    );
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'pty_scrollback' ? scrollbackResponse('') : undefined),
    );

    const attachPromise = attachPty(115, { onData: vi.fn() });
    await Promise.resolve();

    // Both listener registrations are in flight at once instead of the exit
    // listener waiting on the data listener's IPC round trip, and the
    // scrollback fetch waits until both are registered.
    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).not.toHaveBeenCalledWith('pty_scrollback', { id: 115 });

    listenResolvers.forEach((resolve) => resolve(() => {}));
    const attached = await attachPromise;

    expect(invokeMock).toHaveBeenCalledWith('pty_scrollback', { id: 115 });
    attached.dispose();
    clearCachedPtyScrollback(115);
  });

  it('buffers live startup output while the fresh scrollback request is pending', async () => {
    let resolveScrollback: (value: ReturnType<typeof scrollbackResponse>) => void = () => {};
    const listeners: { data?: PtyDataListener } = {};
    invokeMock.mockImplementation((command: string) => {
      if (command === 'pty_scrollback') {
        return new Promise((resolve) => {
          resolveScrollback = resolve;
        });
      }

      return Promise.resolve(undefined);
    });
    listenMock.mockImplementation((eventName: string, handler: PtyDataListener) => {
      if (eventName === 'pty:data:107') {
        listeners.data = handler;
      }
      return Promise.resolve(() => {});
    });
    const onData = vi.fn();

    const attachPromise = attachPty(107, { onData });
    await Promise.resolve();
    await Promise.resolve();
    listeners.data?.({ payload: { data: base64Text('PS> '), ptyId: 107 } });
    resolveScrollback(scrollbackResponse(''));

    const attached = await attachPromise;

    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual(['PS> ']);
    attached.dispose();
    clearCachedPtyScrollback(107);
  });

  it('does not duplicate startup output that is already present in fresh scrollback', async () => {
    let resolveScrollback: (value: ReturnType<typeof scrollbackResponse>) => void = () => {};
    const listeners: { data?: PtyDataListener } = {};
    invokeMock.mockImplementation((command: string) => {
      if (command === 'pty_scrollback') {
        return new Promise((resolve) => {
          resolveScrollback = resolve;
        });
      }

      return Promise.resolve(undefined);
    });
    listenMock.mockImplementation((eventName: string, handler: PtyDataListener) => {
      if (eventName === 'pty:data:108') {
        listeners.data = handler;
      }
      return Promise.resolve(() => {});
    });
    const onData = vi.fn();

    const attachPromise = attachPty(108, { onData });
    await Promise.resolve();
    await Promise.resolve();
    listeners.data?.({ payload: { data: base64Text('PS> '), ptyId: 108 } });
    resolveScrollback(scrollbackResponse('PS> '));

    const attached = await attachPromise;

    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual(['PS> ']);
    attached.dispose();
    clearCachedPtyScrollback(108);
  });

  it('paints the cached scrollback synchronously and appends only the fresh delta', async () => {
    mockScrollbackInvoke('hello');
    await prefetchPtyScrollback(102);

    mockScrollbackInvoke('hello world');
    const onData = vi.fn();
    const onReset = vi.fn();
    const attachPromise = attachPty(102, { onData, onReset });

    // The cached preview is written before the pty_scrollback IPC resolves.
    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual(['hello']);

    const attached = await attachPromise;

    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual(['hello', ' world']);
    expect(onReset).not.toHaveBeenCalled();
    attached.dispose();
    clearCachedPtyScrollback(102);
  });

  it('resets the terminal and replays in full when the fresh scrollback diverges', async () => {
    mockScrollbackInvoke('stale content');
    await prefetchPtyScrollback(103);

    mockScrollbackInvoke('fresh content');
    const onData = vi.fn();
    const onReset = vi.fn();

    const attached = await attachPty(103, { onData, onReset });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual([
      'stale content',
      'fresh content',
    ]);
    attached.dispose();
    clearCachedPtyScrollback(103);
  });

  it('skips the preview when the attach does not opt in via onReset', async () => {
    mockScrollbackInvoke('hello');
    await prefetchPtyScrollback(104);

    const onData = vi.fn();
    const attachPromise = attachPty(104, { onData });

    expect(onData).not.toHaveBeenCalled();

    const attached = await attachPromise;

    expect(textOf(onData.mock.calls as Array<[Uint8Array]>)).toEqual(['hello']);
    attached.dispose();
    clearCachedPtyScrollback(104);
  });

  it('does not paint a preview after the cache entry is cleared', async () => {
    mockScrollbackInvoke('hello');
    await prefetchPtyScrollback(105);
    clearCachedPtyScrollback(105);

    const onData = vi.fn();
    const attachPromise = attachPty(105, { onData, onReset: vi.fn() });

    expect(onData).not.toHaveBeenCalled();

    const attached = await attachPromise;
    attached.dispose();
    clearCachedPtyScrollback(105);
  });

  it('deduplicates concurrent prefetches for the same pty', async () => {
    mockScrollbackInvoke('hello');

    await Promise.all([prefetchPtyScrollback(106), prefetchPtyScrollback(106)]);

    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'pty_scrollback'),
    ).toHaveLength(1);
    invokeMock.mockClear();

    // A warm cache entry short-circuits later prefetches entirely.
    await prefetchPtyScrollback(106);
    expect(invokeMock).not.toHaveBeenCalled();
    clearCachedPtyScrollback(106);
  });
});
