import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const webviewMock = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  return {
    handlers,
    onDragDropEvent: vi.fn((handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return Promise.resolve(vi.fn());
    }),
  };
});

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: webviewMock.onDragDropEvent,
  }),
}));

import { listenForDroppedPathsWhenFocused } from './dropPaths';

function dropAt() {
  webviewMock.handlers[0]?.({
    payload: {
      paths: ['/Users/markcl/My Folder/report.txt'],
      position: { x: 0, y: 0 },
      type: 'drop',
    },
  });
}

describe('listenForDroppedPathsWhenFocused', () => {
  beforeEach(() => {
    webviewMock.handlers.length = 0;
    webviewMock.onDragDropEvent.mockClear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('delivers dropped paths to the surface that owns input focus', async () => {
    const panel = document.createElement('div');
    const input = document.createElement('input');
    panel.append(input);
    document.body.append(panel);
    input.focus();

    const onDrop = vi.fn();
    await listenForDroppedPathsWhenFocused(panel, onDrop);

    dropAt();
    expect(onDrop).toHaveBeenCalledWith(['/Users/markcl/My Folder/report.txt']);
  });

  it('ignores drops while focus is outside the surface', async () => {
    const panel = document.createElement('div');
    panel.append(document.createElement('input'));
    const outsideInput = document.createElement('input');
    document.body.append(panel, outsideInput);
    outsideInput.focus();

    const onDrop = vi.fn();
    await listenForDroppedPathsWhenFocused(panel, onDrop);

    dropAt();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('ignores drag events that are not drops', async () => {
    const panel = document.createElement('div');
    const input = document.createElement('input');
    panel.append(input);
    document.body.append(panel);
    input.focus();

    const onDrop = vi.fn();
    await listenForDroppedPathsWhenFocused(panel, onDrop);

    webviewMock.handlers[0]?.({
      payload: { position: { x: 0, y: 0 }, type: 'over' },
    });
    webviewMock.handlers[0]?.({
      payload: { paths: [], position: { x: 0, y: 0 }, type: 'drop' },
    });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
