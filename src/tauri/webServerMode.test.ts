import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpInvokeClient,
  probeTaskcookerServer,
  isWebServerMode,
  setWebServerMode,
} from './webServerMode';

describe('web server mode', () => {
  afterEach(() => {
    setWebServerMode(false);
    vi.restoreAllMocks();
  });

  it('tracks the mode flag', () => {
    expect(isWebServerMode()).toBe(false);
    setWebServerMode(true);
    expect(isWebServerMode()).toBe(true);
  });

  it('probes /health for the taskcooker-server identity', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, name: 'taskcooker-server' })),
    );
    await expect(probeTaskcookerServer(fetchFn as typeof fetch)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('/health');

    const wrongServer = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'something-else' })),
    );
    await expect(probeTaskcookerServer(wrongServer as typeof fetch)).resolves.toBe(false);

    const unreachable = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(probeTaskcookerServer(unreachable as typeof fetch)).resolves.toBe(false);
  });

  it('posts commands with the bearer token and unwraps data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { projects: [] } })),
    );
    const client = createHttpInvokeClient('secret-token', fetchFn as typeof fetch);

    const data = await client.invoke('app_snapshot', { input: { todoId: 7 } });

    expect(data).toEqual({ projects: [] });
    expect(fetchFn).toHaveBeenCalledWith('/command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token',
      },
      body: JSON.stringify({
        command: 'app_snapshot',
        args: { input: { todoId: 7 } },
      }),
    });
  });

  it('surfaces server errors as thrown messages', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
      }),
    );
    const client = createHttpInvokeClient('bad-token', fetchFn as typeof fetch);

    await expect(client.invoke('app_snapshot')).rejects.toThrow('unauthorized');
  });

  it('opens external links in a browser tab instead of the opener plugin', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchFn = vi.fn();
    const client = createHttpInvokeClient('secret-token', fetchFn as typeof fetch);

    await client.invoke('plugin:opener|open_url', { url: 'https://example.com' });

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
