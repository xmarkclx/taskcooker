import { Fragment, useEffect, useRef } from 'react';

type ListContextMenuProps = {
  x: number;
  y: number;
  canCreateTask?: boolean;
  onClose: () => void;
  onNewTask: () => void;
  onAddSubproject?: () => void;
  onLinkProject?: () => void;
  selectedProjectId?: number;
};

export function ListContextMenu({
  x,
  y,
  canCreateTask = true,
  onClose,
  onNewTask,
  onAddSubproject,
  onLinkProject,
  selectedProjectId,
}: ListContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const showProjectActions = selectedProjectId !== undefined && selectedProjectId !== 0;

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
      <button
        disabled={!canCreateTask}
        onClick={run(onNewTask)}
        role="menuitem"
        type="button"
      >
        New task
      </button>
      {showProjectActions && onAddSubproject ? (
        <Fragment>
          <div className="task-context-menu-separator" />
          <button onClick={run(onAddSubproject)} role="menuitem" type="button">
            Add Subproject
          </button>
        </Fragment>
      ) : null}
      {showProjectActions && onLinkProject ? (
        <Fragment>
          <div className="task-context-menu-separator" />
          <button onClick={run(onLinkProject)} role="menuitem" type="button">
            Link Project…
          </button>
        </Fragment>
      ) : null}
    </div>
  );
}
