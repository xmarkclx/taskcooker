import { useAtom } from 'jotai';

import type { AppSnapshot } from '../domain/domain';
import { GlobalSearchDialog } from '../features/search/GlobalSearchDialog';
import type { AppSearchResult } from '../features/search/globalSearch';
import { globalSearchOpenAtom } from './useMainAppUiState';

export function GlobalSearchOverlay({
  onSelectResult,
  selectedProjectId,
  snapshot,
}: {
  onSelectResult: (result: AppSearchResult) => void;
  selectedProjectId: number;
  snapshot: AppSnapshot;
}) {
  const [globalSearchOpen, setGlobalSearchOpen] = useAtom(globalSearchOpenAtom);

  if (!globalSearchOpen) {
    return null;
  }

  return (
    <GlobalSearchDialog
      onClose={() => setGlobalSearchOpen(false)}
      onSelectResult={onSelectResult}
      selectedProjectId={selectedProjectId}
      snapshot={snapshot}
    />
  );
}
