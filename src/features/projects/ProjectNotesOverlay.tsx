import { X } from 'lucide-react';

import type { AppSettingsSummary, ProjectSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { MarkdownEditor } from '../markdown/MarkdownEditor';

export function ProjectNotesOverlay({
  markdownEditorMode,
  markdownEditorFontFamily,
  markdownEditorFontSize,
  markdownEditorMaxImageHeight,
  markdownTocHidden,
  markdownTocWidth,
  onMarkdownEditorModeChange,
  onMarkdownTocHiddenChange,
  onMarkdownTocWidthChange,
  onOpenImage,
  project,
  onClose,
  onSave,
}: {
  markdownEditorMode?: AppSettingsSummary['markdownEditorMode'];
  markdownEditorFontFamily?: AppSettingsSummary['markdownEditorFontFamily'];
  markdownEditorFontSize?: string;
  markdownEditorMaxImageHeight?: string;
  markdownTocHidden?: boolean;
  markdownTocWidth?: number;
  onMarkdownEditorModeChange?: (mode: AppSettingsSummary['markdownEditorMode']) => void;
  onMarkdownTocHiddenChange?: (hidden: boolean) => void;
  onMarkdownTocWidthChange?: (width: number) => void;
  onOpenImage?: (src: string) => void;
  project: ProjectSummary;
  onClose: () => void;
  onSave: (notesMarkdown: string) => void;
}) {
  return (
    <DialogBackdrop className="project-notes-backdrop">
      <DialogPanel
        aria-label="Project Notes"
        className="project-notes-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2>Project Notes</h2>
            <p>
              {project.name} · {project.workingDirectory}
            </p>
          </div>
          <AppButton
            aria-label="Close project notes"
            onClick={onClose}
            title="Close project notes"
            variant="icon"
          >
            <X size={16} />
          </AppButton>
        </header>
        <div className="project-notes-editor">
          <MarkdownEditor
            ariaLabel="Project Notes Markdown"
            attachmentTarget={{
              projectId: project.id,
              scope: 'project-notes',
            }}
            conflictLabel="Project notes changed elsewhere."
            fontFamily={markdownEditorFontFamily}
            fontSize={markdownEditorFontSize}
            maxImageHeight={markdownEditorMaxImageHeight}
            markdown={project.notesMarkdown}
            mode={markdownEditorMode}
            onModeChange={onMarkdownEditorModeChange}
            onOpenImage={onOpenImage}
            onTocHiddenChange={onMarkdownTocHiddenChange}
            onTocWidthChange={onMarkdownTocWidthChange}
            onSave={onSave}
            scrollKey={`project:${project.id}:notes`}
            tocHidden={markdownTocHidden}
            tocWidth={markdownTocWidth}
          />
        </div>
      </DialogPanel>
    </DialogBackdrop>
  );
}
