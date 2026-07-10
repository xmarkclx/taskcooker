import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event';

// Drops route to the surface that owns input focus, like keyboard input does.
// Position hit-testing is deliberately avoided: Tauri reports macOS drop
// coordinates in CSS pixels mislabeled as physical (wry passes the AppKit
// draggingLocation through unscaled), so any coordinate math needs per-OS
// special cases that focus does not.
export function listenForDroppedPathsWhenFocused(
  element: HTMLElement,
  onDrop: (paths: string[]) => void,
): Promise<UnlistenFn | null> {
  try {
    return getCurrentWebview()
      .onDragDropEvent((event: TauriEvent<DragDropEvent>) => {
        const payload = event.payload;
        if (payload.type !== 'drop' || payload.paths.length === 0) {
          return;
        }

        if (elementOwnsFocus(element)) {
          onDrop(payload.paths);
        }
      })
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function elementOwnsFocus(element: HTMLElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && element.contains(active);
}
