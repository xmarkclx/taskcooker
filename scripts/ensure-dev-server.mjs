#!/usr/bin/env node

import { spawn } from 'node:child_process';
import net from 'node:net';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 1420;
const DEV_SERVER_KEEPALIVE_MS = 60_000;

export function buildViteArgs({ host, port }) {
  return ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort'];
}

export async function classifyExistingDevServer({ fetchImpl = fetch, url }) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        'cache-control': 'no-cache',
      },
    });

    if (!response.ok) {
      return { kind: 'occupied', reason: `server returned HTTP ${response.status}` };
    }

    const html = await response.text();
    if (
      html.includes('<title>TaskCooker</title>') &&
      html.includes('id="root"') &&
      html.includes('/src/main.tsx')
    ) {
      return { kind: 'reusable' };
    }

    return { kind: 'occupied', reason: 'port is serving a different app' };
  } catch (error) {
    return {
      kind: 'unreachable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isPortOpen({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const host = process.env.TAURI_DEV_HOST || process.env.VITE_HOST || DEFAULT_HOST;
  const port = Number(process.env.VITE_PORT || DEFAULT_PORT);
  const url = process.env.VITE_DEV_URL || `http://${host}:${port}/`;

  if (await isPortOpen({ host, port })) {
    const status = await classifyExistingDevServer({ url });

    if (status.kind === 'reusable') {
      console.log(`Reusing existing TaskCooker dev server at ${url}`);
      await keepAliveUntilStopped();
      return;
    }

    console.error(`Port ${port} is already in use, but not by TaskCooker.`);
    console.error(status.reason);
    process.exitCode = 1;
    return;
  }

  const child = spawn('npm', buildViteArgs({ host, port }), {
    env: {
      ...process.env,
      BROWSER: 'none',
    },
    stdio: 'inherit',
  });

  const stopChild = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };

  process.once('SIGINT', stopChild);
  process.once('SIGTERM', stopChild);

  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 1;
  });
}

function keepAliveUntilStopped() {
  return new Promise((resolve) => {
    const interval = setInterval(() => undefined, DEV_SERVER_KEEPALIVE_MS);

    const stop = () => {
      clearInterval(interval);
      resolve();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
