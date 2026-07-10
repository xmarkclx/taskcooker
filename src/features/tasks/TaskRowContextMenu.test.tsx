import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { TaskRowContextMenu } from './TaskRowContextMenu';

const appStyles = readFileSync('src/styles.css', 'utf8');

describe('TaskRowContextMenu', () => {
  it('renders create, status, and delete items', () => {
    render(
      <TaskRowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        onCreateAbove={vi.fn()}
        onCreateBelow={vi.fn()}
        onCreateSubtask={vi.fn()}
        onDelete={vi.fn()}
        onSetPriority={vi.fn()}
        onSetState={vi.fn()}
      />,
    );

    expect(screen.getByText('New task above')).toBeInTheDocument();
    expect(screen.getByText('New task below')).toBeInTheDocument();
    expect(screen.getByText('New subtask')).toBeInTheDocument();
    expect(screen.getByText('Delete task')).toBeInTheDocument();

    expect(screen.getAllByRole('menuitem').slice(0, 3).map((item) => item.textContent)).toEqual([
      'New subtask',
      'New task above',
      'New task below',
    ]);
  });

  it('fires onSetState with a chosen status', () => {
    const onSetState = vi.fn();
    render(
      <TaskRowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        onCreateAbove={vi.fn()}
        onCreateBelow={vi.fn()}
        onCreateSubtask={vi.fn()}
        onDelete={vi.fn()}
        onSetPriority={vi.fn()}
        onSetState={onSetState}
      />,
    );

    fireEvent.click(screen.getByText('Doing'));

    expect(onSetState).toHaveBeenCalledWith('Doing');
  });

  it('fires onSetPriority with a chosen priority', () => {
    const onSetPriority = vi.fn();
    render(
      <TaskRowContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        onCreateAbove={vi.fn()}
        onCreateBelow={vi.fn()}
        onCreateSubtask={vi.fn()}
        onDelete={vi.fn()}
        onSetPriority={onSetPriority}
        onSetState={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('🔴 Urgent'));

    expect(onSetPriority).toHaveBeenCalledWith('Urgent');
  });

  it('fires copy and paste task link actions when a paste label is available', () => {
    const onCopyTaskLink = vi.fn();
    const onPasteTaskLink = vi.fn();
    render(
      <TaskRowContextMenu
        pasteTaskLabel="Paste B-264 task"
        x={0}
        y={0}
        onClose={vi.fn()}
        onCopyTaskLink={onCopyTaskLink}
        onCreateAbove={vi.fn()}
        onCreateBelow={vi.fn()}
        onCreateSubtask={vi.fn()}
        onDelete={vi.fn()}
        onPasteTaskLink={onPasteTaskLink}
        onSetPriority={vi.fn()}
        onSetState={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Copy task link'));
    fireEvent.click(screen.getByText('Paste B-264 task'));

    expect(onCopyTaskLink).toHaveBeenCalledOnce();
    expect(onPasteTaskLink).toHaveBeenCalledOnce();
  });

  it('uses compact menu item typography and spacing', () => {
    const menuRule = cssRule('.task-context-menu');
    const itemRule = cssRule('.task-context-menu button');

    expect(menuRule).toContain('min-width: 178px;');
    expect(itemRule).toContain('font-size: 14px;');
    expect(itemRule).toContain('line-height: 18px;');
    expect(itemRule).toContain('padding: 5px 8px;');
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}
