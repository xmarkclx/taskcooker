import { TanStackDevtools } from '@tanstack/react-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import type { AnyRouter } from '@tanstack/react-router';

type TanStackDevtoolsHostProps = {
  router: AnyRouter;
};

export function TanStackDevtoolsHost({ router }: TanStackDevtoolsHostProps) {
  return (
    <TanStackDevtools
      plugins={[
        {
          name: 'TanStack Query',
          render: <ReactQueryDevtoolsPanel />,
        },
        {
          name: 'TanStack Router',
          render: <TanStackRouterDevtoolsPanel router={router} />,
        },
      ]}
    />
  );
}
