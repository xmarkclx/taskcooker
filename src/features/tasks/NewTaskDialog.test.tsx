import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { clearNewTaskDialogDraft } from '../../app/appShellDrafts';
import { NewTaskDialog } from './NewTaskDialog';

const appStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('NewTaskDialog', () => {
  it('focuses the description when opening task and subtask dialogs', async () => {
    const taskDialog = render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        title="New task"
      />,
    );

    await waitFor(() => {
      expect(
        taskDialog.container.querySelector('.tiptap-editor .ProseMirror'),
      ).toHaveFocus();
    });

    taskDialog.unmount();

    render(
      <NewTaskDialog
        description="Create a subtask under T-6."
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="Create Subtask"
        title="New subtask"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Task description Markdown')).toHaveFocus();
    });
  });

  it('keeps the modal form and description editor constrained to the visible viewport', () => {
    const dialogRule = cssRule('.new-task-dialog');
    const formRule = cssRule('.new-task-dialog .dialog-form');
    const markdownFieldRule = cssRule('.new-task-dialog .markdown-form-field');
    const descriptionPanelRule = cssRule('.new-task-dialog .description-panel');
    const editorBodyRule = cssRule('.new-task-dialog .editor-body');

    expect(dialogRule).toContain(
      'max-height: calc(100vh - var(--top-bar-height) - 40px);',
    );
    expect(dialogRule).toContain(
      'height: min(88vh, calc(100vh - var(--top-bar-height) - 40px));',
    );
    expect(dialogRule).toContain('display: flex;');
    expect(dialogRule).toContain('flex-direction: column;');
    expect(dialogRule).toContain('overflow: hidden;');
    expect(dialogRule).toContain('overscroll-behavior: contain;');

    expect(formRule).toContain('flex: 1;');
    expect(formRule).toContain('min-height: 0;');
    expect(formRule).toContain('overflow: hidden;');

    expect(markdownFieldRule).toContain('flex: 1;');
    expect(markdownFieldRule).toContain('min-height: 0;');

    expect(descriptionPanelRule).toContain('flex: 1;');
    expect(descriptionPanelRule).toContain('min-height: 0;');

    expect(editorBodyRule).toContain('min-height: 0;');
    expect(editorBodyRule).not.toContain('min-height: 300px;');
  });

  it('restores a locally stored draft after the dialog is closed without creating', () => {
    const draftStorageKey = 'new-subtask-draft-test';
    const first = render(
      <NewTaskDialog
        description="Create a subtask under T-6."
        draftStorageKey={draftStorageKey}
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="Create Subtask"
        title="New subtask"
      />,
    );

    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Draft title' },
    });
    fireEvent.change(screen.getByLabelText('Task description Markdown'), {
      target: { value: 'Draft description' },
    });

    first.unmount();

    render(
      <NewTaskDialog
        description="Create a subtask under T-6."
        draftStorageKey={draftStorageKey}
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="Create Subtask"
        title="New subtask"
      />,
    );

    expect(screen.getByLabelText('Task title')).toHaveValue('Draft title');
    expect(screen.getByLabelText('Task description Markdown')).toHaveValue(
      'Draft description',
    );
  });

  it('uses the shared Markdown editor and submits the current draft immediately', async () => {
    const onSubmit = vi.fn();

    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="New task"
      />,
    );

    expect(screen.getByRole('button', { name: 'Rich' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Document modal creation' },
    });
    fireEvent.change(screen.getByLabelText('Task description Markdown'), {
      target: { value: '# Notes\n\n- [ ] Uses Markdown' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Task' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Document modal creation',
        descriptionMarkdown: '# Notes\n\n- [ ] Uses Markdown',
      });
    });
  });

  it('submits without a title so the backend can generate one', async () => {
    const onSubmit = vi.fn();

    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="New task"
      />,
    );

    fireEvent.change(screen.getByLabelText('Task description Markdown'), {
      target: { value: 'Review the deployment notes and summarize the next action.' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Task' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: '',
        descriptionMarkdown: 'Review the deployment notes and summarize the next action.',
      });
    });
  });

  it('submits a subtask when Cmd+Enter is pressed in the rich description editor', async () => {
    const onSubmit = vi.fn();

    const { container } = render(
      <NewTaskDialog
        description="Create a subtask under T-6."
        initialTitle="Keyboard created subtask"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        submitLabel="Create Subtask"
        title="New subtask"
      />,
    );

    const richEditor = container.querySelector('.tiptap-editor .ProseMirror');
    expect(richEditor).toBeInstanceOf(HTMLElement);

    fireEvent.keyDown(richEditor as HTMLElement, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Keyboard created subtask',
        descriptionMarkdown: undefined,
      });
    });
  });

  it('submits the current raw description draft when Ctrl+Enter is pressed', async () => {
    const onSubmit = vi.fn();

    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        initialTitle="Keyboard created task"
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="New task"
      />,
    );

    fireEvent.change(screen.getByLabelText('Task description Markdown'), {
      target: { value: 'Use the current raw draft.' },
    });
    fireEvent.keyDown(screen.getByLabelText('Task description Markdown'), {
      key: 'Enter',
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Keyboard created task',
        descriptionMarkdown: 'Use the current raw draft.',
      });
    });
  });

  it('does not restore a submitted draft after the caller clears it', async () => {
    const draftStorageKey = 'submitted-new-task-draft-test';
    const onSubmit = vi.fn(() => {
      clearNewTaskDialogDraft(draftStorageKey);
    });

    const submitted = render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        draftStorageKey={draftStorageKey}
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="New task"
      />,
    );

    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Submitted task' },
    });
    fireEvent.change(screen.getByLabelText('Task description Markdown'), {
      target: { value: 'Submitted description draft.' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Task' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Submitted task',
        descriptionMarkdown: 'Submitted description draft.',
      });
    });

    submitted.unmount();

    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        draftStorageKey={draftStorageKey}
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        title="New task"
      />,
    );

    expect(screen.getByLabelText('Task title')).toHaveValue('');
    expect(screen.getByLabelText('Task description Markdown')).toHaveValue('');
  });

  it('keeps the description draft editable while the form echoes local changes', () => {
    render(
      <NewTaskDialog
        description="Create a subtask under T-6."
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="Create Subtask"
        title="New subtask"
      />,
    );

    const description = screen.getByLabelText('Task description Markdown');
    fireEvent.change(description, { target: { value: 'h' } });

    expect(screen.queryByText('Description changed outside this dialog.')).not.toBeInTheDocument();
    expect(description).toBeEnabled();

    fireEvent.change(description, { target: { value: 'hi' } });

    expect(description).toHaveValue('hi');
    expect(screen.queryByText('Description changed outside this dialog.')).not.toBeInTheDocument();
  });

  it('labels the unsaved task description as a draft instead of saved', () => {
    render(
      <NewTaskDialog
        description="Create a subtask under T-6."
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="Create Subtask"
        title="New subtask"
      />,
    );

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('submits the chosen parent task and remembers the change', async () => {
    const onSubmit = vi.fn();
    const onParentChange = vi.fn();

    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        initialTitle="Child task"
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onParentChange={onParentChange}
        onSubmit={onSubmit}
        parentOptions={[
          { id: 7, displayId: 'T-7', title: 'Publicize the app' },
          { id: 8, displayId: 'T-8', title: 'Write the docs' },
        ]}
        title="New task"
      />,
    );

    const parentInput = screen.getByLabelText('Parent task');
    fireEvent.focus(parentInput);
    fireEvent.change(parentInput, { target: { value: 'docs' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'T-8 Write the docs' }));

    expect(onParentChange).toHaveBeenCalledWith(8);

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Child task',
        descriptionMarkdown: undefined,
        parentId: 8,
      });
    });
  });

  it('pre-selects the remembered parent and can clear it back to none', async () => {
    const onSubmit = vi.fn();

    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        initialParentId={7}
        initialTitle="Child task"
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        parentOptions={[{ id: 7, displayId: 'T-7', title: 'Publicize the app' }]}
        title="New task"
      />,
    );

    expect(screen.getByLabelText('Parent task')).toHaveValue('T-7 Publicize the app');

    fireEvent.focus(screen.getByLabelText('Parent task'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'No parent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Child task',
        descriptionMarkdown: undefined,
        parentId: null,
      });
    });
  });

  it('omits the parent field when no parent options are provided', () => {
    render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        markdownEditorMode="raw"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        title="New task"
      />,
    );

    expect(screen.queryByLabelText('Parent task')).not.toBeInTheDocument();
  });

  it('passes description TOC width changes through to the caller', () => {
    const onMarkdownTocWidthChange = vi.fn();
    const { container } = render(
      <NewTaskDialog
        description="Create a task in tmatrix."
        markdownTocHidden={false}
        markdownTocWidth={224}
        onClose={vi.fn()}
        onMarkdownTocWidthChange={onMarkdownTocWidthChange}
        onSubmit={vi.fn()}
        title="New task"
      />,
    );

    expect(container.querySelector('.editor-body')).toHaveStyle({
      gridTemplateColumns: '224px 8px minmax(0, 1fr)',
    });

    fireEvent.keyDown(
      screen.getByRole('separator', { name: 'Resize table of contents' }),
      { key: 'ArrowRight' },
    );

    expect(onMarkdownTocWidthChange).toHaveBeenCalledWith(240);
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(
    new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`),
  );
  return match?.groups?.body ?? '';
}
