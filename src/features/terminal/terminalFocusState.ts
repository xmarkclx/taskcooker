import { atom } from 'jotai';

// Incremented by actions that intentionally send the current window to an
// external app. The active terminal consumes the next native focus return.
export const terminalWindowFocusRestoreNonceAtom = atom(0);
