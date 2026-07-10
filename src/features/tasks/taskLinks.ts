const TASK_URI_PREFIX = 'boomerang://todo/';

export function formatTaskUri(displayId: string): string {
  return `${TASK_URI_PREFIX}${encodeURIComponent(displayId)}`;
}

export function parseTaskUri(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(TASK_URI_PREFIX)) {
    return null;
  }

  const encodedDisplayId = trimmed.slice(TASK_URI_PREFIX.length);
  if (!encodedDisplayId) {
    return null;
  }

  try {
    return decodeURIComponent(encodedDisplayId);
  } catch {
    return null;
  }
}
