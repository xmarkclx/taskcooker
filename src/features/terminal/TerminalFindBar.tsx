import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FIND_IGNORE_ATTRIBUTE } from '../find/findInPage';

export type TerminalFindDirection = 'next' | 'previous';

export type TerminalFindResults = {
  resultCount: number;
  resultIndex: number;
};

type TerminalFindBarProps = {
  /** Bumped by the surface when Cmd+F fires so an already-open bar refocuses. */
  focusNonce: number;
  onClose: () => void;
  onFind: (term: string, direction: TerminalFindDirection, incremental?: boolean) => void;
  results: TerminalFindResults | null;
};

/**
 * Browser-style find bar scoped to one xterm buffer. The page-level FindBar
 * cannot see terminal content (xterm renders to canvas, not DOM text), so the
 * terminal owns its own Cmd+F surface backed by @xterm/addon-search.
 */
export function TerminalFindBar({ focusNonce, onClose, onFind, results }: TerminalFindBarProps) {
  const [term, setTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  const ordinal = results && results.resultIndex >= 0 ? results.resultIndex + 1 : 0;

  return (
    <div
      aria-label="Find in terminal"
      className="find-bar terminal-find-bar"
      role="search"
      {...{ [FIND_IGNORE_ATTRIBUTE]: '' }}
    >
      <Search aria-hidden="true" className="find-bar-icon" size={16} />
      <input
        aria-label="Find in terminal input"
        autoComplete="off"
        className="find-bar-input"
        name="find-in-terminal"
        onChange={(event) => {
          setTerm(event.target.value);
          onFind(event.target.value, 'next', true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onFind(term, event.shiftKey ? 'previous' : 'next');
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            event.stopPropagation();
            onFind(term, event.shiftKey ? 'previous' : 'next');
          }
        }}
        placeholder="Find in terminal…"
        ref={inputRef}
        spellCheck={false}
        type="search"
        value={term}
      />
      <span aria-live="polite" className="find-bar-count" role="status">
        {results ? `${ordinal}/${results.resultCount}` : ''}
      </span>
      <button
        aria-label="Previous match"
        className="find-bar-button"
        onClick={() => onFind(term, 'previous')}
        type="button"
      >
        <ChevronUp aria-hidden="true" size={16} />
      </button>
      <button
        aria-label="Next match"
        className="find-bar-button"
        onClick={() => onFind(term, 'next')}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      <button
        aria-label="Close terminal find"
        className="find-bar-button"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
