import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const LOCAL_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const port = await getFreePort();
const baseUrl = `http://${HOST}:${port}`;
const server = spawn(
  'npm',
  ['run', 'dev', '--', '--host', HOST, '--port', String(port), '--strictPort'],
  {
    env: {
      ...process.env,
      BROWSER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverOutput = '';
let serverExit = null;

server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.on('exit', (code, signal) => {
  serverExit = { code, signal };
});

let browser;
const pageErrors = [];

try {
  await waitForServer(baseUrl);
  browser = await chromium.launch({
    executablePath: existsSync(LOCAL_CHROME) ? LOCAL_CHROME : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error);
  });

  await step('main task screen', async () => {
    await page.goto(baseUrl);
    await visible(page.getByText('TaskCooker'), 'wordmark');
    await visible(page.getByRole('button', { name: /select project: tmatrix/i }), 'project picker');
    await visible(page.getByRole('button', { name: /wire up mcp server/i }), 'selected task row');
    await visible(page.getByRole('heading', { name: 'Wire up MCP server' }), 'task detail');
    await absent(page.getByText("Send it out. Know when it's back."), 'marketing tagline');
  });

  await step('project selector and new-window affordance', async () => {
    await page.getByRole('button', { name: /select project: tmatrix/i }).click();
    await visible(page.getByRole('menuitem', { name: /all projects/i }), 'All Projects option');
    await visible(
      page.getByLabel('Open tmatrix in new window'),
      'project new-window control',
    );
    await page.keyboard.press('Escape');
  });

  await step('app settings dialog', async () => {
    await page.getByRole('button', { name: /select project: tmatrix/i }).click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'App Settings' });
    await visible(dialog, 'App Settings dialog');
    await visible(dialog.getByLabel('Enable MCP server'), 'MCP toggle');
    await visible(dialog.getByLabel('Theme'), 'theme select');
    await page.getByRole('button', { name: 'Close app settings' }).click();
  });

  await step('project notes overlay', async () => {
    await page.getByRole('button', { name: /select project: tmatrix/i }).click();
    await page.getByRole('menuitem', { name: 'Project Notes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Project Notes' });
    await visible(dialog, 'Project Notes dialog');
    await visible(dialog.getByText('Contents'), 'notes table of contents');
    await visible(dialog.getByRole('button', { name: 'Raw' }), 'raw editor toggle');
    await page.getByRole('button', { name: 'Close project notes' }).click();
  });

  await step('project actions menu and dialog', async () => {
    await page.getByRole('button', { name: 'Project actions' }).click();
    await visible(page.getByRole('menuitem', { name: /open folder/i }), 'native Open Folder action');
    await visible(page.getByRole('menuitem', { name: /new action task/i }), 'new action task entry');
    await page.getByRole('button', { name: 'Browse' }).click();
    await visible(page.getByRole('dialog', { name: 'Project Actions' }), 'Project Actions dialog');
    await page.getByRole('button', { name: 'Close project actions' }).click();
  });

  await step('terminal session controls', async () => {
    await visible(page.getByText('Agent Sessions'), 'Agent Sessions panel');
    await disabled(page.getByRole('button', { name: 'Show terminal' }), 'Show terminal button');
    await disabled(page.getByLabel('Open terminal inline'), 'inline terminal button');
    await disabled(page.getByLabel('Open terminal in new window'), 'detached terminal button');
  });

  await step('mobile single-panel routing', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/?projectId=1&todoId=128`);
    await visible(page.getByRole('heading', { name: 'Wire up MCP server' }), 'mobile detail');
    await page.getByRole('button', { name: 'Back to task list' }).click();
    await visible(page.getByRole('button', { name: /wire up mcp server/i }), 'mobile list row');
  });

  if (pageErrors.length > 0) {
    throw new Error(`Browser page errors:\n${pageErrors.map((error) => error.stack ?? error.message).join('\n')}`);
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await waitForServerExit(server);
}

async function step(name, run) {
  await run();
  console.log(`ok - ${name}`);
}

async function visible(locator, label) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 7_500 });
  } catch (error) {
    throw new Error(`Expected ${label} to be visible: ${error.message}`);
  }
}

async function absent(locator, label) {
  const count = await locator.count();
  if (count > 0) {
    throw new Error(`Expected ${label} to be absent, found ${count}`);
  }
}

async function disabled(locator, label) {
  await visible(locator, label);
  if (!(await locator.isDisabled())) {
    throw new Error(`Expected ${label} to be disabled`);
  }
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (serverExit) {
      throw new Error(
        `Vite server exited before it was ready: ${JSON.stringify(serverExit)}\n${serverOutput}`,
      );
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Vite accepts connections.
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}\n${serverOutput}`);
}

function waitForServerExit(child) {
  if (serverExit) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 2_000);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      probe.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Could not allocate a smoke-test port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
