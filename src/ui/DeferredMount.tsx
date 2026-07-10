import { type ReactNode, useEffect, useRef, useState } from 'react';

type DeferredMountStrategy = 'paint' | 'idle';

/**
 * Mounts expensive children (Tiptap editors, xterm terminals) only after the
 * surrounding shell has painted, so switching tasks feels instant and each
 * heavy island shows its own loading state instead of blocking the view.
 */
export function DeferredMount({
  children,
  fallback,
  idleTimeoutMs = 250,
  strategy = 'paint',
}: {
  children: ReactNode;
  fallback?: ReactNode;
  idleTimeoutMs?: number;
  strategy?: DeferredMountStrategy;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Two frames: the first paints the shell/fallback, the second mounts the
    // island or schedules it for idle so its init cost never blocks the view
    // switch itself.
    let secondFrame = 0;
    let idleCallback: number | null = null;
    let idleFallbackTimer: number | null = null;
    const mountWhenIdle = () => {
      if (strategy !== 'idle') {
        setReady(true);
        return;
      }

      if (typeof window.requestIdleCallback === 'function') {
        idleCallback = window.requestIdleCallback(() => setReady(true), {
          timeout: idleTimeoutMs,
        });
        return;
      }

      idleFallbackTimer = window.setTimeout(
        () => setReady(true),
        Math.min(idleTimeoutMs, 120),
      );
    };
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(mountWhenIdle);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (idleCallback !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallback);
      }
      if (idleFallbackTimer !== null) {
        window.clearTimeout(idleFallbackTimer);
      }
    };
  }, [idleTimeoutMs, strategy]);

  if (!ready) {
    return <>{fallback ?? <IslandSpinner />}</>;
  }

  return <>{children}</>;
}

/** Keeps returning true after the first render where `active` was true. */
export function useActivatedOnce(active: boolean): boolean {
  const activatedRef = useRef(active);
  if (active) {
    activatedRef.current = true;
  }
  return activatedRef.current;
}

export function IslandSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      aria-label={label}
      className="flex h-full min-h-24 w-full items-center justify-center"
      role="status"
    >
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]"
      />
    </div>
  );
}
