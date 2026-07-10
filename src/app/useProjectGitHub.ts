import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectSummary } from '../domain/domain';
import type {
  ConnectGitHubRepositorySubmit,
  ProjectGitRepositorySummary,
} from '../features/projects/ProjectSettingsDialog';
import {
  connectProjectGitHubRepository,
  getProjectGitRepository,
  listProjectGitHubOwners,
  openExternalUrl,
  pushProjectGitRepository,
} from '../tauri/commands';
import { queryKeys } from '../tauri/queryKeys';

/**
 * Owns the Project Settings GitHub state: the owner options and repository
 * summary queries plus the connect/push/open handlers, returned in the shape
 * ProjectSettingsDialog expects so the shell can spread them straight in.
 */
export function useProjectGitHub({
  previewFallbacksEnabled,
  project,
}: {
  previewFallbacksEnabled: boolean;
  project: ProjectSummary | undefined;
}) {
  const queryClient = useQueryClient();
  const applyRepositorySummary = (
    summary: ProjectGitRepositorySummary,
    input: { projectId: number },
  ) => {
    queryClient.setQueryData(queryKeys.projectGitRepository(input.projectId), summary);
  };
  const connectMutation = useMutation({
    mutationFn: (input: Parameters<typeof connectProjectGitHubRepository>[0]) =>
      connectProjectGitHubRepository(input),
    onSuccess: applyRepositorySummary,
  });
  const pushMutation = useMutation({
    mutationFn: (input: Parameters<typeof pushProjectGitRepository>[0]) =>
      pushProjectGitRepository(input),
    onSuccess: applyRepositorySummary,
  });
  const { data: ownerOptions = [] } = useQuery({
    queryKey: queryKeys.projectGitHubOwners(),
    queryFn: async () => {
      try {
        return await listProjectGitHubOwners();
      } catch (error) {
        if (!previewFallbacksEnabled) {
          throw error;
        }

        return [];
      }
    },
  });
  const { data: gitRepository = null } = useQuery({
    enabled: Boolean(project),
    queryKey: queryKeys.projectGitRepository(project?.id ?? 0),
    queryFn: async () => {
      if (!project) {
        return null;
      }

      try {
        return await getProjectGitRepository({ projectId: project.id });
      } catch (error) {
        if (!previewFallbacksEnabled) {
          throw error;
        }

        return null;
      }
    },
  });

  return {
    gitRepository,
    ownerOptions,
    onConnectGitHub: (value: ConnectGitHubRepositorySubmit) => {
      if (project) {
        connectMutation.mutate({ ...value, projectId: project.id });
      }
    },
    onOpenGitHub: (url: string) => {
      void openExternalUrl({ url });
    },
    onPushGitHub: () => {
      if (project) {
        pushMutation.mutate({ projectId: project.id });
      }
    },
  };
}
