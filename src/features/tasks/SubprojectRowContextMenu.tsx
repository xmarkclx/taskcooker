import { useEffect, useRef } from 'react';

import type { ProjectStatus, ProjectSummary } from '../../domain/domain';
import { projectStatusActions } from './nativeSubprojectRowContextMenu';

type SubprojectRowContextMenuProps = {
  parentName: string;
  parentProjectId: number;
  project: ProjectSummary;
  x: number;
  y: number;
  onClose: () => void;
  onProjectSelect: (projectId: number) => void;
  onNewRootTask: (projectId: number) => void;
  onAddSubproject: (parentId: number) => void;
  onLinkProject: (parentId: number) => void;
  onProjectStatusChange: (projectId: number, status: ProjectStatus) => void;
  onUnlink: (parentId: number, childId: number) => void;
};

export function SubprojectRowContextMenu({
  parentName,
  parentProjectId,
  project,
  x,
  y,
  onClose,
  onProjectSelect,
  onNewRootTask,
  onAddSubproject,
  onLinkProject,
  onProjectStatusChange,
  onUnlink,
}: SubprojectRowContextMenuProps) {
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
      <button onClick={run(() => onProjectSelect(project.id))} role="menuitem" type="button">
        Open Project
      </button>
      <button onClick={run(() => onNewRootTask(project.id))} role="menuitem" type="button">
        New task
      </button>
      <div className="task-context-menu-separator" />
      <button onClick={run(() => onAddSubproject(project.id))} role="menuitem" type="button">
        Add Subproject
      </button>
      <button onClick={run(() => onLinkProject(project.id))} role="menuitem" type="button">
        Link Project…
      </button>
      <div className="task-context-menu-separator" />
      {projectStatusActions(project.status).map((action) => (
        <button
          key={action.status}
          onClick={run(() => onProjectStatusChange(project.id, action.status))}
          role="menuitem"
          type="button"
        >
          {action.label}
        </button>
      ))}
      <div className="task-context-menu-separator" />
      <button
        className="danger"
        onClick={run(() => onUnlink(parentProjectId, project.id))}
        role="menuitem"
        type="button"
      >
        {`Unlink from ${parentName}`}
      </button>
    </div>
  );
}
