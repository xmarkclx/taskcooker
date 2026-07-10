import { describe, expect, it } from 'vitest';

import {
  formatReplyWithAttachments,
  formatTerminalImageReferences,
} from './replyAttachments';

describe('reply attachment helpers', () => {
  it('appends saved image paths to the message body for CLI delivery', () => {
    expect(
      formatReplyWithAttachments('Please inspect this.', [
        {
          fileName: 'screen.png',
          markdownPath: '~/Library/Application Support/Boomerang/screen.png',
        },
      ]),
    ).toBe(
      'Please inspect this.\n\nAttachments:\n- screen.png: ~/Library/Application Support/Boomerang/screen.png',
    );
  });

  it('can send image-only replies as local file references', () => {
    expect(
      formatReplyWithAttachments('', [
        {
          fileName: 'trace.webp',
          markdownPath: '~/Library/Application Support/Boomerang/trace.webp',
        },
      ]),
    ).toBe('Attachments:\n- trace.webp: ~/Library/Application Support/Boomerang/trace.webp');
  });

  it('formats terminal image references as input text for the running CLI', () => {
    expect(
      formatTerminalImageReferences([
        {
          fileName: 'terminal.png',
          markdownPath: '~/Library/Application Support/Boomerang/terminal.png',
        },
      ]),
    ).toBe(
      '\r\n[Image attachments saved by TaskCooker]\r\n- terminal.png: ~/Library/Application Support/Boomerang/terminal.png\r\n',
    );
  });
});
