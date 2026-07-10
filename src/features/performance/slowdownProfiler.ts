import { useEffect, useRef } from 'react';

import {
  appendSlowdownProfileRecords,
  type SlowdownProfileRecord,
} from '../../tauri/commands';

type SlowdownProfilerOptions = {
  enabled: boolean;
  route: string;
  windowLabel?: string;
};

const EVENT_LOOP_INTERVAL_MS = 1_000;
const EVENT_LOOP_LAG_THRESHOLD_MS = 150;
const EVENT_LOOP_LAG_SLEEP_THRESHOLD_MS = 60_000;
const INPUT_DELAY_THRESHOLD_MS = 80;
const RENDER_WINDOW_MS = 5_000;
const RENDER_STORM_THRESHOLD = 40;
const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_BATCH_SIZE = 25;

const trackedRenderCounts = new Map<string, { count: number; startedAt: number }>();
let activeSink: ((record: SlowdownProfileRecord) => void) | null = null;

export function useSlowdownProfiler({ enabled, route, windowLabel }: SlowdownProfilerOptions) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return undefined;
    }

    return startSlowdownProfiler({ route, windowLabel });
  }, [enabled, route, windowLabel]);
}

export function useSlowdownRenderProbe(surface: string, detail?: string) {
  useEffect(() => {
    emitSlowdownRecord({
      detail,
      kind: 'component-mounted',
      occurredAt: new Date().toISOString(),
      surface,
    });

    return () => {
      emitSlowdownRecord({
        detail,
        kind: 'component-unmounted',
        occurredAt: new Date().toISOString(),
        surface,
      });
    };
  }, [detail, surface]);

  const renderCount = useRef(0);
  renderCount.current += 1;
  trackRender(surface, detail);
}

export function recordSlowdownProfilerEvent(
  record: Omit<SlowdownProfileRecord, 'occurredAt'> & { occurredAt?: string },
) {
  emitSlowdownRecord({
    ...record,
    occurredAt: record.occurredAt ?? new Date().toISOString(),
  });
}

export function describeSlowdownTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return 'unknown';
  }
  if (target.closest('.terminal-shell, .xterm')) {
    return 'terminal';
  }
  if (target.closest('.description-panel, .tiptap-editor')) {
    return 'markdown';
  }
  if (target.closest('.task-list-panel, .task-row')) {
    return 'task-list';
  }
  if (target.closest('input, textarea, [contenteditable="true"]')) {
    return 'form-input';
  }

  return 'app';
}

export function describeSlowdownDetail(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const marker = target.closest<HTMLElement>('[data-slowdown-detail]');
  const detail = marker?.dataset.slowdownDetail?.trim();
  return detail || null;
}

export function summarizeKeyboardEvent(event: KeyboardEvent): Pick<
  SlowdownProfileRecord,
  'eventType' | 'keyType'
> {
  return {
    eventType: event.type,
    keyType: keyboardKeyType(event.key),
  };
}

function startSlowdownProfiler({ route, windowLabel }: Omit<SlowdownProfilerOptions, 'enabled'>) {
  const records: SlowdownProfileRecord[] = [];
  let disposed = false;
  let flushTimer: number | null = null;
  let lagTimer: number | null = null;
  let observer: PerformanceObserver | null = null;
  const previousSink = activeSink;

  const enqueue = (record: SlowdownProfileRecord) => {
    if (disposed) {
      return;
    }

    records.push({
      route,
      windowLabel,
      ...record,
    });
    if (records.length >= FLUSH_BATCH_SIZE) {
      void flush();
    }
  };

  const flush = async () => {
    if (records.length === 0) {
      return;
    }
    const batch = records.splice(0, records.length);
    try {
      await appendSlowdownProfileRecords(batch);
    } catch {
      records.unshift(...batch.slice(-FLUSH_BATCH_SIZE));
    }
  };

  activeSink = enqueue;

  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        enqueue({
          durationMs: Math.round(entry.duration),
          kind: 'browser-long-task',
          occurredAt: new Date().toISOString(),
          surface: 'browser',
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  }

  let expectedTick = performance.now() + EVENT_LOOP_INTERVAL_MS;
  lagTimer = window.setInterval(() => {
    const now = performance.now();
    const lag = now - expectedTick;
    expectedTick = now + EVENT_LOOP_INTERVAL_MS;
    if (
      document.visibilityState === 'visible' &&
      lag >= EVENT_LOOP_LAG_THRESHOLD_MS &&
      lag < EVENT_LOOP_LAG_SLEEP_THRESHOLD_MS
    ) {
      enqueue({
        durationMs: Math.round(lag),
        kind: 'event-loop-lag',
        occurredAt: new Date().toISOString(),
        surface: 'app',
      });
    }
  }, EVENT_LOOP_INTERVAL_MS);

  const captureInputDelay = (event: Event) => {
    const startedAt = performance.now();
    const surface = describeSlowdownTarget(event.target);
    const detail = describeSlowdownDetail(event.target);
    const summary =
      event instanceof KeyboardEvent ? summarizeKeyboardEvent(event) : { eventType: event.type };

    requestAnimationFrame(() => {
      const delay = performance.now() - startedAt;
      if (delay >= INPUT_DELAY_THRESHOLD_MS) {
        enqueue({
          ...summary,
          ...(detail ? { detail } : {}),
          durationMs: Math.round(delay),
          kind: 'input-delay',
          occurredAt: new Date().toISOString(),
          surface,
        });
      }
    });
  };

  document.addEventListener('keydown', captureInputDelay, true);
  document.addEventListener('beforeinput', captureInputDelay, true);
  document.addEventListener('pointerdown', captureInputDelay, true);
  flushTimer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);

  return () => {
    disposed = true;
    activeSink = previousSink;
    observer?.disconnect();
    if (flushTimer !== null) {
      clearInterval(flushTimer);
    }
    if (lagTimer !== null) {
      clearInterval(lagTimer);
    }
    document.removeEventListener('keydown', captureInputDelay, true);
    document.removeEventListener('beforeinput', captureInputDelay, true);
    document.removeEventListener('pointerdown', captureInputDelay, true);
    void flush();
  };
}

function trackRender(surface: string, detail?: string) {
  const now = performance.now();
  const key = `${surface}:${detail ?? ''}`;
  const current = trackedRenderCounts.get(key);
  const next =
    !current || now - current.startedAt > RENDER_WINDOW_MS
      ? { count: 1, startedAt: now }
      : { count: current.count + 1, startedAt: current.startedAt };
  trackedRenderCounts.set(key, next);

  if (next.count === RENDER_STORM_THRESHOLD) {
    emitSlowdownRecord({
      count: next.count,
      detail,
      durationMs: Math.round(now - next.startedAt),
      kind: 'render-storm',
      occurredAt: new Date().toISOString(),
      surface,
    });
  }
}

function emitSlowdownRecord(record: SlowdownProfileRecord) {
  activeSink?.(record);
}

function keyboardKeyType(key: string): string {
  if (key.length === 1) {
    return 'character';
  }
  if (['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(key)) {
    return 'arrow';
  }
  if (['Backspace', 'Delete', 'Enter', 'Escape', 'Tab'].includes(key)) {
    return key;
  }

  return 'control';
}
