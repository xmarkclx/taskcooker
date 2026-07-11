import {
  closestCenter,
  pointerWithin,
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  type SortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarPlus,
  Check,
  ChevronDown,
  Flag,
  FolderPlus,
  History,
  Link2,
  ListTree,
  Play,
  Plus,
  Search,
  Star,
  TreePine,
} from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SVGProps,
} from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ProjectStatus,
  ProjectSummary,
  TodoPriority,
  TodoState,
  TodoSummary,
} from '../../domain/domain';
import { TODO_STATES, formatDuration } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { projectAccentStyle } from '../../app/appShellHelpers';
import { useStableCallbackProps } from '../../app/useStableCallbackProps';
import { useNow } from '../time/liveTime';
import { summarizeTodoTime } from '../time/timeRange';
import type { TaskFilter, TaskSortMode } from '../workspace/workspaceHelpers';
import { ListContextMenu } from './ListContextMenu';
import {
  canUseNativeListContextMenu,
  openNativeListContextMenu,
} from './nativeListContextMenu';
import {
  canUseNativeTaskRowContextMenu,
  openNativeTaskRowContextMenu,
} from './nativeTaskRowContextMenu';
import { StateBadge, TaskMetaBadge } from './taskBadges';
import { TaskTimerButton } from './TaskTimerButton';
import { TaskRowContextMenu } from './TaskRowContextMenu';
import { SubprojectRowContextMenu } from './SubprojectRowContextMenu';
import { formatTaskUri, parseTaskUri } from './taskLinks';
import type { ProjectRootRowModel, SubprojectRowModel, TaskRowModel } from './taskRowModel';
import {
  canUseNativeSubprojectRowContextMenu,
  openNativeSubprojectRowContextMenu,
} from './nativeSubprojectRowContextMenu';
import {
  dropPointBoxId,
  flattenRows,
  getDropInstruction,
  getDropInstructionAtPoint,
  getDropPointMarkers,
  getProjectLinkDropInstruction,
  getProjectLinkDropPointMarkers,
  getVisualOverIndex,
  parseProjectRootRowId,
  parseDropPointBoxId,
  projectRootRowId,
  resolveDragEndDropInstruction,
  resolveDropLabel,
  type DropIndicator,
  type DropInstruction,
  type DropPointMarker,
  type ProjectRootRowId,
  type RowId,
} from './treeReorder';

const MIN_TASK_LIST_WIDTH = 330;
const MAX_TASK_LIST_WIDTH = 520;
const TASK_LIST_KEYBOARD_STEP = 16;
const TASK_VIEW_OPTIONS: Array<{
  Icon: typeof ListTree;
  label: string;
  mode: TaskSortMode;
}> = [
  { Icon: ListTree, label: 'Tree View', mode: 'manual' },
  { Icon: History, label: 'Updated View', mode: 'updated' },
  { Icon: Flag, label: 'Priority View', mode: 'default' },
  { Icon: CalendarPlus, label: 'Created View', mode: 'created' },
];
const TASK_FILTER_LABELS: Record<TaskFilter, string> = {
  tasks: 'Tasks',
  review: 'Ready to Test',
  feedback: 'Needs Feedback',
  todo: 'To Do',
  delegated: 'Delegated',
  blocked: 'Blocked',
  archived: 'Archived',
};
const TASK_ROW_TODAY_SELECTION = {
  amount: 24,
  endLocal: '',
  mode: 'today',
  startLocal: '',
  unit: 'hours',
} as const;
const EMPTY_SET: Set<number> = new Set<number>();
const EMPTY_PROJECTS: ProjectSummary[] = [];

export type TaskListAccordionState = {
  collapsedProjectIds: Set<number>;
  collapsedSubprojectIds: Set<number>;
  collapsedTodoIds: Set<number>;
};

function emptyAccordionState(): TaskListAccordionState {
  return {
    collapsedProjectIds: new Set(),
    collapsedSubprojectIds: new Set(),
    collapsedTodoIds: new Set(),
  };
}

function toggleCollapsedId(ids: Set<number>, id: number): Set<number> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

type DelegatedCookingPotIconProps = SVGProps<SVGSVGElement> & {
  cooking: boolean;
};

function DelegatedCookingPotIcon({
  className,
  cooking,
  ...props
}: DelegatedCookingPotIconProps) {
  const stateClass = cooking ? 'cooking' : 'empty';

  return (
    <svg
      {...props}
      aria-hidden="true"
      className={`delegated-cooking-pot-icon ${stateClass}${className ? ` ${className}` : ''}`}
      fill="none"
      focusable="false"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      {cooking ? (
        <path
          className="delegated-cooking-pot-steam"
          d="M5.2 2.2c-.7.7-.7 1.3 0 2M8 1.8c-.7.7-.7 1.4 0 2.1M10.8 2.2c-.7.7-.7 1.3 0 2"
        />
      ) : null}
      <path className="delegated-cooking-pot-lid" d="M4 6h8M6.7 4.9h2.6" />
      <path
        className="delegated-cooking-pot-body"
        d="M3.5 6.2h9l-.7 5.1a2 2 0 0 1-2 1.7H6.2a2 2 0 0 1-2-1.7L3.5 6.2zM3.8 8.5H2.6M12.2 8.5h1.2"
      />
    </svg>
  );
}

// Module-scope sensor options: fresh object literals here would give
// useSensor new deps every render, rebuilding DndContext's internal context
// and re-rendering every sortable row on every list update.
const pointerSensorOptions = { activationConstraint: { distance: 4 } };
const keyboardSensorOptions = { coordinateGetter: sortableKeyboardCoordinates };
const taskListCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  // Drop-point boxes are nested inside sortable rows; prefer box targets so
  // the box (not the parent row) wins when the pointer is over a box.
  const boxCollisions = pointerCollisions.filter((c) =>
    parseDropPointBoxId(c.id) !== null,
  );
  return boxCollisions.length > 0
    ? boxCollisions
    : pointerCollisions.length > 0
      ? pointerCollisions
      : closestCenter(args);
};

// Memoized so parent state churn (search typing, dialogs, timers) skips the
// task list; its callback props stay stable via useStableCallbackProps.
export const TaskList = memo(function TaskList({
  accordionState,
  archivedCount,
  canCreateTask,
  delegatedCount = 0,
  filter,
  hideDelegated = false,
  showStarredOnly = false,
  onFilterChange,
  onHideDelegatedChange,
  onShowStarredOnlyChange,
  onNewTask,
  onOpenCreateTodo,
  projects = EMPTY_PROJECTS,
  showProjectRoots = false,
  onDeleteTodo,
  onDeleteTodos,
  onWidthChange,
  todos,
  selectedTodo,
  unreadTodoIds,
  onSelect,
  onOpenTaskWindow,
  onSetTodoState,
  onSetTodosState,
  onSetTodoPriority,
  onReorder,
  onLinkTodo,
  onSearchChange,
  onSortModeChange,
  onStateFilterChange,
  onStartTimer,
  onStopTimer,
  onTagFilterChange,
  runningTimerTodoId,
  searchValue,
  sortMode,
  stateFilter,
  tagFilter,
  tags,
  tasksCount,
  starredCount = 0,
  width,
  childProjects = [],
  selectedProjectId,
  focusedProjectId,
  onProjectSelect,
  onProjectFocus,
  onReorderProjectLink,
  onAddSubproject,
  onAccordionStateChange,
  onLinkProject,
  onUnlinkProject,
  onUpdateProjectStatus,
}: {
  accordionState?: TaskListAccordionState;
  archivedCount: number;
  canCreateTask: boolean;
  delegatedCount?: number;
  filter: TaskFilter;
  hideDelegated?: boolean;
  showStarredOnly?: boolean;
  onFilterChange: (filter: TaskFilter) => void;
  onHideDelegatedChange?: (hideDelegated: boolean) => void;
  onShowStarredOnlyChange?: (showStarredOnly: boolean) => void;
  onNewTask: () => void;
  onOpenCreateTodo?: (input: {
    parentId: number | null;
    position: number;
    projectId: number;
  }) => void;
  onDeleteTodo?: (todoId: number) => void;
  onDeleteTodos?: (todoIds: number[]) => void;
  onWidthChange: (width: number) => void;
  projects?: ProjectSummary[];
  showProjectRoots?: boolean;
  todos: TodoSummary[];
  selectedTodo?: TodoSummary;
  unreadTodoIds: ReadonlySet<number>;
  onSelect: (todoId: number) => void;
  onOpenTaskWindow?: (todoId: number) => void;
  onSetTodoState?: (todoId: number, state: TodoState) => boolean | void;
  onSetTodosState?: (todoIds: number[], state: TodoState) => void;
  onSetTodoPriority?: (todoId: number, priority: TodoPriority) => void;
  onReorder?: (
    todoId: number,
    newParentId: number | null,
    newIndex: number,
    newProjectId?: number,
  ) => void;
  onLinkTodo?: (input: {
    sourceTodoId: number;
    targetParentTodoId: number;
    position: number;
  }) => void;
  onSearchChange: (value: string) => void;
  onSortModeChange: (mode: TaskSortMode) => void;
  onStateFilterChange: (state: TodoState | '') => void;
  onStartTimer: (todoId: number) => void;
  onStopTimer: () => void;
  onTagFilterChange: (tag: string) => void;
  runningTimerTodoId: number | null;
  searchValue: string;
  sortMode: TaskSortMode;
  stateFilter: TodoState | '';
  tagFilter: string;
  tags: string[];
  tasksCount: number;
  starredCount?: number;
  width: number;
  childProjects?: ProjectSummary[];
  selectedProjectId?: number;
  focusedProjectId?: number;
  onProjectSelect?: (projectId: number) => void;
  onProjectFocus?: (projectId: number) => void;
  onReorderProjectLink?: (childProjectId: number, newIndex: number) => void;
  onAddSubproject?: (parentId: number) => void;
  onAccordionStateChange?: (state: TaskListAccordionState) => void;
  onLinkProject?: (parentId: number) => void;
  onUnlinkProject?: (parentId: number, childId: number) => void;
  onUpdateProjectStatus?: (projectId: number, status: ProjectStatus) => void;
}) {
  const now = useNow();
  const [internalAccordionState, setInternalAccordionState] = useState<TaskListAccordionState>(
    emptyAccordionState,
  );
  const effectiveAccordionState = accordionState ?? internalAccordionState;
  const setAccordionState = onAccordionStateChange ?? setInternalAccordionState;
  const { collapsedProjectIds, collapsedSubprojectIds, collapsedTodoIds } =
    effectiveAccordionState;
  const [completingTodoIds, setCompletingTodoIds] = useState<Set<number>>(() => new Set());
  const [dragState, setDragState] = useState<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const treeDragEnabled = sortMode === 'manual';
  const [subprojectContextMenu, setSubprojectContextMenu] = useState<{
    project: ProjectSummary;
    x: number;
    y: number;
  } | null>(null);
  const taskRows = useMemo(
    () =>
      buildTaskRows({
        childProjects,
        collapsedProjectIds,
        collapsedSubprojectIds,
        collapsedTodoIds,
        projects,
        selectedProjectId,
        showProjectRoots,
        todos,
        treeView: treeDragEnabled,
      }),
    [
      childProjects,
      collapsedProjectIds,
      collapsedSubprojectIds,
      collapsedTodoIds,
      projects,
      selectedProjectId,
      showProjectRoots,
      treeDragEnabled,
      todos,
    ],
  );
  const childProjectIdSet = useMemo(
    () => new Set(childProjects.map((project) => project.id)),
    [childProjects],
  );
  // Subproject rows and their nested child todos participate in DnD only in
  // manual tree view:
  // subproject rows are droppable anchors (project:${id}), their child todos
  // are sortable/draggable so you can reorder within the expanded subproject
  // task list, and cross-project drops target the subproject row.
  const dndTaskRows = taskRows;
  const flatRows = useMemo(() => flattenRows(dndTaskRows), [dndTaskRows]);
  const [contextMenu, setContextMenu] = useState<{
    pasteTask?: {
      label: string;
      sourceTodoId: number;
    } | null;
    todoId: number;
    todoIds: number[];
    x: number;
    y: number;
  } | null>(null);
  const [listContextMenu, setListContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<number>>(
    () => new Set(selectedTodo ? [selectedTodo.id] : []),
  );
  const [selectionAnchorId, setSelectionAnchorId] = useState<number | null>(
    selectedTodo?.id ?? null,
  );
  const [dropInstruction, setDropInstruction] = useState<DropInstruction | null>(null);
  const [draggedRowId, setDraggedRowId] = useState<RowId | null>(null);
  const draggedTodoId = typeof draggedRowId === 'number' ? draggedRowId : null;
  const draggedTodo = useMemo(
    () => todos.find((todo) => todo.id === draggedTodoId) ?? null,
    [draggedTodoId, todos],
  );
  const dropLabel = useMemo(
    () => (dropInstruction ? resolveDropLabel(flatRows, dropInstruction) : null),
    [dropInstruction, flatRows],
  );
  const dropMarkersByRowId = useMemo(() => {
    if (!treeDragEnabled || draggedRowId === null) {
      return null;
    }
    const map = new Map<RowId, DropPointMarker[]>();
    for (const row of flatRows) {
      const markers =
        typeof draggedRowId === 'number'
          ? getDropPointMarkers(flatRows, draggedRowId, row.id)
          : getProjectLinkDropPointMarkers(flatRows, draggedRowId, row.id);
      if (markers) {
        map.set(row.id, markers);
      }
    }
    return map;
  }, [draggedRowId, flatRows, treeDragEnabled]);
  const boxInstructionById = useMemo(() => {
    const map = new Map<string, DropInstruction>();
    if (!dropMarkersByRowId) {
      return map;
    }
    for (const [rowId, markers] of dropMarkersByRowId) {
      for (const marker of markers) {
        map.set(dropPointBoxId(marker.placement, rowId), marker.instruction);
      }
    }
    return map;
  }, [dropMarkersByRowId]);
  const [activeOverId, setActiveOverId] = useState<string | number | null>(null);
  const activeBoxId = useMemo(() => {
    if (typeof activeOverId !== 'string' || !activeOverId.startsWith('droppoint:')) {
      return null;
    }
    return activeOverId;
  }, [activeOverId]);
  const onWidthChangeRef = useRef(onWidthChange);
  const committedWidth = clampTaskListWidth(width);
  const visibleWidth = dragWidth ?? committedWidth;
  const sensors = useSensors(
    useSensor(PointerSensor, pointerSensorOptions),
    useSensor(KeyboardSensor, keyboardSensorOptions),
  );
  // The strategy reads drag state through a ref so its identity never
  // changes: an unstable strategy prop invalidates SortableContext's context
  // value, which re-renders every sortable row on every list update.
  const sortingStateRef = useRef({ dropInstruction, flatRows });
  sortingStateRef.current = { dropInstruction, flatRows };
  const sortingStrategy = useCallback<SortingStrategy>((args) => {
    const { dropInstruction: instruction, flatRows: rows } = sortingStateRef.current;
    const activeRow = rows[args.activeIndex];
    const visualOverIndex =
      activeRow && instruction
        ? getVisualOverIndex(rows, activeRow.id, instruction)
        : null;
    return verticalListSortingStrategy({
      ...args,
      overIndex: visualOverIndex ?? args.overIndex,
    });
  }, []);
  // Same reasoning: keep the items array identity stable while row order is
  // unchanged so a single-todo update leaves SortableContext untouched.
  const sortableIdsRef = useRef<Array<string | number>>([]);
  const sortableItems = useMemo(() => {
    const next = flatRows.map((row) => row.id);
    const previous = sortableIdsRef.current;
    if (
      previous.length === next.length &&
      previous.every((id, index) => id === next[index])
    ) {
      return previous;
    }
    sortableIdsRef.current = next;
    return next;
  }, [flatRows]);

  useEffect(() => {
    if (!selectedTodo) {
      setSelectedTodoIds(new Set());
      setSelectionAnchorId(null);
      return;
    }

    setSelectedTodoIds((current) => {
      if (current.has(selectedTodo.id)) {
        return current;
      }
      return new Set([selectedTodo.id]);
    });
    setSelectionAnchorId((current) => current ?? selectedTodo.id);
  }, [selectedTodo?.id, selectedTodo]);

  useEffect(() => {
    const finishedTodoIds = new Set(
      todos
        .filter((todo) => todo.state === 'Done')
        .map((todo) => todo.id),
    );
    setCompletingTodoIds((current) => {
      const next = new Set(
        Array.from(current).filter((todoId) => todos.some((todo) => todo.id === todoId)),
      );
      finishedTodoIds.forEach((todoId) => next.delete(todoId));
      return next.size === current.size && Array.from(next).every((todoId) => current.has(todoId))
        ? current
        : next;
    });
  }, [todos]);

  const markTodoDone = (todoId: number) => {
    if (!onSetTodoState || completingTodoIds.has(todoId)) {
      return;
    }

    if (onSetTodoState(todoId, 'Done') !== false) {
      setCompletingTodoIds((current) => new Set(current).add(todoId));
    }
  };

  const resolveDropInstruction = (
    overId: string | number,
    overRect: { top: number; height: number; left?: number; width?: number; bottom?: number },
    activeRect: { top: number; height: number; left?: number; width?: number },
    dragPoint: { x: number; y: number } | null,
    activeId: RowId,
  ): DropInstruction | null => {
    const parsed = parseDropPointBoxId(overId);
    if (parsed) {
      // Drop-point box is the target — look up the pre-computed instruction.
      return boxInstructionById.get(dropPointBoxId(parsed.placement, parsed.rowId)) ?? null;
    }
    const over = overId as RowId;
    if (typeof activeId === 'string') {
      return dragPoint
        ? getProjectLinkDropInstruction(flatRows, activeId, over, overRect, {
            height: 0,
            left: dragPoint.x,
            top: dragPoint.y,
            width: 0,
          })
        : getProjectLinkDropInstruction(flatRows, activeId, over, overRect, activeRect);
    }
    return dragPoint
      ? getDropInstructionAtPoint(flatRows, activeId, over, overRect, dragPoint)
      : getDropInstruction(flatRows, activeId, over, overRect, activeRect);
  };
  const handleDragStart = (event: DragStartEvent) => {
    if (!treeDragEnabled) {
      return;
    }
    setDraggedRowId(toRowId(event.active.id));
  };


  const handleDragMove = (event: DragMoveEvent) => {
    if (!treeDragEnabled) {
      return;
    }
    const active = toRowId(event.active.id);
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    const dragPoint = getDragPoint(event);
    setDraggedRowId(active);
    setActiveOverId(event.over ? event.over.id : null);
    setDropInstruction(
      event.over && activeRect
        ? resolveDropInstruction(event.over.id, event.over.rect, activeRect, dragPoint, active)
        : null,
    );
  };
  const handleDragEnd = (event: DragEndEvent) => {
    if (!treeDragEnabled) {
      setDropInstruction(null);
      setDraggedRowId(null);
      setActiveOverId(null);
      return;
    }
    const active = toRowId(event.active.id);
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    const dragPoint = getDragPoint(event);
    const resolvedInstruction = event.over && activeRect
      ? resolveDropInstruction(event.over.id, event.over.rect, activeRect, dragPoint, active)
      : dropInstruction;
    const instruction = resolveDragEndDropInstruction({
      activeOverId,
      previousInstruction: dropInstruction,
      resolvedInstruction,
    });

    clearDropState();
    if (!event.over) {
      return;
    }
    if (!instruction) {
      return;
    }

    const { newParentId, newIndex, newProjectId } = instruction.result;
    if (sortMode !== 'manual') {
      onSortModeChange('manual');
    }
    if (typeof active === 'string') {
      const activeProjectId = parseProjectRootRowId(active);
      if (activeProjectId !== null) {
        onReorderProjectLink?.(activeProjectId, newIndex);
      }
      return;
    }
    if (!onReorder) {
      return;
    }
    onReorder(active, newParentId, newIndex, newProjectId);
  };

  const clearDropState = () => {
    setDropInstruction(null);
    setDraggedRowId(null);
    setActiveOverId(null);
  };

  const handleDragCancel = () => {
    clearDropState();
  };

  const handleDragAbort = () => {
    clearDropState();
  };

  const openCreateTodo = (todoId: number, mode: 'above' | 'below' | 'subtask') => {
    const target = flatRows.find((row) => row.id === todoId);
    if (!target) {
      return;
    }
    const targetTodo = todos.find((todo) => todo.id === todoId);
    if (!targetTodo) {
      return;
    }

    if (mode === 'subtask') {
      const childCount = todos.filter((todo) => todo.parentId === todoId).length;
      onOpenCreateTodo?.({
        parentId: todoId,
        position: childCount,
        projectId: targetTodo.projectId,
      });
      return;
    }

    onOpenCreateTodo?.({
      parentId: target.parentId,
      position: mode === 'above' ? targetTodo.position : targetTodo.position + 1,
      projectId: targetTodo.projectId,
    });
  };

  const visibleTodoIds = () =>
    taskRows.flatMap((row) => (row.type === 'todo' ? [row.todo.id] : []));

  const rangeSelection = (anchorId: number, todoId: number): number[] => {
    const ids = visibleTodoIds();
    const anchorIndex = ids.indexOf(anchorId);
    const todoIndex = ids.indexOf(todoId);
    if (anchorIndex === -1 || todoIndex === -1) {
      return [todoId];
    }

    const start = Math.min(anchorIndex, todoIndex);
    const end = Math.max(anchorIndex, todoIndex);
    return ids.slice(start, end + 1);
  };

  const handleSelectTodo = (event: ReactMouseEvent<HTMLButtonElement>, todoId: number) => {
    if (event.shiftKey && selectionAnchorId !== null) {
      setSelectedTodoIds(new Set(rangeSelection(selectionAnchorId, todoId)));
      onSelect(todoId);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedTodoIds((current) => {
        const next = new Set(current);
        if (next.has(todoId) && next.size > 1) {
          next.delete(todoId);
        } else {
          next.add(todoId);
        }
        return next;
      });
      setSelectionAnchorId(todoId);
      onSelect(todoId);
      return;
    }

    setSelectedTodoIds(new Set([todoId]));
    setSelectionAnchorId(todoId);
    onSelect(todoId);
  };

  const contextTodoIds = (todoId: number): number[] => {
    if (!selectedTodoIds.has(todoId)) {
      return [todoId];
    }

    const visible = new Set(visibleTodoIds());
    return Array.from(selectedTodoIds)
      .filter((selectedId) => visible.has(selectedId))
      .sort((left, right) => visibleTodoIds().indexOf(left) - visibleTodoIds().indexOf(right));
  };

  const deleteContextTodos = (todoIds: number[]) => {
    if (onDeleteTodos) {
      onDeleteTodos(todoIds);
      return;
    }

    todoIds.forEach((todoId) => onDeleteTodo?.(todoId));
  };

  const setContextTodosState = (todoIds: number[], state: TodoState) => {
    if (onSetTodosState) {
      onSetTodosState(todoIds, state);
      return;
    }

    todoIds.forEach((todoId) => onSetTodoState?.(todoId, state));
  };

  const setContextTodosPriority = (todoIds: number[], priority: TodoPriority) => {
    todoIds.forEach((todoId) => onSetTodoPriority?.(todoId, priority));
  };

  const copyTaskLink = (todoId: number) => {
    const todo = todos.find((item) => item.id === todoId);
    const writeText = clipboardTextWriter();
    if (!todo || !writeText) {
      return;
    }

    void writeText(formatTaskUri(todo.displayId));
  };

  const linkTaskUnderParent = (sourceTodoId: number, targetParentTodoId: number) => {
    const target = todos.find((todo) => todo.id === targetParentTodoId);
    onLinkTodo?.({
      sourceTodoId,
      targetParentTodoId,
      position: target?.linkedTasks?.length ?? 0,
    });
  };

  const resolveClipboardTask = async (targetTodoId: number) => {
    const readText = clipboardTextReader();
    if (!readText) {
      return null;
    }

    try {
      const displayId = parseTaskUri(await readText());
      if (!displayId) {
        return null;
      }
      const source = todos.find((todo) => todo.displayId === displayId);
      if (!source || source.id === targetTodoId) {
        return null;
      }
      return {
        label: `Paste ${source.displayId} task`,
        sourceTodoId: source.id,
      };
    } catch {
      return null;
    }
  };

  const openTaskContextMenu = async (event: ReactMouseEvent<HTMLDivElement>, todoId: number) => {
    event.preventDefault();
    setListContextMenu(null);

    const x = event.clientX;
    const y = event.clientY;
    const todoIds = contextTodoIds(todoId);
    const pasteTask = onLinkTodo ? await resolveClipboardTask(todoId) : null;
    if (!selectedTodoIds.has(todoId)) {
      setSelectedTodoIds(new Set([todoId]));
      setSelectionAnchorId(todoId);
      onSelect(todoId);
    }
    const openFallbackMenu = () => {
      setContextMenu({ pasteTask, todoId, todoIds, x, y });
    };

    if (!canUseNativeTaskRowContextMenu()) {
      openFallbackMenu();
      return;
    }

    void openNativeTaskRowContextMenu({
      x,
      y,
      onCreateAbove: () => openCreateTodo(todoId, 'above'),
      onCreateBelow: () => openCreateTodo(todoId, 'below'),
      onCreateSubtask: () => openCreateTodo(todoId, 'subtask'),
      onCopyTaskLink: () => copyTaskLink(todoId),
      onDelete: () => deleteContextTodos(todoIds),
      onPasteTaskLink: pasteTask
        ? () => linkTaskUnderParent(pasteTask.sourceTodoId, todoId)
        : undefined,
      onSetPriority: (priority) => setContextTodosPriority(todoIds, priority),
      onSetState: (state) => setContextTodosState(todoIds, state),
      pasteTaskLabel: pasteTask?.label,
      selectedCount: todoIds.length,
    })
      .then((opened) => {
        if (!opened) {
          openFallbackMenu();
        }
      })
      .catch(openFallbackMenu);
  };

  // One referentially-stable callback set shared by every task row, so
  // memo(SortableTaskRow) can skip unchanged rows on list-wide updates.
  const rowCallbacks = useStableCallbackProps({
    onMarkDone: markTodoDone,
    onOpenInNewWindow: (todoId: number) => onOpenTaskWindow?.(todoId),
    onRowContextMenu: (event: ReactMouseEvent<HTMLDivElement>, todoId: number) =>
      void openTaskContextMenu(event, todoId),
    onSelect: handleSelectTodo,
    onStartTimer: (todoId: number) => onStartTimer(todoId),
    onStopTimer: () => onStopTimer(),
    onToggleExpanded: (todoId: number) => {
      setAccordionState({
        ...effectiveAccordionState,
        collapsedTodoIds: toggleCollapsedId(
          effectiveAccordionState.collapsedTodoIds,
          todoId,
        ),
      });
    },
  });
  const selectedProject = useMemo(
    () =>
      selectedProjectId !== undefined
        ? projects.find((project) => project.id === selectedProjectId)
        : undefined,
    [projects, selectedProjectId],
  );
  const rootTaskCountForProject = (projectId: number) =>
    todos.filter((todo) => todo.projectId === projectId && (todo.parentId ?? null) === null)
      .length;
  const openProjectRootTask = (projectId: number) => {
    if (!onOpenCreateTodo) {
      onNewTask();
      return;
    }
    onOpenCreateTodo({
      parentId: null,
      position: rootTaskCountForProject(projectId),
      projectId,
    });
  };
  const toolbarTaskProjectId =
    focusedProjectId ??
    (selectedProjectId !== undefined && selectedProjectId !== 0 ? selectedProjectId : undefined);
  const openToolbarNewTask = () => {
    if (!toolbarTaskProjectId) {
      return;
    }
    openProjectRootTask(toolbarTaskProjectId);
  };

  const openSubprojectContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    project: ProjectSummary,
  ) => {
    event.preventDefault();
    setListContextMenu(null);
    setContextMenu(null);

    const x = event.clientX;
    const y = event.clientY;

    const openFallbackMenu = () => {
      setSubprojectContextMenu({ project, x, y });
    };

    if (!canUseNativeSubprojectRowContextMenu() || selectedProjectId === undefined) {
      openFallbackMenu();
      return;
    }

    const parentName = selectedProject?.name ?? 'parent';
    void openNativeSubprojectRowContextMenu({
      x,
      y,
      parentName,
      parentProjectId: selectedProjectId,
      project,
      onProjectSelect: (projectId) => onProjectSelect?.(projectId),
      onNewRootTask: openProjectRootTask,
      onAddSubproject: (parentId) => onAddSubproject?.(parentId),
      onLinkProject: (parentId) => onLinkProject?.(parentId),
      onProjectStatusChange: (projectId, status) => onUpdateProjectStatus?.(projectId, status),
      onUnlink: (parentId, childId) => onUnlinkProject?.(parentId, childId),
    })
      .then((opened) => {
        if (!opened) {
          openFallbackMenu();
        } else {
          setSubprojectContextMenu(null);
        }
      })
      .catch(openFallbackMenu);
  };

  const openListContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A task row's own context-menu handler runs first and calls preventDefault;
    // skip here so right-clicking a row never opens the list menu too.
    if (event.defaultPrevented) {
      return;
    }
    event.preventDefault();

    const x = event.clientX;
    const y = event.clientY;
    const openFallbackMenu = () => {
      setContextMenu(null);
      setListContextMenu({ x, y });
    };

    if (!canUseNativeListContextMenu()) {
      openFallbackMenu();
      return;
    }

    const showProjectActions = selectedProjectId !== undefined && selectedProjectId !== 0;
    void openNativeListContextMenu({
      x,
      y,
      canCreateTask,
      onNewTask,
      onAddSubproject: showProjectActions && onAddSubproject
        ? () => onAddSubproject(selectedProjectId!)
        : undefined,
      onLinkProject: showProjectActions && onLinkProject
        ? () => onLinkProject(selectedProjectId!)
        : undefined,
    })
      .then((opened) => {
        if (!opened) {
          openFallbackMenu();
        }
      })
      .catch(openFallbackMenu);
  };

  const handleTaskListKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const isScopedShortcut =
      target === event.currentTarget || Boolean(target.closest('.task-rows, .task-context-menu'));
    if (!isScopedShortcut) {
      return;
    }

    const targetTodoId = contextMenu?.todoId ?? selectedTodo?.id;
    if (!targetTodoId) {
      return;
    }

    event.preventDefault();
    if (contextMenu) {
      setContextMenu(null);
    }
    openCreateTodo(targetTodoId, event.metaKey || event.ctrlKey ? 'subtask' : 'below');
  };

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange;
  }, [onWidthChange]);

  useEffect(() => {
    if (!dragState) {
      setDragWidth(null);
      return;
    }

    const resize = (clientX: number) =>
      clampTaskListWidth(dragState.startWidth + clientX - dragState.startX);

    const handlePointerMove = (event: PointerEvent) => {
      setDragWidth(resize(event.clientX));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const nextWidth = resize(event.clientX);
      setDragWidth(nextWidth);
      setDragState(null);
      onWidthChangeRef.current(nextWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState]);
  const taskRowsRef = useRef<HTMLDivElement>(null);

  return (
    <aside
      aria-label="Task list"
      className={`task-list ${dragState ? 'resizing' : ''}`}
      onKeyDown={handleTaskListKeyDown}
      style={{ width: `${visibleWidth}px` }}
    >
      <TaskListHeader
        archivedCount={archivedCount}
        delegatedCount={delegatedCount}
        filter={filter}
        hideDelegated={hideDelegated}
        onFilterChange={onFilterChange}
        onHideDelegatedChange={onHideDelegatedChange}
        onShowStarredOnlyChange={onShowStarredOnlyChange}
        onSortModeChange={onSortModeChange}
        onStateFilterChange={onStateFilterChange}
        onTagFilterChange={onTagFilterChange}
        showStarredOnly={showStarredOnly}
        sortMode={sortMode}
        starredCount={starredCount}
        stateFilter={stateFilter}
        tagFilter={tagFilter}
        tags={tags}
        tasksCount={tasksCount}
      />

      <div className="task-list-search">
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search tasks or ID"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search tasks or ID..."
            value={searchValue}
          />
        </label>
        <TaskListToolbar
          canCreateTask={canCreateTask && Boolean(toolbarTaskProjectId)}
          onAddSubproject={
            selectedProjectId !== undefined && selectedProjectId !== 0 && onAddSubproject
              ? () => onAddSubproject(selectedProjectId)
              : undefined
          }
          onLinkProject={
            selectedProjectId !== undefined && selectedProjectId !== 0 && onLinkProject
              ? () => onLinkProject(selectedProjectId)
              : undefined
          }
          onNewRootTask={openToolbarNewTask}
        />
      </div>

      <div className="task-rows" data-drag-active={draggedRowId !== null ? 'true' : undefined} onContextMenu={openListContextMenu} ref={taskRowsRef}>
          <DndContext
            collisionDetection={taskListCollisionDetection}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragAbort={handleDragAbort}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
            onDragMove={handleDragMove}
            onDragStart={handleDragStart}
            sensors={sensors}
        >
          <SortableContext
            items={sortableItems}
            strategy={sortingStrategy}
          >
            {taskRows.map((row) => {
              if (row.type === 'project') {
                return (
                  <SortableProjectRootRow
                    dropIndicator={
                      dropInstruction?.indicator.rowId === projectRootRowId(row.project.id) &&
                      draggedRowId !== null
                        ? dropInstruction.indicator
                        : null
                    }
                    dropLabel={dropLabel}
                    dropPointMarkers={
                      dropMarkersByRowId
                        ? dropMarkersByRowId.get(projectRootRowId(row.project.id)) ?? null
                        : null
                    }
                    activeBoxId={activeBoxId}
                    dropPreviewTodo={draggedTodo}
                    isCollapsed={row.isCollapsed}
                    key={projectRootRowId(row.project.id)}
                    now={now}
                    onToggleExpanded={() => {
                      setAccordionState({
                        ...effectiveAccordionState,
                        collapsedProjectIds: toggleCollapsedId(
                          effectiveAccordionState.collapsedProjectIds,
                          row.project.id,
                        ),
                      });
                    }}
                    row={row}
                  />
                );
              }

              if (row.type === 'subproject') {
                const subRowId = projectRootRowId(row.project.id);
                return (
                  <SubprojectRow
                    activeBoxId={activeBoxId}
                    childCount={row.childTodos.length}
                    dropIndicator={
                      dropInstruction?.indicator.rowId === subRowId && draggedRowId !== null
                        ? dropInstruction.indicator
                        : null
                    }
                    dropLabel={dropLabel}
                    dropPointMarkers={
                      dropMarkersByRowId
                        ? dropMarkersByRowId.get(subRowId) ?? null
                        : null
                    }
                    dropPreviewTodo={draggedTodo}
                    isCollapsed={row.isCollapsed}
                    isFocused={focusedProjectId === row.project.id}
                    key={subRowId}
                    kind={row.kind}
                    now={now}
                    onContextMenu={(event) => openSubprojectContextMenu(event, row.project)}
                    onProjectFocus={onProjectFocus}
                    canReorder={treeDragEnabled && Boolean(onReorderProjectLink)}
                    onToggleExpanded={() => {
                      setAccordionState({
                        ...effectiveAccordionState,
                        collapsedSubprojectIds: toggleCollapsedId(
                          effectiveAccordionState.collapsedSubprojectIds,
                          row.project.id,
                        ),
                      });
                    }}
                    project={row.project}
                    projects={projects}
                    rowId={subRowId}
                  />
                );
              }
              return (
                <SortableTaskRow
                  activeBoxId={activeBoxId}
                  depth={row.depth}
                  disabled={!treeDragEnabled}
                  dropIndicator={
                    dropInstruction?.indicator.rowId === row.todo.id && draggedRowId !== null
                      ? dropInstruction.indicator
                      : null
                  }
                  onContextMenu={rowCallbacks.onRowContextMenu}
                  dropLabel={
                    dropInstruction?.indicator.rowId === row.todo.id && draggedRowId !== null
                      ? dropLabel
                      : null
                  }
                  dropPointMarkers={
                    dropMarkersByRowId
                      ? dropMarkersByRowId.get(row.todo.id) ?? null
                      : null
                  }
                  dropPreviewTodo={draggedTodo}
                  isCollapsed={row.isCollapsed}
                  hasSubtasks={row.hasSubtasks}
                  hasUnreadMessages={unreadTodoIds.has(row.todo.id)}
                  isCompleting={completingTodoIds.has(row.todo.id)}
                  isMultiSelected={selectedTodoIds.has(row.todo.id)}
                  isSelected={selectedTodo?.id === row.todo.id}
                  isTimerRunning={runningTimerTodoId === row.todo.id}
                  key={row.todo.id}
                  now={now}
                  onSelect={rowCallbacks.onSelect}
                  onOpenInNewWindow={
                    onOpenTaskWindow ? rowCallbacks.onOpenInNewWindow : undefined
                  }
                  onMarkDone={rowCallbacks.onMarkDone}
                  onStartTimer={rowCallbacks.onStartTimer}
                  onStopTimer={rowCallbacks.onStopTimer}
                  onToggleExpanded={rowCallbacks.onToggleExpanded}
                  projects={projects}
                  todo={row.todo}
                />
              );
            })}
          </SortableContext>
        </DndContext>
        {todos.length === 0 ? (
          <p className="empty-copy compact task-list-empty">No tasks match these filters.</p>
        ) : null}
      </div>
      {contextMenu ? (
        <TaskRowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopyTaskLink={() => copyTaskLink(contextMenu.todoId)}
          onCreateAbove={() => openCreateTodo(contextMenu.todoId, 'above')}
          onCreateBelow={() => openCreateTodo(contextMenu.todoId, 'below')}
          onCreateSubtask={() => openCreateTodo(contextMenu.todoId, 'subtask')}
          onDelete={() => deleteContextTodos(contextMenu.todoIds)}
          onPasteTaskLink={
            contextMenu.pasteTask
              ? () => linkTaskUnderParent(contextMenu.pasteTask!.sourceTodoId, contextMenu.todoId)
              : undefined
          }
          onSetPriority={(priority) => setContextTodosPriority(contextMenu.todoIds, priority)}
          onSetState={(state) => setContextTodosState(contextMenu.todoIds, state)}
          pasteTaskLabel={contextMenu.pasteTask?.label}
          selectedCount={contextMenu.todoIds.length}
        />
      ) : null}
      {listContextMenu ? (
        <ListContextMenu
          canCreateTask={canCreateTask}
          onAddSubproject={
            selectedProjectId !== undefined && selectedProjectId !== 0 && onAddSubproject
            ? () => onAddSubproject(selectedProjectId)
            : undefined
          }
          onClose={() => setListContextMenu(null)}
          onLinkProject={
            selectedProjectId !== undefined && selectedProjectId !== 0 && onLinkProject
            ? () => onLinkProject(selectedProjectId)
            : undefined
          }
          onNewTask={onNewTask}
          selectedProjectId={selectedProjectId}
          x={listContextMenu.x}
          y={listContextMenu.y}
        />
      ) : null}
      {subprojectContextMenu && selectedProjectId !== undefined ? (
        <SubprojectRowContextMenu
          onClose={() => setSubprojectContextMenu(null)}
          onAddSubproject={(parentId) => onAddSubproject?.(parentId)}
          onLinkProject={(parentId) => onLinkProject?.(parentId)}
          onNewRootTask={openProjectRootTask}
          onProjectSelect={(projectId) => onProjectSelect?.(projectId)}
          onProjectStatusChange={(projectId, status) =>
            onUpdateProjectStatus?.(projectId, status)
          }
          onUnlink={(parentId, childId) => onUnlinkProject?.(parentId, childId)}
          parentName={selectedProject?.name ?? 'parent'}
          parentProjectId={selectedProjectId}
          project={subprojectContextMenu.project}
          x={subprojectContextMenu.x}
          y={subprojectContextMenu.y}
        />
      ) : null}
      <div
        aria-label="Resize task list"
        aria-orientation="vertical"
        aria-valuemax={MAX_TASK_LIST_WIDTH}
        aria-valuemin={MIN_TASK_LIST_WIDTH}
        aria-valuenow={visibleWidth}
        className="task-list-resize-handle"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
          }

          event.preventDefault();
          const delta =
            (event.key === 'ArrowRight' ? 1 : -1) *
            (event.shiftKey ? TASK_LIST_KEYBOARD_STEP * 2 : TASK_LIST_KEYBOARD_STEP);
          onWidthChange(clampTaskListWidth(committedWidth + delta));
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragWidth(committedWidth);
          setDragState({
            startWidth: committedWidth,
            startX: event.clientX,
          });
        }}
        role="separator"
        tabIndex={0}
      />
    </aside>
  );
});

type TaskListDropdownProps = {
  children: (close: () => void) => ReactNode;
  label: string;
  triggerText: string;
};

function TaskListDropdown({ children, label, triggerText }: TaskListDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  return (
    <div className="list-filter-dropdown" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="list-filter-trigger"
        onClick={() => setOpen((value) => !value)}
        title={label}
        type="button"
      >
        <strong>{triggerText}</strong>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div aria-label={label} className="task-list-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

type TaskListHeaderProps = {
  archivedCount: number;
  delegatedCount: number;
  filter: TaskFilter;
  hideDelegated: boolean;
  onFilterChange: (filter: TaskFilter) => void;
  onHideDelegatedChange?: (hideDelegated: boolean) => void;
  onShowStarredOnlyChange?: (showStarredOnly: boolean) => void;
  onSortModeChange: (mode: TaskSortMode) => void;
  onStateFilterChange: (state: TodoState | '') => void;
  onTagFilterChange: (tag: string) => void;
  showStarredOnly: boolean;
  sortMode: TaskSortMode;
  starredCount: number;
  stateFilter: TodoState | '';
  tagFilter: string;
  tags: string[];
  tasksCount: number;
};

type TaskFilterToggleButtonProps = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  onPressedChange?: (pressed: boolean) => void;
  pressed: boolean;
  title: string;
};

function TaskFilterToggleButton({
  ariaLabel,
  children,
  className,
  onPressedChange,
  pressed,
  title,
}: TaskFilterToggleButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={`task-filter-toggle ${className} ${pressed ? 'active' : ''}`}
      onClick={() => onPressedChange?.(!pressed)}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function TaskListHeader({
  archivedCount,
  delegatedCount,
  filter,
  hideDelegated,
  onFilterChange,
  onHideDelegatedChange,
  onShowStarredOnlyChange,
  onSortModeChange,
  onStateFilterChange,
  onTagFilterChange,
  showStarredOnly,
  sortMode,
  starredCount,
  stateFilter,
  tagFilter,
  tags,
  tasksCount,
}: TaskListHeaderProps) {
  const activeFilterLabel = stateFilter || TASK_FILTER_LABELS[filter];
  const delegatedCountLabel =
    delegatedCount === 1 ? '1 Delegated Task' : `${delegatedCount} Delegated Tasks`;
  const delegatedToggleLabel =
    delegatedCount > 0 ? `Hide Delegated Tasks ${delegatedCountLabel}` : 'Hide Delegated Tasks';
  const starredCountLabel =
    starredCount === 1 ? '1 Starred Task' : `${starredCount} Starred Tasks`;
  const starredToggleLabel =
    starredCount > 0 ? `Show Only Starred Tasks ${starredCountLabel}` : 'Show Only Starred Tasks';

  return (
    <div className="list-filter-row">
      <TaskListDropdown label="Filter tasks" triggerText={activeFilterLabel}>
        {(close) => (
          <>
            <button
              aria-label={`Tasks ${tasksCount}`}
              className={`task-list-menu-row selected ${filter === 'tasks' && !stateFilter ? 'active' : ''}`}
              onClick={() => {
                close();
                onStateFilterChange('');
                onFilterChange('tasks');
              }}
              role="menuitem"
              type="button"
            >
              <strong>Tasks</strong>
              <span>{tasksCount}</span>
            </button>
            {TODO_STATES.map((state) => {
              const showCount = state === 'Archived' && archivedCount > 0;

              return (
                <button
                  aria-label={showCount ? `${state} ${archivedCount}` : state}
                  className={`task-list-menu-row ${stateFilter === state ? 'active' : ''}`}
                  key={state}
                  onClick={() => {
                    close();
                    onFilterChange('tasks');
                    onStateFilterChange(state);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <strong>{state}</strong>
                  {showCount ? <span>{archivedCount}</span> : null}
                </button>
              );
            })}
          </>
        )}
      </TaskListDropdown>
      <TaskFilterToggleButton
        ariaLabel={delegatedToggleLabel}
        className="delegated-filter-toggle"
        onPressedChange={onHideDelegatedChange}
        pressed={hideDelegated}
        title="Hide Delegated Tasks"
      >
        <DelegatedCookingPotIcon cooking={delegatedCount > 0} />
        {delegatedCount > 0 ? (
          <span aria-hidden="true" className="task-filter-count delegated-filter-count">
            {delegatedCount}
          </span>
        ) : null}
      </TaskFilterToggleButton>
      <TaskFilterToggleButton
        ariaLabel={starredToggleLabel}
        className="starred-filter-toggle"
        onPressedChange={onShowStarredOnlyChange}
        pressed={showStarredOnly}
        title="Show Only Starred Tasks"
      >
        <Star
          aria-hidden="true"
          className="starred-filter-icon"
          fill={showStarredOnly ? 'currentColor' : 'none'}
          size={16}
          strokeWidth={2.2}
        />
        {starredCount > 0 ? (
          <span aria-hidden="true" className="task-filter-count starred-filter-count">
            {starredCount}
          </span>
        ) : null}
      </TaskFilterToggleButton>
      <div aria-label="Task list view" className="segment view-segment" role="radiogroup">
        {TASK_VIEW_OPTIONS.map((view) => {
          const selected = sortMode === view.mode;

          return (
            <button
              aria-checked={selected}
              aria-label={view.label}
              className={selected ? 'active' : undefined}
              key={view.mode}
              onClick={() => onSortModeChange(view.mode)}
              role="radio"
              title={view.label}
              type="button"
            >
              <view.Icon aria-hidden="true" size={14} strokeWidth={2.4} />
            </button>
          );
        })}
      </div>
      <div className="list-selectors">
        <label className="sort-button">
          <select
            aria-label="Filter by state"
            onChange={(event) => onStateFilterChange(event.target.value as TodoState | '')}
            value={stateFilter}
          >
            <option value="">All states</option>
            {TODO_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
        <label className="sort-button">
          <select
            aria-label="Filter by tag"
            onChange={(event) => onTagFilterChange(event.target.value)}
            value={tagFilter}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
        <label className="sort-button">
          <select
            aria-label="Sort tasks"
            onChange={(event) => onSortModeChange(event.target.value as TaskSortMode)}
            value={sortMode}
          >
            <option value="manual">Tree View</option>
            <option value="default">Priority View</option>
            <option value="deadline">Deadline View</option>
            <option value="state">State View</option>
            <option value="updated">Updated View</option>
            <option value="created">Created View</option>
          </select>
          <ChevronDown size={12} />
        </label>
      </div>
    </div>
  );
}

type TaskListToolbarProps = {
  canCreateTask: boolean;
  onAddSubproject?: () => void;
  onLinkProject?: () => void;
  onNewRootTask: () => void;
};

function TaskListToolbar({
  canCreateTask,
  onAddSubproject,
  onLinkProject,
  onNewRootTask,
}: TaskListToolbarProps) {
  const showProjectActions = Boolean(onAddSubproject || onLinkProject);

  return (
    <div aria-label="Task list actions" className="task-list-actions">
      <AppButton
        aria-label="New task"
        className="list-add-button"
        disabled={!canCreateTask}
        onClick={onNewRootTask}
        title="New task"
        variant="icon"
      >
        <Plus size={16} strokeWidth={2.6} />
      </AppButton>
      {showProjectActions ? (
        <>
          {onAddSubproject ? (
            <AppButton
              aria-label="Add Subproject"
              className="list-project-button"
              onClick={onAddSubproject}
              title="Add Subproject"
              variant="icon"
            >
              <FolderPlus size={16} strokeWidth={2.4} />
            </AppButton>
          ) : null}
          {onLinkProject ? (
            <AppButton
              aria-label="Link Project…"
              className="list-project-button"
              onClick={onLinkProject}
              title="Link Project…"
              variant="icon"
            >
              <Link2 size={16} strokeWidth={2.4} />
            </AppButton>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type TaskRowProps = {
  activeBoxId?: string | null;
  depth: number;
  dropIndicator?: DropIndicator | null;
  dropLabel?: string | null;
  dropPointMarkers?: DropPointMarker[] | null;
  dropPreviewTodo?: TodoSummary | null;
  hasSubtasks: boolean;
  hasUnreadMessages: boolean;
  isCollapsed: boolean;
  isCompleting: boolean;
  isMultiSelected: boolean;
  isSelected: boolean;
  isTimerRunning: boolean;
  now: Date;
  onMarkDone: (todoId: number) => void;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>, todoId: number) => void;
  onOpenInNewWindow?: (todoId: number) => void;
  onStartTimer: (todoId: number) => void;
  onStopTimer: () => void;
  onToggleExpanded: (todoId: number) => void;
  projects: ProjectSummary[];
  todo: TodoSummary;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
};

type SortableTaskRowProps = TaskRowProps & {
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, todoId: number) => void;
  disabled?: boolean;
};

// Memoized with id-based stable callbacks so a single-todo change re-renders
// only that row instead of the whole list (B-253 done-checkbox latency).
const SortableTaskRow = memo(function SortableTaskRow({
  onContextMenu,
  disabled = false,
  ...props
}: SortableTaskRowProps) {
  // Nested child todos (under a subproject row) are excluded from DnD: they
  // render as plain task rows without registering a sortable, so they never
  // participate in reordering or collision detection.
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) =>
    onContextMenu(event, props.todo.id);
  if (disabled) {
    return (
      <div className="task-row-drag-wrap" onContextMenu={handleContextMenu}>
        <TaskRow {...props} />
      </div>
    );
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.todo.id });
  const dragHandleProps = {
    ...attributes,
    ...listeners,
  } as ButtonHTMLAttributes<HTMLButtonElement>;
  const style = {
    opacity: isDragging ? 0.45 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className="task-row-drag-wrap"
      onContextMenu={handleContextMenu}
      ref={setNodeRef}
      style={style}
    >
      <DropPointBoxes markers={props.dropPointMarkers ?? null} rowId={props.todo.id} activeBoxId={props.activeBoxId ?? null} placement="before" />
      <TaskRow {...props} dragHandleProps={dragHandleProps} />
      <DropPointBoxes markers={props.dropPointMarkers ?? null} rowId={props.todo.id} activeBoxId={props.activeBoxId ?? null} placement="inside" />
      <DropPointBoxes markers={props.dropPointMarkers ?? null} rowId={props.todo.id} activeBoxId={props.activeBoxId ?? null} placement="after" />
    </div>
  );
});
function SortableProjectRootRow({
  activeBoxId,
  dropIndicator,
  dropLabel,
  dropPointMarkers,
  dropPreviewTodo,
  isCollapsed,
  now,
  onToggleExpanded,
  row,
}: {
  activeBoxId?: string | null;
  dropIndicator?: DropIndicator | null;
  dropLabel?: string | null;
  dropPointMarkers?: DropPointMarker[] | null;
  dropPreviewTodo?: TodoSummary | null;
  isCollapsed: boolean;
  now: Date;
  onToggleExpanded: () => void;
  row: ProjectRootRowModel;
}) {
  const rowId = projectRootRowId(row.project.id);
  const { setNodeRef, transform, transition } = useSortable({
    disabled: { draggable: true },
    id: rowId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const taskLabel = row.childCount === 1 ? 'task' : 'tasks';

  return (
    <div className="task-row-drag-wrap" ref={setNodeRef} style={style}>
      <DropPointBoxes markers={dropPointMarkers ?? null} rowId={projectRootRowId(row.project.id)} activeBoxId={activeBoxId ?? null} placement="before" />
      <div className="task-row project-root">
        <button
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} project ${row.project.name}`}
          className={`task-expand-toggle ${row.hasSubtasks ? '' : 'empty'}`}
          disabled={!row.hasSubtasks}
          onClick={onToggleExpanded}
          type="button"
        >
          {row.hasSubtasks ? (
            <ChevronDown className={isCollapsed ? 'collapsed' : ''} size={14} />
          ) : null}
        </button>
        <button
          aria-label={`Project ${row.project.name}, ${row.childCount} ${taskLabel}`}
          className="task-row-select project-root-select"
          onClick={onToggleExpanded}
          type="button"
        >
          <span className="task-row-main">
            <span className="task-title-line">
              <strong>{row.project.name}</strong>
              <span>{row.project.displayIdPrefix}</span>
            </span>
            <span className="task-row-foot">
              <span />
              <span className="task-row-foot-meta">
                <span className="meta-chip">{`${row.childCount} ${taskLabel}`}</span>
              </span>
            </span>
          </span>
        </button>
      </div>
      <DropPointBoxes markers={dropPointMarkers ?? null} rowId={projectRootRowId(row.project.id)} activeBoxId={activeBoxId ?? null} placement="after" />
    </div>
  );
}

function SubprojectRow({
  activeBoxId,
  canReorder,
  childCount,
  dropIndicator,
  dropLabel,
  dropPointMarkers,
  dropPreviewTodo,
  isCollapsed,
  isFocused,
  kind,
  now,
  onContextMenu,
  onProjectFocus,
  onToggleExpanded,
  project,
  projects,
  rowId,
}: {
  activeBoxId?: string | null;
  canReorder: boolean;
  childCount: number;
  dropIndicator?: DropIndicator | null;
  dropLabel?: string | null;
  dropPointMarkers?: DropPointMarker[] | null;
  dropPreviewTodo?: TodoSummary | null;
  isCollapsed: boolean;
  isFocused: boolean;
  kind: 'subproject' | 'link';
  now: Date;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onProjectFocus?: (projectId: number) => void;
  onToggleExpanded: () => void;
  project: ProjectSummary;
  projects: ProjectSummary[];
  rowId: ProjectRootRowId;
}) {
  const accentStyle = projectAccentStyle(project, projects);
  const hasTasks = childCount > 0;
  const taskLabel = childCount === 1 ? 'task' : 'tasks';
  const marker = kind === 'link' ? 'Linked' : 'Subproject';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    disabled: { draggable: !canReorder },
    id: rowId,
  });
  const dragHandleProps = canReorder
    ? ({
        ...attributes,
        ...listeners,
      } as ButtonHTMLAttributes<HTMLButtonElement>)
    : undefined;
  const style = {
    opacity: isDragging ? 0.45 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className="task-row-drag-wrap subproject-row-wrap"
      onContextMenu={onContextMenu}
      ref={setNodeRef}
      style={style}
    >
      <DropPointBoxes markers={dropPointMarkers ?? null} rowId={rowId} activeBoxId={activeBoxId ?? null} placement="before" />
      <div
        className={`task-row project-root subproject-row ${isFocused ? 'focused' : ''}`}
        style={accentStyle}
      >
        <button
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} subproject ${project.name}`}
          className={`task-expand-toggle ${hasTasks ? '' : 'empty'}`}
          disabled={!hasTasks}
          onClick={onToggleExpanded}
          type="button"
        >
          {hasTasks ? (
            <ChevronDown className={isCollapsed ? 'collapsed' : ''} size={14} />
          ) : null}
        </button>
        <span className="project-dot" />
        <button
          aria-label={`Focus project ${project.name}, ${childCount} ${taskLabel}`}
          className="task-row-select project-root-select"
          onClick={() => onProjectFocus?.(project.id)}
          type="button"
          {...dragHandleProps}
        >
          <span className="task-row-main">
            <span className="task-title-line">
              <strong>{project.name}</strong>
              <span className="subproject-marker" data-kind={kind}>{marker}</span>
              <span>{project.displayIdPrefix}</span>
            </span>
            <span className="task-row-foot">
              <span />
              <span className="task-row-foot-meta">
                <span className="meta-chip">{`${childCount} ${taskLabel}`}</span>
                {project.status !== 'Active' ? (
                  <span className={`state-badge ${project.status.toLowerCase()}`}>
                    {project.status}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        </button>
      </div>
      <DropPointBoxes markers={dropPointMarkers ?? null} rowId={rowId} activeBoxId={activeBoxId ?? null} placement="after" />
    </div>
  );
}

function DropPointBoxes({
  markers,
  rowId,
  activeBoxId,
  placement,
}: {
  markers: DropPointMarker[] | null;
  rowId: RowId;
  activeBoxId: string | null;
  placement: 'before' | 'inside' | 'after';
}) {
  if (!markers || markers.length === 0) {
    return null;
  }

  const filtered = markers.filter((m) => m.placement === placement);
  if (filtered.length === 0) {
    return null;
  }

  return (
    <div className="drop-point-boxes">
      {filtered.map((marker) => {
        const boxId = dropPointBoxId(marker.placement, rowId);
        return (
          <DropPointBox
            boxId={boxId}
            depth={marker.instruction.indicator.depth}
            isActive={activeBoxId === boxId}
            key={marker.placement}
            label={marker.label}
            placement={marker.placement}
          />
        );
      })}
    </div>
  );
}

const DropPointBox = memo(function DropPointBox({
  boxId,
  depth,
  isActive,
  label,
  placement,
}: {
  boxId: string;
  depth: number;
  isActive: boolean;
  label: string;
  placement: 'before' | 'inside' | 'after';
}) {
  const { setNodeRef, isOver } = useDroppable({ id: boxId });
  return (
    <div
      className={`drop-point-box ${placement} ${isOver ? 'over' : ''} ${
        isActive ? 'active' : ''
      }`}
      data-depth={depth}
      ref={setNodeRef}
      style={{ '--drop-depth': `${Math.min(depth, 4) * 18}px` } as CSSProperties}
    >
      <span
        className="task-expand-toggle empty"
        style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
      />
      <span className="drop-point-box-content">
        <span className="drop-point-box-icon">
          {placement === 'before' ? '↑' : placement === 'inside' ? '→' : '↓'}
        </span>
        <span className="drop-point-box-label">{label}</span>
      </span>
    </div>
  );
});

function TaskDropPreview({
  indicator,
  label,
  now,
  todo,
}: {
  indicator: DropIndicator;
  label?: string | null;
  now: Date;
  todo?: TodoSummary | null;
}) {
  if (!todo) {
    return null;
  }

  const visibleTags = todo.tags.slice(0, 2);
  const todayLabel = formatTaskRowTodayTime(todo, now);

  return (
    <div
      aria-hidden="true"
      className={`task-drop-preview ${indicator.kind}`}
      style={{ '--drop-depth': `${Math.min(indicator.depth, 4) * 18}px` } as CSSProperties}
    >
      {label ? (
        <div className="task-drop-preview-label" role="status">
          {label}
        </div>
      ) : null}
      <div
        className={`task-row drop-preview ${indicator.depth > 0 ? 'nested' : ''}`}
        data-depth={indicator.depth}
        style={{ '--task-depth': indicator.depth } as CSSProperties}
      >
        <span
          className="task-expand-toggle empty"
          style={{ marginLeft: `${Math.min(indicator.depth, 4) * 18}px` }}
        />
        <span
          className={`task-timer-button task-title-timer-button priority-${todo.priority.toLowerCase()}`}
        >
          <Play fill="currentColor" size={13} />
        </span>
        <span className="task-row-select">
          <span className="task-row-main">
            <span className="task-title-line">
              {todo.starred ? (
                <Star className="task-row-star" fill="currentColor" size={12} />
              ) : null}
              <WorktreeIndicator todo={todo} />
              <strong>{todo.title}</strong>
              <span>{todo.displayId}</span>
            </span>
            <span className="task-row-badges">
              <StateBadge
                compact
                state={todo.state}
                ageLabel={todo.stateAgeLabel}
                stale={todo.stale}
              />
              {visibleTags.map((tag) => (
                <span className="task-tag-chip" key={tag}>
                  {tag}
                </span>
              ))}
            </span>
            <span className="task-row-foot">
              {todayLabel ? <span className="task-row-elapsed">{todayLabel}</span> : <span />}
              <span className="task-row-foot-meta">
                {todo.dependencies.length ? (
                  <span className="meta-chip dependency-chip">
                    Depends {formatDependencySummary(todo.dependencies)}
                  </span>
                ) : null}
                <TaskMetaBadge now={now} todo={todo} />
                {todo.ownTimeSeconds > 0 ? (
                  <span className="mono-muted">{formatDuration(todo.ownTimeSeconds)} total</span>
                ) : null}
              </span>
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

function TaskRow({
  dragHandleProps,
  depth,
  hasSubtasks,
  hasUnreadMessages,
  isCollapsed,
  isCompleting,
  isMultiSelected,
  isSelected,
  isTimerRunning,
  now,
  onMarkDone,
  onSelect,
  onOpenInNewWindow,
  onStartTimer,
  onStopTimer,
  onToggleExpanded,
  projects,
  todo,
}: TaskRowProps) {
  const visibleTags = todo.tags.slice(0, 2);
  const todayLabel = formatTaskRowTodayTime(todo, now);
  const isDone = todo.state === 'Done';
  const contextProject =
    todo.effectiveContextProjectId && todo.effectiveContextProjectId !== todo.projectId
      ? projects.find((project) => project.id === todo.effectiveContextProjectId)
      : undefined;

  return (
    <div
      className={`task-row ${isSelected ? 'selected' : ''} ${
        isMultiSelected ? 'multi-selected' : ''
      } ${depth > 0 ? 'nested' : ''} ${isCompleting ? 'completing' : ''}`}
      data-depth={depth}
      style={{ '--task-depth': depth } as CSSProperties}
    >
      <button
        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} subtasks for ${todo.displayId}`}
        className={`task-expand-toggle ${hasSubtasks ? '' : 'empty'}`}
        data-slowdown-detail={todo.displayId}
        disabled={!hasSubtasks}
        onClick={() => onToggleExpanded(todo.id)}
        style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
        type="button"
      >
        {hasSubtasks ? (
          <ChevronDown className={isCollapsed ? 'collapsed' : ''} size={14} />
        ) : null}
      </button>
      <TaskTimerButton
        displayId={todo.displayId}
        isRunning={isTimerRunning}
        location="list"
        onStart={() => onStartTimer(todo.id)}
        onStop={onStopTimer}
        priority={todo.priority}
      />
      <button
        aria-label={
          isDone
            ? `${todo.displayId} is done`
            : isCompleting
              ? `Marking ${todo.displayId} done`
              : `Mark ${todo.displayId} done`
        }
        className={`task-done-button ${isDone ? 'complete' : ''}`}
        data-slowdown-detail={todo.displayId}
        disabled={isDone || isCompleting}
        onClick={(event) => {
          event.stopPropagation();
          if (!isDone && !isCompleting) {
            onMarkDone(todo.id);
          }
        }}
        title={isDone ? 'Done' : 'Mark done'}
        type="button"
      >
        {isDone ? <Check size={12} strokeWidth={3} /> : null}
      </button>
      <button
        aria-label={`${todo.displayId}: ${todo.title}`}
        aria-pressed={isMultiSelected}
        className="task-row-select"
        data-slowdown-detail={todo.displayId}
        onClick={(event) => onSelect(event, todo.id)}
        onDoubleClick={onOpenInNewWindow ? () => onOpenInNewWindow(todo.id) : undefined}
        type="button"
        {...dragHandleProps}
      >
        <span className="task-row-main">
          <span className="task-title-line">
            {todo.starred ? (
              <Star className="task-row-star" fill="currentColor" size={12} />
            ) : null}
            <WorktreeIndicator todo={todo} />
            <strong>{todo.title}</strong>
            <span>{todo.displayId}</span>
          </span>
          <span className="task-row-badges">
            <StateBadge
              compact
              state={todo.state}
              ageLabel={todo.stateAgeLabel}
              stale={todo.stale}
            />
            {visibleTags.map((tag) => (
              <span className="task-tag-chip" key={tag}>
                {tag}
              </span>
            ))}
          </span>
          <span className="task-row-foot">
            {todayLabel ? <span className="task-row-elapsed">{todayLabel}</span> : <span />}
            <span className="task-row-foot-meta">
              {todo.dependencies.length ? (
                <span className="meta-chip dependency-chip">
                  Depends {formatDependencySummary(todo.dependencies)}
                </span>
              ) : null}
              {hasUnreadMessages ? <span className="meta-chip unread-chip">Unread</span> : null}
              {contextProject ? (
                <span
                  aria-label={`Context project ${contextProject.name}`}
                  className="meta-chip context-project-chip"
                  style={projectAccentStyle(contextProject, projects)}
                >
                  {contextProject.name}
                </span>
              ) : null}
              <TaskMetaBadge now={now} todo={todo} />
              {todo.ownTimeSeconds > 0 ? (
                <span className="mono-muted">{formatDuration(todo.ownTimeSeconds)} total</span>
              ) : null}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

function WorktreeIndicator({ todo }: { todo: TodoSummary }) {
  if (!todo.worktreeName) {
    return null;
  }

  if (todo.worktreeMergedAt) {
    return (
      <span
        aria-label="Merged worktree"
        className="task-worktree-indicator merged"
        title={`Merged worktree: ${todo.worktreeName}`}
      >
        🎄
      </span>
    );
  }

  return (
    <span
      aria-label="Active worktree"
      className="task-worktree-indicator"
      title={`Active worktree: ${todo.worktreeName}`}
    >
      <TreePine aria-hidden="true" size={12} strokeWidth={2.4} />
    </span>
  );
}

function formatDependencySummary(dependencies: TodoSummary['dependencies']): string {
  return dependencies
    .map((dependency) => `${dependency.displayId} ${truncateText(dependency.title, 32)}`)
    .join(', ');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function formatTaskRowTodayTime(todo: TodoSummary, now: Date): string | undefined {
  const seconds = summarizeTodoTime(todo, [todo], TASK_ROW_TODAY_SELECTION, now).ownTimeSeconds;
  return seconds > 0 ? `${formatCompactTaskRowDuration(seconds)} today` : undefined;
}

function formatCompactTaskRowDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${Math.max(1, minutes)}m`;
}

function clampTaskListWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return MIN_TASK_LIST_WIDTH;
  }

  return Math.min(MAX_TASK_LIST_WIDTH, Math.max(MIN_TASK_LIST_WIDTH, Math.round(width)));
}

function toRowId(id: string | number): RowId {
  const projectId = parseProjectRootRowId(id);
  if (projectId !== null) {
    return projectRootRowId(projectId);
  }
  return typeof id === 'number' ? id : Number(id);
}

function getDragPoint(event: Pick<DragMoveEvent, 'activatorEvent' | 'delta'>): {
  x: number;
  y: number;
} | null {
  const start = getEventPoint(event.activatorEvent);
  if (!start) {
    return null;
  }

  return {
    x: start.x + event.delta.x,
    y: start.y + event.delta.y,
  };
}

function getEventPoint(event: Event): { x: number; y: number } | null {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }

  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  return null;
}

export function buildTaskRows({
  childProjects = [],
  collapsedProjectIds,
  collapsedSubprojectIds,
  collapsedTodoIds,
  projects,
  selectedProjectId,
  showProjectRoots,
  todos,
  treeView,
}: {
  childProjects?: ProjectSummary[];
  collapsedProjectIds: Set<number>;
  collapsedSubprojectIds: Set<number>;
  collapsedTodoIds: Set<number>;
  projects: ProjectSummary[];
  selectedProjectId?: number;
  showProjectRoots: boolean;
  todos: TodoSummary[];
  treeView: boolean;
}): TaskRowModel[] {
  if (!treeView) {
    return todos.map((todo) => ({
      depth: 0,
      hasSubtasks: false,
      isCollapsed: false,
      todo,
      type: 'todo',
    }));
  }

  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const childIds = new Set<number>();
  for (const todo of todos) {
    for (const subtask of todo.subtasks) {
      if (byId.has(subtask.id)) {
        childIds.add(subtask.id);
      }
    }
    for (const linkedTask of todo.linkedTasks ?? []) {
      if (byId.has(linkedTask.id)) {
        childIds.add(linkedTask.id);
      }
    }
  }

  const rows: TaskRowModel[] = [];
  const visited = new Set<number>();
  const appendTodo = (todo: TodoSummary, depth: number) => {
    if (visited.has(todo.id)) {
      return;
    }
    visited.add(todo.id);
    const childTodos = todo.subtasks
      .map((subtask) => byId.get(subtask.id))
      .filter((subtask): subtask is TodoSummary => Boolean(subtask));
    const linkedTodos = (todo.linkedTasks ?? [])
      .map((linkedTask) => byId.get(linkedTask.id))
      .filter((linkedTask): linkedTask is TodoSummary => Boolean(linkedTask));
    const childRows = [...childTodos, ...linkedTodos];
    const isCollapsed = collapsedTodoIds.has(todo.id);
    rows.push({
      depth,
      hasSubtasks: childRows.length > 0,
      isCollapsed,
      todo,
      type: 'todo',
    });
    if (!isCollapsed) {
      childRows.forEach((child) => appendTodo(child, depth + 1));
    }
  };

  const rootTodos = todos.filter((todo) => !childIds.has(todo.id));
  // When a single project is selected (not All Projects / showProjectRoots),
  // each direct child project renders as an expandable row at the top of the
  // list, above the parent's own tasks. When expanded, that child's task rows
  // follow nested one depth deeper. Grandchild subproject rows do NOT render
  // (one level per list).
  const showSubprojectRows =
    !showProjectRoots &&
    selectedProjectId !== undefined &&
    selectedProjectId !== 0 &&
    childProjects.length > 0;
  if (!showProjectRoots) {
    if (showSubprojectRows) {
      const selectedProject = projects.find((project) => project.id === selectedProjectId);
      for (const child of childProjects) {
        const edge =
          selectedProject?.subprojects.find((link) => link.childProjectId === child.id)
            ?? { childProjectId: child.id, kind: 'link' as const };
        const childTodos = rootTodos.filter((todo) => todo.projectId === child.id);
        const isCollapsed = collapsedSubprojectIds.has(child.id);
        rows.push({
          childTodos,
          depth: 0,
          isCollapsed,
          kind: edge.kind,
          project: child,
          type: 'subproject',
        });
        if (!isCollapsed) {
          childTodos.forEach((todo) => appendTodo(todo, 1));
        }
      }
    }
    rootTodos
      .filter((todo) => !isChildTodo(todo, childProjects))
      .forEach((todo) => appendTodo(todo, 0));
    return rows;
  }

  const rootTodosByProjectId = new Map<number, TodoSummary[]>();
  for (const todo of rootTodos) {
    const group = rootTodosByProjectId.get(todo.projectId) ?? [];
    group.push(todo);
    rootTodosByProjectId.set(todo.projectId, group);
  }

  for (const project of projects) {
    const projectRootTodos = rootTodosByProjectId.get(project.id) ?? [];
    if (projectRootTodos.length === 0) {
      continue;
    }

    const projectTodoCount = todos.filter((todo) => todo.projectId === project.id).length;
    const isCollapsed = collapsedProjectIds.has(project.id);
    rows.push({
      childCount: projectTodoCount,
      depth: 0,
      hasSubtasks: projectTodoCount > 0,
      isCollapsed,
      project,
      type: 'project',
    });
    if (!isCollapsed) {
      projectRootTodos.forEach((todo) => appendTodo(todo, 1));
    }
  }

  for (const todo of rootTodos) {
    if (!visited.has(todo.id)) {
      appendTodo(todo, 0);
    }
  }

  return rows;
}

function isChildTodo(todo: TodoSummary, childProjects: ProjectSummary[]): boolean {
  return childProjects.some((child) => child.id === todo.projectId);
}

function clipboardTextReader(): (() => Promise<string>) | null {
  const readText = navigator.clipboard?.readText;
  return typeof readText === 'function' ? () => readText.call(navigator.clipboard) : null;
}

function clipboardTextWriter(): ((value: string) => Promise<void>) | null {
  const writeText = navigator.clipboard?.writeText;
  return typeof writeText === 'function'
    ? (value: string) => writeText.call(navigator.clipboard, value)
    : null;
}
