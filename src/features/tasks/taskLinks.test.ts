import { describe, expect, it } from 'vitest';

import { formatTaskUri, parseTaskUri } from './taskLinks';

describe('taskLinks', () => {
  it('formats task display ids as Boomerang task URIs', () => {
    expect(formatTaskUri('B-264')).toBe('boomerang://todo/B-264');
  });

  it('parses Boomerang task URIs back to display ids', () => {
    expect(parseTaskUri('boomerang://todo/B-264')).toBe('B-264');
    expect(parseTaskUri('  boomerang://todo/Client%20Task-12  ')).toBe('Client Task-12');
  });

  it('rejects clipboard text that is not a task URI', () => {
    expect(parseTaskUri('B-264')).toBeNull();
    expect(parseTaskUri('https://example.test/todo/B-264')).toBeNull();
  });
});
