import { Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import type { AppSnapshot } from '../../domain/domain';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { searchApp, type AppSearchResult } from './globalSearch';

export function GlobalSearchDialog({
  onClose,
  onSelectResult,
  selectedProjectId,
  snapshot,
}: {
  onClose: () => void;
  onSelectResult: (result: AppSearchResult) => void;
  selectedProjectId?: number;
  snapshot: AppSnapshot;
}) {
  const [query, setQuery] = useState('');
  // Scoring every todo in every project on each keystroke can outpace fast
  // typists; deferring the query keeps the input itself responsive.
  const deferredQuery = useDeferredValue(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = deferredQuery.trim().length > 0;
  const selectedProject = selectedProjectId
    ? snapshot.projects.find((project) => project.id === selectedProjectId)
    : null;
  const results = useMemo(() => {
    if (hasQuery || !selectedProject) {
      return searchApp(snapshot, deferredQuery);
    }

    return [
      {
        kind: 'project-notes',
        excerpt: `Open notes for ${selectedProject.name}`,
        matchedFields: ['Project'],
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        title: 'Project Notes',
      },
    ] satisfies AppSearchResult[];
  }, [hasQuery, deferredQuery, selectedProject, snapshot]);
  const activeResult = results[Math.min(activeIndex, Math.max(results.length - 1, 0))];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const selectResult = (result: AppSearchResult | undefined) => {
    if (!result) {
      return;
    }

    onSelectResult(result);
  };

  return (
    <DialogBackdrop className="global-search-backdrop">
      <DialogPanel
        aria-label="Search app"
        className="global-search-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <div className="global-search-input-row">
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="Search the whole app"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) =>
                  results.length === 0 ? 0 : Math.min(current + 1, results.length - 1),
                );
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                selectResult(activeResult);
              }
            }}
            placeholder="Search tasks, IDs, descriptions, artifacts..."
            ref={inputRef}
            value={query}
          />
          <button aria-label="Close search" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>

        <div className="global-search-results">
          {!hasQuery && results.length === 0 ? (
            <p className="global-search-empty">Type to search all tasks in every project.</p>
          ) : null}
          {hasQuery && results.length === 0 ? (
            <p className="global-search-empty">No results found.</p>
          ) : null}
          {results.map((result, index) => (
            <button
              aria-label={
                result.kind === 'todo'
                  ? `${result.displayId} ${result.title} ${result.projectName} ${result.state}`
                  : `${result.title} ${result.projectName}`
              }
              className={`global-search-result ${index === activeIndex ? 'active' : ''}`}
              key={result.kind === 'todo' ? result.todoId : `project-notes-${result.projectId}`}
              onClick={() => selectResult(result)}
              type="button"
            >
              <span className="global-search-result-main">
                <span className="global-search-result-title">
                  {result.kind === 'todo' ? <strong>{result.displayId}</strong> : null}
                  <span>{result.title}</span>
                </span>
                {result.excerpt ? (
                  <span className="global-search-result-excerpt">{result.excerpt}</span>
                ) : null}
              </span>
              <span className="global-search-result-meta">
                <span>{result.projectName}</span>
                {result.kind === 'todo' ? <span>{result.state}</span> : null}
                <span>{result.matchedFields.join(', ')}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogPanel>
    </DialogBackdrop>
  );
}

export function useGlobalSearchShortcut(onOpen: () => void) {
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const openSearchFromShortcut = (event: KeyboardEvent) => {
      const isSearchShortcut =
        (event.code === 'KeyP' || event.key.toLowerCase() === 'p') &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      if (!isSearchShortcut) {
        return;
      }

      event.preventDefault();
      onOpenRef.current();
    };

    document.addEventListener('keydown', openSearchFromShortcut);
    return () => {
      document.removeEventListener('keydown', openSearchFromShortcut);
    };
  }, []);
}
