import type { InvokeClient } from './commands';

/**
 * Web-server mode: the frontend was loaded in a plain browser from a
 * TaskCooker network server (T-34) instead of the Tauri webview. Commands are
 * routed to the server's `/command` endpoint with a bearer token, and the
 * preview seed fallbacks stay disabled so transient network errors never
 * silently swap real data for demo data.
 */

const TOKEN_STORAGE_KEY = 'taskcooker.webServerToken';

let webServerMode = false;
let activeClient: InvokeClient | null = null;
let activeToken: string | null = null;

export function isWebServerMode(): boolean {
  return webServerMode;
}

export function setWebServerMode(active: boolean): void {
  webServerMode = active;
  if (!active) {
    activeClient = null;
    activeToken = null;
  }
}

/** Activates web-server mode with a validated client + token. The token is
 * needed beyond the invoke client for the `/stream` event connection. */
export function activateWebServerMode(client: InvokeClient, token: string): void {
  activeClient = client;
  activeToken = token;
  webServerMode = true;
}

/** Invoke a command over HTTP in web-server mode (used by transports like the
 * PTY bridge that normally speak raw Tauri IPC). */
export function webCommandInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!activeClient) {
    return Promise.reject(new Error('web server mode is not active'));
  }
  return activeClient.invoke<T>(command, args);
}

/** True when the current origin is a TaskCooker server (its /health endpoint
 * identifies itself). The Vite dev server and other hosts fail this probe, so
 * the existing browser preview mode is untouched. */
export async function probeTaskcookerServer(
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchFn('/health');
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { name?: string } | null;
    return body?.name === 'taskcooker-server';
  } catch {
    return false;
  }
}

/** Reads the access token: a `?token=` URL parameter wins (and is stored and
 * stripped from the address bar), otherwise the stored token is used. */
export function readWebServerToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('token')?.trim();
    if (fromUrl) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
      url.searchParams.delete('token');
      window.history.replaceState(null, '', url.toString());
      return fromUrl;
    }
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function storeWebServerToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  } catch {
    // localStorage can be unavailable in private or restricted browsers.
  }
}

export function clearWebServerToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the gate will simply re-prompt.
  }
}

type CommandResponse = {
  ok?: boolean;
  data?: unknown;
  error?: string;
};

/** Routes invokes to the server's `/command` endpoint. Commands the server
 * does not map reject with the server's own clear error message; opening
 * external links falls back to a browser tab. */
export function createHttpInvokeClient(
  token: string,
  fetchFn: typeof fetch = fetch,
): InvokeClient {
  return {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === 'plugin:opener|open_url') {
        const url = typeof args?.url === 'string' ? args.url : null;
        if (url) {
          window.open(url, '_blank', 'noopener');
          return undefined as T;
        }
        throw new Error('cannot open an empty URL');
      }

      const body: { command: string; args?: Record<string, unknown> } = {
        command,
      };
      if (args !== undefined) {
        body.args = args;
      }
      const response = await fetchFn('/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as CommandResponse | null;
      if (!payload?.ok) {
        throw new Error(
          payload?.error ?? `TaskCooker server returned HTTP ${response.status}`,
        );
      }
      return payload.data as T;
    },
  };
}

/** Validates a token by loading settings through the command surface. */
export async function validateWebServerToken(
  client: InvokeClient,
): Promise<boolean> {
  try {
    await client.invoke('app_settings');
    return true;
  } catch {
    return false;
  }
}

/**
 * Multiplexed server event stream. Browsers cap HTTP/1.1 connections per
 * host, so every listener (app event bridge, PTY terminals) shares ONE
 * `/stream` connection whose event-name set is renegotiated (debounced
 * reopen) as listeners come and go. The server pushes frames in
 * `text/event-stream` format; `fetch` is used instead of `EventSource` so the
 * bearer token can travel in a header rather than the URL.
 */
type WebEventHandler = (event: { payload: unknown }) => void;

const eventHandlers = new Map<string, Set<WebEventHandler>>();
let streamAbort: AbortController | null = null;
let streamReopenTimer: ReturnType<typeof setTimeout> | null = null;
let streamGeneration = 0;
let streamReady: Promise<void> = Promise.resolve();
let streamReadyResolve: (() => void) | null = null;

function scheduleStreamReopen(): void {
  if (streamReopenTimer === null) {
    streamReady = new Promise((resolve) => {
      streamReadyResolve = resolve;
    });
    streamReopenTimer = setTimeout(() => {
      streamReopenTimer = null;
      void openEventStream();
    }, 25);
  }
}

function markStreamReady(): void {
  streamReadyResolve?.();
  streamReadyResolve = null;
}

async function openEventStream(): Promise<void> {
  streamAbort?.abort();
  const names = [...eventHandlers.keys()];
  const generation = ++streamGeneration;
  if (names.length === 0 || !activeToken) {
    markStreamReady();
    return;
  }
  const controller = new AbortController();
  streamAbort = controller;
  const url = `/stream?events=${names.map(encodeURIComponent).join(',')}`;

  while (!controller.signal.aborted && generation === streamGeneration) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`stream returned HTTP ${response.status}`);
      }
      markStreamReady();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.indexOf('\n\n');
        while (separator >= 0) {
          dispatchStreamFrame(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Connection failed or dropped; retry below unless superseded.
    }
    markStreamReady();
    if (controller.signal.aborted || generation !== streamGeneration) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function dispatchStreamFrame(frame: string): void {
  let eventName = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event: ')) {
      eventName = line.slice('event: '.length);
    } else if (line.startsWith('data: ')) {
      data = line.slice('data: '.length);
    }
  }
  if (!eventName) {
    return; // heartbeat comment
  }
  const handlers = eventHandlers.get(eventName);
  if (!handlers?.size) {
    return;
  }
  let payload: unknown = data;
  try {
    payload = JSON.parse(data);
  } catch {
    // Non-JSON payloads pass through as text.
  }
  for (const handler of [...handlers]) {
    handler({ payload });
  }
}

/** Subscribe to a named app event over the shared stream. Resolves once the
 * (re)opened stream is connected so callers can rely on subscribe-then-fetch
 * ordering (the PTY attach protocol needs this). */
export async function webListen<T>(
  eventName: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  const entry = handler as WebEventHandler;
  let handlers = eventHandlers.get(eventName);
  if (!handlers) {
    handlers = new Set();
    eventHandlers.set(eventName, handlers);
    scheduleStreamReopen();
  }
  handlers.add(entry);
  await streamReady;
  return () => {
    const registered = eventHandlers.get(eventName);
    if (!registered) {
      return;
    }
    registered.delete(entry);
    if (registered.size === 0) {
      eventHandlers.delete(eventName);
      scheduleStreamReopen();
    }
  };
}

/** EventClient-compatible adapter for the app-wide Tauri event bridge. */
export function createWebAppEventClient(): {
  listen: <T>(
    eventName: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
} {
  return { listen: webListen };
}
