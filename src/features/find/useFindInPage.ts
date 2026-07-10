import { useCallback, useEffect, useRef, useState } from 'react';

import { findMatchRanges, nextMatchIndex } from './findInPage';

const ALL_HIGHLIGHT = 'find-all';
const ACTIVE_HIGHLIGHT = 'find-active';
const FALLBACK_LAYER_ID = 'find-in-page-highlight-layer';
const HIGHLIGHT_STYLE_ID = 'find-in-page-highlight-styles';
const HIGHLIGHT_STYLE_TEXT = `
::highlight(${ALL_HIGHLIGHT}) {
  background-color: var(--find-highlight-background);
  color: inherit;
}

::highlight(${ACTIVE_HIGHLIGHT}) {
  background-color: var(--find-active-highlight-background);
  color: var(--find-active-highlight-text);
}
`;

/**
 * The CSS Custom Highlight API lets us paint match ranges without mutating the
 * DOM. It is available in the Tauri macOS webview but absent in jsdom and older
 * webviews, so every use is guarded.
 */
function supportsHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

function clearHighlights(): void {
  if (supportsHighlightApi()) {
    CSS.highlights.delete(ALL_HIGHLIGHT);
    CSS.highlights.delete(ACTIVE_HIGHLIGHT);
  }
  document.getElementById(FALLBACK_LAYER_ID)?.remove();
}

function ensureHighlightStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = HIGHLIGHT_STYLE_TEXT;
  document.head.appendChild(style);
}

function applyHighlights(ranges: Range[], activeRange: Range | undefined): void {
  if (supportsHighlightApi()) {
    ensureHighlightStyles();
    if (ranges.length === 0) {
      clearHighlights();
      return;
    }
    CSS.highlights.set(ALL_HIGHLIGHT, new Highlight(...ranges));
    if (activeRange) {
      CSS.highlights.set(ACTIVE_HIGHLIGHT, new Highlight(activeRange));
    } else {
      CSS.highlights.delete(ACTIVE_HIGHLIGHT);
    }
  }
}

function getFallbackLayerHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.app-shell') ?? document.body;
}

function ensureFallbackLayer(): HTMLElement {
  const existing = document.getElementById(FALLBACK_LAYER_ID);
  if (existing) {
    return existing;
  }

  const layer = document.createElement('div');
  layer.id = FALLBACK_LAYER_ID;
  layer.className = 'find-highlight-layer';
  layer.setAttribute('aria-hidden', 'true');
  getFallbackLayerHost().appendChild(layer);
  return layer;
}

function renderFallbackHighlights(ranges: Range[], activeIndex: number): void {
  if (ranges.length === 0) {
    document.getElementById(FALLBACK_LAYER_ID)?.remove();
    return;
  }

  const layer = ensureFallbackLayer();
  const fragment = document.createDocumentFragment();

  ranges.forEach((range, rangeIndex) => {
    Array.from(range.getClientRects()).forEach((rect) => {
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const highlight = document.createElement('span');
      highlight.className = `find-highlight-rect${rangeIndex === activeIndex ? ' active' : ''}`;
      highlight.style.height = `${rect.height}px`;
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      fragment.appendChild(highlight);
    });
  });

  layer.replaceChildren(fragment);
}

function scrollRangeIntoView(range: Range | undefined): void {
  const element = range?.startContainer.parentElement;
  if (!element) {
    return;
  }
  try {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    // jsdom and other environments without layout treat scrolling as a no-op.
  }
}

export interface FindInPageState {
  activeIndex: number;
  goNext: () => void;
  goPrev: () => void;
  matchCount: number;
  query: string;
  setQuery: (query: string) => void;
}

/**
 * Owns the state of a browser-style in-page find: the query, the live match
 * count, the active match, and the highlight/scroll side effects against the
 * document. Always searches `document.body`; the find bar itself opts out of
 * matching via the `data-find-ignore` attribute.
 */
export function useFindInPage(): FindInPageState {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  // Bumped on every recompute so the highlight effect re-runs even when the
  // match count is unchanged between two different queries.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const ranges = query.trim().length > 0 ? findMatchRanges(document.body, query) : [];
    rangesRef.current = ranges;
    setMatchCount(ranges.length);
    setActiveIndex(0);
    setRevision((value) => value + 1);
  }, [query]);

  useEffect(() => {
    const ranges = rangesRef.current;
    const active = ranges[activeIndex];
    let animationFrame = 0;

    const paint = () => {
      applyHighlights(ranges, active);
      renderFallbackHighlights(ranges, activeIndex);
    };

    const schedulePaint = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(paint);
    };

    paint();
    scrollRangeIntoView(active);
    document.addEventListener('scroll', schedulePaint, true);
    window.addEventListener('resize', schedulePaint);

    return () => {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('scroll', schedulePaint, true);
      window.removeEventListener('resize', schedulePaint);
      clearHighlights();
    };
  }, [revision, activeIndex]);

  useEffect(() => () => clearHighlights(), []);

  const goNext = useCallback(() => {
    setActiveIndex((current) => nextMatchIndex(current, rangesRef.current.length, 1));
  }, []);

  const goPrev = useCallback(() => {
    setActiveIndex((current) => nextMatchIndex(current, rangesRef.current.length, -1));
  }, []);

  return { activeIndex, goNext, goPrev, matchCount, query, setQuery };
}

/**
 * Opens the find bar on Cmd+F / Ctrl+F. Kept separate from the global-search
 * shortcut so Cmd+P continues to open the cross-project search.
 */
export function useFindShortcut(onOpen: () => void): void {
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const openFindFromShortcut = (event: KeyboardEvent) => {
      const isFindShortcut =
        (event.code === 'KeyF' || event.key.toLowerCase() === 'f') &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      if (!isFindShortcut) {
        return;
      }

      event.preventDefault();
      onOpenRef.current();
    };

    document.addEventListener('keydown', openFindFromShortcut);
    return () => {
      document.removeEventListener('keydown', openFindFromShortcut);
    };
  }, []);
}
