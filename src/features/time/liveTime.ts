import { useEffect, useState } from 'react';

export function useLiveElapsedSeconds(baseSeconds: number, timerKey: number | null): number {
  const [anchor, setAnchor] = useState(() => ({
    baseSeconds,
    startedAt: Date.now(),
    timerKey,
  }));
  const now = useNow(1_000);

  useEffect(() => {
    setAnchor({
      baseSeconds,
      startedAt: Date.now(),
      timerKey,
    });
  }, [baseSeconds, timerKey]);

  if (timerKey === null || anchor.timerKey !== timerKey) {
    return baseSeconds;
  }

  return baseSeconds + Math.max(0, Math.floor((now.getTime() - anchor.startedAt) / 1000));
}

export function useNow(tickMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), tickMs);
    return () => window.clearInterval(interval);
  }, [tickMs]);

  return now;
}
