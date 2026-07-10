export const queryKeys = {
  appSettings: () => ['appSettings'] as const,
  appSnapshot: () => ['appSnapshot'] as const,
  projects: () => ['projects'] as const,
  projectActions: (projectId: number) => ['projectActions', projectId] as const,
  projectActionsDirectory: (projectId: number) =>
    ['projectActionsDirectory', projectId] as const,
  projectGitRepository: (projectId: number) =>
    ['projectGitRepository', projectId] as const,
  projectGitHubOwners: () => ['projectGitHubOwners'] as const,
  todos: (scope: { projectId: number; filter?: string }) =>
    ['todos', scope] as const,
  todo: (todoId: number) => ['todo', todoId] as const,
};
