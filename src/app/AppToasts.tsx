import { useAtom } from 'jotai';

import { toastsAtom } from './useMainAppUiState';

export function AppToasts() {
  const [toasts, setToasts] = useAtom(toastsAtom);

  if (!toasts.length) {
    return null;
  }

  return (
    <div aria-live="polite" className="toast-stack">
      {toasts.map((toast) => (
        <div className={`app-toast ${toast.kind ?? 'info'}`} key={toast.id} role="status">
          <div>
            <strong>{toast.title}</strong>
            {toast.body ? <p>{toast.body}</p> : null}
          </div>
          <button
            aria-label={`Dismiss ${toast.title}`}
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            type="button"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
