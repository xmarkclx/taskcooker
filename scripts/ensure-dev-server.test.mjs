import { describe, expect, it } from 'vitest';

import { buildViteArgs, classifyExistingDevServer } from './ensure-dev-server.mjs';

describe('ensure dev server preflight', () => {
  it('reuses an existing Boomerang Vite server', async () => {
    const status = await classifyExistingDevServer({
      fetchImpl: async () =>
        new Response(
          '<!doctype html><title>TaskCooker</title><div id="root"></div><script type="module" src="/src/main.tsx"></script>',
          { status: 200 },
        ),
      url: 'http://127.0.0.1:1420/',
    });

    expect(status).toEqual({ kind: 'reusable' });
  });

  it('rejects an unrelated server on the dev port', async () => {
    const status = await classifyExistingDevServer({
      fetchImpl: async () => new Response('<!doctype html><title>Other App</title>', { status: 200 }),
      url: 'http://127.0.0.1:1420/',
    });

    expect(status.kind).toBe('occupied');
  });

  it('starts Vite on the Tauri dev URL port with strict port binding', () => {
    expect(buildViteArgs({ host: '127.0.0.1', port: 1420 })).toEqual([
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '1420',
      '--strictPort',
    ]);
  });
});
