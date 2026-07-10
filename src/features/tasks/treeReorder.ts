import type { TaskRowModel } from './taskRowModel';

export type ProjectRootRowId = `project:${number}`;
export type RowId = number | ProjectRootRowId;

export type FlatRow = {
  childCount?: number;
  id: RowId;
  parentId: number | null;
  depth: number;
  projectId?: number;
  title?: string;
  type?: 'project' | 'todo';
};

export type DropPlacement = 'before' | 'inside' | 'after' | 'auto';
export type DropIndicator = {
  depth: number;
  kind: 'root' | 'sibling' | 'child';
  placement: 'before' | 'after';
  rowId: RowId;
};
export type DropInstruction = {
  indicator: DropIndicator;
  result: { newParentId: number | null; newIndex: number; newProjectId?: number };
};

type RectLike = {
  bottom?: number;
  height: number;
  left?: number;
  top: number;
  width?: number;
};

const MAX_DEPTH = 4;

export function flattenRows(taskRows: TaskRowModel[]): FlatRow[] {
  return taskRows
    .map((row) =>
      row.type === 'project'
        ? {
            childCount: row.childCount,
            depth: row.depth,
            id: projectRootRowId(row.project.id),
            parentId: null,
            projectId: row.project.id,
            title: row.project.name,
            type: 'project',
          }
      : row.type === 'subproject'
        ? {
            childCount: row.project.activeTodoCount,
            depth: row.depth,
            id: projectRootRowId(row.project.id),
            parentId: null,
            projectId: row.project.id,
            title: row.project.name,
            type: 'project' as const,
          }
        : {
            childCount: row.todo.subtasks.length,
            depth: row.depth,
            id: row.todo.id,
            parentId: row.todo.parentId ?? null,
            projectId: row.todo.projectId,
            title: row.todo.title,
            type: 'todo' as const,
          },
    );
}

export function projectRootRowId(projectId: number): ProjectRootRowId {
  return `project:${projectId}`;
}

export function parseProjectRootRowId(id: string | number): number | null {
  if (typeof id !== 'string' || !id.startsWith('project:')) {
    return null;
  }
  const projectId = Number(id.slice('project:'.length));
  return Number.isFinite(projectId) ? projectId : null;
}

export function getDropPlacement(
  overRect: RectLike,
  activeRect: RectLike,
): Exclude<DropPlacement, 'auto'> {
  const overBottom = overRect.bottom ?? overRect.top + overRect.height;
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const topBandEnd = overRect.top + overRect.height * 0.25;
  const bottomBandStart = overBottom - overRect.height * 0.25;

  if (activeCenterY < topBandEnd) {
    return 'before';
  }
  if (activeCenterY > bottomBandStart) {
    return 'after';
  }

  return 'inside';
}

export function getDropInstruction(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  overRect: RectLike,
  activeRect: RectLike,
): DropInstruction | null {
  const overIndex = rows.findIndex((row) => row.id === overId);
  const over = rows[overIndex];
  if (!over || activeId === overId) {
    return null;
  }
  if (isProjectRow(over)) {
    return getProjectRootDropInstruction(rows, activeId, over.projectId);
  }
  if (!isTodoRow(over)) {
    return null;
  }

  const activeCenterY = activeRect.top + activeRect.height / 2;
  const isAboveFirstRow = overIndex === 0 && activeCenterY < overRect.top + overRect.height / 2;
  if (isAboveFirstRow) {
    return {
      indicator: { depth: 0, kind: 'root', placement: 'before', rowId: overId },
      result: { newParentId: null, newIndex: 0, newProjectId: over.projectId },
    };
  }

  const overLeft = overRect.left ?? 0;
  const overWidth = overRect.width ?? 0;
  const activeCenterX = (activeRect.left ?? 0) + (activeRect.width ?? 0) / 2;
  const isRightHalf = overWidth > 0 && activeCenterX >= overLeft + overWidth / 2;
  const dropPlacement = getDropPlacement(overRect, activeRect);

  if (
    isRightHalf &&
    dropPlacement === 'inside' &&
    over.depth < MAX_DEPTH &&
    !isDescendantOf(rows, activeId, over.id)
  ) {
    const childCount =
      over.childCount ?? rows.filter((row) => row.parentId === over.id).length;
    return {
      indicator: {
        depth: Math.min(over.depth + 1, MAX_DEPTH),
        kind: 'child',
        placement: 'after',
        rowId: over.id,
      },
      result: {
        newParentId: over.id,
        newIndex: Math.max(0, childCount),
        newProjectId: over.projectId,
      },
    };
  }

  const siblingParentId = over.parentId;
  // Reject dropping a task as a sibling of its own descendant (would
  // reparent the task under itself) and the existing cycle guard.
  if (
    (siblingParentId !== null && isDescendantOf(rows, activeId, siblingParentId)) ||
    isDescendantOf(rows, activeId, over.id)
  ) {
    return null;
  }

  // When the pointer is in the right-half center "inside" band but nesting
  // was blocked (max depth reached, or the dragged task is an ancestor of
  // the target), fall back to an after-sibling so the drop doesn't silently
  // insert before the target.
  const nestingBlocked = isRightHalf && dropPlacement === 'inside';

  if (dropPlacement === 'after' || nestingBlocked) {
    return {
      indicator: {
        depth: over.depth,
        kind: 'sibling',
        placement: 'after',
        rowId: overId,
      },
      result: {
        newParentId: siblingParentId,
        newIndex: getIndexAfterRow(rows, activeId, overId, siblingParentId, over.projectId),
        newProjectId: over.projectId,
      },
    };
  }

  return {
    indicator: {
      depth: over.depth,
      kind: 'sibling',
      placement: 'before',
      rowId: overId,
    },
    result: {
      newParentId: siblingParentId,
      newIndex: getIndexBeforeRow(rows, activeId, overId, siblingParentId, over.projectId),
      newProjectId: over.projectId,
    },
  };
}

export function getDropInstructionAtPoint(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  overRect: RectLike,
  point: { x: number; y: number },
): DropInstruction | null {
  const lastRow = rows[rows.length - 1];
  if (lastRow?.id === overId) {
    const overBottom = overRect.bottom ?? overRect.top + overRect.height;
    if (point.y >= overBottom) {
      return getRootDropInstructionAfterLastRow(rows, activeId);
    }
  }

  return getDropInstruction(rows, activeId, overId, overRect, {
    height: 0,
    left: point.x,
    top: point.y,
    width: 0,
  });
}

export function getVisualOverIndex(
  rows: FlatRow[],
  activeId: RowId,
  instruction: DropInstruction,
): number | null {
  const activeIndex = rows.findIndex((row) => row.id === activeId);
  const targetIndex = rows.findIndex((row) => row.id === instruction.indicator.rowId);
  if (activeIndex < 0 || targetIndex < 0) {
    return null;
  }

  const visualIndex =
    instruction.indicator.placement === 'after'
      ? activeIndex < targetIndex
        ? targetIndex
        : targetIndex + 1
      : activeIndex < targetIndex
        ? targetIndex - 1
        : targetIndex;
  return clampIndex(visualIndex, rows.length);
}

export function getProjectLinkDropInstruction(
  rows: FlatRow[],
  activeId: ProjectRootRowId,
  overId: RowId,
  overRect: RectLike,
  activeRect: RectLike,
): DropInstruction | null {
  if (activeId === overId) {
    return null;
  }

  const active = rows.find((row) => row.id === activeId);
  const over = rows.find((row) => row.id === overId);
  if (!active || !over || !isProjectRow(active) || !isProjectRow(over)) {
    return null;
  }

  const placement = getDropPlacement(overRect, activeRect) === 'before' ? 'before' : 'after';
  const siblings = rows.filter((row) => isProjectRow(row) && row.id !== activeId);
  const overIndex = siblings.findIndex((row) => row.id === overId);
  if (overIndex < 0) {
    return null;
  }
  const newIndex = placement === 'before' ? overIndex : overIndex + 1;

  return {
    indicator: {
      depth: over.depth,
      kind: 'sibling',
      placement,
      rowId: over.id,
    },
    result: {
      newParentId: null,
      newIndex,
    },
  };
}

export function getProjection(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  dragDepth: number,
): { depth: number; parentId: number | null } {
  const overIndex = rows.findIndex((row) => row.id === overId);
  const over = rows[overIndex];
  if (!over || activeId === overId) {
    const active = rows.find((row) => row.id === activeId);
    return { depth: active?.depth ?? 0, parentId: active?.parentId ?? null };
  }

  const maxDepth = Math.min(over.depth + 1, MAX_DEPTH);
  const depth = Math.max(0, Math.min(dragDepth, maxDepth));
  if (depth === 0) {
    return { depth, parentId: null };
  }
  if (depth > over.depth && isTodoRow(over)) {
    return { depth, parentId: over.id };
  }
  if (depth === over.depth) {
    return { depth, parentId: over.parentId };
  }

  const parent = rows
    .slice(0, overIndex)
    .reverse()
    .find((row) => isTodoRow(row) && row.depth === depth - 1);
  return { depth, parentId: typeof parent?.id === 'number' ? parent.id : null };
}

export function getDropTarget(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  projectedParentId: number | null,
  dropPlacement: DropPlacement = 'auto',
): { newParentId: number | null; newIndex: number; newProjectId?: number } {
  const over = rows.find((row) => row.id === overId);
  if (over && isProjectRow(over)) {
    return getProjectRootDropInstruction(rows, activeId, over.projectId)?.result ?? {
      newParentId: null,
      newIndex: 0,
      newProjectId: over.projectId,
    };
  }

  if (dropPlacement === 'inside') {
    if (!over || !isTodoRow(over) || activeId === overId || isDescendantOf(rows, activeId, overId)) {
      return getCurrentTarget(rows, activeId);
    }

    const childCount =
      over.childCount ?? rows.filter((row) => row.parentId === over.id).length;
    return {
      newParentId: over.id,
      newIndex: Math.max(0, childCount),
      newProjectId: over.projectId,
    };
  }

  const activeIndex = rows.findIndex((row) => row.id === activeId);
  const originalOverIndex = rows.findIndex((row) => row.id === overId);
  const withoutActive = rows.filter((row) => row.id !== activeId);
  const overIndex = withoutActive.findIndex((row) => row.id === overId);
  const insertionIndex =
    overIndex < 0
      ? withoutActive.length
      : activeIndex >= 0 && originalOverIndex >= 0 && activeIndex < originalOverIndex
        ? overIndex + 1
        : overIndex;
  const targetProjectId = over?.projectId;
  const sequence: FlatRow[] = [
    ...withoutActive.slice(0, insertionIndex),
    {
      depth: 0,
      id: activeId,
      parentId: projectedParentId,
      projectId: targetProjectId,
      type: 'todo',
    },
    ...withoutActive.slice(insertionIndex),
  ];
  const siblings = sequence.filter(
    (row) =>
      isTodoRow(row) &&
      row.parentId === projectedParentId &&
      (targetProjectId === undefined || row.projectId === targetProjectId),
  );
  const newIndex = siblings.findIndex((row) => row.id === activeId);
  return {
    newParentId: projectedParentId,
    newIndex: Math.max(0, newIndex),
    newProjectId: targetProjectId,
  };
}

export function computeDragResult(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  dragDepth: number,
  dropPlacement: DropPlacement = 'auto',
): { newParentId: number | null; newIndex: number; newProjectId?: number } {
  const projection = getProjection(rows, activeId, overId, dragDepth);
  const placement = projection.parentId === overId ? 'inside' : dropPlacement;
  return getDropTarget(rows, activeId, overId, projection.parentId, placement);
}

export function getProjectRootDropInstruction(
  rows: FlatRow[],
  activeId: number,
  projectId: number,
): DropInstruction | null {
  const projectRoot = rows.find((row) => isProjectRow(row) && row.projectId === projectId);
  if (!projectRoot) {
    return null;
  }

  const rootTodos = rows.filter(
    (row) =>
      isTodoRow(row) &&
      row.id !== activeId &&
      row.projectId === projectId &&
      row.parentId === null,
  );
  const lastRootTodo = rootTodos[rootTodos.length - 1];
  const newIndex = rootTodos.length > 0 ? rootTodos.length : (projectRoot.childCount ?? 0);

  return {
    indicator: {
      depth: 1,
      kind: 'root',
      placement: 'after',
      rowId: lastRootTodo?.id ?? projectRoot.id,
    },
    result: {
      newParentId: null,
      newIndex,
      newProjectId: projectId,
    },
  };
}

function isDescendantOf(
  rows: FlatRow[],
  ancestorId: number,
  possibleDescendantId: RowId,
): boolean {
  const ancestorIndex = rows.findIndex((row) => row.id === ancestorId);
  const ancestor = rows[ancestorIndex];
  if (!ancestor) {
    return false;
  }

  for (const row of rows.slice(ancestorIndex + 1)) {
    if (row.depth <= ancestor.depth) {
      return false;
    }
    if (row.id === possibleDescendantId) {
      return true;
    }
  }

  return false;
}

function getCurrentTarget(
  rows: FlatRow[],
  activeId: number,
): { newParentId: number | null; newIndex: number; newProjectId?: number } {
  const active = rows.find((row) => row.id === activeId);
  if (!active) {
    return { newParentId: null, newIndex: 0 };
  }

  const siblings = rows.filter(
    (row) =>
      isTodoRow(row) &&
      row.parentId === active.parentId &&
      (active.projectId === undefined || row.projectId === active.projectId),
  );
  return {
    newParentId: active.parentId,
    newIndex: Math.max(0, siblings.findIndex((row) => row.id === activeId)),
    newProjectId: active.projectId,
  };
}

function getIndexBeforeRow(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  parentId: number | null,
  projectId?: number,
): number {
  const siblings = rows.filter(
    (row) =>
      isTodoRow(row) &&
      row.id !== activeId &&
      row.parentId === parentId &&
      (projectId === undefined || row.projectId === projectId),
  );
  const overIndex = siblings.findIndex((row) => row.id === overId);
  return overIndex >= 0 ? overIndex : siblings.length;
}

function getIndexAfterRow(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
  parentId: number | null,
  projectId?: number,
): number {
  const siblings = rows.filter(
    (row) =>
      isTodoRow(row) &&
      row.id !== activeId &&
      row.parentId === parentId &&
      (projectId === undefined || row.projectId === projectId),
  );
  const overIndex = siblings.findIndex((row) => row.id === overId);
  return overIndex >= 0 ? overIndex + 1 : siblings.length;
}

function getRootDropInstructionAfterLastRow(
  rows: FlatRow[],
  activeId: number,
): DropInstruction | null {
  const lastRow = rows[rows.length - 1];
  if (!lastRow) {
    return null;
  }

  const targetProjectId = lastRow.projectId;
  const visibleRootIndex = rows.filter(
    (row) =>
      isTodoRow(row) &&
      row.id !== activeId &&
      row.parentId === null &&
      (targetProjectId === undefined || row.projectId === targetProjectId),
  ).length;
  const rootIndex =
    visibleRootIndex > 0 || !isProjectRow(lastRow)
      ? visibleRootIndex
      : (lastRow.childCount ?? 0);
  return {
    indicator: {
      depth: targetProjectId === undefined ? 0 : 1,
      kind: 'root',
      placement: 'after',
      rowId: lastRow.id,
    },
    result: { newParentId: null, newIndex: rootIndex, newProjectId: targetProjectId },
  };
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(0, index), Math.max(0, length - 1));
}

function isProjectRow(row: FlatRow): row is FlatRow & { projectId: number; type: 'project' } {
  return row.type === 'project';
}

function isTodoRow(row: FlatRow): row is FlatRow & { id: number } {
  return typeof row.id === 'number' && row.type !== 'project';
}

/**
 * Human-readable description of where a drop will land, derived from the
 * drop instruction and the flat row list (which carries each row's title).
 * Examples: "Inside “X”", "After “Y”", "Before “Y”", "Root task · After “Y”".
 */
export function resolveDropLabel(
  rows: FlatRow[],
  instruction: DropInstruction,
): string {
  const { indicator } = instruction;
  const target = rows.find((row) => row.id === indicator.rowId);
  const targetTitle = target?.title?.trim();
  const label = targetTitle ? `“${targetTitle}”` : 'task';
  const isProject = target?.type === 'project';

  if (indicator.kind === 'child') {
    return `Inside ${label}`;
  }
  if (indicator.kind === 'root') {
    // Root drops land at the project-root level; preserve placement so the
    // user can tell "before" vs "after" the anchor row. Reserve "under" for
    // project-root anchors to avoid reading as a child drop.
    const placed = indicator.placement === 'before' ? `Before ${label}` : `After ${label}`;
    return isProject ? `Root of ${label}` : `Root task · ${placed}`;
  }
  // sibling
  return indicator.placement === 'before' ? `Before ${label}` : `After ${label}`;
}

/**
 * The set of candidate drop points a row exposes during an active drag, and
 * the label for each. Derived by probing `getDropInstructionAtPoint` with
 * representative points for the top (before), right-middle (inside), and
 * bottom (after) bands, so the visible markers never advertise a drop the
 * model won't honor — including the left-half middle (sibling-before) and
 * above-first-row (root-before) special cases.
 *
 * Returns `null` for a row with no valid drop points (e.g. the dragged task
 * itself, or its own descendant).
 */
export type DropPointMarker = {
  instruction: DropInstruction;
  label: string;
  placement: 'before' | 'inside' | 'after';
};

// Synthetic row rect used only to derive band math; real drag coordinates are
// not available at this call site, but the band thresholds scale with height,
// so a normalized 64px tall row keeps before/inside/after representative.
const MARKER_ROW_RECT: RectLike = { top: 0, height: 64, left: 0, width: 320 };

export function getDropPointMarkers(
  rows: FlatRow[],
  activeId: number,
  overId: RowId,
): DropPointMarker[] | null {
  const over = rows.find((row) => row.id === overId);
  if (!over || over.id === activeId) {
    return null;
  }

  // Probe points: top-center-left (before band), right-middle (inside band),
  // bottom-center-left (after band).
  const probes: Array<{ placement: 'before' | 'inside' | 'after'; point: { x: number; y: number } }> = [
    { placement: 'before', point: { x: 40, y: 6 } },
    { placement: 'inside', point: { x: 280, y: 32 } },
    { placement: 'after', point: { x: 40, y: 58 } },
  ];

  const seen = new Set<string>();
  const markers: DropPointMarker[] = [];
  for (const { point } of probes) {
    const instruction = getDropInstructionAtPoint(rows, activeId, overId, MARKER_ROW_RECT, point);
    if (!instruction) {
      continue;
    }
    // Dedupe by the probed instruction so the same drop point isn't shown
    // twice (e.g. max-depth inside falls back to after-sibling, same as the
    // bottom band probe; project-root probes all collapse to one marker).
    const dedupeKey = `${instruction.indicator.kind}:${instruction.indicator.placement}:${instruction.indicator.rowId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    // Derive the marker placement from the actual instruction, not the probe:
    // only label "inside" when the model truly nests (kind === 'child');
    // otherwise map to before/after by the instruction's placement.
    const markerPlacement: 'before' | 'inside' | 'after' =
      instruction.indicator.kind === 'child'
        ? 'inside'
        : instruction.indicator.placement;
    markers.push({ instruction, label: resolveDropLabel(rows, instruction), placement: markerPlacement });
  }

  return markers.length > 0 ? markers : null;
}

export function getProjectLinkDropPointMarkers(
  rows: FlatRow[],
  activeId: ProjectRootRowId,
  overId: RowId,
): DropPointMarker[] | null {
  const over = rows.find((row) => row.id === overId);
  if (!over || over.id === activeId || !isProjectRow(over)) {
    return null;
  }

  const probes: Array<{ point: { x: number; y: number } }> = [
    { point: { x: 40, y: 6 } },
    { point: { x: 40, y: 58 } },
  ];
  const seen = new Set<string>();
  const markers: DropPointMarker[] = [];
  for (const { point } of probes) {
    const instruction = getProjectLinkDropInstruction(
      rows,
      activeId,
      overId,
      MARKER_ROW_RECT,
      { height: 0, left: point.x, top: point.y, width: 0 },
    );
    if (!instruction) {
      continue;
    }
    const dedupeKey = `${instruction.indicator.placement}:${instruction.indicator.rowId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    markers.push({
      instruction,
      label: resolveDropLabel(rows, instruction),
      placement: instruction.indicator.placement,
    });
  }

  return markers.length > 0 ? markers : null;
}

/** Build a stable droppable id for a drop-point box. */
export function dropPointBoxId(
  placement: 'before' | 'inside' | 'after',
  rowId: RowId,
): `droppoint:${'before' | 'inside' | 'after'}:${string}` {
  return `droppoint:${placement}:${String(rowId)}`;
}

/** Parse a drop-point box id back into its placement + rowId, or null. */
export function parseDropPointBoxId(
  id: string | number,
): { placement: 'before' | 'inside' | 'after'; rowId: RowId } | null {
  if (typeof id !== 'string' || !id.startsWith('droppoint:')) {
    return null;
  }
  const rest = id.slice('droppoint:'.length);
  const sep = rest.indexOf(':');
  if (sep < 0) {
    return null;
  }
  const placement = rest.slice(0, sep) as 'before' | 'inside' | 'after';
  if (placement !== 'before' && placement !== 'inside' && placement !== 'after') {
    return null;
  }
  const rowIdStr = rest.slice(sep + 1);
  const rowId: RowId = rowIdStr.startsWith('project:')
    ? (rowIdStr as ProjectRootRowId)
    : Number(rowIdStr);
  return { placement, rowId };
}

export function resolveDragEndDropInstruction({
  activeOverId,
  previousInstruction,
  resolvedInstruction,
}: {
  activeOverId: string | number | null;
  previousInstruction: DropInstruction | null;
  resolvedInstruction: DropInstruction | null;
}): DropInstruction | null {
  if (resolvedInstruction) {
    return resolvedInstruction;
  }

  return previousInstruction && activeOverId !== null && parseDropPointBoxId(activeOverId)
    ? previousInstruction
    : null;
}
