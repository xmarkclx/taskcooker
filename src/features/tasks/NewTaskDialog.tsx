import { useForm } from '@tanstack/react-form';
import { X } from 'lucide-react';
import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import {
  MarkdownEditor,
  type AttachmentTarget,
  type MarkdownEditorMode,
} from '../markdown/MarkdownEditor';
import { TaskSelector, type TaskSelectorOption } from './TaskSelector';

export type NewTaskDialogSubmit = {
  title: string;
  descriptionMarkdown?: string;
  parentId?: number | null;
};

type NewTaskDialogProps = {
  attachmentTarget?: AttachmentTarget;
  description: string;
  draftStorageKey?: string;
  initialDescriptionMarkdown?: string;
  initialParentId?: number | null;
  initialTitle?: string;
  markdownEditorMode?: MarkdownEditorMode;
  markdownEditorFontFamily?: string;
  markdownEditorFontSize?: string;
  markdownEditorMaxImageHeight?: string;
  markdownTocHidden?: boolean;
  markdownTocWidth?: number;
  onClose: () => void;
  onMarkdownEditorModeChange?: (mode: MarkdownEditorMode) => void;
  onMarkdownTocHiddenChange?: (hidden: boolean) => void;
  onMarkdownTocWidthChange?: (width: number) => void;
  onOpenImage?: (src: string) => void;
  onParentChange?: (parentId: number | null) => void;
  onSubmit: (value: NewTaskDialogSubmit) => void;
  parentOptions?: TaskSelectorOption[];
  submitLabel?: string;
  title: string;
};

type NewTaskFormValues = {
  title: string;
  descriptionMarkdown: string;
  parentId: number | null;
};

type StoredNewTaskDraft = {
  descriptionMarkdown: string;
  title: string;
};

export function NewTaskDialog({
  attachmentTarget,
  description,
  draftStorageKey,
  initialDescriptionMarkdown = '',
  initialParentId = null,
  initialTitle = '',
  markdownEditorMode,
  markdownEditorFontFamily,
  markdownEditorFontSize,
  markdownEditorMaxImageHeight,
  markdownTocHidden,
  markdownTocWidth,
  onClose,
  onMarkdownEditorModeChange,
  onMarkdownTocHiddenChange,
  onMarkdownTocWidthChange,
  onOpenImage,
  onParentChange,
  onSubmit,
  parentOptions,
  submitLabel = 'Create Task',
  title,
}: NewTaskDialogProps) {
  const showParentSelector = Boolean(parentOptions);
  const initialValues = useMemo(
    () =>
      readNewTaskDialogDraft(draftStorageKey, {
        descriptionMarkdown: initialDescriptionMarkdown,
        parentId: initialParentId,
        title: initialTitle,
      }),
    [draftStorageKey, initialDescriptionMarkdown, initialParentId, initialTitle],
  );

  const persistDraft = (nextValue: NewTaskFormValues) => {
    persistNewTaskDialogDraft(draftStorageKey, nextValue);
  };

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: ({ value }: { value: NewTaskFormValues }) => {
      const nextTitle = value.title.trim();
      const nextDescription = value.descriptionMarkdown.trim();
      onSubmit({
        title: nextTitle,
        descriptionMarkdown: nextDescription || undefined,
        ...(showParentSelector ? { parentId: value.parentId } : {}),
      });
    },
  });

  const handleDescriptionKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="new-task-dialog-title"
        aria-modal="true"
        className="new-task-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="new-task-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <AppButton aria-label="Close dialog" onClick={onClose} variant="icon">
            <X size={16} />
          </AppButton>
        </header>

        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => (
              <label className="form-field">
                <span>Task title</span>
                <input
                  aria-label="Task title"
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const nextTitle = event.target.value;
                    field.handleChange(nextTitle);
                    persistDraft({ ...form.state.values, title: nextTitle });
                  }}
                  value={field.state.value}
                />
              </label>
            )}
          </form.Field>

          {showParentSelector ? (
            <form.Field name="parentId">
              {(field) => (
                <div className="form-field">
                  <span>Parent task (optional)</span>
                  <TaskSelector
                    ariaLabel="Parent task"
                    emptyLabel="No parent"
                    onChange={(parentId) => {
                      field.handleChange(parentId);
                      persistDraft({ ...form.state.values, parentId });
                      onParentChange?.(parentId);
                    }}
                    options={parentOptions ?? []}
                    placeholder="Search tasks…"
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
          ) : null}

          <form.Field name="descriptionMarkdown">
            {(field) => (
              <div
                className="form-field markdown-form-field"
                onKeyDown={handleDescriptionKeyDown}
              >
                <span>Description</span>
                {(() => {
                  const handleDescriptionChange = (descriptionMarkdown: string) => {
                    field.handleChange(descriptionMarkdown);
                    persistDraft({
                      ...form.state.values,
                      descriptionMarkdown,
                    });
                  };

                  return (
                    <MarkdownEditor
                      ariaLabel="Task description Markdown"
                      attachmentTarget={attachmentTarget}
                      autoFocus
                      conflictLabel="Description changed outside this dialog."
                      fontFamily={markdownEditorFontFamily}
                      fontSize={markdownEditorFontSize}
                      maxImageHeight={markdownEditorMaxImageHeight}
                      markdown={field.state.value}
                      mode={markdownEditorMode}
                      onDraftChange={handleDescriptionChange}
                      onModeChange={onMarkdownEditorModeChange}
                      onOpenImage={onOpenImage}
                      onSave={() => undefined}
                      onTocHiddenChange={onMarkdownTocHiddenChange}
                      onTocWidthChange={onMarkdownTocWidthChange}
                      saveStatusLabels={{ clean: 'Draft', dirty: 'Editing draft...' }}
                      tocHidden={markdownTocHidden}
                      tocWidth={markdownTocWidth}
                    />
                  );
                })()}
              </div>
            )}
          </form.Field>

          <footer className="dialog-actions">
            <AppButton onClick={onClose} variant="secondary">
              Cancel
            </AppButton>
            <form.Subscribe
              selector={(state) => ({
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ isSubmitting }) => (
                <AppButton
                  disabled={isSubmitting}
                  type="submit"
                  variant="primary"
                >
                  {submitLabel}
                </AppButton>
              )}
            </form.Subscribe>
          </footer>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}

function readNewTaskDialogDraft(
  draftStorageKey: string | undefined,
  fallback: NewTaskFormValues,
): NewTaskFormValues {
  if (!draftStorageKey) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(draftStorageKey);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<StoredNewTaskDraft>;
    return {
      descriptionMarkdown:
        typeof parsed.descriptionMarkdown === 'string'
          ? parsed.descriptionMarkdown
          : fallback.descriptionMarkdown,
      parentId: fallback.parentId,
      title: typeof parsed.title === 'string' ? parsed.title : fallback.title,
    };
  } catch {
    return fallback;
  }
}

function persistNewTaskDialogDraft(
  draftStorageKey: string | undefined,
  value: NewTaskFormValues,
): void {
  if (!draftStorageKey) {
    return;
  }

  const draft: StoredNewTaskDraft = {
    descriptionMarkdown: value.descriptionMarkdown,
    title: value.title,
  };

  try {
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  } catch {
    // Losing local draft persistence should not prevent task creation.
  }
}
