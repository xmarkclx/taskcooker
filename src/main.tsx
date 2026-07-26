import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import { WebTokenGate } from './app/WebTokenGate';
import { router } from './router';
import { setActiveInvokeClient } from './tauri/commands';
import {
  activateWebServerMode,
  createHttpInvokeClient,
  probeTaskcookerServer,
  readWebServerToken,
  validateWebServerToken,
} from './tauri/webServerMode';
import './styles.css';

// The devtools panels subscribe to every query-cache and router event, which
// is measurable overhead in an app that broadcasts snapshot updates across
// many windows. Lazy-load them in dev only so production bundles drop them.
const TanStackDevtoolsHost = import.meta.env.DEV
  ? lazy(() =>
      import('./devtools/TanStackDevtoolsHost').then((module) => ({
        default: module.TanStackDevtoolsHost,
      })),
    )
  : null;

/** Polling cadence in web-server mode: a plain browser has no Tauri event
 * bridge, so queries refetch on an interval to stay fresh. */
const WEB_SERVER_POLL_MS = 4000;

type WebBootstrap =
  | { gate: false; webMode: boolean }
  | { gate: true; invalidToken: boolean };

/** Detects whether this page is served by a TaskCooker network server (T-34)
 * and, if so, activates the HTTP command client behind its access token. The
 * Tauri webview and the Vite preview are untouched. */
async function detectWebServerMode(): Promise<WebBootstrap> {
  if (isTauri() || !(await probeTaskcookerServer())) {
    return { gate: false, webMode: false };
  }
  const token = readWebServerToken();
  if (!token) {
    return { gate: true, invalidToken: false };
  }
  const client = createHttpInvokeClient(token);
  if (!(await validateWebServerToken(client))) {
    return { gate: true, invalidToken: true };
  }
  setActiveInvokeClient(client);
  activateWebServerMode(client, token);
  return { gate: false, webMode: true };
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

const root = createRoot(rootElement);

void detectWebServerMode().then((boot) => {
  if (boot.gate) {
    root.render(
      <StrictMode>
        <WebTokenGate invalidToken={boot.invalidToken} />
      </StrictMode>,
    );
    return;
  }

  const queryClient = new QueryClient(
    boot.webMode
      ? { defaultOptions: { queries: { refetchInterval: WEB_SERVER_POLL_MS } } }
      : {},
  );

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {TanStackDevtoolsHost ? (
          <Suspense fallback={null}>
            <TanStackDevtoolsHost router={router} />
          </Suspense>
        ) : null}
      </QueryClientProvider>
    </StrictMode>,
  );
});
