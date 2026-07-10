import { describe, expect, it } from 'vitest';

import {
  describeSlowdownDetail,
  describeSlowdownTarget,
  summarizeKeyboardEvent,
} from './slowdownProfiler';

describe('slowdownProfiler helpers', () => {
  it('classifies terminal and markdown targets for slowdown logs', () => {
    document.body.innerHTML = `
      <div class="terminal-shell"><div class="xterm"><textarea id="terminal"></textarea></div></div>
      <section class="description-panel"><div class="tiptap-editor"><input id="markdown" /></div></section>
    `;

    expect(describeSlowdownTarget(document.querySelector('#terminal'))).toBe('terminal');
    expect(describeSlowdownTarget(document.querySelector('#markdown'))).toBe('markdown');
  });

  it('redacts typed characters from keyboard summaries', () => {
    const summary = summarizeKeyboardEvent(new KeyboardEvent('keydown', { key: 'x' }));

    expect(summary).toEqual({ eventType: 'keydown', keyType: 'character' });
    expect(JSON.stringify(summary)).not.toContain('x');
  });

  it('uses explicit slowdown detail markers without reading freeform text', () => {
    document.body.innerHTML = `
      <button data-slowdown-detail="CN-83">
        <span id="task-label">CN-83 User-entered task title should not be logged</span>
      </button>
      <p id="plain-text">CN-84 Plain text should not be scraped</p>
    `;

    expect(describeSlowdownDetail(document.querySelector('#task-label'))).toBe('CN-83');
    expect(describeSlowdownDetail(document.querySelector('#plain-text'))).toBeNull();
  });
});
