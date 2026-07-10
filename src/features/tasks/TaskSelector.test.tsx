import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { TaskSelector, type TaskSelectorOption } from './TaskSelector';

const appStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

const options: TaskSelectorOption[] = [
  { id: 1, displayId: 'T-1', title: 'Publicize the app' },
  { id: 2, displayId: 'T-2', title: 'Write the docs' },
  { id: 3, displayId: 'T-3', title: 'Ship the release' },
];

describe('TaskSelector', () => {
  it('shows the selected task label and the empty option', () => {
    render(
      <TaskSelector
        ariaLabel="Parent task"
        onChange={vi.fn()}
        options={options}
        value={2}
      />,
    );

    expect(screen.getByLabelText('Parent task')).toHaveValue('T-2 Write the docs');
  });

  it('filters options by the typed query and selects one', () => {
    const onChange = vi.fn();
    render(
      <TaskSelector
        ariaLabel="Parent task"
        onChange={onChange}
        options={options}
        value={null}
      />,
    );

    const input = screen.getByLabelText('Parent task');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'docs' } });

    expect(screen.queryByRole('option', { name: 'T-1 Publicize the app' })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'T-2 Write the docs' }));

    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('lets the user clear the selection with the empty option', () => {
    const onChange = vi.fn();
    render(
      <TaskSelector
        ariaLabel="Parent task"
        emptyLabel="No parent"
        onChange={onChange}
        options={options}
        value={1}
      />,
    );

    fireEvent.focus(screen.getByLabelText('Parent task'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'No parent' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('treats a value that is no longer a valid option as empty', () => {
    render(
      <TaskSelector
        ariaLabel="Parent task"
        onChange={vi.fn()}
        options={options}
        value={999}
      />,
    );

    expect(screen.getByLabelText('Parent task')).toHaveValue('');
  });

  it('keeps dropdown options as compact full-width button rows', () => {
    const rule = cssRule('.task-selector-option');

    expect(rule).toContain('appearance: none;');
    expect(rule).toContain('display: block;');
    expect(rule).toContain('line-height: 20px;');
    expect(rule).toContain('min-height: 36px;');
    expect(rule).toContain('width: 100%;');
  });
});

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(
    new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`),
  );
  return match?.groups?.body ?? '';
}
