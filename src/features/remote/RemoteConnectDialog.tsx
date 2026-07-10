import { useEffect, useState } from 'react';

import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import type { RemoteServerInput } from './remoteServers';

export function RemoteConnectDialog({
  error,
  onClose,
  onConnect,
  pending,
  recentServers,
}: {
  error: string | null;
  onClose: () => void;
  onConnect: (input: RemoteServerInput) => void;
  pending: boolean;
  recentServers: RemoteServerInput[];
}) {
  const firstRecent = recentServers[0];
  const [sshHost, setSshHost] = useState(firstRecent?.sshHost ?? '');
  const [serverPort, setServerPort] = useState(String(firstRecent?.serverPort ?? 8790));
  const [remotePath, setRemotePath] = useState(firstRecent?.remotePath ?? '');
  const parsedPort = Number(serverPort);
  const canConnect =
    sshHost.trim().length > 0 &&
    remotePath.trim().length > 0 &&
    Number.isInteger(parsedPort) &&
    parsedPort > 0;

  useEffect(() => {
    document.getElementById('remote-connect-dialog-panel')?.focus();
  }, []);

  const submit = () => {
    if (!canConnect || pending) {
      return;
    }
    onConnect({
      sshHost,
      serverPort: parsedPort,
      remotePath,
    });
  };

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="remote-connect-title"
        aria-modal="true"
        id="remote-connect-dialog-panel"
        onCancel={onClose}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <h2 id="remote-connect-title">Connect to TaskCooker server</h2>
            <p>
              Create an SSH tunnel to a loopback taskcooker-server and use that machine's
              projects, todos, artifacts, and config.
            </p>
          </div>
        </header>
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {recentServers.length ? (
            <section aria-label="Recent remote servers" className="remote-recent-servers">
              <span className="form-field-hint">Recent servers</span>
              {recentServers.map((server) => (
                <button
                  aria-label={`Quick connect ${server.sshHost}`}
                  className="remote-server-row"
                  disabled={pending}
                  key={`${server.sshHost}:${server.serverPort}:${server.remotePath}`}
                  onClick={() => onConnect(server)}
                  type="button"
                >
                  <strong>{server.sshHost}</strong>
                  <span>
                    :{server.serverPort} · {server.remotePath}
                  </span>
                </button>
              ))}
            </section>
          ) : null}
          <label className="form-field">
            <span>SSH host</span>
            <input
              autoFocus
              onChange={(event) => setSshHost(event.currentTarget.value)}
              placeholder="wsl or user@host"
              value={sshHost}
            />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>Server port</span>
              <input
                inputMode="numeric"
                onChange={(event) => setServerPort(event.currentTarget.value)}
                value={serverPort}
              />
            </label>
            <label className="form-field">
              <span>Remote project path</span>
              <input
                onChange={(event) => setRemotePath(event.currentTarget.value)}
                placeholder="/home/mark/p/project"
                value={remotePath}
              />
            </label>
          </div>
          {error ? <p className="dialog-error">{error}</p> : null}
          <footer className="dialog-actions">
            <AppButton disabled={pending} onClick={onClose} type="button" variant="secondary">
              Cancel
            </AppButton>
            <AppButton disabled={!canConnect || pending} type="submit" variant="primary">
              {pending ? 'Connecting...' : 'Connect'}
            </AppButton>
          </footer>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}
