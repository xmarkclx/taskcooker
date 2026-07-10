import { describe, expect, it } from 'vitest';

import type { TodoSummary } from '../../domain/domain';
import {
  computeDragResult,
  flattenRows,
  getDropInstruction,
  getDropInstructionAtPoint,
  getDropPlacement,
  getDropPointMarkers,
  getProjectLinkDropInstruction,
  getProjectRootDropInstruction,
  resolveDragEndDropInstruction,
  getDropTarget,
  getVisualOverIndex,
  getProjection,
  projectRootRowId,
  resolveDropLabel,
  type FlatRow,
} from './treeReorder';

const rows: FlatRow[] = [
  { id: 1, parentId: null, depth: 0 },
  { id: 2, parentId: null, depth: 0 },
  { id: 3, parentId: null, depth: 0 },
];

describe('getProjection', () => {
  it('keeps sibling depth when dragged left or flat', () => {
    expect(getProjection(rows, 3, 1, 0)).toEqual({ depth: 0, parentId: null });
  });

  it('nests under previous row when dragged right', () => {
    expect(getProjection(rows, 3, 2, 1)).toEqual({ depth: 1, parentId: 2 });
  });
});

describe('getDropTarget', () => {
  it('maps a same-level move to the target group index', () => {
    expect(getDropTarget(rows, 3, 1, null)).toEqual({
      newParentId: null,
      newIndex: 0,
    });
  });

  it('maps a downward same-level move after the hovered row', () => {
    expect(getDropTarget(rows, 1, 3, null)).toEqual({
      newParentId: null,
      newIndex: 2,
    });
  });

  it('maps a nest to index 0 of the new parent group', () => {
    expect(getDropTarget(rows, 3, 2, 2)).toEqual({
      newParentId: 2,
      newIndex: 0,
    });
  });
});

describe('computeDragResult', () => {
  it('parents the dragged task under the hovered row for an inside drop', () => {
    expect(computeDragResult(rows, 3, 2, 0, 'inside')).toEqual({
      newParentId: 2,
      newIndex: 0,
    });
  });

  it('appends inside drops after existing target subtasks', () => {
    const nestedRows: FlatRow[] = [
      { childCount: 1, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 4, parentId: 1, depth: 1 },
      { childCount: 0, id: 2, parentId: null, depth: 0 },
      { childCount: 0, id: 3, parentId: null, depth: 0 },
    ];

    expect(computeDragResult(nestedRows, 3, 1, 0, 'inside')).toEqual({
      newParentId: 1,
      newIndex: 1,
    });
  });
});

describe('getDropInstruction', () => {
  const visibleRows: FlatRow[] = [
    { childCount: 0, id: 1, parentId: null, depth: 0 },
    { childCount: 0, id: 2, parentId: null, depth: 0 },
    { childCount: 0, id: 3, parentId: 1, depth: 1 },
  ];
  const targetRect = { top: 100, bottom: 164, left: 20, width: 300, height: 64 };

  it('drops above the target as a sibling from the left half', () => {
    expect(
      getDropInstruction(visibleRows, 3, 2, targetRect, {
        top: 136,
        left: 70,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 2, depth: 0, placement: 'before' },
      result: { newParentId: null, newIndex: 1 },
    });
  });

  it('drops below the target as a sibling from the lower band', () => {
    expect(
      getDropInstruction(visibleRows, 3, 2, targetRect, {
        top: 152,
        left: 70,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 2, depth: 0, placement: 'after' },
      result: { newParentId: null, newIndex: 2 },
    });
  });

  it('uses the pointer point for the drop band when available', () => {
    expect(
      getDropInstructionAtPoint(visibleRows, 3, 2, targetRect, { x: 70, y: 156 }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 2, depth: 0, placement: 'after' },
      result: { newParentId: null, newIndex: 2 },
    });
  });

  it('drops below the final visible row as a root task', () => {
    const nestedRows: FlatRow[] = [
      { childCount: 0, id: 1, parentId: null, depth: 0 },
      { childCount: 1, id: 2, parentId: null, depth: 0 },
      { childCount: 0, id: 3, parentId: 2, depth: 1 },
    ];

    expect(
      getDropInstructionAtPoint(
        nestedRows,
        3,
        3,
        { top: 228, bottom: 292, left: 20, width: 300, height: 64 },
        { x: 70, y: 304 },
      ),
    ).toMatchObject({
      indicator: { kind: 'root', rowId: 3, depth: 0, placement: 'after' },
      result: { newParentId: null, newIndex: 2 },
    });
  });

  it('drops inside the target as a child from the right half center band', () => {
    // Original child case: center Y in the middle band (25%-75%) and right
    // half of the row -> nest as a child of the target.
    expect(
      getDropInstruction(visibleRows, 3, 2, targetRect, {
        top: 136,
        left: 250,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'child', rowId: 2, depth: 1, placement: 'after' },
      result: { newParentId: 2, newIndex: 0 },
    });
  });

  it('does not nest when hovering the right half top band (before sibling)', () => {
    // top: 100, height: 20 -> centerY 110 < topBand end (116) -> before.
    expect(
      getDropInstruction(visibleRows, 3, 2, targetRect, {
        top: 100,
        left: 250,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 2, depth: 0, placement: 'before' },
      result: { newParentId: null, newIndex: 1 },
    });
  });

  it('does not nest when hovering the right half bottom band (after sibling)', () => {
    // top: 150, height: 20 -> centerY 160 > bottomBand start (148) -> after.
    expect(
      getDropInstruction(visibleRows, 3, 2, targetRect, {
        top: 150,
        left: 250,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 2, depth: 0, placement: 'after' },
      result: { newParentId: null, newIndex: 2 },
    });
  });

  it('falls back to an after-sibling when nesting is blocked by max depth', () => {
    // Separate branches so the dragged task is not an ancestor of the target;
    // id 6 sits at MAX_DEPTH (4), so the center "inside" band can't nest.
    const maxDepthRows: FlatRow[] = [
      { childCount: 0, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 2, parentId: null, depth: 0 },
      { childCount: 0, id: 3, parentId: 2, depth: 1 },
      { childCount: 0, id: 4, parentId: 3, depth: 2 },
      { childCount: 0, id: 5, parentId: 4, depth: 3 },
      { childCount: 0, id: 6, parentId: 5, depth: 4 },
    ];
    expect(
      getDropInstruction(maxDepthRows, 1, 6, targetRect, {
        top: 126,
        left: 250,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 6, depth: 4, placement: 'after' },
      result: { newParentId: 5, newIndex: 1 },
    });
  });

  it('drops above the first visible row as a root task', () => {
    expect(
      getDropInstruction(visibleRows, 3, 1, { ...targetRect, top: 20, bottom: 84 }, {
        top: 0,
        left: 70,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'root', rowId: 1, depth: 0, placement: 'before' },
      result: { newParentId: null, newIndex: 0 },
    });
  });

  it('drops a task as a sibling in the hovered task project', () => {
    const allProjectRows: FlatRow[] = [
      { childCount: 1, id: projectRootRowId(1), parentId: null, depth: 0, projectId: 1, type: 'project' },
      { childCount: 0, id: 1, parentId: null, depth: 1, projectId: 1, type: 'todo' },
      { childCount: 1, id: projectRootRowId(2), parentId: null, depth: 0, projectId: 2, type: 'project' },
      { childCount: 0, id: 2, parentId: null, depth: 1, projectId: 2, type: 'todo' },
    ];

    expect(
      getDropInstruction(allProjectRows, 1, 2, targetRect, {
        top: 152,
        left: 70,
        width: 20,
        height: 20,
      }),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: 2, depth: 1, placement: 'after' },
      result: { newProjectId: 2, newParentId: null, newIndex: 1 },
    });
  });

  it('does not reparent a task onto its own descendant (self-parent guard)', () => {
    // Dragging id 1 (a parent) over its direct child id 2: the sibling
    // branch would set newParentId = 1 (self-parent). The guard must reject it.
    const parentChildRows: FlatRow[] = [
      { childCount: 1, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 2, parentId: 1, depth: 1 },
      { childCount: 0, id: 3, parentId: null, depth: 0 },
    ];
    expect(
      getDropInstruction(parentChildRows, 1, 2, targetRect, {
        top: 152,
        left: 70,
        width: 20,
        height: 20,
      }),
    ).toBeNull();
  });
});

describe('getProjectRootDropInstruction', () => {
  it('drops a task at the end of the target project root group', () => {
    const allProjectRows: FlatRow[] = [
      { childCount: 1, id: projectRootRowId(1), parentId: null, depth: 0, projectId: 1, type: 'project' },
      { childCount: 0, id: 1, parentId: null, depth: 1, projectId: 1, type: 'todo' },
      { childCount: 1, id: projectRootRowId(2), parentId: null, depth: 0, projectId: 2, type: 'project' },
      { childCount: 0, id: 2, parentId: null, depth: 1, projectId: 2, type: 'todo' },
    ];

    expect(getProjectRootDropInstruction(allProjectRows, 1, 2)).toMatchObject({
      indicator: {
        depth: 1,
        kind: 'root',
        placement: 'after',
        rowId: 2,
      },
      result: { newProjectId: 2, newParentId: null, newIndex: 1 },
    });
  });
});

describe('getProjectLinkDropInstruction', () => {
  it('maps a dragged project row to a sibling project index', () => {
    const projectRows: FlatRow[] = [
      { id: projectRootRowId(1), parentId: null, depth: 0, projectId: 1, title: 'Alpha', type: 'project' },
      { id: projectRootRowId(2), parentId: null, depth: 0, projectId: 2, title: 'Beta', type: 'project' },
      { id: projectRootRowId(3), parentId: null, depth: 0, projectId: 3, title: 'Gamma', type: 'project' },
      { childCount: 0, id: 10, parentId: null, depth: 0, projectId: 99, type: 'todo' },
    ];

    expect(
      getProjectLinkDropInstruction(
        projectRows,
        projectRootRowId(3),
        projectRootRowId(2),
        { top: 100, bottom: 164, left: 20, width: 300, height: 64 },
        { top: 100, left: 70, width: 20, height: 20 },
      ),
    ).toMatchObject({
      indicator: { kind: 'sibling', rowId: projectRootRowId(2), depth: 0, placement: 'before' },
      result: { newParentId: null, newIndex: 1 },
    });
  });
});

describe('getVisualOverIndex', () => {
  it('maps an after-row indicator to the same visual gap index', () => {
    const visualRows: FlatRow[] = [
      { childCount: 0, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 2, parentId: null, depth: 0 },
      { childCount: 0, id: 3, parentId: null, depth: 0 },
      { childCount: 0, id: 4, parentId: null, depth: 0 },
    ];
    const instruction = getDropInstructionAtPoint(
      visualRows,
      4,
      2,
      { top: 100, bottom: 164, left: 20, width: 300, height: 64 },
      { x: 70, y: 156 },
    );

    expect(instruction).not.toBeNull();
    expect(getVisualOverIndex(visualRows, 4, instruction!)).toBe(2);
  });

  it('maps a before-row indicator to the same visual gap index', () => {
    const visualRows: FlatRow[] = [
      { childCount: 0, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 2, parentId: null, depth: 0 },
      { childCount: 0, id: 3, parentId: null, depth: 0 },
      { childCount: 0, id: 4, parentId: null, depth: 0 },
    ];
    const instruction = getDropInstruction(
      visualRows,
      1,
      3,
      { top: 100, bottom: 164, left: 20, width: 300, height: 64 },
      { top: 80, left: 70, width: 20, height: 20 },
    );

    expect(instruction).not.toBeNull();
    expect(getVisualOverIndex(visualRows, 1, instruction!)).toBe(1);
  });
});

describe('getDropPlacement', () => {
  const overRect = { top: 100, bottom: 164, height: 64 };

  it('uses the center band of the hovered row as an inside drop', () => {
    expect(getDropPlacement(overRect, { top: 114, height: 28 })).toBe('inside');
  });

  it('uses the upper and lower bands for ordinary row reordering', () => {
    expect(getDropPlacement(overRect, { top: 88, height: 20 })).toBe('before');
    expect(getDropPlacement(overRect, { top: 156, height: 20 })).toBe('after');
  });
});

describe('flattenRows', () => {
  it('maps task rows to flat reorder rows', () => {
    expect(
      flattenRows([
        {
          depth: 1,
          hasSubtasks: false,
          isCollapsed: false,
          todo: todo({ id: 8, parentId: 4 }),
          type: 'todo',
        },
      ]),
    ).toEqual([{ childCount: 0, id: 8, parentId: 4, depth: 1, projectId: 1, title: 'Task 8', type: 'todo' }]);
  });
});

describe('resolveDropLabel', () => {
  const labeledRows: FlatRow[] = [
    { childCount: 0, id: 1, parentId: null, depth: 0, title: 'Plan launch', type: 'todo' },
    { childCount: 0, id: 2, parentId: null, depth: 0, title: 'Write brief', type: 'todo' },
    { childCount: 0, id: 3, parentId: 1, depth: 1, title: 'Send invite', type: 'todo' },
    {
      childCount: 1,
      id: projectRootRowId(7),
      parentId: null,
      depth: 0,
      projectId: 7,
      title: 'Marketing',
      type: 'project',
    },
  ];

  it('labels a child drop as Inside', () => {
    expect(
      resolveDropLabel(labeledRows, {
        indicator: { depth: 1, kind: 'child', placement: 'after', rowId: 2 },
        result: { newParentId: 2, newIndex: 0 },
      }),
    ).toBe('Inside “Write brief”');
  });

  it('labels a before-sibling drop', () => {
    expect(
      resolveDropLabel(labeledRows, {
        indicator: { depth: 0, kind: 'sibling', placement: 'before', rowId: 2 },
        result: { newParentId: null, newIndex: 0 },
      }),
    ).toBe('Before “Write brief”');
  });

  it('labels an after-sibling drop', () => {
    expect(
      resolveDropLabel(labeledRows, {
        indicator: { depth: 0, kind: 'sibling', placement: 'after', rowId: 2 },
        result: { newParentId: null, newIndex: 1 },
      }),
    ).toBe('After “Write brief”');
  });

  it('labels a root drop on a project-root anchor as Root of', () => {
    expect(
      resolveDropLabel(labeledRows, {
        indicator: { depth: 1, kind: 'root', placement: 'after', rowId: projectRootRowId(7) },
        result: { newParentId: null, newIndex: 0, newProjectId: 7 },
      }),
    ).toBe('Root of “Marketing”');
  });

  it('labels a root drop on a todo anchor preserving placement', () => {
    expect(
      resolveDropLabel(labeledRows, {
        indicator: { depth: 0, kind: 'root', placement: 'before', rowId: 1 },
        result: { newParentId: null, newIndex: 0 },
      }),
    ).toBe('Root task · Before “Plan launch”');
  });

  it('falls back to "task" when the anchor row has no title', () => {
    const untitledRows: FlatRow[] = [
      { childCount: 0, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 2, parentId: null, depth: 0 },
    ];
    expect(
      resolveDropLabel(untitledRows, {
        indicator: { depth: 0, kind: 'sibling', placement: 'after', rowId: 2 },
        result: { newParentId: null, newIndex: 1 },
      }),
    ).toBe('After task');
  });
});

describe('getDropPointMarkers', () => {
  const labeledRows: FlatRow[] = [
    { childCount: 0, id: 1, parentId: null, depth: 0, title: 'Plan launch', type: 'todo' },
    { childCount: 0, id: 2, parentId: null, depth: 0, title: 'Write brief', type: 'todo' },
    { childCount: 0, id: 3, parentId: 1, depth: 1, title: 'Send invite', type: 'todo' },
    {
      childCount: 1,
      id: projectRootRowId(7),
      parentId: null,
      depth: 0,
      projectId: 7,
      title: 'Marketing',
      type: 'project',
    },
  ];

  it('exposes before/inside/after on a plain todo row', () => {
    const markers = getDropPointMarkers(labeledRows, 1, 2);
    expect(markers).not.toBeNull();
    expect(markers!.map((m) => ({ placement: m.placement, label: m.label }))).toEqual([
      { placement: 'before', label: 'Before “Write brief”' },
      { placement: 'inside', label: 'Inside “Write brief”' },
      { placement: 'after', label: 'After “Write brief”' },
    ]);
  });

  it('offers no inside marker at max depth (over row already at depth 4)', () => {
    const maxDepthRows: FlatRow[] = [
      { childCount: 0, id: 1, parentId: null, depth: 0 },
      { childCount: 0, id: 2, parentId: null, depth: 0 },
      { childCount: 0, id: 3, parentId: 2, depth: 1 },
      { childCount: 0, id: 4, parentId: 3, depth: 2 },
      { childCount: 0, id: 5, parentId: 4, depth: 3 },
      { childCount: 0, id: 6, parentId: 5, depth: 4 },
    ];
    const markers = getDropPointMarkers(maxDepthRows, 1, 6);
    expect(markers).not.toBeNull();
    expect(markers!.map((m) => ({ placement: m.placement, label: m.label }))).toEqual([
      { placement: 'before', label: 'Before task' },
      { placement: 'after', label: 'After task' },
    ]);
  });

  it('offers only a single root marker on a project-root row', () => {
    const markers = getDropPointMarkers(labeledRows, 1, projectRootRowId(7));
    expect(markers).not.toBeNull();
    expect(markers!.map((m) => ({ placement: m.placement, label: m.label }))).toEqual([
      { placement: 'after', label: 'Root of “Marketing”' },
    ]);
  });

  it('offers no markers for the dragged task itself or its own descendant', () => {
    // Row 2 is a direct child of row 1, contiguous in depth -> descendant.
    const parentChildRows: FlatRow[] = [
      { childCount: 1, id: 1, parentId: null, depth: 0, title: 'Parent', type: 'todo' },
      { childCount: 0, id: 2, parentId: 1, depth: 1, title: 'Child', type: 'todo' },
    ];
    expect(getDropPointMarkers(parentChildRows, 1, 1)).toBeNull();
    expect(getDropPointMarkers(parentChildRows, 1, 2)).toBeNull();
  });
});

describe('resolveDragEndDropInstruction', () => {
  it('keeps the last explicit drop-box instruction when drag end resolves no instruction', () => {
    const afterRunInstruction = {
      indicator: { depth: 0, kind: 'sibling', placement: 'after', rowId: 2 },
      result: { newParentId: null, newIndex: 2 },
    } as const;

    expect(
      resolveDragEndDropInstruction({
        activeOverId: 'droppoint:after:2',
        previousInstruction: afterRunInstruction,
        resolvedInstruction: null,
      }),
    ).toBe(afterRunInstruction);
  });

  it('does not reuse a row-hover instruction after drag end resolves no instruction', () => {
    const rowHoverInstruction = {
      indicator: { depth: 0, kind: 'sibling', placement: 'after', rowId: 2 },
      result: { newParentId: null, newIndex: 2 },
    } as const;

    expect(
      resolveDragEndDropInstruction({
        activeOverId: 2,
        previousInstruction: rowHoverInstruction,
        resolvedInstruction: null,
      }),
    ).toBeNull();
  });
});

function todo(overrides: Pick<TodoSummary, 'id'> & Partial<TodoSummary>): TodoSummary {
  const { id, ...rest } = overrides;
  return {
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    activeWorkingDirectory: '~/p/tmatrix',
    deadline: null,
    dependencies: [],
    descriptionMarkdown: '',
    displayId: `T-${id}`,
    events: [],
    id,
    ownTimeSeconds: 0,
    position: 0,
    priority: 'None',
    projectId: 1,
    rolledUpTimeSeconds: 0,
    stale: false,
    state: 'To Do',
    subtasks: [],
    tags: [],
    timeLogs: [],
    title: `Task ${id}`,
    updatedAt: '2026-06-20T10:00:00Z',
    ...rest,
    createdAt: rest.createdAt ?? '2026-06-20T09:00:00Z',
  };
}
