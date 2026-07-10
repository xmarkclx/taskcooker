import { Search } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import type { ProjectSummary } from '../../domain/domain';

export type ProjectSelectorStaticRow = {
  ariaLabel?: string;
  detail?: string;
  dotClassName?: string;
  id: string;
  label: string;
  onSelect: () => void;
  selected: boolean;
  selectionIndicator?: ReactNode;
  visibleWhenSearching?: boolean;
};

export function ProjectSelectorMenu({
  ariaLabel,
  className = '',
  emptyLabel = 'No projects found',
  hiddenProjectIdsWhenSearchEmpty,
  listClassName = '',
  onProjectSelect,
  onSearchChange,
  projectDotStyle,
  projectRole = 'menuitem',
  projects,
  renderProjectAction,
  renderProjectSelectionIndicator,
  rowClassName = '',
  searchAriaLabel,
  searchClassName = '',
  searchInputName,
  searchValue,
  selectedProjectId,
  showProjectDetails = true,
  staticRows = [],
}: {
  ariaLabel: string;
  className?: string;
  emptyLabel?: string;
  hiddenProjectIdsWhenSearchEmpty?: Set<number>;
  listClassName?: string;
  onProjectSelect: (project: ProjectSummary) => void;
  onSearchChange: (value: string) => void;
  projectDotStyle?: (project: ProjectSummary) => CSSProperties | undefined;
  projectRole?: 'menuitem' | 'menuitemradio';
  projects: ProjectSummary[];
  renderProjectAction?: (project: ProjectSummary) => ReactNode;
  renderProjectSelectionIndicator?: (project: ProjectSummary) => ReactNode;
  rowClassName?: string;
  searchAriaLabel: string;
  searchClassName?: string;
  searchInputName?: string;
  searchValue: string;
  selectedProjectId?: number | null;
  showProjectDetails?: boolean;
  staticRows?: ProjectSelectorStaticRow[];
}) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  const visibleStaticRows = staticRows.filter((row) => {
    if (!normalizedSearch || row.visibleWhenSearching) {
      return true;
    }

    return `${row.label} ${row.detail ?? ''}`.toLowerCase().includes(normalizedSearch);
  });
  const filteredProjects = projects.filter((project) => {
    if (!normalizedSearch && hiddenProjectIdsWhenSearchEmpty?.has(project.id)) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return `${project.name} ${project.client} ${project.workingDirectory} ${project.activeTodoCount} active`
      .toLowerCase()
      .includes(normalizedSearch);
  });

  return (
    <div aria-label={ariaLabel} className={`project-selector-menu ${className}`.trim()} role="menu">
      <label className={`project-selector-search ${searchClassName}`.trim()}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-label={searchAriaLabel}
          autoComplete="off"
          autoFocus
          name={searchInputName}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search projects…"
          spellCheck={false}
          value={searchValue}
        />
      </label>
      <div className={`project-selector-list ${listClassName}`.trim()}>
        {visibleStaticRows.map((row) => (
          <div
            className={`project-selector-row no-action ${rowClassName} ${row.selected ? 'selected' : ''}`.trim()}
            key={row.id}
          >
            <button
              aria-checked={projectRole === 'menuitemradio' ? row.selected : undefined}
              aria-label={row.ariaLabel ?? row.label}
              className="project-selector-main project-menu-main"
              onClick={row.onSelect}
              role={projectRole}
              type="button"
            >
              {row.dotClassName ? <span className={`project-dot ${row.dotClassName}`} /> : null}
              <span className="project-selector-copy task-context-option-copy">
                <strong>{row.label}</strong>
                {showProjectDetails && row.detail ? <small>{row.detail}</small> : null}
              </span>
              {row.selectionIndicator}
            </button>
          </div>
        ))}
        {filteredProjects.map((project) => {
          const selected = selectedProjectId === project.id;
          const action = renderProjectAction?.(project);
          return (
            <div
              className={`project-selector-row ${action ? '' : 'no-action'} ${rowClassName} ${selected ? 'selected' : ''}`.trim()}
              key={project.id}
            >
              <button
                aria-checked={projectRole === 'menuitemradio' ? selected : undefined}
                aria-label={project.name}
                className="project-selector-main project-menu-main"
                onClick={() => onProjectSelect(project)}
                role={projectRole}
                type="button"
              >
                <span className="project-dot" style={projectDotStyle?.(project)} />
                <span className="project-selector-copy task-context-option-copy">
                  <strong>{project.name}</strong>
                  {showProjectDetails ? <small>{project.activeTodoCount} active</small> : null}
                </span>
                {renderProjectSelectionIndicator?.(project)}
              </button>
              {action}
            </div>
          );
        })}
        {visibleStaticRows.length === 0 && filteredProjects.length === 0 ? (
          <div className="project-selector-empty">{emptyLabel}</div>
        ) : null}
      </div>
    </div>
  );
}
