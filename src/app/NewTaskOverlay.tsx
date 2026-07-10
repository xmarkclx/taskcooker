import type { ComponentProps } from 'react';
import { useAtom } from 'jotai';

import { NewTaskDialog, type NewTaskDialogSubmit } from '../features/tasks/NewTaskDialog';
import { newTaskDialogAtom } from './useMainAppUiState';

type NewTaskDialogProps = ComponentProps<typeof NewTaskDialog>;

export function NewTaskOverlay({
  attachmentTarget,
  description,
  draftStorageKey,
  initialDescriptionMarkdown,
  initialParentId,
  initialTitle,
  markdownEditorFontFamily,
  markdownEditorFontSize,
  markdownEditorMaxImageHeight,
  markdownTocWidth,
  onMarkdownTocWidthChange,
  onOpenImage,
  onParentChange,
  onSubmit,
  parentOptions,
  submitLabel,
  title,
}: {
  attachmentTarget: NewTaskDialogProps['attachmentTarget'];
  description: string;
  draftStorageKey?: string;
  initialDescriptionMarkdown: string;
  initialParentId: number | null;
  initialTitle: string;
  markdownEditorFontFamily: NewTaskDialogProps['markdownEditorFontFamily'];
  markdownEditorFontSize: NewTaskDialogProps['markdownEditorFontSize'];
  markdownEditorMaxImageHeight: NewTaskDialogProps['markdownEditorMaxImageHeight'];
  markdownTocWidth: number;
  onMarkdownTocWidthChange: (width: number) => void;
  onOpenImage: (src: string) => void;
  onParentChange: (parentId: number | null) => void;
  onSubmit: (value: NewTaskDialogSubmit) => void;
  parentOptions: NewTaskDialogProps['parentOptions'];
  submitLabel: string;
  title: string;
}) {
  const [newTaskDialog, setNewTaskDialog] = useAtom(newTaskDialogAtom);

  if (!newTaskDialog) {
    return null;
  }
  const placement = newTaskDialog.kind === 'task' ? newTaskDialog.placement : undefined;

  return (
    <NewTaskDialog
      attachmentTarget={attachmentTarget}
      description={description}
      draftStorageKey={draftStorageKey}
      initialDescriptionMarkdown={initialDescriptionMarkdown}
      initialParentId={initialParentId}
      initialTitle={initialTitle}
      key={newTaskDialog.kind === 'action' ? 'action' : `task-${placement?.projectId ?? 'current'}-${placement?.parentId ?? 'root'}-${placement?.position ?? 'end'}`}
      markdownEditorFontFamily={markdownEditorFontFamily}
      markdownEditorFontSize={markdownEditorFontSize}
      markdownEditorMaxImageHeight={markdownEditorMaxImageHeight}
      markdownTocWidth={markdownTocWidth}
      onClose={() => setNewTaskDialog(null)}
      onMarkdownTocWidthChange={onMarkdownTocWidthChange}
      onOpenImage={onOpenImage}
      onParentChange={onParentChange}
      onSubmit={onSubmit}
      parentOptions={parentOptions}
      submitLabel={submitLabel}
      title={title}
    />
  );
}
