import type { QueryClient } from '@tanstack/react-query';
import { ProjectSettingsDialog } from '../features/projects/ProjectSettingsDialog';
import type {
  ConnectGitHubRepositorySubmit,
  ProjectGitRepositorySummary,
  ProjectSettingsSubmit,
} from '../features/projects/ProjectSettingsDialog';
import type { AppSnapshot, ProjectActionsDirectorySummary, ProjectActionSummary, ProjectSummary } from '../domain/domain';
import type { LocalUpdateProjectSettingsInput } from '../domain/snapshotActions';
import type { AppMutations } from './useAppMutations';
import { defaultProjectActionsDirectory } from '../features/workspace/workspaceHelpers';
import { queryKeys } from '../tauri/queryKeys';

type MinimalQueryClient = Pick<QueryClient, 'setQueryData' | 'invalidateQueries'>;
type AnyMutation = { mutate: (input: never, opts?: { onError?: () => void }) => void };
type ProjectGitHubProps = {
  gitRepository: ProjectGitRepositorySummary | null;
  ownerOptions: string[];
  onConnectGitHub: (value: ConnectGitHubRepositorySubmit) => void;
  onOpenGitHub: (url: string) => void;
  onPushGitHub: () => void;
};

export function ProjectSettingsOverlay({
  isSettingsOpen,
  project,
  projectGitHubProps,
  projectActionsDirectory,
  clientOptions,
  projectActions,
  snapshot,
  queryClient,
  setSettingsOpen,
  setLocalSnapshot,
  setPreviewSnapshot,
  runPreviewFallback,
  appMutations,
  updateProjectSettingsMutation,
  updateProjectSettingsLocally,
}: {
  isSettingsOpen: boolean;
  project: ProjectSummary | undefined;
  projectGitHubProps: ProjectGitHubProps;
  projectActionsDirectory: ProjectActionsDirectorySummary | null;
  clientOptions: string[];
  projectActions: ProjectActionSummary[];
  snapshot: AppSnapshot;
  queryClient: MinimalQueryClient;
  setSettingsOpen: (open: boolean) => void;
  setLocalSnapshot: (snapshot: AppSnapshot | ((prev: AppSnapshot | null) => AppSnapshot)) => void;
  setPreviewSnapshot: (updater: (snapshot: AppSnapshot) => AppSnapshot) => void;
  runPreviewFallback: (fn: () => void) => void;
  appMutations: AppMutations;
  updateProjectSettingsLocally: (snapshot: AppSnapshot, input: LocalUpdateProjectSettingsInput) => AppSnapshot;
  updateProjectSettingsMutation: AnyMutation;
}) {
  if (!isSettingsOpen || !project) {
    return null;
  }

  const {
    chooseProjectBackgroundImageMutation,
    clearProjectBackgroundImageMutation,
    createActionsDirectoryMutation,
    openActionsDirectoryMutation,
    openProjectFolderMutation,
  } = appMutations;

  return (
    <ProjectSettingsDialog
      {...projectGitHubProps}
      actionsDirectory={projectActionsDirectory}
      clientOptions={clientOptions}
      projectActions={projectActions}
      project={project}
      isSubproject={snapshot.projects.some(
        (p) =>
          p.subprojects.some(
            (edge) =>
              edge.kind === 'subproject' && edge.childProjectId === project.id,
          ),
      )}
      onClose={() => setSettingsOpen(false)}
      onChooseBackgroundImage={() => {
        chooseProjectBackgroundImageMutation.mutate({ projectId: project.id } as never);
      }}
      onClearBackgroundImage={() => {
        clearProjectBackgroundImageMutation.mutate({ projectId: project.id } as never);
      }}
      onCreateActionsDirectory={() => {
        createActionsDirectoryMutation.mutate(
          { projectId: project.id } as never,
          {
            onError: () =>
              runPreviewFallback(() => {
                const fallback = {
                  ...defaultProjectActionsDirectory(project),
                  exists: true,
                };
                queryClient.setQueryData(
                  queryKeys.projectActionsDirectory(project.id),
                  fallback,
                );
              }),
          },
        );
      }}
      onOpenActionsDirectory={() => {
        openActionsDirectoryMutation.mutate({ projectId: project.id } as never);
      }}
      onOpenProjectFolder={() => {
        openProjectFolderMutation.mutate({ projectId: project.id } as never);
      }}
      onSubmit={(value: ProjectSettingsSubmit) => {
        const input = { ...value, projectId: project.id };
        runPreviewFallback(() => {
          const optimistic = updateProjectSettingsLocally(snapshot, input);
          setLocalSnapshot(optimistic);
          queryClient.setQueryData(queryKeys.appSnapshot(), optimistic);
        });
        setSettingsOpen(false);
        updateProjectSettingsMutation.mutate(input as never, {
          onError: () =>
            setPreviewSnapshot((s) => updateProjectSettingsLocally(s, input)),
        });
      }}
    />
  );
}
