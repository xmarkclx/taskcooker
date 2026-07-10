import { describe, expect, it } from 'vitest';

import { findMatchRanges, nextMatchIndex } from './findInPage';

function container(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  // Attach to the document so TreeWalker/Range behave like the real app.
  document.body.appendChild(el);
  return el;
}

describe('findMatchRanges', () => {
  it('returns no ranges for an empty or whitespace query', () => {
    const root = container('<p>Hello world</p>');
    expect(findMatchRanges(root, '')).toEqual([]);
    expect(findMatchRanges(root, '   ')).toEqual([]);
  });

  it('finds a case-insensitive match and captures its exact text', () => {
    const root = container('<p>Hello World</p>');
    const ranges = findMatchRanges(root, 'world');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('World');
  });

  it('finds multiple matches within a single text node in document order', () => {
    const root = container('<p>aXaXa</p>');
    const ranges = findMatchRanges(root, 'x');
    expect(ranges.map((range) => range.startOffset)).toEqual([1, 3]);
  });

  it('finds matches across multiple elements in document order', () => {
    const root = container('<p>find me</p><span>and find again</span>');
    const ranges = findMatchRanges(root, 'find');
    expect(ranges).toHaveLength(2);
  });

  it('ignores script and style content', () => {
    const root = container('<style>find</style><p>find</p><script>find</script>');
    const ranges = findMatchRanges(root, 'find');
    expect(ranges).toHaveLength(1);
  });

  it('ignores subtrees marked with data-find-ignore (the find bar itself)', () => {
    const root = container(
      '<div data-find-ignore><span>find</span></div><p>find</p>',
    );
    const ranges = findMatchRanges(root, 'find');
    expect(ranges).toHaveLength(1);
  });
});

describe('nextMatchIndex', () => {
  it('stays at 0 when there are no matches', () => {
    expect(nextMatchIndex(0, 0, 1)).toBe(0);
    expect(nextMatchIndex(0, 0, -1)).toBe(0);
  });

  it('advances forward and wraps to the start', () => {
    expect(nextMatchIndex(0, 3, 1)).toBe(1);
    expect(nextMatchIndex(2, 3, 1)).toBe(0);
  });

  it('advances backward and wraps to the end', () => {
    expect(nextMatchIndex(0, 3, -1)).toBe(2);
    expect(nextMatchIndex(1, 3, -1)).toBe(0);
  });
});
