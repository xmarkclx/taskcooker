import { isTauri } from '@tauri-apps/api/core';

export type AppWindowChrome = 'custom' | 'system';

export function isTauriRuntime(): boolean {
  return isTauri();
}

export function appWindowChrome(): AppWindowChrome {
  return isTauriRuntime() ? 'custom' : 'system';
}

export function canUseTauriWindowControls(): boolean {
  if (!isTauriRuntime() || typeof window === 'undefined') {
    return false;
  }

  return typeof currentTauriWindowLabel() === 'string';
}

export function currentTauriWindowLabel(): string | undefined {
  if (!isTauriRuntime() || typeof window === 'undefined') {
    return undefined;
  }

  const internals = (
    window as Window & {
      __TAURI_INTERNALS__?: {
        metadata?: {
          currentWindow?: {
            label?: unknown;
          };
        };
      };
    }
  ).__TAURI_INTERNALS__;

  const label = internals?.metadata?.currentWindow?.label;
  return typeof label === 'string' ? label : undefined;
}
