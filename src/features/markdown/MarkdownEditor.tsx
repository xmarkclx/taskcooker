import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type ReactNodeViewProps,
} from '@tiptap/react';
import { Editor, mergeAttributes, type CommandProps } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import FileHandler from '@tiptap/extension-file-handler';
import Image, { type SetImageOptions } from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { convertFileSrc } from '@tauri-apps/api/core';
import { downloadDir, homeDir } from '@tauri-apps/api/path';
import { Croissant, ExternalLink, Link2, Package, Wheat, X } from 'lucide-react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MermaidConfig, RenderResult } from 'mermaid';

import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { openPathOrUrl, saveEditorImage } from '../../tauri/commands';
import type { SaveEditorImageInput } from '../../tauri/commands';
import { listenForDroppedPathsWhenFocused } from '../../tauri/dropPaths';
import { fileToBase64 } from '../messages/replyAttachments';
import { useSlowdownRenderProbe } from '../performance/slowdownProfiler';

export type MarkdownEditorMode = 'rich' | 'raw';

export type AttachmentTarget = Pick<SaveEditorImageInput, 'projectId' | 'scope' | 'todoId'>;
type SaveMarkdown = (markdown: string) => void;
type PendingSave = {
  save: SaveMarkdown;
  value: string;
};

let cachedHomeDirectory: string | null = null;

// Long enough that steady typing never pays serialize/save/snapshot costs,
// short enough that edits still land quickly after the user pauses.
export const AUTOSAVE_DEBOUNCE_MS = 2_000;
const DEFAULT_TOC_WIDTH = 180;
const MIN_TOC_WIDTH = 120;
const MAX_TOC_WIDTH = 360;
const TOC_WIDTH_KEYBOARD_STEP = 16;
const DOWNLOADS_FALLBACK_LABEL = 'Downloads';
const rememberedScrollPositions = new Map<string, number>();
let mermaidDiagramSequence = 0;

type LinkOpenAffordance = {
  href: string;
  label: string;
  left: number;
  top: number;
};

export const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        renderHTML: (attributes) => ({
          src: resolveMarkdownImageSrc(String(attributes.src ?? '')),
        }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addCommands() {
    return {
      setImage:
        (options: SetImageOptions) =>
        ({ commands }: CommandProps) =>
          commands.insertContent([
            { type: this.name, attrs: options },
            { type: 'paragraph' },
          ]),
    };
  },

  renderMarkdown(node) {
    const src = markdownDestination(String(node.attrs?.src ?? ''));
    const alt = String(node.attrs?.alt ?? '');
    const title = String(node.attrs?.title ?? '');

    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
});

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MarkdownCodeBlockView);
  },
});

// Single source of truth for the editor's extension set so tests can verify the
// exact Markdown round-trip the live editor performs (e.g. that GFM tables are
// preserved instead of being silently dropped on save).
export function createMarkdownExtensions(options?: { attachmentTarget?: AttachmentTarget }) {
  const attachmentTarget = options?.attachmentTarget;
  return [
    StarterKit.configure({
      codeBlock: false,
      link: {
        defaultProtocol: 'https',
        enableClickSelection: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
        openOnClick: false,
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    MermaidCodeBlock,
    LocalImage.configure({
      resize: {
        enabled: true,
        directions: ['top', 'bottom', 'left', 'right'],
        minHeight: 80,
        minWidth: 80,
        alwaysPreserveAspectRatio: true,
      },
    }),
    TableKit,
    FileHandler.configure({
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      onDrop: (currentEditor, files, position) => {
        void insertImageFiles(currentEditor, files, attachmentTarget, position);
      },
      onPaste: (currentEditor, files) => {
        void insertImageFiles(currentEditor, files, attachmentTarget);
      },
    }),
    Markdown.configure({
      indentation: {
        size: 2,
        style: 'space',
      },
    }),
  ];
}

function syncRichEditorEmptyState(editor: Editor | null | undefined) {
  if (!editor || editor.isDestroyed) {
    return;
  }

  editor.view.dom.setAttribute('data-empty', editor.isEmpty ? 'true' : 'false');
}

export type MarkdownEditorProps = {
  ariaLabel: string;
  attachmentTarget?: AttachmentTarget;
  conflictLabel: string;
  fontFamily?: string;
  fontSize?: string;
  maxImageHeight?: string;
  markdown: string;
  mode?: MarkdownEditorMode;
  onDraftChange?: (markdown: string) => void;
  onOpenImage?: (src: string) => void;
  onModeChange?: (mode: MarkdownEditorMode) => void;
  onTocHiddenChange?: (hidden: boolean) => void;
  onTocWidthChange?: (width: number) => void;
  onSave: SaveMarkdown;
  placeholder?: string;
  saveStatusLabels?: {
    clean: string;
    dirty: string;
  };
  scrollKey?: string;
  tocHidden?: boolean;
  tocWidth?: number;
};

export function MarkdownEditor({
  ariaLabel,
  attachmentTarget,
  conflictLabel,
  fontFamily = DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY,
  fontSize = DEFAULT_MARKDOWN_EDITOR_FONT_SIZE,
  maxImageHeight = 'none',
  markdown,
  mode: modeProp,
  onDraftChange,
  onOpenImage,
  onModeChange,
  onTocHiddenChange,
  onTocWidthChange,
  onSave,
  placeholder = 'Type description here',
  saveStatusLabels = { clean: 'Saved', dirty: 'Saving...' },
  scrollKey,
  tocHidden: tocHiddenProp,
  tocWidth: tocWidthProp,
}: MarkdownEditorProps) {
  useSlowdownRenderProbe('markdown-editor', ariaLabel);
  const [uncontrolledMode, setUncontrolledMode] = useState<MarkdownEditorMode>(
    modeProp ?? 'rich',
  );
  const mode = modeProp ?? uncontrolledMode;
  const [uncontrolledTocHidden, setUncontrolledTocHidden] = useState(tocHiddenProp ?? true);
  const tocHidden = tocHiddenProp ?? uncontrolledTocHidden;
  const [uncontrolledTocWidth, setUncontrolledTocWidth] = useState(
    clampTocWidth(tocWidthProp ?? DEFAULT_TOC_WIDTH),
  );
  const committedTocWidth = clampTocWidth(tocWidthProp ?? uncontrolledTocWidth);
  const [tocDragState, setTocDragState] = useState<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const [tocDragWidth, setTocDragWidth] = useState<number | null>(null);
  const visibleTocWidth = tocDragWidth ?? committedTocWidth;
  const editorTypographyStyle = markdownEditorTypographyStyle(
    fontFamily,
    fontSize,
    maxImageHeight,
  );
  const [draft, setDraft] = useState(markdown);
  const [dirty, setDirty] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDirectory, setExportDirectory] = useState(DOWNLOADS_FALLBACK_LABEL);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);
  const [linkOpenAffordance, setLinkOpenAffordance] =
    useState<LinkOpenAffordance | null>(null);
  const headings = useMemo(() => extractMarkdownHeadings(draft), [draft]);
  const savedRef = useRef(markdown);
  const seenMarkdownRef = useRef(markdown);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  // Rich-mode edits mark this instead of serializing the document per
  // keystroke; the debounce flush (or unmount) serializes once from the editor.
  const pendingRichSerializeRef = useRef<SaveMarkdown | null>(null);
  const localDraftEchoesRef = useRef<string[]>([]);
  const localSaveEchoesRef = useRef<string[]>([]);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hasConflictRef = useRef(hasConflict);
  hasConflictRef.current = hasConflict;
  const panelRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const rawScrollElementRef = useRef<HTMLTextAreaElement | null>(null);
  const richScrollElementRef = useRef<HTMLDivElement | null>(null);
  const attachmentTargetRef = useRef(attachmentTarget);
  attachmentTargetRef.current = attachmentTarget;

  const commitTocWidth = (width: number) => {
    const nextWidth = clampTocWidth(width);
    setUncontrolledTocWidth(nextWidth);
    onTocWidthChange?.(nextWidth);
  };

  const updateActiveHeadingFromRichScroll = (scrollElement: HTMLElement) => {
    const panel = scrollElement.closest('.description-panel');
    const headingElements = Array.from(
      panel?.querySelectorAll<HTMLElement>('.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3') ?? [],
    );
    setActiveHeadingIndex(activeHeadingIndexFromVisibleHeadings(scrollElement, headingElements));
  };

  const cancelPendingSave = () => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    pendingRichSerializeRef.current = null;
  };

  const commitSave = (value: string, save: SaveMarkdown = onSaveRef.current) => {
    cancelPendingSave();
    rememberLocalEcho(value, localSaveEchoesRef.current);
    savedRef.current = value;
    setDirty(false);
    save(value);
  };

  const scheduleSave = (value: string) => {
    setLinkOpenAffordance(null);
    setDraft(value);
    if (onDraftChangeRef.current) {
      rememberLocalEcho(value, localDraftEchoesRef.current);
    }
    onDraftChangeRef.current?.(value);
    setDirty(true);
    pendingSaveRef.current = { save: onSaveRef.current, value };
    pendingRichSerializeRef.current = null;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending !== null) {
        commitSave(pending.value, pending.save);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  // Rich-mode fast path: serializing the whole document with getMarkdown() and
  // mirroring it into React state on every keystroke caused measurable render
  // storms. Mark the edit dirty, and serialize once when the debounce settles.
  const scheduleDeferredRichSave = () => {
    setLinkOpenAffordance(null);
    setDirty(true);
    pendingRichSerializeRef.current = onSaveRef.current;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushDeferredRichSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const flushDeferredRichSave = () => {
    const save = pendingRichSerializeRef.current;
    if (!save) {
      return;
    }
    pendingRichSerializeRef.current = null;
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) {
      return;
    }
    const value = currentEditor.getMarkdown();
    setDraft(value);
    commitSave(value, save);
  };

  const editor = useEditor({
    content: normalizeMarkdownForEditor(markdown),
    contentType: 'markdown',
    editorProps: {
      attributes: {
        'data-placeholder': placeholder,
      },
      transformPastedHTML: normalizeJiraPastedHtml,
      // WKWebView (Tauri) often delivers pasted images via clipboardData.items
      // with an empty clipboardData.files, so Tiptap's FileHandler onPaste never
      // fires. Read images from items here and take precedence over FileHandler.
      handlePaste: (_view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor) {
          return false;
        }
        const html = event.clipboardData?.getData('text/html') ?? '';
        const htmlWithSavedImages = html
          ? saveInlineDataImagesInPastedHtml(html, attachmentTargetRef.current)
          : null;
        if (htmlWithSavedImages) {
          event.preventDefault();
          void htmlWithSavedImages
            .then((nextHtml) => {
              if (currentEditor.isDestroyed || !currentEditor.isEditable) {
                return;
              }
              currentEditor.chain().focus().insertContent(nextHtml).run();
            })
            .catch(() => undefined);
          return true;
        }

        const files = imageFilesFromClipboard(event.clipboardData);
        if (files.length === 0) {
          return false;
        }
        event.preventDefault();
        void insertImageFiles(currentEditor, files, attachmentTargetRef.current);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (!isPlainTextPasteShortcut(event)) {
          return false;
        }

        const readText = clipboardTextReader();
        if (!readText) {
          return false;
        }

        event.preventDefault();
        void readText()
          .then((text) => {
            const currentEditor = editorRef.current;
            if (!text || !currentEditor || hasConflictRef.current || !currentEditor.isEditable) {
              return;
            }
            insertPlainTextIntoRichEditor(currentEditor, text);
          })
          .catch(() => undefined);
        return true;
      },
    },
    extensions: createMarkdownExtensions({ attachmentTarget }),
    onCreate: ({ editor: currentEditor }) => {
      syncRichEditorEmptyState(currentEditor);
    },
    onUpdate: ({ editor: currentEditor }) => {
      syncRichEditorEmptyState(currentEditor);
      // In raw mode the textarea is the source of truth; ignore the hidden
      // rich editor's transactions (including its async initialization).
      if (modeRef.current !== 'rich') {
        return;
      }
      // Form-embedded editors (onDraftChange) need the live value per edit;
      // standalone autosave surfaces defer serialization to the flush.
      if (onDraftChangeRef.current) {
        scheduleSave(currentEditor.getMarkdown());
        return;
      }
      scheduleDeferredRichSave();
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (markdown === seenMarkdownRef.current) {
      return;
    }
    seenMarkdownRef.current = markdown;

    // Forms can feed onDraftChange straight back into the markdown prop before
    // there is any durable save. That is a local draft echo, not an outside edit.
    if (consumeLocalEcho(markdown, localDraftEchoesRef.current)) {
      setHasConflict(false);
      return;
    }

    // A save from this editor can echo back after newer local edits/saves. Do not
    // drive the editor content from those round-trips or the caret jumps backward.
    if (consumeLocalEcho(markdown, localSaveEchoesRef.current)) {
      if (markdown === savedRef.current) {
        setHasConflict(false);
      }
      return;
    }

    // Our own latest save echoing back through the snapshot round-trip: confirm, don't conflict.
    if (markdown === savedRef.current) {
      setHasConflict(false);
      return;
    }

    // Genuine external change. Adopt it live when there is nothing unsaved to lose;
    // otherwise lock the editor until the user resolves the conflict explicitly.
    if (dirty) {
      cancelPendingSave();
      setHasConflict(true);
      return;
    }

    savedRef.current = markdown;
    setDraft(markdown);
    editor?.commands.setContent(normalizeMarkdownForEditor(markdown), {
      contentType: 'markdown',
      emitUpdate: false,
    });
    syncRichEditorEmptyState(editor);
    setHasConflict(false);
  }, [dirty, editor, markdown]);

  useEffect(() => {
    if (editor && editor.isEditable === hasConflict) {
      editor.setEditable(!hasConflict);
    }
  }, [editor, hasConflict]);

  useLayoutEffect(() => {
    if (!scrollKey) {
      return;
    }

    const element =
      mode === 'raw' ? rawScrollElementRef.current : richScrollElementRef.current;
    const rememberedScrollTop = rememberedScrollPositions.get(scrollKey);
    if (element && rememberedScrollTop !== undefined) {
      element.scrollTop = rememberedScrollTop;
    }
  }, [editor, mode, scrollKey]);

  useEffect(() => {
    if (!scrollKey) {
      return undefined;
    }

    return () => {
      const element =
        mode === 'raw' ? rawScrollElementRef.current : richScrollElementRef.current;
      if (element) {
        rememberedScrollPositions.set(scrollKey, element.scrollTop);
      }
    };
  }, [mode, scrollKey]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    let pending = pendingSaveRef.current;
    const pendingRichSave = pendingRichSerializeRef.current;
    if (pendingRichSave) {
      pendingRichSerializeRef.current = null;
      const currentEditor = editorRef.current;
      if (currentEditor && !currentEditor.isDestroyed) {
        pending = { save: pendingRichSave, value: currentEditor.getMarkdown() };
      }
    }
    if (pending !== null) {
      pendingSaveRef.current = null;
      rememberLocalEcho(pending.value, localSaveEchoesRef.current);
      pending.save(pending.value);
    }
  }, []);

  useEffect(() => {
    if (cachedHomeDirectory || !editor) {
      return;
    }

    let cancelled = false;
    void homeDir()
      .then((directory) => {
        if (cancelled) {
          return;
        }
        cachedHomeDirectory = directory.replace(/\/$/, '');
        forceEditorImageRerender(editor);
      })
      .catch(() => {
        // Browser preview and tests do not have Tauri path APIs available.
      });

    return () => {
      cancelled = true;
    };
  }, [editor]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listenForDroppedPathsWhenFocused(panel, (paths) => {
      if (hasConflictRef.current) {
        return;
      }

      insertDroppedPathText(paths.join('\n'));
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten?.();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!exportDialogOpen) {
      return undefined;
    }

    let cancelled = false;
    void downloadDir()
      .then((directory) => {
        if (!cancelled) {
          setExportDirectory(directory.replace(/\/$/, ''));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExportDirectory(DOWNLOADS_FALLBACK_LABEL);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [exportDialogOpen]);

  const reloadFromSnapshot = () => {
    cancelPendingSave();
    savedRef.current = markdown;
    seenMarkdownRef.current = markdown;
    setDraft(markdown);
    editor?.commands.setContent(normalizeMarkdownForEditor(markdown), {
      contentType: 'markdown',
      emitUpdate: false,
    });
    syncRichEditorEmptyState(editor);
    setDirty(false);
    setHasConflict(false);
  };

  const overwriteRemote = () => {
    const nextMarkdown = mode === 'rich' && editor ? editor.getMarkdown() : draft;
    setHasConflict(false);
    commitSave(nextMarkdown);
  };

  const switchMode = (nextMode: MarkdownEditorMode) => {
    if (mode === nextMode) {
      return;
    }

    if (nextMode === 'rich') {
      editor?.commands.setContent(normalizeMarkdownForEditor(draft), {
        contentType: 'markdown',
        emitUpdate: false,
      });
      syncRichEditorEmptyState(editor);
    } else if (editor) {
      const nextDraft = editor.getMarkdown();
      setDraft(nextDraft);
      if (onDraftChangeRef.current) {
        rememberLocalEcho(nextDraft, localDraftEchoesRef.current);
      }
      onDraftChangeRef.current?.(nextDraft);
    }

    setUncontrolledMode(nextMode);
    onModeChange?.(nextMode);
  };

  const exportPdf = () => {
    const html =
      mode === 'rich' && editor ? editor.getHTML() : markdownToExportHtml(draft);
    setExportDialogOpen(false);
    printMarkdownAsPdf({
      html,
      title: exportTitleFromAriaLabel(ariaLabel),
    });
  };

  const toggleToc = () => {
    const nextHidden = !tocHidden;
    setUncontrolledTocHidden(nextHidden);
    onTocHiddenChange?.(nextHidden);
  };

  useEffect(() => {
    if (!tocDragState) {
      setTocDragWidth(null);
      return;
    }

    const resize = (clientX: number) =>
      clampTocWidth(tocDragState.startWidth + clientX - tocDragState.startX);

    const handlePointerMove = (event: PointerEvent) => {
      setTocDragWidth(resize(event.clientX));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const nextWidth = resize(event.clientX);
      setTocDragWidth(nextWidth);
      setTocDragState(null);
      commitTocWidth(nextWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [tocDragState]);

  const applyLink = () => {
    if (!editor || mode === 'raw') {
      return;
    }

    const currentHref = String(editor.getAttributes('link').href ?? '');
    const nextHref = window.prompt('Link URL', currentHref || 'https://');
    if (nextHref === null) {
      return;
    }

    const href = nextHref.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  const showLinkOpenAffordance = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    const link = target instanceof HTMLElement ? target.closest('a[href]') : null;

    if (!(link instanceof HTMLAnchorElement) || !event.currentTarget.contains(link)) {
      setLinkOpenAffordance(null);
      return;
    }

    event.preventDefault();
    setLinkOpenAffordance(linkOpenAffordanceFromElement(link, event.currentTarget));
  };

  const openLinkAffordanceTarget = () => {
    if (!linkOpenAffordance) {
      return;
    }

    const href = linkOpenAffordance.href;
    setLinkOpenAffordance(null);
    void openPathOrUrl({ target: href });
  };

  const openImageFromDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onOpenImage) {
      return;
    }

    const target = event.target;
    const image = target instanceof HTMLElement ? target.closest('img') : null;
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    const src = image.currentSrc || image.getAttribute('src') || image.src;
    if (!src) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpenImage(src);
  };

  const pastePlainTextIntoRawEditor = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!isPlainTextPasteShortcut(event.nativeEvent)) {
      return;
    }

    const readText = clipboardTextReader();
    if (!readText) {
      return;
    }

    event.preventDefault();
    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;

    void readText()
      .then((text) => {
        if (!text || hasConflictRef.current) {
          return;
        }

        const nextDraft = `${textarea.value.slice(0, selectionStart)}${text}${textarea.value.slice(selectionEnd)}`;
        scheduleSave(nextDraft);
        requestAnimationFrame(() => {
          textarea.setSelectionRange(
            selectionStart + text.length,
            selectionStart + text.length,
          );
        });
      })
      .catch(() => undefined);
  };

  // OS file drops arrive as paths through the Tauri drop listener; this only
  // sees non-file image drops (e.g. an image dragged out of a browser), which
  // have no path to paste and are saved into the attachment directory instead.
  const saveDroppedImageFilesIntoRawEditor = async (files: File[]) => {
    const attachmentTarget = attachmentTargetRef.current;
    if (!attachmentTarget || hasConflictRef.current) {
      return;
    }

    const sources: string[] = [];
    for (const file of files) {
      try {
        sources.push(await saveImageFile(file, attachmentTarget));
      } catch {
        // An image that fails to save has nothing insertable; skip it.
      }
    }

    if (sources.length) {
      insertDroppedPathText(
        sources.map((src) => `![](${markdownDestination(src)})`).join('\n'),
      );
    }
  };

  const insertDroppedPathText = (text: string) => {
    if (!text) {
      return;
    }

    if (modeRef.current === 'raw') {
      const textarea = rawScrollElementRef.current;
      if (!textarea) {
        return;
      }

      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const nextDraft = `${textarea.value.slice(0, selectionStart)}${text}${textarea.value.slice(selectionEnd)}`;
      scheduleSave(nextDraft);
      requestAnimationFrame(() => {
        textarea.setSelectionRange(selectionStart + text.length, selectionStart + text.length);
      });
      return;
    }

    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed || !currentEditor.isEditable) {
      return;
    }

    insertPlainTextIntoRichEditor(currentEditor, text);
  };

  return (
    <section className="description-panel" ref={panelRef}>
      <div className="editor-toolbar">
        <button
          aria-label="Toggle table of contents"
          aria-pressed={!tocHidden}
          className={`editor-toc-button ${tocHidden ? '' : 'active'}`}
          onClick={toggleToc}
          type="button"
        >
          TOC
        </button>
        <div className="editor-mode-toggle">
          <button
            aria-label="Rich"
            className={mode === 'rich' ? 'active' : ''}
            onClick={() => switchMode('rich')}
            title="Rich"
            type="button"
          >
            <Croissant aria-hidden="true" size={15} />
          </button>
          <button
            aria-label="Raw"
            className={mode === 'raw' ? 'active' : ''}
            onClick={() => switchMode('raw')}
            title="Raw"
            type="button"
          >
            <Wheat aria-hidden="true" size={15} />
          </button>
        </div>
        <button
          aria-label="Export"
          className="editor-export-button"
          onClick={() => setExportDialogOpen(true)}
          title="Export"
          type="button"
        >
          <Package aria-hidden="true" size={15} />
        </button>
        <div className="editor-format-actions">
          <button
            aria-label="Bold"
            className={editor?.isActive('bold') ? 'active' : ''}
            disabled={!editor || mode === 'raw'}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            type="button"
          >
            B
          </button>
          <button
            aria-label="Heading 1"
            className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}
            disabled={!editor || mode === 'raw'}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            type="button"
          >
            H1
          </button>
          <button
            aria-label="Bullet list"
            className={editor?.isActive('bulletList') ? 'active' : ''}
            disabled={!editor || mode === 'raw'}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            type="button"
          >
            ≡
          </button>
          <button
            aria-label="Task list"
            className={editor?.isActive('taskList') ? 'active' : ''}
            disabled={!editor || mode === 'raw'}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            type="button"
          >
            ☑
          </button>
          <button
            aria-label="Code block"
            className={editor?.isActive('codeBlock') ? 'active' : ''}
            disabled={!editor || mode === 'raw'}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            type="button"
          >
            &lt;&gt;
          </button>
          <button
            aria-label="Link"
            className={editor?.isActive('link') ? 'active' : ''}
            disabled={!editor || mode === 'raw'}
            onClick={applyLink}
            type="button"
          >
            <Link2 aria-hidden="true" size={14} />
          </button>
        </div>
        <div className="editor-actions">
          {hasConflict ? (
            <>
              <button onClick={overwriteRemote} type="button">
                Overwrite
              </button>
              <button onClick={reloadFromSnapshot} type="button">
                Reload
              </button>
            </>
          ) : (
            <span className="editor-save-status">
              {dirty ? saveStatusLabels.dirty : saveStatusLabels.clean}
            </span>
          )}
        </div>
      </div>
      {hasConflict ? <div className="conflict-banner">{conflictLabel}</div> : null}
      <div
        className={`editor-body ${tocHidden ? 'toc-hidden' : ''}`}
        style={
          tocHidden
            ? undefined
            : ({
                gridTemplateColumns: `${visibleTocWidth}px 8px minmax(0, 1fr)`,
              } as CSSProperties)
        }
      >
        {tocHidden ? null : (
          <nav>
            <div className="contents-header">
              <span>Contents</span>
            </div>
            {headings.length > 0 ? (
              headings.map((heading, index) => (
                <a
                  className={index === activeHeadingIndex ? 'active' : ''}
                  href={`#${heading.id}`}
                  key={heading.id}
                  onClick={(event) => {
                    setActiveHeadingIndex(index);
                    scrollToHeading(event, index);
                  }}
                >
                  {heading.text}
                </a>
              ))
            ) : (
              <small>No headings</small>
            )}
          </nav>
        )}
        {tocHidden ? null : (
          <div
            aria-label="Resize table of contents"
            aria-orientation="vertical"
            aria-valuemax={MAX_TOC_WIDTH}
            aria-valuemin={MIN_TOC_WIDTH}
            aria-valuenow={visibleTocWidth}
            className="editor-toc-resize-handle"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
              }
              event.preventDefault();
              const delta =
                (event.key === 'ArrowRight' ? 1 : -1) *
                (event.shiftKey ? TOC_WIDTH_KEYBOARD_STEP * 2 : TOC_WIDTH_KEYBOARD_STEP);
              commitTocWidth(committedTocWidth + delta);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setTocDragWidth(committedTocWidth);
              setTocDragState({
                startWidth: committedTocWidth,
                startX: event.clientX,
              });
            }}
            role="separator"
            tabIndex={0}
          />
        )}
        {mode === 'raw' ? (
          <textarea
            aria-label={ariaLabel}
            className="markdown-textarea"
            disabled={hasConflict}
            onChange={(event) => {
              scheduleSave(event.target.value);
            }}
            onKeyDown={pastePlainTextIntoRawEditor}
            onDragOver={(event) => {
              if (dragHasImageFiles(event.dataTransfer)) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              const files = imageFilesFromClipboard(event.dataTransfer);
              if (!files.length) {
                return;
              }

              event.preventDefault();
              void saveDroppedImageFilesIntoRawEditor(files);
            }}
            placeholder={placeholder}
            onScroll={(event) => {
              if (scrollKey) {
                rememberedScrollPositions.set(scrollKey, event.currentTarget.scrollTop);
              }
            }}
            ref={rawScrollElementRef}
            style={editorTypographyStyle}
            value={draft}
          />
        ) : (
          <div
            className="tiptap-editor-wrap"
            onClick={showLinkOpenAffordance}
            onDoubleClick={openImageFromDoubleClick}
            onMouseDown={(event) => {
              // Clicking the empty padding around the editor should still place the
              // caret inside it, so an empty document reads as editable.
              if (event.target === event.currentTarget && editor && !hasConflict) {
                event.preventDefault();
                editor.view.dom.focus();
                editor.commands.focus('end');
              }
            }}
            onScroll={(event) => {
              if (scrollKey) {
                rememberedScrollPositions.set(scrollKey, event.currentTarget.scrollTop);
              }
              // Querying and measuring every heading per scroll only pays off
              // when the contents list is actually visible.
              if (!tocHidden) {
                updateActiveHeadingFromRichScroll(event.currentTarget);
              }
            }}
            ref={richScrollElementRef}
            style={editorTypographyStyle}
          >
            {editor ? <EditorContent className="tiptap-editor" editor={editor} /> : null}
            {linkOpenAffordance ? (
              <button
                aria-label={`Open link ${linkOpenAffordance.label}`}
                className="markdown-link-open-button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openLinkAffordanceTarget();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                style={{
                  left: linkOpenAffordance.left,
                  top: linkOpenAffordance.top,
                }}
                title={linkOpenAffordance.href}
                type="button"
              >
                <ExternalLink aria-hidden="true" size={13} />
              </button>
            ) : null}
          </div>
        )}
      </div>
      {exportDialogOpen ? (
        <MarkdownExportDialog
          exportDirectory={exportDirectory}
          onCancel={() => setExportDialogOpen(false)}
          onExportPdf={exportPdf}
        />
      ) : null}
    </section>
  );
}

export function markdownEditorTypographyStyle(
  fontFamily: string,
  fontSize: string,
  maxImageHeight = 'none',
): CSSProperties {
  return {
    '--markdown-editor-font-family': validMarkdownEditorFontFamily(fontFamily),
    '--markdown-editor-font-size': validMarkdownEditorFontSize(fontSize),
    '--markdown-editor-max-image-height': maxImageHeight.trim() || 'none',
  } as CSSProperties;
}

const DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY = 'sans-serif';
const DEFAULT_MARKDOWN_EDITOR_FONT_SIZE = '12px';

function validMarkdownEditorFontFamily(fontFamily: string): string {
  const value = fontFamily.trim();
  if (!value) {
    return DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY;
  }
  if (typeof document === 'undefined') {
    return value;
  }

  const probe = document.createElement('span');
  probe.style.fontFamily = value;
  return probe.style.fontFamily ? value : DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY;
}

function validMarkdownEditorFontSize(fontSize: string): string {
  const value = fontSize.trim();
  if (!value) {
    return DEFAULT_MARKDOWN_EDITOR_FONT_SIZE;
  }
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    return `${value}px`;
  }

  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    if (CSS.supports('font-size', value)) {
      return value;
    }
    if (CSS.supports('font-size', 'clamp(12px, 2vw, 16px)')) {
      return DEFAULT_MARKDOWN_EDITOR_FONT_SIZE;
    }
  }
  if (/^(?:calc|clamp|min|max|var)\(.+\)$/i.test(value)) {
    return value;
  }
  if (typeof document === 'undefined') {
    return value;
  }

  const probe = document.createElement('span');
  probe.style.fontSize = value;
  return probe.style.fontSize ? value : DEFAULT_MARKDOWN_EDITOR_FONT_SIZE;
}

function MarkdownExportDialog({
  exportDirectory,
  onCancel,
  onExportPdf,
}: {
  exportDirectory: string;
  onCancel: () => void;
  onExportPdf: () => void;
}) {
  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="markdown-export-dialog-title"
        aria-modal="true"
        className="markdown-export-dialog"
        onCancel={onCancel}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="markdown-export-dialog-title">Export Markdown</h2>
            <p>Choose an export format.</p>
          </div>
          <AppButton aria-label="Close export dialog" onClick={onCancel} variant="icon">
            <X size={16} />
          </AppButton>
        </header>
        <div className="dialog-form">
          <div className="markdown-export-option">
            <span>PDF</span>
          </div>
          <div className="form-field">
            <span>Location</span>
            <code className="markdown-export-location">{exportDirectory}</code>
          </div>
          <footer className="dialog-actions">
            <AppButton onClick={onCancel} variant="secondary">
              Cancel
            </AppButton>
            <AppButton onClick={onExportPdf} variant="primary">
              Export PDF
            </AppButton>
          </footer>
        </div>
      </DialogPanel>
    </DialogBackdrop>
  );
}

export function markdownToExportHtml(markdown: string): string {
  const exportEditor = new Editor({
    content: normalizeMarkdownForEditor(markdown),
    contentType: 'markdown',
    extensions: createMarkdownExtensions(),
  });
  const html = exportEditor.getHTML();
  exportEditor.destroy();
  return html;
}

export function printMarkdownAsPdf({ html, title }: { html: string; title: string }) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'markdown-print-frame';
  document.body.appendChild(frame);

  const printDocument = frame.contentDocument;
  const printWindow = frame.contentWindow;
  if (!printDocument || !printWindow) {
    frame.remove();
    window.print();
    return;
  }

  printDocument.open();
  printDocument.write(markdownPrintDocument(title));
  printDocument.close();
  const content = printDocument.getElementById('markdown-export-content');
  if (content) {
    content.innerHTML = html;
  }

  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 0);
}

function markdownPrintDocument(title: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    `<title>${escapeHtml(title)}</title>`,
    '<meta charset="utf-8">',
    '<style>',
    'body{background:Canvas;color:CanvasText;font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:40px;}',
    'main{max-width:760px;}',
    'h1{font-size:28px;line-height:1.25;margin:0 0 18px;}',
    'h2{font-size:22px;line-height:1.3;margin:24px 0 12px;}',
    'h3{font-size:18px;line-height:1.35;margin:20px 0 8px;}',
    'pre{background:Canvas;border:1px solid ButtonBorder;border-radius:8px;overflow:auto;padding:12px;}',
    'code{font-family:"SFMono-Regular",Consolas,monospace;}',
    'img{height:auto;max-width:100%;}',
    'table{border-collapse:collapse;width:100%;}',
    'td,th{border:1px solid ButtonBorder;padding:6px 8px;text-align:left;}',
    '@page{margin:18mm;}',
    '</style>',
    '</head>',
    '<body>',
    '<main id="markdown-export-content"></main>',
    '</body>',
    '</html>',
  ].join('');
}

function exportTitleFromAriaLabel(ariaLabel: string): string {
  return ariaLabel.replace(/\s*Markdown\s*$/i, '').trim() || 'Markdown Export';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function MarkdownCodeBlockView({ node }: ReactNodeViewProps) {
  const language = String(node.attrs.language ?? '').trim().toLowerCase();
  const className = language ? `language-${language}` : undefined;

  if (language !== 'mermaid') {
    return (
      <NodeViewWrapper as="pre">
        <NodeViewContent<'code'> as="code" className={className} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="mermaid-code-block" data-language="mermaid">
      <MermaidDiagram source={node.textContent} />
      <details className="mermaid-source">
        <summary>Mermaid source</summary>
        <pre>
          <NodeViewContent<'code'> as="code" className="mermaid-source-code" />
        </pre>
      </details>
    </NodeViewWrapper>
  );
}

type MermaidDiagramState =
  | { status: 'empty' | 'rendering' }
  | { bindFunctions?: RenderResult['bindFunctions']; status: 'rendered'; svg: string }
  | { message: string; status: 'error' };

function MermaidDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const diagramIdRef = useRef(nextMermaidDiagramId());
  const [state, setState] = useState<MermaidDiagramState>({ status: 'rendering' });

  useEffect(() => {
    const graphDefinition = source.trim();
    if (!graphDefinition) {
      setState({ status: 'empty' });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'rendering' });

    const config = mermaidConfigFromElement(containerRef.current);
    void renderMermaidDiagram(diagramIdRef.current, graphDefinition, config)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setState({
          bindFunctions: result.bindFunctions,
          status: 'rendered',
          svg: result.svg,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({ message: mermaidErrorMessage(error), status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  useLayoutEffect(() => {
    if (state.status !== 'rendered' || !state.bindFunctions || !containerRef.current) {
      return;
    }

    state.bindFunctions(containerRef.current);
  }, [state]);

  return (
    <div aria-label="Mermaid diagram" className="mermaid-diagram">
      {state.status === 'rendering' ? (
        <span className="mermaid-diagram-status">Rendering Mermaid diagram...</span>
      ) : null}
      {state.status === 'empty' ? (
        <span className="mermaid-diagram-status">Empty Mermaid diagram</span>
      ) : null}
      {state.status === 'error' ? (
        <div className="mermaid-diagram-error" role="alert">
          <strong>Unable to render Mermaid diagram</strong>
          <span>{state.message}</span>
        </div>
      ) : null}
      <div
        className="mermaid-diagram-svg"
        dangerouslySetInnerHTML={state.status === 'rendered' ? { __html: state.svg } : undefined}
        ref={containerRef}
      />
    </div>
  );
}

export async function renderMermaidDiagram(
  id: string,
  source: string,
  config: MermaidConfig,
): Promise<RenderResult> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize(config);
  return mermaid.render(id, source);
}

function nextMermaidDiagramId(): string {
  mermaidDiagramSequence += 1;
  return `boomerang-mermaid-${mermaidDiagramSequence}`;
}

function mermaidConfigFromElement(element: HTMLElement | null): MermaidConfig {
  const themeElement = element?.closest<HTMLElement>('.app-shell') ?? document.documentElement;
  const styles = window.getComputedStyle(themeElement);
  const text = cssVariable(styles, '--color-text', '#2d2118');
  const textStrong = cssVariable(styles, '--color-text-strong', '#241a12');
  const surface = cssVariable(styles, '--color-surface', '#fffdf8');
  const surfaceWarm = cssVariable(styles, '--color-surface-warm', '#fff8ec');
  const selected = cssVariable(styles, '--color-selected', '#f6e3c4');
  const border = cssVariable(styles, '--color-border', '#d7c6ae');
  const primary = cssVariable(styles, '--color-primary', '#a96334');
  const danger = cssVariable(styles, '--color-danger', '#b9463a');
  const fontFamily = cssVariable(
    styles,
    '--font-sans',
    window.getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif',
  );

  return {
    fontFamily,
    securityLevel: 'strict',
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: {
      background: surface,
      clusterBkg: surfaceWarm,
      clusterBorder: border,
      errorBkgColor: surfaceWarm,
      errorTextColor: danger,
      fontFamily,
      lineColor: primary,
      mainBkg: surface,
      nodeBorder: border,
      noteBkgColor: selected,
      noteTextColor: textStrong,
      primaryBorderColor: border,
      primaryColor: surfaceWarm,
      primaryTextColor: textStrong,
      secondaryBorderColor: border,
      secondaryColor: selected,
      secondaryTextColor: text,
      tertiaryBorderColor: border,
      tertiaryColor: surface,
      tertiaryTextColor: text,
    },
  };
}

function cssVariable(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function mermaidErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error || 'Unknown Mermaid render error');
}

function dragHasImageFiles(data: DataTransfer | null): boolean {
  if (!data) {
    return false;
  }

  return Array.from(data.items).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
}

function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }

  const files: File[] = [];
  // clipboardData.files is unreliable in WKWebView; items is the durable source.
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  if (files.length > 0) {
    return files;
  }

  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

function isPlainTextPasteShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
): boolean {
  return (
    event.shiftKey &&
    !event.altKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'v'
  );
}

function clipboardTextReader(): (() => Promise<string>) | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  const readText = navigator.clipboard?.readText;
  return typeof readText === 'function' ? () => readText.call(navigator.clipboard) : null;
}

function insertPlainTextIntoRichEditor(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.insertText(text, from, to).scrollIntoView());
  editor.view.focus();
}

async function insertImageFiles(
  editor: Editor,
  files: File[],
  attachmentTarget?: AttachmentTarget,
  position?: number,
) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      continue;
    }

    const src = attachmentTarget
      ? await saveImageFile(file, attachmentTarget)
      : URL.createObjectURL(file);
    if (typeof position === 'number') {
      editor.chain().insertContentAt(position, { type: 'image', attrs: { src } }).run();
      continue;
    }

    editor.chain().focus().setImage({ src }).run();
  }
}

function saveInlineDataImagesInPastedHtml(
  html: string,
  attachmentTarget?: AttachmentTarget,
): Promise<string> | null {
  const normalizedHtml = normalizeJiraPastedHtml(html);
  const documentForParsing = document.implementation.createHTMLDocument('pasted-html');
  const root = documentForParsing.createElement('div');
  root.innerHTML = normalizedHtml;
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src^="data:image/"]'));
  if (images.length === 0) {
    return null;
  }

  return Promise.all(
    images.map(async (image, index) => {
      const file = fileFromDataImageSrc(
        image.getAttribute('src') ?? '',
        pastedImageFileName(image, index),
      );
      if (!file) {
        return;
      }

      const src = attachmentTarget
        ? await saveImageFile(file, attachmentTarget)
        : URL.createObjectURL(file);
      image.setAttribute('src', src);
    }),
  ).then(() => root.innerHTML);
}

async function saveImageFile(
  file: File,
  attachmentTarget: AttachmentTarget,
): Promise<string> {
  const base64Data = await fileToBase64(file);
  const saved = await saveEditorImage({
    ...attachmentTarget,
    base64Data,
    fileName: file.name || 'pasted-image',
    mimeType: file.type,
  });

  return saved.markdownPath;
}

function fileFromDataImageSrc(src: string, fileName: string): File | null {
  const match = src.match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  if (!isSupportedPastedImageMime(mimeType)) {
    return null;
  }

  const isBase64 = Boolean(match[2]);
  const data = match[3].trim();
  try {
    const bytes = isBase64 ? base64ToBytes(data) : uriDataToBytes(data);
    if (bytes.length === 0) {
      return null;
    }
    return new File([bytesToArrayBuffer(bytes)], ensureImageFileExtension(fileName, mimeType), {
      type: mimeType,
    });
  } catch {
    return null;
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function uriDataToBytes(value: string): Uint8Array {
  const binary = decodeURIComponent(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pastedImageFileName(image: HTMLImageElement, index: number): string {
  const label =
    image.getAttribute('data-filename') ||
    image.getAttribute('alt') ||
    image.getAttribute('title') ||
    `jira-image-${index + 1}`;
  const name = label.split(/[\\/]/).pop()?.trim() || `jira-image-${index + 1}`;
  return name.replace(/[^\w .-]+/g, '-');
}

function ensureImageFileExtension(fileName: string, mimeType: string): string {
  if (/\.(png|jpe?g|gif|webp)$/i.test(fileName)) {
    return fileName;
  }

  const extension = mimeType === 'image/jpeg' || mimeType === 'image/jpg'
    ? 'jpg'
    : mimeType.split('/')[1] || 'png';
  return `${fileName}.${extension}`;
}

function isSupportedPastedImageMime(mimeType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(
    mimeType,
  );
}

export function resolveMarkdownImageSrc(
  src: string,
  homeDirectory: string | null = cachedHomeDirectory,
  convert: (path: string) => string = convertFileSrc,
): string {
  const value = src.trim();
  if (!value || /^(https?:|data:|blob:|asset:|tauri:)/i.test(value)) {
    return src;
  }

  const absolutePath = value.startsWith('~/')
    ? homeDirectory
      ? `${homeDirectory.replace(/\/$/, '')}/${value.slice(2)}`
      : null
    : isAbsoluteFilePath(value)
      ? value
      : null;
  if (!absolutePath) {
    return src;
  }

  try {
    return convert(absolutePath);
  } catch {
    return src;
  }
}

export function forceEditorImageRerender(editor: Editor) {
  const normalized = normalizeMarkdownForEditor(editor.getMarkdown());
  editor.commands.setContent('', { contentType: 'markdown', emitUpdate: false });
  editor.commands.setContent(normalized, { contentType: 'markdown', emitUpdate: false });
}

export function normalizeMarkdownForEditor(markdown: string): string {
  return escapeAlphabeticOrderedListMarkers(markdown).replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (_match, opening, target, closing) => {
      const normalizedTarget = normalizeMarkdownLinkTarget(target);
      return `${opening}${normalizedTarget}${closing}`;
    },
  );
}

function escapeAlphabeticOrderedListMarkers(markdown: string): string {
  let fence: { char: string; length: number } | null = null;

  return markdown
    .split('\n')
    .map((line) => {
      const fenceMatch = line.match(/^(?: {0,3}>[ \t]*)* {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (fence && marker[0] === fence.char && marker.length >= fence.length) {
          fence = null;
        } else if (!fence) {
          fence = { char: marker[0], length: marker.length };
        }
        return line;
      }

      if (fence) {
        return line;
      }

      return line.replace(
        /^((?: {0,3}>[ \t]*)* {0,3})([A-Za-z]+)([.)])([ \t]+)/,
        '$1$2\\$3$4',
      );
    })
    .join('\n');
}

export function normalizeJiraPastedHtml(html: string): string {
  if (!html || !/<input\b[^>]*\btype=["']?checkbox/i.test(html)) {
    return html;
  }

  const documentForParsing = document.implementation.createHTMLDocument('jira-paste');
  const root = documentForParsing.createElement('div');
  root.innerHTML = html;

  normalizeCheckboxListItems(root, documentForParsing);
  normalizeStandaloneCheckboxRows(root, documentForParsing);

  return root.innerHTML;
}

function normalizeCheckboxListItems(root: HTMLElement, ownerDocument: Document): void {
  for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
    const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
    if (items.length === 0 || !items.every((item) => findCheckboxInput(item))) {
      continue;
    }

    const taskList = ownerDocument.createElement('ul');
    taskList.setAttribute('data-type', 'taskList');
    for (const item of items) {
      taskList.appendChild(createTaskItemFromCheckboxRow(item, ownerDocument));
    }
    list.replaceWith(taskList);
  }
}

function normalizeStandaloneCheckboxRows(parent: Element, ownerDocument: Document): void {
  let rows: Element[] = [];

  const flushRows = () => {
    if (rows.length === 0) {
      return;
    }

    const taskList = ownerDocument.createElement('ul');
    taskList.setAttribute('data-type', 'taskList');
    for (const row of rows) {
      taskList.appendChild(createTaskItemFromCheckboxRow(row, ownerDocument));
    }

    rows[0].before(taskList);
    for (const row of rows) {
      row.remove();
    }
    rows = [];
  };

  for (const child of Array.from(parent.children)) {
    if (isStandaloneCheckboxRow(child)) {
      rows.push(child);
      continue;
    }

    flushRows();
    normalizeStandaloneCheckboxRows(child, ownerDocument);
  }

  flushRows();
}

function isStandaloneCheckboxRow(element: Element): boolean {
  if (element.closest('li')) {
    return false;
  }

  const checkbox = findCheckboxInput(element);
  if (!checkbox) {
    return false;
  }

  return nearestCheckboxRow(checkbox) === element;
}

function nearestCheckboxRow(input: HTMLInputElement): Element | null {
  let current = input.parentElement;
  while (current) {
    const tagName = current.tagName.toLowerCase();
    if (tagName === 'li' || tagName === 'p' || tagName === 'div') {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function createTaskItemFromCheckboxRow(row: Element, ownerDocument: Document): HTMLLIElement {
  const clone = row.cloneNode(true) as HTMLElement;
  const checkbox = findCheckboxInput(clone);
  const checked = checkbox ? isCheckedCheckbox(checkbox) : false;
  if (checkbox) {
    removeCheckboxInput(checkbox, clone);
  }
  trimLeadingWhitespace(clone);

  const item = ownerDocument.createElement('li');
  item.setAttribute('data-type', 'taskItem');
  item.setAttribute('data-checked', String(checked));
  appendTaskItemContent(item, clone, ownerDocument);
  return item;
}

function appendTaskItemContent(
  item: HTMLLIElement,
  source: HTMLElement,
  ownerDocument: Document,
): void {
  if (source.tagName.toLowerCase() === 'p' || !hasBlockElementChild(source)) {
    const paragraph = ownerDocument.createElement('p');
    while (source.firstChild) {
      paragraph.appendChild(source.firstChild);
    }
    item.appendChild(paragraph);
    return;
  }

  while (source.firstChild) {
    item.appendChild(source.firstChild);
  }
}

function hasBlockElementChild(element: Element): boolean {
  return Array.from(element.children).some((child) =>
    /^(address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|ol|p|pre|section|table|ul)$/i.test(
      child.tagName,
    ),
  );
}

function findCheckboxInput(element: Element): HTMLInputElement | null {
  return element.querySelector('input[type="checkbox"]');
}

function isCheckedCheckbox(input: HTMLInputElement): boolean {
  return (
    input.checked ||
    input.hasAttribute('checked') ||
    input.getAttribute('aria-checked') === 'true' ||
    input.getAttribute('data-checked') === 'true'
  );
}

function removeCheckboxInput(input: HTMLInputElement, boundary: Element): void {
  let parent = input.parentElement;
  input.remove();

  while (
    parent &&
    parent !== boundary &&
    /^(label|span)$/i.test(parent.tagName) &&
    !parent.textContent?.trim() &&
    parent.children.length === 0
  ) {
    const nextParent = parent.parentElement;
    parent.remove();
    parent = nextParent;
  }
}

function trimLeadingWhitespace(element: Element): void {
  let current = element.firstChild;
  while (current) {
    if (current.nodeType !== Node.TEXT_NODE) {
      break;
    }

    const value = current.textContent ?? '';
    const trimmed = value.replace(/^[\s\u00a0]+/, '');
    if (trimmed) {
      current.textContent = trimmed;
      break;
    }

    const next = current.nextSibling;
    current.remove();
    current = next;
  }
}

function normalizeMarkdownLinkTarget(target: string): string {
  const value = target.trim();
  if (!value || value.startsWith('<') || !/\s/.test(value)) {
    return target;
  }

  const titleMatch = value.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/);
  const destination = titleMatch?.[1] ?? value;
  const title = titleMatch?.[2] ?? '';
  if (destination.startsWith('<') || !/\s/.test(destination)) {
    return target;
  }

  return `<${destination}>${title}`;
}

function markdownDestination(value: string): string {
  return /\s/.test(value) && !value.startsWith('<') ? `<${value}>` : value;
}

function linkOpenAffordanceFromElement(
  link: HTMLAnchorElement,
  scrollContainer: HTMLElement,
): LinkOpenAffordance {
  const linkRect = link.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const href = link.getAttribute('href') || link.href;
  const label = link.textContent?.trim() || href;

  return {
    href,
    label,
    left: Math.max(6, linkRect.right - containerRect.left + scrollContainer.scrollLeft + 6),
    top: Math.max(6, linkRect.top - containerRect.top + scrollContainer.scrollTop),
  };
}

function rememberLocalEcho(value: string, echoes: string[]): void {
  if (!echoes.includes(value)) {
    echoes.push(value);
  }
  while (echoes.length > 10) {
    echoes.shift();
  }
}

function consumeLocalEcho(value: string, echoes: string[]): boolean {
  const index = echoes.indexOf(value);
  if (index === -1) {
    return false;
  }

  echoes.splice(index, 1);
  return true;
}

function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function clampTocWidth(width: number): number {
  return Math.min(MAX_TOC_WIDTH, Math.max(MIN_TOC_WIDTH, Math.round(width)));
}

function extractMarkdownHeadings(markdown: string): Array<{ id: string; text: string }> {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, '').trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `${slugify(text)}-${index}`,
      text,
    }));
}

function activeHeadingIndexFromVisibleHeadings(
  scrollContainer: HTMLElement,
  headings: HTMLElement[],
): number {
  if (headings.length === 0) {
    return 0;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  let latestVisibleIndex = -1;
  let latestAboveIndex = -1;
  headings.forEach((heading, index) => {
    const headingRect = heading.getBoundingClientRect();
    if (headingRect.top <= containerRect.top) {
      latestAboveIndex = index;
    }
    if (headingRect.top <= containerRect.bottom && headingRect.bottom >= containerRect.top) {
      latestVisibleIndex = index;
    }
  });

  if (latestVisibleIndex >= 0) {
    return latestVisibleIndex;
  }
  if (latestAboveIndex >= 0) {
    return latestAboveIndex;
  }
  return 0;
}

function scrollToHeading(event: MouseEvent<HTMLAnchorElement>, index: number): void {
  event.preventDefault();
  const panel = event.currentTarget.closest('.description-panel');
  const headings = panel?.querySelectorAll('.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3');
  headings?.[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}
