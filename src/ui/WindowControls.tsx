import { getCurrentWindow } from '@tauri-apps/api/window';

import { canUseTauriWindowControls } from '../tauri/runtime';

export function WindowControls({ className = '' }: { className?: string }) {
  if (!canUseTauriWindowControls()) {
    return null;
  }

  const currentWindow = getCurrentWindow();
  const classes = ['window-controls', className].filter(Boolean).join(' ');

  return (
    <div aria-label="Window controls" className={classes} data-tauri-drag-region="false">
      <button
        aria-label="Close window"
        className="window-control close"
        onClick={() => {
          void currentWindow.close();
        }}
        title="Close"
        type="button"
      />
      <button
        aria-label="Minimize window"
        className="window-control minimize"
        onClick={() => {
          void currentWindow.minimize();
        }}
        title="Minimize"
        type="button"
      />
      <button
        aria-label="Toggle maximize window"
        className="window-control maximize"
        onClick={() => {
          void currentWindow.toggleMaximize();
        }}
        title="Maximize"
        type="button"
      />
    </div>
  );
}
