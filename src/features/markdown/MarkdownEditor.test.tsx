import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes('not a mermaid diagram')) {
      throw new Error('Mermaid parse error');
    }

    return {
      bindFunctions: undefined,
      diagramType: 'flowchart',
      svg: '<svg role="img" viewBox="0 0 120 40"><text>Rendered Mermaid</text></svg>',
    };
  }),
}));

const pathMock = vi.hoisted(() => ({
  downloadDir: vi.fn(async () => '/Users/mark/Downloads'),
  homeDir: vi.fn(async () => '/Users/mark'),
}));
const webviewMock = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  return {
    handlers,
    onDragDropEvent: vi.fn((handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return Promise.resolve(vi.fn());
    }),
  };
});

vi.mock('mermaid', () => ({
  default: mermaidMock,
}));

vi.mock('@tauri-apps/api/path', () => pathMock);
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: webviewMock.onDragDropEvent,
  }),
}));

import {
  AUTOSAVE_DEBOUNCE_MS,
  createMarkdownExtensions,
  forceEditorImageRerender,
  LocalImage,
  MermaidCodeBlock,
  MarkdownEditor,
  markdownEditorTypographyStyle,
  normalizeMarkdownForEditor,
  resolveMarkdownImageSrc,
} from './MarkdownEditor';
import * as tauriCommands from '../../tauri/commands';

// Long enough to trip the autosave debounce regardless of its exact value.
const AUTOSAVE_FLUSH_MS = AUTOSAVE_DEBOUNCE_MS + 200;

describe('MarkdownEditor', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockClear();
    webviewMock.handlers.length = 0;
    webviewMock.onDragDropEvent.mockClear();
  });

  it('auto-saves raw markdown edits after a debounce and has no Save button', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();

      render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Original"
          onSave={onSave}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# Updated\n\n- [x] Check behavior' },
      });

      expect(onSave).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSave).toHaveBeenCalledWith('# Updated\n\n- [x] Check behavior');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies markdown editor typography to rich and raw editors', () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        fontFamily="Atkinson Hyperlegible, fantasy"
        fontSize="clamp(14px, 1.2vw, 20px)"
        maxImageHeight="42vh"
        markdown="# Original"
        onSave={vi.fn()}
      />,
    );

    expect(container.querySelector('.tiptap-editor-wrap')).toHaveStyle({
      '--markdown-editor-font-family': 'Atkinson Hyperlegible, fantasy',
      '--markdown-editor-font-size': 'clamp(14px, 1.2vw, 20px)',
      '--markdown-editor-max-image-height': '42vh',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByLabelText('Description Markdown')).toHaveStyle({
      '--markdown-editor-font-family': 'Atkinson Hyperlegible, fantasy',
      '--markdown-editor-font-size': 'clamp(14px, 1.2vw, 20px)',
      '--markdown-editor-max-image-height': '42vh',
    });
  });

  it('defaults invalid markdown editor font families to sans-serif', () => {
    expect(markdownEditorTypographyStyle('', '12px')).toEqual({
      '--markdown-editor-font-family': 'sans-serif',
      '--markdown-editor-font-size': '12px',
      '--markdown-editor-max-image-height': 'none',
    });
    expect(markdownEditorTypographyStyle('Invalid ) Font', '12px')).toEqual({
      '--markdown-editor-font-family': 'sans-serif',
      '--markdown-editor-font-size': '12px',
      '--markdown-editor-max-image-height': 'none',
    });
  });

  it('treats unitless markdown editor font sizes as pixels', () => {
    expect(markdownEditorTypographyStyle('sans-serif', '14')).toEqual({
      '--markdown-editor-font-family': 'sans-serif',
      '--markdown-editor-font-size': '14px',
      '--markdown-editor-max-image-height': 'none',
    });
  });

  it('defaults blank and invalid markdown editor font sizes to 12px', () => {
    expect(markdownEditorTypographyStyle('sans-serif', '')).toEqual({
      '--markdown-editor-font-family': 'sans-serif',
      '--markdown-editor-font-size': '12px',
      '--markdown-editor-max-image-height': 'none',
    });
    expect(markdownEditorTypographyStyle('sans-serif', 'not a size')).toEqual({
      '--markdown-editor-font-family': 'sans-serif',
      '--markdown-editor-font-size': '12px',
      '--markdown-editor-max-image-height': 'none',
    });
    expect(markdownEditorTypographyStyle('sans-serif', 'clamp(14px, 1.2vw, 20px)')).toEqual({
      '--markdown-editor-font-family': 'sans-serif',
      '--markdown-editor-font-size': 'clamp(14px, 1.2vw, 20px)',
      '--markdown-editor-max-image-height': 'none',
    });
  });

  it('lets rich-mode paragraph text inherit the markdown editor font size', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror p\s*{[^}]*font-size:\s*inherit;/,
    );
  });

  it('applies markdown editor max image height to rich-mode images', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror img\s*{[^}]*max-height:\s*var\(--markdown-editor-max-image-height\);/,
    );
  });

  it('does not auto-save while the user is still typing', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();

      render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Original"
          onSave={onSave}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# A' },
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# AB' },
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onSave).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSave).toHaveBeenCalledWith('# AB');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a pending raw autosave bound to the save handler that scheduled it', () => {
    vi.useFakeTimers();
    try {
      const onSaveJournal = vi.fn();
      const onSaveDescription = vi.fn();
      const { rerender } = render(
        <MarkdownEditor
          ariaLabel="Journal Markdown"
          conflictLabel="Journal changed elsewhere."
          markdown="# Original"
          onSave={onSaveJournal}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
      fireEvent.change(screen.getByLabelText('Journal Markdown'), {
        target: { value: '# Journal draft' },
      });

      rerender(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Original"
          onSave={onSaveDescription}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSaveJournal).toHaveBeenCalledWith('# Journal draft');
      expect(onSaveDescription).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves a rich-mode edit once at the autosave flush', async () => {
    vi.useFakeTimers();
    const readText = vi.fn().mockResolvedValue('deferred flush text');
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });

    try {
      const onSave = vi.fn();
      const { container } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown=""
          mode="rich"
          onSave={onSave}
        />,
      );

      const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
      fireEvent.keyDown(proseMirror, {
        key: 'v',
        code: 'KeyV',
        shiftKey: true,
        metaKey: true,
      });
      await act(async () => {
        await Promise.resolve();
      });

      // The edit is visible immediately, but the whole-document markdown
      // serialization and save wait for the debounce flush.
      expect(proseMirror.textContent).toContain('deferred flush text');
      expect(onSave).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.lastCall?.[0]).toContain('deferred flush text');
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
      vi.useRealTimers();
    }
  });

  it('flushes an unsaved rich-mode edit when the editor unmounts', async () => {
    vi.useFakeTimers();
    const readText = vi.fn().mockResolvedValue('tail typing');
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });

    try {
      const onSave = vi.fn();
      const { container, unmount } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown=""
          mode="rich"
          onSave={onSave}
        />,
      );

      const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
      fireEvent.keyDown(proseMirror, {
        key: 'v',
        code: 'KeyV',
        shiftKey: true,
        metaKey: true,
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(onSave).not.toHaveBeenCalled();

      unmount();

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.lastCall?.[0]).toContain('tail typing');
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
      vi.useRealTimers();
    }
  });

  it('warns when incoming markdown changes while local edits are dirty', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const { rerender } = render(
        <MarkdownEditor
          ariaLabel="Project Notes Markdown"
          conflictLabel="Project notes changed elsewhere."
          markdown="# Notes"
          onSave={onSave}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
      fireEvent.change(screen.getByLabelText('Project Notes Markdown'), {
        target: { value: '# Local draft' },
      });

      rerender(
        <MarkdownEditor
          ariaLabel="Project Notes Markdown"
          conflictLabel="Project notes changed elsewhere."
          markdown="# Remote update"
          onSave={onSave}
        />,
      );

      expect(screen.getByText('Project notes changed elsewhere.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

      expect(screen.getByLabelText('Project Notes Markdown')).toHaveValue('# Remote update');
      expect(screen.queryByText('Project notes changed elsewhere.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show a conflict banner while an auto-save is in flight', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const { rerender } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Notes"
          onSave={onSave}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# Local draft' },
      });
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSave).toHaveBeenCalledWith('# Local draft');
      // markdown prop is still stale (pre-round-trip) yet no spurious conflict banner
      expect(screen.queryByText('Description changed elsewhere.')).not.toBeInTheDocument();

      // round-trip completes: markdown echoes the saved value
      rerender(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Local draft"
          onSave={onSave}
        />,
      );
      expect(screen.queryByText('Description changed elsewhere.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores older local auto-save echoes after a newer local save', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const { rerender } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Original"
          mode="raw"
          onSave={onSave}
        />,
      );

      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# Save A' },
      });
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });
      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# Save B' },
      });
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSave).toHaveBeenNthCalledWith(1, '# Save A');
      expect(onSave).toHaveBeenNthCalledWith(2, '# Save B');

      rerender(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Save A"
          mode="raw"
          onSave={onSave}
        />,
      );

      expect(screen.getByLabelText('Description Markdown')).toHaveValue('# Save B');
      expect(screen.queryByText('Description changed elsewhere.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a remote markdown change while idle', () => {
    const { container, rerender } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        onSave={() => undefined}
      />,
    );

    rerender(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Remote"
        onSave={() => undefined}
      />,
    );

    expect(container.querySelector('.tiptap-editor h1')?.textContent).toBe('Remote');
  });

  it('focuses the empty rich editor when its surrounding area is clicked', async () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown=""
        mode="rich"
        onSave={() => undefined}
      />,
    );

    const wrap = container.querySelector('.tiptap-editor-wrap') as HTMLElement;
    fireEvent.mouseDown(wrap);

    const prose = container.querySelector('.tiptap-editor .ProseMirror');
    await waitFor(() => {
      expect(prose).toBe(document.activeElement);
    });
  });

  it('clears the rich editor placeholder state after rich HTML paste into an empty editor', async () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown=""
        mode="rich"
        onSave={() => undefined}
        placeholder="Type a description here"
      />,
    );

    const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
    await waitFor(() => {
      expect(proseMirror).toHaveAttribute('data-empty', 'true');
    });

    fireEvent.paste(proseMirror, {
      clipboardData: {
        files: [],
        getData: (type: string) => {
          if (type === 'text/html') {
            return '<p>Go ahead and apply</p>';
          }
          if (type === 'text/plain') {
            return 'Go ahead and apply';
          }
          return '';
        },
        items: [],
      },
    });

    await waitFor(() => {
      expect(proseMirror).toHaveTextContent('Go ahead and apply');
      expect(proseMirror).toHaveAttribute('data-empty', 'false');
    });
  });

  it.each([
    ['Cmd+Shift+V', { metaKey: true, ctrlKey: false }],
    ['Ctrl+Shift+V', { metaKey: false, ctrlKey: true }],
  ])('pastes clipboard text literally in rich mode from %s', async (_label, modifier) => {
    vi.useFakeTimers();
    const readText = vi.fn().mockResolvedValue('<strong>Raw</strong>');
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });

    try {
      const onSave = vi.fn();
      const { container } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown=""
          mode="rich"
          onSave={onSave}
        />,
      );

      const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
      fireEvent.keyDown(proseMirror, {
        key: 'v',
        code: 'KeyV',
        shiftKey: true,
        ...modifier,
      });

      expect(readText).toHaveBeenCalledTimes(1);

      await act(async () => {
        await Promise.resolve();
      });
      expect(proseMirror.textContent).toContain('<strong>Raw</strong>');
      expect(proseMirror.querySelector('strong')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_FLUSH_MS);
      });

      expect(onSave.mock.lastCall?.[0]).toContain('&lt;strong&gt;Raw&lt;/strong&gt;');
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
      vi.useRealTimers();
    }
  });

  it('opens in the mode given by the mode prop', () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        mode="raw"
        onSave={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Description Markdown')).toBeInTheDocument();
  });

  it('restores a keyed raw editor scroll position after remounting', () => {
    const { unmount } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown={Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join('\n')}
        mode="raw"
        onSave={() => undefined}
        scrollKey="todo:42:description"
      />,
    );

    const textarea = screen.getByLabelText('Description Markdown');
    textarea.scrollTop = 144;
    fireEvent.scroll(textarea);
    unmount();

    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown={Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join('\n')}
        mode="raw"
        onSave={() => undefined}
        scrollKey="todo:42:description"
      />,
    );

    expect(screen.getByLabelText('Description Markdown').scrollTop).toBe(144);
  });

  it('notifies the parent when the editor mode changes', () => {
    const onModeChange = vi.fn();
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        mode="rich"
        onModeChange={onModeChange}
        onSave={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(onModeChange).toHaveBeenCalledWith('raw');
  });

  it('places the rich/raw mode control directly after the TOC toggle', () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        onSave={() => undefined}
      />,
    );

    const toc = screen.getByRole('button', { name: 'Toggle table of contents' });
    const rich = screen.getByRole('button', { name: 'Rich' });
    const raw = screen.getByRole('button', { name: 'Raw' });
    const bold = screen.getByRole('button', { name: 'Bold' });

    expect(toc.compareDocumentPosition(rich) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rich.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(raw.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('places export after rich/raw and opens a PDF export dialog defaulting to Downloads', async () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        onSave={() => undefined}
      />,
    );

    const raw = screen.getByRole('button', { name: 'Raw' });
    const exportButton = screen.getByRole('button', { name: 'Export' });
    const bold = screen.getByRole('button', { name: 'Bold' });

    expect(raw.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportButton.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(exportButton);

    const dialog = await screen.findByRole('dialog', { name: 'Export Markdown' });
    expect(within(dialog).getByText('PDF')).toBeInTheDocument();

    await waitFor(() => {
      expect(within(dialog).getByText('/Users/mark/Downloads')).toBeInTheDocument();
    });
  });

  it('uses cooking icons for editor mode and export controls', () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="# Notes"
        onSave={() => undefined}
      />,
    );

    ['Rich', 'Raw', 'Export'].forEach((label) => {
      const button = screen.getByRole('button', { name: label });
      expect(button.querySelector('svg')).not.toBeNull();
    });
  });

  it('hides formatting actions when the editor toolbar is too narrow', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toContain('container-name: description-panel;');
    expect(css).toContain('container-type: inline-size;');
    expect(css).toMatch(
      /@container description-panel \(max-width: 560px\)[\s\S]*\.editor-toolbar \.editor-format-actions\s*{\s*display: none;/,
    );
  });

  it('locks editing during a conflict until Overwrite or Reload is chosen', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const { rerender } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Notes"
          mode="raw"
          onSave={onSave}
        />,
      );

      fireEvent.change(screen.getByLabelText('Description Markdown'), {
        target: { value: '# Local draft' },
      });

      rerender(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="# Remote update"
          mode="raw"
          onSave={onSave}
        />,
      );

      expect(screen.getByText('Description changed elsewhere.')).toBeInTheDocument();
      // Typing is locked out while the conflict is unresolved.
      expect(screen.getByLabelText('Description Markdown')).toBeDisabled();
      // The locked editor must not auto-save over the remote change.
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
      });
      expect(onSave).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

      expect(onSave).toHaveBeenCalledWith('# Local draft');
      expect(screen.queryByText('Description changed elsewhere.')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Description Markdown')).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('toggles the generated contents list', () => {
    render(
      <MarkdownEditor
        ariaLabel="Project Notes Markdown"
        conflictLabel="Project notes changed elsewhere."
        markdown={'# Plan\n\n## Details'}
        onSave={() => undefined}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Plan' })).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Toggle table of contents'));

    expect(screen.getByRole('link', { name: 'Plan' })).toBeInTheDocument();
  });

  it('uses a resizable table of contents width and commits keyboard changes', () => {
    const onTocWidthChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Project Notes Markdown"
        conflictLabel="Project notes changed elsewhere."
        markdown={'# Plan\n\n## Details'}
        onSave={() => undefined}
        onTocWidthChange={onTocWidthChange}
        tocHidden={false}
        tocWidth={192}
      />,
    );

    expect(container.querySelector('.editor-body')).toHaveStyle({
      gridTemplateColumns: '192px 8px minmax(0, 1fr)',
    });

    const resizeHandle = screen.getByRole('separator', {
      name: 'Resize table of contents',
    });
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '192');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

    expect(onTocWidthChange).toHaveBeenCalledWith(208);
  });

  it('styles the table of contents as a bounded scroll container', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(/\.editor-body nav\s*{[^}]*max-height:\s*100%;/);
    expect(css).toMatch(/\.editor-body nav\s*{[^}]*min-height:\s*0;/);
    expect(css).toMatch(/\.editor-body nav\s*{[^}]*overscroll-behavior:\s*contain;/);
    expect(css).toMatch(/\.editor-body nav\s*{[^}]*overflow:\s*auto;/);
  });

  it('highlights the latest visible rich-mode heading while scrolling', () => {
    const rects = new WeakMap<Element, DOMRect>();
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return rects.get(this) ?? originalGetBoundingClientRect.call(this);
    };

    try {
      const { container } = render(
        <MarkdownEditor
          ariaLabel="Project Notes Markdown"
          conflictLabel="Project notes changed elsewhere."
          markdown={'# Summary\n\n## Commands\n\n## Verification\n\n## Notes'}
          onSave={() => undefined}
          tocHidden={false}
        />,
      );
      const scrollContainer = container.querySelector('.tiptap-editor-wrap') as Element;
      const headings = Array.from(
        container.querySelectorAll('.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3'),
      );

      rects.set(scrollContainer, domRect({ top: 0, bottom: 300 }));
      rects.set(headings[0], domRect({ top: -420, bottom: -380 }));
      rects.set(headings[1], domRect({ top: -80, bottom: -40 }));
      rects.set(headings[2], domRect({ top: 80, bottom: 120 }));
      rects.set(headings[3], domRect({ top: 250, bottom: 290 }));

      fireEvent.scroll(scrollContainer);

      expect(screen.getByRole('link', { name: 'Notes' })).toHaveClass('active');
      expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveClass('active');
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('jumps from the contents list to the matching rich heading', () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <MarkdownEditor
          ariaLabel="Project Notes Markdown"
          conflictLabel="Project notes changed elsewhere."
          markdown={'# Plan\n\n## Details'}
          onSave={() => undefined}
          tocHidden={false}
        />,
      );

      fireEvent.click(screen.getByRole('link', { name: 'Details' }));

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('renders Markdown links in rich mode without navigating on edit click', () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="[Docs](https://example.com/docs)"
        onSave={() => undefined}
      />,
    );

    const link = screen.getByRole('link', { name: 'Docs' });

    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders Mermaid fenced code blocks as diagram surfaces in rich mode', async () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown={[
          '# Suggested Workflow',
          '',
          '```mermaid',
          'flowchart TD',
          '  A[Start] --> B[Done]',
          '```',
        ].join('\n')}
        onSave={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.mermaid-diagram svg')).toBeInTheDocument();
    });
    expect(screen.getByText('Mermaid source')).toBeInTheDocument();
    expect(container.querySelector('.mermaid-diagram-status')).toBeNull();
    expect(container.querySelector('.tiptap-editor pre code.language-mermaid')).toBeNull();
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        startOnLoad: false,
      }),
    );
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringMatching(/^boomerang-mermaid-/),
      ['flowchart TD', '  A[Start] --> B[Done]'].join('\n'),
    );
  });

  it('shows Mermaid render errors inline while keeping the source expandable', async () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown={['```mermaid', 'not a mermaid diagram', '```'].join('\n')}
        onSave={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to render Mermaid diagram');
    });
    expect(screen.getByText('Mermaid source')).toBeInTheDocument();
  });

  it('opens a clicked rich-mode link only from the external-open affordance', async () => {
    const openPathOrUrl = vi
      .spyOn(tauriCommands, 'openPathOrUrl')
      .mockResolvedValue(undefined);

    try {
      const { container } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          conflictLabel="Description changed elsewhere."
          markdown="[Docs](https://example.com/docs)"
          onSave={() => undefined}
        />,
      );

      fireEvent.click(screen.getByRole('link', { name: 'Docs' }));

      expect(openPathOrUrl).not.toHaveBeenCalled();

      const button = screen.getByRole('button', { name: 'Open link Docs' });
      expect(container.querySelector('.ProseMirror')).not.toContainElement(button);

      fireEvent.click(button);

      await waitFor(() => {
        expect(openPathOrUrl).toHaveBeenCalledWith({ target: 'https://example.com/docs' });
      });
    } finally {
      openPathOrUrl.mockRestore();
    }
  });

  it('styles rich-mode links with a visible underline and normal surrounding weight', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror a\s*{[^}]*text-decoration(?:-line)?: underline;/,
    );
    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror a\s*{[^}]*text-underline-offset:/,
    );
    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror a\s*{[^}]*font-weight:\s*inherit;/,
    );
  });

  it('styles rich-mode inline code as a primary badge', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror :not\(pre\) > code\s*{[^}]*background: var\(--color-primary\);/,
    );
    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror :not\(pre\) > code\s*{[^}]*border-radius: 999px;/,
    );
    expect(css).toMatch(
      /\.tiptap-editor \.ProseMirror :not\(pre\) > code\s*{[^}]*color: var\(--color-primary-contrast\);/,
    );
  });

  it('keeps Markdown editor bottom slack compact instead of fixed tall content', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(css).toMatch(/\.tiptap-editor \.ProseMirror\s*{[^}]*min-height:\s*0;/);
    expect(css).toMatch(/\.tiptap-editor \.ProseMirror\s*{[^}]*padding-bottom:\s*2lh;/);
    expect(css).toMatch(/\.markdown-textarea\s*{[^}]*min-height:\s*0;/);
    expect(css).toMatch(/\.markdown-textarea\s*{[^}]*padding:\s*22px 22px 2lh;/);
    expect(css).not.toMatch(
      /\.new-task-dialog \.markdown-textarea,\s*\.new-task-dialog \.tiptap-editor \.ProseMirror\s*{[^}]*min-height:/,
    );
  });

  it('exposes a compact link toolbar control in rich mode', () => {
    render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="Docs"
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument();
  });

  it('inserts dropped file paths in rich mode', async () => {
    const onDraftChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="Start"
        onDraftChange={onDraftChange}
        onSave={() => undefined}
      />,
    );

    const panel = container.querySelector('.description-panel');
    expect(panel).toBeInstanceOf(HTMLElement);
    screen.getByRole('button', { name: 'Toggle table of contents' }).focus();
    await waitFor(() => expect(webviewMock.onDragDropEvent).toHaveBeenCalled());

    webviewMock.handlers[0]?.({
      payload: {
        paths: ['/Users/markcl/My Folder/report.txt'],
        position: { x: 42, y: 64 },
        type: 'drop',
      },
    });

    await waitFor(() => {
      expect(onDraftChange.mock.lastCall?.[0]).toContain(
        '/Users/markcl/My Folder/report.txt',
      );
    });
  });

  it('inserts dropped file paths in raw mode', async () => {
    const onDraftChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown="Start"
        mode="raw"
        onDraftChange={onDraftChange}
        onSave={() => undefined}
      />,
    );

    const panel = container.querySelector('.description-panel');
    expect(panel).toBeInstanceOf(HTMLElement);
    const textarea = screen.getByLabelText('Description Markdown') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(5, 5);
    await waitFor(() => expect(webviewMock.onDragDropEvent).toHaveBeenCalled());

    webviewMock.handlers[0]?.({
      payload: {
        paths: ['/Users/markcl/My Folder/report.txt'],
        position: { x: 42, y: 64 },
        type: 'drop',
      },
    });

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith('Start/Users/markcl/My Folder/report.txt');
    });
  });

  it('inserts dropped image file paths as text even with an attachment target', async () => {
    const saveEditorImage = vi.spyOn(tauriCommands, 'saveEditorImage');

    try {
      const onDraftChange = vi.fn();
      const { container } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          attachmentTarget={{ projectId: 7, scope: 'todo-description', todoId: 42 }}
          conflictLabel="Description changed elsewhere."
          markdown="Start"
          mode="raw"
          onDraftChange={onDraftChange}
          onSave={() => undefined}
        />,
      );

      const panel = container.querySelector('.description-panel');
      expect(panel).toBeInstanceOf(HTMLElement);
      const textarea = screen.getByLabelText('Description Markdown') as HTMLTextAreaElement;
      textarea.focus();
      textarea.setSelectionRange(5, 5);
      await waitFor(() => expect(webviewMock.onDragDropEvent).toHaveBeenCalled());

      webviewMock.handlers[0]?.({
        payload: {
          paths: ['/Users/markcl/Desktop/shot.png'],
          position: { x: 42, y: 64 },
          type: 'drop',
        },
      });

      await waitFor(() => {
        expect(onDraftChange).toHaveBeenCalledWith('Start/Users/markcl/Desktop/shot.png');
      });
      expect(saveEditorImage).not.toHaveBeenCalled();
    } finally {
      saveEditorImage.mockRestore();
    }
  });

  it('saves non-file image drops in raw mode and inserts image markdown', async () => {
    const saveEditorImage = vi
      .spyOn(tauriCommands, 'saveEditorImage')
      .mockResolvedValue({
        absolutePath: '/Users/markcl/Library/Application Support/Boomerang/dropped.png',
        markdownPath: '~/Library/Application Support/Boomerang/dropped.png',
      });

    try {
      const onDraftChange = vi.fn();
      render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          attachmentTarget={{ projectId: 7, scope: 'todo-description', todoId: 42 }}
          conflictLabel="Description changed elsewhere."
          markdown="Start"
          mode="raw"
          onDraftChange={onDraftChange}
          onSave={() => undefined}
        />,
      );

      const textarea = screen.getByLabelText('Description Markdown') as HTMLTextAreaElement;
      textarea.setSelectionRange(5, 5);

      const image = new File(['image bytes'], 'browser-image.png', { type: 'image/png' });
      fireEvent.drop(textarea, {
        dataTransfer: {
          files: [],
          items: [
            {
              getAsFile: () => image,
              kind: 'file',
              type: 'image/png',
            },
          ],
        },
      });

      await waitFor(() =>
        expect(saveEditorImage).toHaveBeenCalledWith({
          base64Data: expect.any(String),
          fileName: 'browser-image.png',
          mimeType: 'image/png',
          projectId: 7,
          scope: 'todo-description',
          todoId: 42,
        }),
      );
      await waitFor(() => {
        expect(onDraftChange).toHaveBeenCalledWith(
          'Start![](<~/Library/Application Support/Boomerang/dropped.png>)',
        );
      });
    } finally {
      saveEditorImage.mockRestore();
    }
  });

  it('saves Jira checkbox lists pasted into rich mode as Markdown task items', async () => {
    const onSave = vi.fn();
    const { container } = render(
      <MarkdownEditor
        ariaLabel="Description Markdown"
        conflictLabel="Description changed elsewhere."
        markdown=""
        onSave={onSave}
      />,
    );

    const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
    fireEvent.paste(proseMirror, {
      clipboardData: {
        files: [],
        getData: (type: string) => {
          if (type === 'text/html') {
            return `
              <div>
                <p><strong>Acceptance Criteria:</strong></p>
                <div><input type="checkbox">Navigating to the Get a Quote page displays the external form.</div>
                <div><input type="checkbox" checked>The form within the iframe is fully functional.</div>
              </div>
            `;
          }
          if (type === 'text/plain') {
            return [
              'Acceptance Criteria:',
              'Navigating to the Get a Quote page displays the external form.',
              'The form within the iframe is fully functional.',
            ].join('\n');
          }
          return '';
        },
        items: [],
      },
    });

    await waitFor(
      () => {
        expect(onSave).toHaveBeenCalled();
      },
      { timeout: AUTOSAVE_DEBOUNCE_MS + 2_000 },
    );
    expect(onSave.mock.lastCall?.[0].trimEnd()).toBe(
      [
        '**Acceptance Criteria:**',
        '',
        '- [ ] Navigating to the Get a Quote page displays the external form.',
        '- [x] The form within the iframe is fully functional.',
      ].join('\n'),
    );
  });

  it('saves data-url images from Jira rich HTML paste before inserting content', async () => {
    const saveEditorImage = vi.spyOn(tauriCommands, 'saveEditorImage').mockResolvedValue({
      absolutePath:
        '/Users/markcl/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-2/project-notes/contact-panel.png',
      markdownPath:
        '~/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-2/project-notes/contact-panel.png',
    });
    const onDraftChange = vi.fn();

    try {
      const { container } = render(
        <MarkdownEditor
          ariaLabel="Description Markdown"
          attachmentTarget={{ projectId: 2, scope: 'project-notes' }}
          conflictLabel="Description changed elsewhere."
          markdown=""
          onDraftChange={onDraftChange}
          onSave={() => undefined}
        />,
      );

      const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
      fireEvent.paste(proseMirror, {
        clipboardData: {
          files: [],
          getData: (type: string) => {
            if (type === 'text/html') {
              return `
                <div data-testid="jira-description">
                  <p><strong>Client:</strong> healthAbility</p>
                  <p>They want text above the booking buttons.</p>
                  <img
                    alt="contact-panel.png"
                    src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
                  >
                </div>
              `;
            }
            if (type === 'text/plain') {
              return 'Client: healthAbility\nThey want text above the booking buttons.';
            }
            return '';
          },
          items: [],
        },
      });

      await waitFor(() => {
        expect(saveEditorImage).toHaveBeenCalledWith(
          expect.objectContaining({
            fileName: 'contact-panel.png',
            mimeType: 'image/png',
            projectId: 2,
            scope: 'project-notes',
          }),
        );
      });

      await waitFor(() => {
        const markdown = onDraftChange.mock.lastCall?.[0] ?? '';
        expect(markdown).toContain('**Client:** healthAbility');
        expect(markdown).toContain('They want text above the booking buttons.');
        expect(markdown).toContain(
          '![contact-panel.png](<~/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-2/project-notes/contact-panel.png>)',
        );
      });
    } finally {
      saveEditorImage.mockRestore();
    }
  });

  it('resolves home-aliased image paths only for rendered asset URLs', () => {
    const convert = vi.fn((path: string) => `asset://${path}`);

    expect(
      resolveMarkdownImageSrc(
        '~/Library/Application Support/Boomerang/image.png',
        '/Users/mark',
        convert,
      ),
    ).toBe('asset:///Users/mark/Library/Application Support/Boomerang/image.png');
    expect(resolveMarkdownImageSrc('https://example.com/image.png', '/Users/mark', convert)).toBe(
      'https://example.com/image.png',
    );
  });

  it('renders a spaced image typed in raw mode after switching back to rich mode', () => {
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
        value: '![](~/Library/Application Support/com.marklopez.boomerangtasks/x.png)',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rich' }));

    expect(container.querySelector('.tiptap-editor img')).not.toBeNull();
  });

  it('parses an unnormalized spaced image path as literal text (characterizes the bug)', () => {
    const editor = new Editor({
      content: '![](~/Library/Application Support/com.marklopez.boomerangtasks/x.png)',
      contentType: 'markdown',
      extensions: [StarterKit, LocalImage, Markdown],
    });

    expect(editor.getJSON().content?.[0]?.type).toBe('paragraph');
  });

  it('parses a normalized spaced image path as an image node', () => {
    const editor = new Editor({
      content: normalizeMarkdownForEditor(
        '![](~/Library/Application Support/com.marklopez.boomerangtasks/x.png)',
      ),
      contentType: 'markdown',
      extensions: [StarterKit, LocalImage, Markdown],
    });

    const first = editor.getJSON().content?.[0];
    expect(first?.type).toBe('image');
    expect(first?.attrs?.src).toBe(
      '~/Library/Application Support/com.marklopez.boomerangtasks/x.png',
    );
  });

  it('serializes an image whose src contains spaces as angle-bracketed markdown', () => {
    const editor = new Editor({
      content: '![](<~/Library/Application Support/com.marklopez.boomerangtasks/x.png>)',
      contentType: 'markdown',
      extensions: [
        StarterKit,
        LocalImage.configure({
          resize: {
            enabled: true,
            directions: ['top', 'bottom', 'left', 'right'],
            minHeight: 80,
            minWidth: 80,
            alwaysPreserveAspectRatio: true,
          },
        }),
        Markdown,
      ],
    });

    expect(editor.getMarkdown()).toMatch(
      /!\[\]\(<~\/Library\/Application Support\/com\.marklopez\.boomerangtasks\/x\.png>\)/,
    );
  });

  it('keeps a pasted image when typing immediately after insertion', () => {
    const editor = new Editor({
      content: '',
      contentType: 'markdown',
      extensions: createMarkdownExtensions(),
    });

    editor.commands.setImage({ src: '~/Library/Application Support/Boomerang/x.png' });
    editor.commands.insertContent('caption');

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'image',
      'paragraph',
    ]);
    expect(editor.getMarkdown()).toBe(
      '![](<~/Library/Application Support/Boomerang/x.png>)\n\ncaption',
    );
  });

  it('keeps Mermaid fenced code blocks canonical when serializing Markdown', () => {
    const markdown = ['```mermaid', 'flowchart TD', '  A[Start] --> B[Done]', '```'].join('\n');
    const editor = new Editor({
      content: markdown,
      contentType: 'markdown',
      extensions: [
        StarterKit.configure({
          codeBlock: false,
        }),
        MermaidCodeBlock,
        Markdown,
      ],
    });

    expect(editor.getMarkdown()).toBe(markdown);
  });

  it('preserves GFM tables through the editor Markdown round-trip', () => {
    const markdown = [
      '| Name | Status |',
      '| --- | --- |',
      '| Build | Passing |',
      '| Deploy | Pending |',
    ].join('\n');
    const editor = new Editor({
      content: markdown,
      contentType: 'markdown',
      extensions: createMarkdownExtensions(),
    });

    // Column padding is fine; collapse it so we assert on table structure/content,
    // not exact spacing. The bug was tables vanishing entirely on save.
    const collapsed = editor.getMarkdown().replace(/ +/g, ' ');
    expect(collapsed).toContain('| Name | Status |');
    expect(collapsed).toMatch(/\| -+ \| -+ \|/);
    expect(collapsed).toContain('| Build | Passing |');
    expect(collapsed).toContain('| Deploy | Pending |');
  });

  it('keeps sentence-opening words ending in a period as paragraphs', () => {
    const markdown = '### Recommendation\n\nYes. For the custom CDC Charter blocks.';
    const editor = new Editor({
      content: normalizeMarkdownForEditor(markdown),
      contentType: 'markdown',
      extensions: createMarkdownExtensions(),
    });

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
    ]);
    expect(editor.getMarkdown()).toContain('Yes. For the custom CDC Charter blocks.');
  });

  it('does not overwrite rich text typed after an image URL rerender was scheduled', () => {
    const editor = new Editor({
      content: 'a',
      contentType: 'markdown',
      extensions: [StarterKit, LocalImage, Markdown],
    });

    editor.commands.focus('end');
    editor.commands.insertContent('b');
    forceEditorImageRerender(editor);
    editor.commands.insertContent('c');

    expect(editor.getText()).toBe('abc');
  });
});

function domRect({
  bottom,
  top,
}: {
  bottom: number;
  top: number;
}): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    toJSON: () => ({}),
    top,
    width: 100,
    x: 0,
    y: top,
  };
}

describe('normalizeMarkdownForEditor', () => {
  it('wraps image destinations containing spaces in angle brackets', () => {
    expect(
      normalizeMarkdownForEditor('![](~/Library/Application Support/com.marklopez.boomerangtasks/x.png)'),
    ).toBe('![](<~/Library/Application Support/com.marklopez.boomerangtasks/x.png>)');
  });

  it('preserves alt text and titles when wrapping spaced destinations', () => {
    expect(
      normalizeMarkdownForEditor('![screenshot](~/path with space.png "title")'),
    ).toBe('![screenshot](<~/path with space.png> "title")');
  });

  it('leaves already-bracketed destinations untouched', () => {
    const input = '![](<~/Library/Application Support/com.marklopez.boomerangtasks/x.png>)';
    expect(normalizeMarkdownForEditor(input)).toBe(input);
  });

  it('leaves space-free destinations untouched', () => {
    expect(normalizeMarkdownForEditor('![](https://example.com/x.png)')).toBe(
      '![](https://example.com/x.png)',
    );
  });

  it('wraps link destinations containing spaces', () => {
    expect(normalizeMarkdownForEditor('[link](~/Documents/My Notes)')).toBe(
      '[link](<~/Documents/My Notes>)',
    );
  });

  it('does not touch plain text without link destinations', () => {
    expect(normalizeMarkdownForEditor('# Heading\n\nA paragraph with no links.')).toBe(
      '# Heading\n\nA paragraph with no links.',
    );
  });

  it('escapes alphabetic list-looking sentence openers before rich parsing', () => {
    expect(normalizeMarkdownForEditor('Yes. For this one, use text.')).toBe(
      'Yes\\. For this one, use text.',
    );
    expect(normalizeMarkdownForEditor('> No. Keep the quote as prose.')).toBe(
      '> No\\. Keep the quote as prose.',
    );
  });

  it('keeps numeric ordered lists and fenced code untouched', () => {
    expect(normalizeMarkdownForEditor('1. Real ordered list')).toBe('1. Real ordered list');
    expect(normalizeMarkdownForEditor('```\na. code sample\n```')).toBe(
      '```\na. code sample\n```',
    );
  });
});
