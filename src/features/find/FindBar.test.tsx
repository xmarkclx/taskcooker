import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { FindBar } from './FindBar';

const appStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function renderFindBar(content: string, onClose = vi.fn()) {
  const utils = render(
    <div>
      <p>{content}</p>
      <FindBar onClose={onClose} />
    </div>,
  );
  const input = screen.getByRole('searchbox', { name: /find in page/i });
  return { ...utils, input, onClose };
}

function rectList(...rects: DOMRect[]): DOMRectList {
  const list = rects as unknown as DOMRectList;
  list.item = (index: number) => rects[index] ?? null;
  return list;
}

describe('FindBar', () => {
  it('uses an opaque overlay surface instead of blending into app chrome', () => {
    const findBarRule = cssRule('.find-bar');
    const findBarInputRule = cssRule('.find-bar-input');

    expect(findBarRule).toContain('background: var(--color-menu);');
    expect(findBarRule).not.toMatch(/opacity:\s*0?\.\d/);
    expect(findBarRule).toContain('z-index: 1000;');
    expect(findBarInputRule).toContain('background: var(--color-surface-warm);');
    expect(findBarInputRule).toContain('border: 1px solid var(--line);');
  });

  it('reports the number of matches for the typed query', async () => {
    const { input } = renderFindBar('banana banana split');
    fireEvent.change(input, { target: { value: 'banana' } });
    expect(await screen.findByText('1/2')).toBeInTheDocument();
  });

  it('shows 0/0 when nothing matches', async () => {
    const { input } = renderFindBar('banana banana split');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(await screen.findByText('0/0')).toBeInTheDocument();
  });

  it('paints fallback highlight rectangles when the browser highlight API is unavailable', async () => {
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(
      rectList(new DOMRect(10, 20, 80, 18)),
    );

    const { input } = renderFindBar('banana banana split');
    fireEvent.change(input, { target: { value: 'banana' } });
    await screen.findByText('1/2');

    expect(document.querySelectorAll('.find-highlight-rect')).toHaveLength(2);
    expect(document.querySelector('.find-highlight-rect.active')).toBeInTheDocument();
  });

  it('steps to the next match on Enter and wraps around', async () => {
    const { input } = renderFindBar('banana banana split');
    fireEvent.change(input, { target: { value: 'banana' } });
    await screen.findByText('1/2');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('steps to the previous match on Shift+Enter and wraps around', async () => {
    const { input } = renderFindBar('banana banana split');
    fireEvent.change(input, { target: { value: 'banana' } });
    await screen.findByText('1/2');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const { input, onClose } = renderFindBar('banana');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`),
  );

  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.groups?.body ?? '';
}
