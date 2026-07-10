import { useAtom } from 'jotai';

import { FindBar } from '../features/find/FindBar';
import { findOpenAtom } from './useMainAppUiState';

export function FindOverlay() {
  const [findOpen, setFindOpen] = useAtom(findOpenAtom);

  if (!findOpen) {
    return null;
  }

  return <FindBar onClose={() => setFindOpen(false)} />;
}
