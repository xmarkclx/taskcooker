import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/Users/testhome',
}));
vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return {
    ...actual,
    convertFileSrc: (path: string) => `asset://${path}`,
  };
});

import { MarkdownEditor } from './MarkdownEditor';

describe('MarkdownEditor image rendering (Tauri path APIs available)', () => {
  it('renders a ~/ image as an asset URL once the home directory resolves', async () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown={'![](<~/Library/Application Support/com.marklopez.boomerangtasks/x.png>)'}
        onSave={() => undefined}
      />,
    );

    await waitFor(() => {
      const img = container.querySelector('.tiptap-editor img');
      expect(img?.getAttribute('src')).toBe(
        'asset:///Users/testhome/Library/Application Support/com.marklopez.boomerangtasks/x.png',
      );
    });
  });

  it('re-renders a spaced image pasted in raw mode as an asset URL', async () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    fireEvent.change(screen.getByLabelText('Description Markdown'), {
      target: {
        value: '![](~/Library/Application Support/com.marklopez.boomerangtasks/y.png)',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rich' }));

    await waitFor(() => {
      const img = container.querySelector('.tiptap-editor img');
      expect(img?.getAttribute('src')).toBe(
        'asset:///Users/testhome/Library/Application Support/com.marklopez.boomerangtasks/y.png',
      );
    });
  });

  it('opens a rendered image when it is double-clicked', async () => {
    const onOpenImage = vi.fn();
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown={'![](<~/Library/Application Support/com.marklopez.boomerangtasks/x.png>)'}
        onOpenImage={onOpenImage}
        onSave={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.tiptap-editor img')?.getAttribute('src')).toBe(
        'asset:///Users/testhome/Library/Application Support/com.marklopez.boomerangtasks/x.png',
      );
    });

    const image = container.querySelector('.tiptap-editor img') as HTMLImageElement;
    fireEvent.doubleClick(image);

    expect(onOpenImage).toHaveBeenCalledWith(
      'asset:///Users/testhome/Library/Application Support/com.marklopez.boomerangtasks/x.png',
    );
  });
});
