import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppSegmentedControl } from './SegmentedControl';

describe('AppSegmentedControl', () => {
  it('marks the selected option as checked and forwards selection', () => {
    const handleChange = vi.fn();
    render(
      <AppSegmentedControl
        aria-label="Theme"
        onChange={handleChange}
        options={[
          { label: 'System', value: 'system' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ]}
        value="light"
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).not.toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveClass('active');
    expect(radios[2]).not.toHaveAttribute('aria-checked', 'true');

    fireEvent.click(radios[2]);
    expect(handleChange).toHaveBeenCalledWith('dark');
    expect(group).toBeInTheDocument();
  });
});
