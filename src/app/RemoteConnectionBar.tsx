import { useAtomValue } from 'jotai';

import { AppButton } from '../ui/Button';
import { remoteConnectionAtom } from './useMainAppUiState';

export function RemoteConnectionBar({ onDisconnect }: { onDisconnect: () => void }) {
  const remoteConnection = useAtomValue(remoteConnectionAtom);

  if (!remoteConnection) {
    return null;
  }

  return (
    <div className="remote-connection-bar" role="status">
      <span>Connected to {remoteConnection.sshHost}</span>
      <code>{remoteConnection.remotePath}</code>
      <AppButton aria-label="Disconnect remote server" onClick={onDisconnect} variant="secondary">
        Disconnect
      </AppButton>
    </div>
  );
}
