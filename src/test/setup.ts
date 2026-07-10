import '@testing-library/jest-dom/vitest';

// Some jsdom/node combinations expose a `localStorage` without a `clear` method,
// which makes the shared test `afterEach` throw. Provide a minimal in-memory
// fallback only when the real implementation is missing it.
if (typeof window !== 'undefined' && typeof window.localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
    },
  });
}

const fallbackRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  toJSON: () => ({}),
  top: 0,
  width: 0,
  x: 0,
  y: 0,
} as DOMRect;

function singleRectList(rect: DOMRect): DOMRectList {
  const rects = [rect] as unknown as DOMRectList;
  rects.item = (index: number) => (index === 0 ? rect : null);
  return rects;
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => fallbackRect;
}

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => singleRectList(fallbackRect);
}

if (!Element.prototype.getClientRects) {
  Element.prototype.getClientRects = function getClientRects() {
    const rect = this.getBoundingClientRect();
    return singleRectList(rect);
  };
}
