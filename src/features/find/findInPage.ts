/**
 * Browser-style in-page text matching.
 *
 * Walks the text nodes under `root` and returns a `Range` for every
 * case-insensitive occurrence of `query`, in document order. Ranges are used by
 * the find bar to highlight matches (via the CSS Custom Highlight API) and to
 * scroll the active match into view.
 *
 * The matching logic is intentionally DOM-only and free of React/app state so it
 * can be unit tested in isolation.
 */

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

/** Attribute that marks a subtree as off-limits to find (e.g. the find bar). */
export const FIND_IGNORE_ATTRIBUTE = 'data-find-ignore';

function isSkippedElement(element: Element): boolean {
  return SKIPPED_TAGS.has(element.tagName) || element.hasAttribute(FIND_IGNORE_ATTRIBUTE);
}

/**
 * Step the active match index by `direction` (+1 next, -1 previous) with
 * wraparound. Returns 0 when there are no matches.
 */
export function nextMatchIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) {
    return 0;
  }

  return (current + direction + count) % count;
}

export function findMatchRanges(root: Node, query: string): Range[] {
  const needle = query.toLowerCase();
  if (needle.trim().length === 0) {
    return [];
  }

  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && parent.closest(`[${FIND_IGNORE_ATTRIBUTE}]`)) {
        return NodeFilter.FILTER_REJECT;
      }
      for (let element = parent; element; element = element.parentElement) {
        if (isSkippedElement(element)) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return node.nodeValue && node.nodeValue.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const ranges: Range[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current.nodeValue ?? '';
    const haystack = text.toLowerCase();
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      const range = doc.createRange();
      range.setStart(current, from);
      range.setEnd(current, from + needle.length);
      ranges.push(range);
      from = haystack.indexOf(needle, from + needle.length);
    }
    current = walker.nextNode();
  }

  return ranges;
}
