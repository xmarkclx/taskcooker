import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectSummary } from '../../domain/domain';
import { ProjectNotesOverlay } from './ProjectNotesOverlay';

describe('ProjectNotesOverlay', () => {
  it('passes project notes TOC width changes through to the caller', () => {
    const onMarkdownTocWidthChange = vi.fn();
    const { container } = render(
      <ProjectNotesOverlay
        markdownTocHidden={false}
        markdownTocWidth={224}
        onClose={vi.fn()}
        onMarkdownTocWidthChange={onMarkdownTocWidthChange}
        onSave={vi.fn()}
        project={projectFixture()}
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

function projectFixture(): ProjectSummary {
  return {
    actionsDirectory: '.boomerang/actions',
    activeTodoCount: 1,
    status: 'Active' as const,
    inheritParent: false,
    subprojects: [],    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    backgroundImagePath: '',
    client: '',
    displayIdPrefix: 'T',
    id: 1,
    mainBranch: 'main',
    name: 'tmatrix',
    notesMarkdown: '# Notes',
    projectFolderOpenApp: 'cursor',
    terminalWslEnabled: false,
    workingDirectory: '~/p/tmatrix',
  };
}
