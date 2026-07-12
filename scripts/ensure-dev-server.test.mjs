import { describe, expect, it } from 'vitest';

import {
  buildViteLaunch,
  buildViteArgs,
  buildDirectViteArgs,
  classifyExistingDevServer,
  isMainModule,
} from './ensure-dev-server.mjs';

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

  it('builds direct Vite CLI arguments without package-manager tokens', () => {
    expect(buildDirectViteArgs({ host: '127.0.0.1', port: 1420 })).toEqual([
      '--host',
      '127.0.0.1',
      '--port',
      '1420',
      '--strictPort',
    ]);
  });

  it('launches the repository-local Vite CLI directly through Node', () => {
    expect(
      buildViteLaunch({
        nodeExecutable: String.raw`C:\nvm4w\nodejs\node.exe`,
        viteCli: String.raw`E:\T-4\node_modules\vite\bin\vite.js`,
      }),
    ).toEqual({
      program: String.raw`C:\nvm4w\nodejs\node.exe`,
      prefixArgs: [String.raw`E:\T-4\node_modules\vite\bin\vite.js`],
    });
  });

  it('recognizes a Windows entrypoint path as the main module', () => {
    expect(
      isMainModule({
        moduleUrl: 'file:///E:/T-4/scripts/ensure-dev-server.mjs',
        argvPath: String.raw`E:\T-4\scripts\ensure-dev-server.mjs`,
        platform: 'win32',
      }),
    ).toBe(true);
  });
});
