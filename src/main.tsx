import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import { router } from './router';
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

const queryClient = new QueryClient();
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

createRoot(rootElement).render(
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
