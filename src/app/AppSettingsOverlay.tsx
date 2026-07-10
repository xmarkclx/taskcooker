import { type QueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';

import type { AppSettingsSummary, ProjectSummary } from '../domain/domain';
import { AppSettingsDialog, type AppSettingsSubmit } from '../features/settings/AppSettingsDialog';
import { copyText } from '../features/workspace/workspaceHelpers';
import { queryKeys } from '../tauri/queryKeys';
import {
  dismissDoneTerminalWarning,
  restoreDoneTerminalWarning,
} from '../features/tasks/doneTerminalWarningStorage';
import type { AppMutations } from './useAppMutations';
import { appSettingsOpenAtom, doneTerminalWarningEnabledAtom } from './useMainAppUiState';

export function AppSettingsOverlay({
  appSettings,
  appMutations,
  projects,
  queryClient,
  runPreviewFallback,
}: {
  appSettings: AppSettingsSummary;
  appMutations: AppMutations;
  projects: ProjectSummary[];
  queryClient: QueryClient;
  runPreviewFallback: (callback: () => void) => void;
}) {
  const [appSettingsOpen, setAppSettingsOpen] = useAtom(appSettingsOpenAtom);
  const [doneTerminalWarningEnabled, setDoneTerminalWarningEnabled] = useAtom(
    doneTerminalWarningEnabledAtom,
  );

  if (!appSettingsOpen) {
    return null;
  }

  return (
    <AppSettingsDialog
      doneTerminalWarningEnabled={doneTerminalWarningEnabled}
      onClose={() => setAppSettingsOpen(false)}
      onCopyToken={() => void copyText(appSettings.mcpToken)}
      onDoneTerminalWarningEnabledChange={(enabled) => {
        setDoneTerminalWarningEnabled(enabled);
        if (enabled) {
          restoreDoneTerminalWarning();
        } else {
          dismissDoneTerminalWarning();
        }
      }}
      onRegenerateToken={() => {
        appMutations.regenerateMcpTokenMutation.mutate(undefined, {
          onError: () =>
            runPreviewFallback(() => {
              queryClient.setQueryData(queryKeys.appSettings(), {
                ...appSettings,
                mcpToken: `local-${Date.now()}`,
              });
            }),
        });
      }}
      onSubmit={(value: AppSettingsSubmit) => {
        const optimistic = { ...appSettings, ...value };
        runPreviewFallback(() => {
          queryClient.setQueryData(queryKeys.appSettings(), optimistic);
        });
        setAppSettingsOpen(false);
        appMutations.updateAppSettingsMutation.mutate(value, {
          onError: () =>
            runPreviewFallback(() => {
              queryClient.setQueryData(queryKeys.appSettings(), optimistic);
            }),
        });
      }}
      projects={projects}
      settings={appSettings}
    />
  );
}
