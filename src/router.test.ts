import { describe, expect, it } from 'vitest';

import { parseAppSearch } from './router';

describe('app route search params', () => {
  it('keeps positive integer project and todo ids', () => {
    expect(parseAppSearch({ focusedProjectId: '8', projectId: '4', ptyId: '9', taskWindow: '1', terminalTitle: 'Claude', todoId: 12 })).toEqual({
      focusedProjectId: 8,
      imageSrc: undefined,
      imageWindow: false,
      projectId: 4,
      ptyId: 9,
      taskWindow: true,
      terminalTitle: 'Claude',
      todoId: 12,
    });
  });

  it('keeps projectId 0 as the all-projects route', () => {
    expect(parseAppSearch({ projectId: '0', todoId: 12 })).toEqual({
      focusedProjectId: undefined,
      imageSrc: undefined,
      projectId: 0,
      imageWindow: false,
      ptyId: undefined,
      taskWindow: false,
      terminalTitle: undefined,
      todoId: 12,
    });
  });

  it('keeps image window source route params', () => {
    expect(
      parseAppSearch({
        imageSrc: 'asset%3A%2F%2Flocalhost%2FUsers%2Fmark%2Fimage.png',
        imageWindow: '1',
      }),
    ).toEqual({
      focusedProjectId: undefined,
      imageSrc: 'asset%3A%2F%2Flocalhost%2FUsers%2Fmark%2Fimage.png',
      imageWindow: true,
      projectId: undefined,
      ptyId: undefined,
      taskWindow: false,
      terminalTitle: undefined,
      todoId: undefined,
    });
  });

  it('drops invalid ids instead of trusting URL input', () => {
    expect(
      parseAppSearch({
        projectId: '-2',
        focusedProjectId: '0',
        ptyId: '-1',
        taskWindow: 'false',
        terminalTitle: '   ',
        todoId: '1.5',
      }),
    ).toEqual({
      focusedProjectId: undefined,
      imageSrc: undefined,
      imageWindow: false,
      projectId: undefined,
      ptyId: undefined,
      taskWindow: false,
      terminalTitle: undefined,
      todoId: undefined,
    });
  });
});
