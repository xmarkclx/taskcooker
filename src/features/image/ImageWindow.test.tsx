import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImageWindow } from './ImageWindow';

describe('ImageWindow', () => {
  it('zooms with browser-style keyboard shortcuts', () => {
    render(<ImageWindow src="asset://localhost/Users/mark/image.png" />);

    const image = screen.getByRole('img', { name: 'Opened image' });
    const viewer = screen.getByRole('main', { name: 'Image viewer' });

    expect(image).toHaveStyle({ width: '100%' });

    fireEvent.keyDown(viewer, { key: '=', metaKey: true });
    expect(image).toHaveStyle({ width: '125%' });

    fireEvent.keyDown(viewer, { key: '-', metaKey: true });
    expect(image).toHaveStyle({ width: '100%' });

    fireEvent.keyDown(viewer, { key: '=', metaKey: true });
    fireEvent.keyDown(viewer, { key: '0', metaKey: true });
    expect(image).toHaveStyle({ width: '100%' });
  });

  it('zooms on trackpad pinch-style wheel events', () => {
    render(<ImageWindow src="asset://localhost/Users/mark/image.png" />);

    const image = screen.getByRole('img', { name: 'Opened image' });
    const viewport = screen.getByTestId('image-window-viewport');

    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -80 });
    expect(image).toHaveStyle({ width: '110%' });

    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: 80 });
    expect(image).toHaveStyle({ width: '100%' });
  });
});
