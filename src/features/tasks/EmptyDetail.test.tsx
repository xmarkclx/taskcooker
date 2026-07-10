import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmptyDetail } from './EmptyDetail';

describe('EmptyDetail', () => {
  it('renders a labelled no-task-selected empty state with the task creation action', () => {
    const onNewTask = vi.fn();

    render(
      <EmptyDetail
        hasProject
        onNewProject={vi.fn()}
        onNewTask={onNewTask}
      />,
    );

    expect(
      screen.getByRole('region', { name: 'No task selected' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Pick a task from the list or create a new one.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('renders first-run project creation copy when no project exists', () => {
    const onNewProject = vi.fn();

    render(
      <EmptyDetail
        hasProject={false}
        onNewProject={onNewProject}
        onNewTask={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('region', { name: 'No task selected' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Create a project, then add the first task.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
  });
});
