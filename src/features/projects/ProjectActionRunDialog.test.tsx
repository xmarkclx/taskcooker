import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectActionSummary } from '../../domain/domain';
import { ProjectActionRunDialog } from './ProjectActionRunDialog';

describe('ProjectActionRunDialog', () => {
  it('collects action arguments in metadata order names', () => {
    const onRun = vi.fn();
    render(
      <ProjectActionRunDialog
        action={actionWithArguments}
        onClose={() => undefined}
        onRun={onRun}
      />,
    );

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'prod' } });
    fireEvent.click(screen.getByLabelText('Verbose output'));
    fireEvent.change(screen.getByLabelText('Release note'), {
      target: { value: 'Ship authenticated MCP tools.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Action' }));

    expect(onRun).toHaveBeenCalledWith({
      note: 'Ship authenticated MCP tools.',
      target: 'prod',
      verbose: true,
    });
  });
});

const actionWithArguments: ProjectActionSummary = {
  arguments: [
    {
      choices: ['dev', 'prod'],
      kind: 'choice',
      label: 'Target',
      name: 'target',
      required: true,
    },
    {
      choices: [],
      kind: 'boolean',
      label: 'Verbose output',
      name: 'verbose',
      required: false,
    },
    {
      choices: [],
      kind: 'string',
      label: 'Release note',
      name: 'note',
      required: false,
    },
  ],
  description: 'Run deployment.',
  fileName: 'deploy.sh',
  icon: null,
  iconConfigured: false,
  path: '/tmp/deploy.sh',
  runtime: 'shell',
  title: 'Deploy',
  validationError: null,
};
