import type { QueryClient } from '@tanstack/react-query';

import type { AppSettingsSummary } from '../domain/domain';
import { queryKeys } from '../tauri/queryKeys';
import type { UpdateAppSettingsInput } from '../tauri/commands';

type SettingsMutation<TInput> = (
  input: TInput,
  options: { onError: () => void },
) => void;

export function updateAppSettingsPreference<
  TInput,
  TKey extends keyof AppSettingsSummary,
>({
  appSettings,
  input,
  key,
  mutate,
  previewFallbacksEnabled,
  queryClient,
  value,
}: {
  appSettings: AppSettingsSummary;
  input: TInput;
  key: TKey;
  mutate: SettingsMutation<TInput>;
  previewFallbacksEnabled: boolean;
  queryClient: QueryClient;
  value: AppSettingsSummary[TKey];
}) {
  const previousSettings = appSettings;
  const optimistic = {
    ...appSettings,
    [key]: value,
  };
  queryClient.setQueryData(queryKeys.appSettings(), optimistic);
  mutate(input, {
    onError: () => {
      queryClient.setQueryData(
        queryKeys.appSettings(),
        previewFallbacksEnabled ? optimistic : previousSettings,
      );
    },
  });
}

export function appSettingsUpdateInput(
  appSettings: AppSettingsSummary,
  override: Partial<UpdateAppSettingsInput>,
): UpdateAppSettingsInput {
  return {
    appContextMarkdown: appSettings.appContextMarkdown,
    claudePath: appSettings.claudePath,
    codexPath: appSettings.codexPath,
    deepLinkFallback: appSettings.deepLinkFallback,
    externalTerminalOpeners: appSettings.externalTerminalOpeners,
    folderOpenApp: appSettings.folderOpenApp,
    homeProjectId: appSettings.homeProjectId,
    markdownEditorFontFamily: appSettings.markdownEditorFontFamily,
    markdownEditorFontSize: appSettings.markdownEditorFontSize,
    markdownEditorMaxImageHeight: appSettings.markdownEditorMaxImageHeight,
    mcpEnabled: appSettings.mcpEnabled,
    projectAccentBorderWidth: appSettings.projectAccentBorderWidth,
    slowdownProfilerEnabled: appSettings.slowdownProfilerEnabled,
    taskTitler: appSettings.taskTitler,
    terminalTmuxEnabled: appSettings.terminalTmuxEnabled,
    theme: appSettings.theme,
    ...override,
  };
}
