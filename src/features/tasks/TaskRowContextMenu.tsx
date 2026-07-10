import { useEffect, useRef } from 'react';

import {
  PRIORITY_EMOJI,
  TODO_PRIORITIES,
  TODO_STATES,
  type TodoPriority,
  type TodoState,
} from '../../domain/domain';

type TaskRowContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onCopyTaskLink?: () => void;
  onCreateAbove: () => void;
  onCreateBelow: () => void;
  onCreateSubtask: () => void;
  onDelete: () => void;
  onPasteTaskLink?: () => void;
  onSetPriority: (priority: TodoPriority) => void;
  onSetState: (state: TodoState) => void;
  pasteTaskLabel?: string | null;
  selectedCount?: number;
};

export function TaskRowContextMenu({
  x,
  y,
  onClose,
  onCopyTaskLink,
  onCreateAbove,
  onCreateBelow,
  onCreateSubtask,
  onDelete,
  onPasteTaskLink,
  onSetPriority,
  onSetState,
  pasteTaskLabel,
  selectedCount = 1,
}: TaskRowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div
      className="task-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: x, top: y }}
      tabIndex={-1}
    >
      <button onClick={run(onCreateSubtask)} role="menuitem" type="button">
        New subtask
      </button>
      <button onClick={run(onCreateAbove)} role="menuitem" type="button">
        New task above
      </button>
      <button onClick={run(onCreateBelow)} role="menuitem" type="button">
        New task below
      </button>
      {onCopyTaskLink || (pasteTaskLabel && onPasteTaskLink) ? (
        <>
          <div className="task-context-menu-separator" />
          {onCopyTaskLink ? (
            <button onClick={run(onCopyTaskLink)} role="menuitem" type="button">
              Copy task link
            </button>
          ) : null}
          {pasteTaskLabel && onPasteTaskLink ? (
            <button onClick={run(onPasteTaskLink)} role="menuitem" type="button">
              {pasteTaskLabel}
            </button>
          ) : null}
        </>
      ) : null}
      <div className="task-context-menu-separator" />
      <div aria-label="Set status" className="task-context-menu-group">
        <span className="task-context-menu-label">Set status</span>
        {TODO_STATES.map((state) => (
          <button key={state} onClick={run(() => onSetState(state))} role="menuitem" type="button">
            {state}
          </button>
        ))}
      </div>
      <div className="task-context-menu-separator" />
      <div aria-label="Set priority" className="task-context-menu-group">
        <span className="task-context-menu-label">Set priority</span>
        {TODO_PRIORITIES.map((priority) => (
          <button
            key={priority}
            onClick={run(() => onSetPriority(priority))}
            role="menuitem"
            type="button"
          >
            {`${PRIORITY_EMOJI[priority]} ${priority}`}
          </button>
        ))}
      </div>
      <div className="task-context-menu-separator" />
      <button className="danger" onClick={run(onDelete)} role="menuitem" type="button">
        {selectedCount > 1 ? `Delete ${selectedCount} tasks` : 'Delete task'}
      </button>
    </div>
  );
}
