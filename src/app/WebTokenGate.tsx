import { useState } from 'react';

import { AppButton } from '../ui/Button';
import { DialogBackdrop, DialogPanel } from '../ui/Dialog';
import { storeWebServerToken } from '../tauri/webServerMode';

/**
 * Shown when the app is served by a TaskCooker network server but no valid
 * access token is stored yet. Stores the pasted token and reloads so the
 * bootstrap validates it and starts the real app.
 */
export function WebTokenGate({ invalidToken }: { invalidToken: boolean }) {
  const [token, setToken] = useState('');
  const canConnect = token.trim().length > 0;

  const submit = () => {
    if (!canConnect) {
      return;
    }
    storeWebServerToken(token);
    window.location.reload();
  };

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="web-token-gate-title"
        aria-modal="true"
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="web-token-gate-title">Connect to TaskCooker</h2>
            <p>
              Paste this server&apos;s access token (the MCP token from App
              Settings on the machine running TaskCooker).
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
          <label className="form-field">
            <span>Access token</span>
            <input
              autoFocus
              aria-label="Access token"
              onChange={(event) => setToken(event.currentTarget.value)}
              type="password"
              value={token}
            />
          </label>
          {invalidToken ? (
            <p className="dialog-error">
              That token was not accepted. Copy the current token from App
              Settings and try again.
            </p>
          ) : null}
          <footer className="dialog-actions">
            <AppButton disabled={!canConnect} type="submit" variant="primary">
              Connect
            </AppButton>
          </footer>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}
