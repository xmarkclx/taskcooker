import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type PtyDataPayload = {
  ptyId: number;
  data: string;
};

type PtyExitPayload = {
  ptyId: number;
  exitCode: number;
};

type PtyScrollback = {
  ptyId: number;
  data: string;
  exited: boolean;
  exitCode: number | null;
};

export type AttachedPty = {
  claimInput: () => Promise<void>;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  releaseInput: () => Promise<void>;
  close: () => Promise<void>;
  dispose: () => void;
};

export type AttachPtyHandlers = {
  onData: (data: Uint8Array) => void;
  onExit?: (code: number) => void;
  /**
   * Called when a cached scrollback preview was painted but the fresh
   * scrollback diverged from it; the terminal must clear before the fresh
   * bytes arrive via onData. Providing this opts the attach into the
   * stale-while-revalidate preview.
   */
  onReset?: () => void;
};

// Last-known scrollback per PTY, kept across attach/detach so switching back
// to a task (or terminal tab) paints the terminal synchronously while the
// fresh scrollback is fetched. Mirrors the backend SCROLLBACK_MAX_BYTES cap.
const SCROLLBACK_CACHE_MAX_BYTES = 512 * 1024;
const scrollbackCache = new Map<number, Uint8Array>();
const scrollbackPrefetches = new Map<number, Promise<void>>();

function capScrollbackBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteLength <= SCROLLBACK_CACHE_MAX_BYTES
    ? bytes
    : bytes.slice(bytes.byteLength - SCROLLBACK_CACHE_MAX_BYTES);
}

function appendCachedPtyScrollback(ptyId: number, data: Uint8Array): void {
  const existing = scrollbackCache.get(ptyId);
  if (!existing?.byteLength) {
    scrollbackCache.set(ptyId, capScrollbackBytes(data));
    return;
  }

  const combined = new Uint8Array(existing.byteLength + data.byteLength);
  combined.set(existing);
  combined.set(data, existing.byteLength);
  scrollbackCache.set(ptyId, capScrollbackBytes(combined));
}

export function clearCachedPtyScrollback(ptyId: number): void {
  scrollbackCache.delete(ptyId);
}

/**
 * Warms the scrollback cache so the first attach for this PTY can paint
 * without waiting on IPC. Skips PTYs that already have a cache entry.
 */
export function prefetchPtyScrollback(ptyId: number): Promise<void> {
  if (scrollbackCache.has(ptyId)) {
    return Promise.resolve();
  }

  const inflight = scrollbackPrefetches.get(ptyId);
  if (inflight) {
    return inflight;
  }

  const request = invoke<PtyScrollback>('pty_scrollback', { id: ptyId })
    .then((scrollback) => {
      if (scrollback.data && !scrollbackCache.has(ptyId)) {
        scrollbackCache.set(ptyId, capScrollbackBytes(base64ToBytes(scrollback.data)));
      }
    })
    .catch(() => undefined)
    .finally(() => {
      scrollbackPrefetches.delete(ptyId);
    });
  scrollbackPrefetches.set(ptyId, request);
  return request;
}

function isBytePrefix(prefix: Uint8Array, bytes: Uint8Array): boolean {
  if (prefix.byteLength > bytes.byteLength) {
    return false;
  }

  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (prefix[index] !== bytes[index]) {
      return false;
    }
  }

  return true;
}

export async function attachPty(
  ptyId: number,
  handlers: AttachPtyHandlers,
): Promise<AttachedPty> {
  const inputOwner = makeInputOwner();
  let disposed = false;
  let replayingScrollback = true;
  let exitDelivered = false;
  let queuedExitCode: number | null = null;
  const queuedLiveData: Uint8Array[] = [];
  let unlistenData: (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;
  const deliverExit = (code: number) => {
    if (exitDelivered) {
      return;
    }

    exitDelivered = true;
    handlers.onExit?.(code);
  };
  // Stale-while-revalidate: paint the last-known scrollback synchronously,
  // then subscribe before fetching fresh scrollback so startup prompt bytes
  // cannot fall between the snapshot read and live event listener.
  const cached = handlers.onReset ? scrollbackCache.get(ptyId) : undefined;
  if (cached?.byteLength) {
    handlers.onData(cached);
  }

  try {
    // Register both listeners in one round trip's time; the scrollback fetch
    // must still wait for both so no startup byte or exit event slips between
    // the snapshot read and the live subscriptions. `allSettled` (not `all`)
    // so a lone registration failure still assigns the successful listener
    // for the catch block below to clean up.
    const [dataRegistration, exitRegistration] = await Promise.allSettled([
      listen<PtyDataPayload>(ptyDataEventName(ptyId), (event) => {
        const bytes = base64ToBytes(event.payload.data);
        appendCachedPtyScrollback(ptyId, bytes);
        if (replayingScrollback) {
          queuedLiveData.push(bytes);
          return;
        }

        handlers.onData(bytes);
      }),
      listen<PtyExitPayload>(ptyExitEventName(ptyId), (event) => {
        if (replayingScrollback) {
          queuedExitCode = event.payload.exitCode;
          return;
        }

        deliverExit(event.payload.exitCode);
      }),
    ]);
    if (dataRegistration.status === 'fulfilled') {
      unlistenData = dataRegistration.value;
    }
    if (exitRegistration.status === 'fulfilled') {
      unlistenExit = exitRegistration.value;
    }
    if (dataRegistration.status === 'rejected') {
      throw dataRegistration.reason;
    }
    if (exitRegistration.status === 'rejected') {
      throw exitRegistration.reason;
    }

    const scrollback = await invoke<PtyScrollback>('pty_scrollback', { id: ptyId });
    const fresh = scrollback.data ? base64ToBytes(scrollback.data) : new Uint8Array(0);
    scrollbackCache.set(ptyId, capScrollbackBytes(fresh));
    if (cached?.byteLength) {
      if (isBytePrefix(cached, fresh)) {
        if (fresh.byteLength > cached.byteLength) {
          handlers.onData(fresh.subarray(cached.byteLength));
        }
      } else {
        handlers.onReset?.();
        if (fresh.byteLength) {
          handlers.onData(fresh);
        }
      }
    } else if (fresh.byteLength) {
      handlers.onData(fresh);
    }

    const queued = concatBytes(queuedLiveData);
    if (queued.byteLength) {
      const overlap = byteSuffixPrefixOverlap(fresh, queued);
      const delta = queued.subarray(overlap);
      if (delta.byteLength) {
        handlers.onData(delta);
      }
    }

    replayingScrollback = false;
    if (scrollback.exited && scrollback.exitCode !== null) {
      deliverExit(scrollback.exitCode);
    }
    if (queuedExitCode !== null) {
      deliverExit(queuedExitCode);
    }

    return {
      claimInput: () => invoke('pty_claim_input', { id: ptyId, owner: inputOwner }),
      close: () => invoke('pty_close', { id: ptyId }),
      dispose: () => {
        if (disposed) {
          return;
        }

        disposed = true;
        unlistenData?.();
        unlistenExit?.();
      },
      releaseInput: () => invoke('pty_release_input', { id: ptyId, owner: inputOwner }),
      resize: (cols, rows) => invoke('pty_resize', { id: ptyId, cols, rows }),
      write: (data) =>
        invoke('pty_write', encoder.encode(data), {
          headers: {
            'x-pty-id': String(ptyId),
            'x-pty-input-owner': inputOwner,
          },
        }),
    };
  } catch (error) {
    unlistenData?.();
    unlistenExit?.();
    throw error;
  }
}

export async function loadPtyScrollbackText(ptyId: number): Promise<string> {
  const scrollback = await invoke<PtyScrollback>('pty_scrollback', { id: ptyId });
  return decoder.decode(base64ToBytes(scrollback.data));
}

export async function closePty(ptyId: number): Promise<void> {
  await invoke('pty_close', { id: ptyId });
}

type Uint8ArrayWithFromBase64 = typeof Uint8Array & {
  fromBase64?: (value: string) => Uint8Array;
};

// Runs for every PTY output chunk and for the scrollback replay on attach
// (up to 512KB), so prefer the native decoder where the webview has it.
function base64ToBytes(value: string): Uint8Array {
  const nativeFromBase64 = (Uint8Array as Uint8ArrayWithFromBase64).fromBase64;
  if (typeof nativeFromBase64 === 'function') {
    return nativeFromBase64(value);
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }

  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array(0);
  }

  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function byteSuffixPrefixOverlap(left: Uint8Array, right: Uint8Array): number {
  const max = Math.min(left.byteLength, right.byteLength);
  for (let length = max; length > 0; length -= 1) {
    let matches = true;
    for (let index = 0; index < length; index += 1) {
      if (left[left.byteLength - length + index] !== right[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return length;
    }
  }
  return 0;
}

function makeInputOwner(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ptyDataEventName(ptyId: number): string {
  return `pty:data:${ptyId}`;
}

function ptyExitEventName(ptyId: number): string {
  return `pty:exit:${ptyId}`;
}
