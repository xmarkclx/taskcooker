import {
  Outlet,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';

import { App } from './app/App';

export type AppSearch = {
  focusedProjectId?: number;
  imageSrc?: string;
  imageWindow?: boolean;
  projectId?: number;
  todoId?: number;
  ptyId?: number;
  taskWindow?: boolean;
  terminalTitle?: string;
  view?: 'tasks' | 'time';
};

export function parseAppSearch(search: Record<string, unknown>): AppSearch {
  return {
    focusedProjectId: parsePositiveInteger(search.focusedProjectId),
    imageSrc: parseOptionalText(search.imageSrc),
    imageWindow: parseBooleanFlag(search.imageWindow),
    projectId: parseNonNegativeInteger(search.projectId),
    ptyId: parsePositiveInteger(search.ptyId),
    taskWindow: parseBooleanFlag(search.taskWindow),
    terminalTitle: parseOptionalText(search.terminalTitle),
    todoId: parsePositiveInteger(search.todoId),
    view: search.view === 'time' ? 'time' : undefined,
  };
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseAppSearch,
  component: App,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
  });
}

export function createTestRouter(url = '/') {
  return createAppRouter(
    createMemoryHistory({
      initialEntries: [url],
    }),
  );
}

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function parsePositiveInteger(value: unknown): number | undefined {
  const candidate = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : undefined;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  const candidate = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(candidate) && candidate >= 0 ? candidate : undefined;
}

function parseOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1;
}
