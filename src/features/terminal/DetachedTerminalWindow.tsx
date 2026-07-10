import { useQuery } from '@tanstack/react-query';

import { useSlowdownProfiler, useSlowdownRenderProbe } from '../performance/slowdownProfiler';
import { fallbackAppSettings, loadAppSettings } from '../../tauri/commands';
import { queryKeys } from '../../tauri/queryKeys';
import { currentTauriWindowLabel, isTauriRuntime } from '../../tauri/runtime';
import { BoomerangMark } from '../../ui/BoomerangMark';
import { WindowControls } from '../../ui/WindowControls';
import { TerminalSurface } from './TerminalSurface';

export function DetachedTerminalWindow({
  attachmentTarget,
  ptyId,
  title,
}: {
  attachmentTarget?: {
    projectId: number;
    todoId: number;
  };
  ptyId: number;
  title: string;
}) {
  const { data: appSettings = fallbackAppSettings } = useQuery({
    queryKey: queryKeys.appSettings(),
    queryFn: () => loadAppSettings(),
    placeholderData: fallbackAppSettings,
  });
  const tauriRuntime = isTauriRuntime();
  const route = `detached-terminal/pty:${ptyId}`;
  useSlowdownProfiler({
    enabled: tauriRuntime && appSettings.slowdownProfilerEnabled,
    route,
    windowLabel: currentTauriWindowLabel(),
  });
  useSlowdownRenderProbe('detached-terminal-window', route);

  return (
    <main className="detached-terminal-window">
      <header data-tauri-drag-region="deep">
        <WindowControls />
        <BoomerangMark />
        <h1>{title}</h1>
      </header>
      <TerminalSurface attachmentTarget={attachmentTarget} label={title} ptyId={ptyId} />
    </main>
  );
}
