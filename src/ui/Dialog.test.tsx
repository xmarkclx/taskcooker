import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { DialogBackdrop, DialogPanel } from './Dialog';

const appStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('Dialog primitives', () => {
  it('compose shared dialog shell classes with feature-specific classes', () => {
    render(
      <DialogBackdrop className="project-notes-backdrop">
        <DialogPanel
          aria-labelledby="example-title"
          className="project-notes-dialog"
          role="dialog"
        >
          <h2 id="example-title">Project Notes</h2>
        </DialogPanel>
      </DialogBackdrop>,
    );

    expect(screen.getByText('Project Notes').parentElement).toHaveClass(
      'dialog-panel',
      'project-notes-dialog',
    );
    expect(screen.getByText('Project Notes').parentElement).toHaveAttribute(
      'aria-labelledby',
      'example-title',
    );
    expect(screen.getByText('Project Notes').parentElement?.parentElement).toHaveClass(
      'dialog-backdrop',
      'project-notes-backdrop',
    );
  });

  it('keeps shared dialog backdrops below the draggable app header', () => {
    const topBarRule = cssRule('.top-bar');
    const backdropRule = cssRule('.dialog-backdrop');

    expect(topBarRule).toContain('height: var(--top-bar-height);');
    expect(backdropRule).toContain('inset: var(--top-bar-height) 0 0;');
    expect(backdropRule).not.toContain('inset: 0;');
  });

  it('cancels only the topmost dialog when Escape is pressed', () => {
    const lowerCancel = vi.fn();
    const topCancel = vi.fn();

    render(
      <DialogBackdrop>
        <DialogPanel aria-label="Lower dialog" onCancel={lowerCancel} role="dialog">
          Lower dialog
        </DialogPanel>
        <DialogPanel aria-label="Top dialog" onCancel={topCancel} role="dialog">
          Top dialog
        </DialogPanel>
      </DialogBackdrop>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(topCancel).toHaveBeenCalledTimes(1);
    expect(lowerCancel).not.toHaveBeenCalled();
  });

  it('cancels only the topmost dialog when the backdrop is clicked', () => {
    const lowerCancel = vi.fn();
    const topCancel = vi.fn();

    const { container } = render(
      <DialogBackdrop>
        <DialogPanel aria-label="Lower dialog" onCancel={lowerCancel} role="dialog">
          Lower dialog
        </DialogPanel>
        <DialogPanel aria-label="Top dialog" onCancel={topCancel} role="dialog">
          Top dialog
        </DialogPanel>
      </DialogBackdrop>,
    );

    const backdrop = container.querySelector('.dialog-backdrop');
    expect(backdrop).toBeInstanceOf(HTMLElement);

    fireEvent.click(backdrop as HTMLElement);

    expect(topCancel).toHaveBeenCalledTimes(1);
    expect(lowerCancel).not.toHaveBeenCalled();
  });

  it('does not cancel the dialog when the panel is clicked', () => {
    const cancel = vi.fn();

    render(
      <DialogBackdrop>
        <DialogPanel aria-label="Example dialog" onCancel={cancel} role="dialog">
          Example dialog
        </DialogPanel>
      </DialogBackdrop>,
    );

    fireEvent.click(screen.getByRole('dialog', { name: 'Example dialog' }));

    expect(cancel).not.toHaveBeenCalled();
  });

  it('lets persistent dialogs close only from their own buttons', () => {
    const cancel = vi.fn();

    const { container } = render(
      <DialogBackdrop persistent>
        <DialogPanel
          aria-label="Persistent dialog"
          onCancel={cancel}
          persistent
          role="dialog"
        >
          Persistent dialog
          <button onClick={cancel} type="button">
            Cancel
          </button>
        </DialogPanel>
      </DialogBackdrop>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('.dialog-backdrop') as HTMLElement);

    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(
    new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`),
  );
  return match?.groups?.body ?? '';
}
