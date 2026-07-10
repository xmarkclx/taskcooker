import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppSelect } from './Select';

describe('AppSelect', () => {
  it('renders options with the shared design-system class and forwards selection', () => {
    const handleChange = vi.fn();
    render(
      <AppSelect
        aria-label="Theme"
        onChange={handleChange}
        options={[
          { label: 'Wood Light', value: 'light' },
          { label: 'Wood Dark', value: 'dark' },
        ]}
        value="light"
      />,
    );

    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    expect(select).toHaveClass('app-select');
    expect(select.options).toHaveLength(2);
    expect(select.options[0]).toHaveValue('light');
    expect(select.options[1]).toHaveValue('dark');

    fireEvent.change(select, { target: { value: 'dark' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to app-select when no custom className is supplied', () => {
    render(
      <AppSelect
        aria-label="Unit"
        options={[{ label: 'Hours', value: 'hours' }]}
        value="hours"
      />,
    );

    expect(screen.getByLabelText('Unit')).toHaveClass('app-select');
  });
});
