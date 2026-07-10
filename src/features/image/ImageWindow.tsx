import type { KeyboardEvent, WheelEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { BoomerangMark } from '../../ui/BoomerangMark';
import { WindowControls } from '../../ui/WindowControls';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const KEYBOARD_ZOOM_STEP = 0.25;
const WHEEL_ZOOM_STEP = 0.1;

export function ImageWindow({ src }: { src: string }) {
  const [zoom, setZoom] = useState(1);
  const shellRef = useRef<HTMLElement | null>(null);
  const imageSrc = decodeImageSrc(src);

  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  const zoomBy = (delta: number) => {
    setZoom((current) => clampZoom(current + delta));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(KEYBOARD_ZOOM_STEP);
      return;
    }

    if (event.key === '-') {
      event.preventDefault();
      zoomBy(-KEYBOARD_ZOOM_STEP);
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      setZoom(1);
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP);
  };

  return (
    <main
      aria-label="Image viewer"
      className="image-window"
      onKeyDown={onKeyDown}
      ref={shellRef}
      tabIndex={-1}
    >
      <header data-tauri-drag-region="deep">
        <WindowControls />
        <BoomerangMark />
        <h1>Image</h1>
        <div className="image-window-actions">
          <button aria-label="Zoom out" onClick={() => zoomBy(-KEYBOARD_ZOOM_STEP)} type="button">
            -
          </button>
          <button aria-label="Reset zoom" onClick={() => setZoom(1)} type="button">
            {Math.round(zoom * 100)}%
          </button>
          <button aria-label="Zoom in" onClick={() => zoomBy(KEYBOARD_ZOOM_STEP)} type="button">
            +
          </button>
        </div>
      </header>
      <div className="image-window-viewport" data-testid="image-window-viewport" onWheel={onWheel}>
        <img alt="Opened image" src={imageSrc} style={{ width: `${Math.round(zoom * 100)}%` }} />
      </div>
    </main>
  );
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, roundZoom(value)));
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

function decodeImageSrc(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
