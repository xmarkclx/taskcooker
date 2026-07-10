import { describe, expect, it } from 'vitest';

import { computeDragResult, type FlatRow } from './treeReorder';

describe('computeDragResult', () => {
  it('produces reorder args for a flat move', () => {
    const rows: FlatRow[] = [
      { id: 1, parentId: null, depth: 0 },
      { id: 2, parentId: null, depth: 0 },
    ];

    expect(computeDragResult(rows, 2, 1, 0)).toEqual({
      newParentId: null,
      newIndex: 0,
    });
  });
});
