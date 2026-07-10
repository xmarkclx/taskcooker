import { useAtom } from 'jotai';

import { RemoteConnectDialog } from '../features/remote/RemoteConnectDialog';
import type { RemoteServerInput } from '../features/remote/remoteServers';
import { remoteDialogOpenAtom } from './useMainAppUiState';

export function RemoteConnectOverlay({
  error,
  onConnect,
  pending,
  recentServers,
}: {
  error: string | null;
  onConnect: (input: RemoteServerInput) => void;
  pending: boolean;
  recentServers: RemoteServerInput[];
}) {
  const [remoteDialogOpen, setRemoteDialogOpen] = useAtom(remoteDialogOpenAtom);

  if (!remoteDialogOpen) {
    return null;
  }

  return (
    <RemoteConnectDialog
      error={error}
      onClose={() => setRemoteDialogOpen(false)}
      onConnect={onConnect}
      pending={pending}
      recentServers={recentServers}
    />
  );
}
