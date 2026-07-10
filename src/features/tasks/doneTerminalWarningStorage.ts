const DONE_TERMINAL_WARNING_DISMISSED_KEY = 'boomerang.doneTerminalWarningDismissed';

export function doneTerminalWarningDismissed() {
  try {
    return window.localStorage.getItem(DONE_TERMINAL_WARNING_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissDoneTerminalWarning() {
  try {
    window.localStorage.setItem(DONE_TERMINAL_WARNING_DISMISSED_KEY, 'true');
  } catch {
    // localStorage can be unavailable in private or restricted webviews.
  }
}

export function restoreDoneTerminalWarning() {
  try {
    window.localStorage.removeItem(DONE_TERMINAL_WARNING_DISMISSED_KEY);
  } catch {
    // localStorage can be unavailable in private or restricted webviews.
  }
}
