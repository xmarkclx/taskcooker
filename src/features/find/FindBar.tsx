import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { FIND_IGNORE_ATTRIBUTE } from './findInPage';
import { useFindInPage } from './useFindInPage';

export function FindBar({ onClose }: { onClose: () => void }) {
  const { activeIndex, goNext, goPrev, matchCount, query, setQuery } = useFindInPage();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const selection = window.getSelection?.()?.toString().trim();
    if (selection) {
      setQuery(selection);
      inputRef.current?.select();
    }
  }, [setQuery]);

  // Cmd+G / Cmd+Shift+G step through matches like a browser, even when the
  // input is not focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) {
          goPrev();
        } else {
          goNext();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [goNext, goPrev]);

  const ordinal = matchCount === 0 ? 0 : activeIndex + 1;
  const noMatches = matchCount === 0;

  return (
    <div
      aria-label="Find in page"
      className="find-bar"
      role="search"
      {...{ [FIND_IGNORE_ATTRIBUTE]: '' }}
    >
      <Search aria-hidden="true" className="find-bar-icon" size={16} />
      <input
        aria-label="Find in page"
        autoComplete="off"
        className="find-bar-input"
        name="find-in-page"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
              goPrev();
            } else {
              goNext();
            }
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in page…"
        ref={inputRef}
        spellCheck={false}
        type="search"
        value={query}
      />
      <span aria-live="polite" className="find-bar-count" role="status">
        {ordinal}/{matchCount}
      </span>
      <button
        aria-label="Previous match"
        className="find-bar-button"
        disabled={noMatches}
        onClick={goPrev}
        type="button"
      >
        <ChevronUp aria-hidden="true" size={16} />
      </button>
      <button
        aria-label="Next match"
        className="find-bar-button"
        disabled={noMatches}
        onClick={goNext}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      <button aria-label="Close find" className="find-bar-button" onClick={onClose} type="button">
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
