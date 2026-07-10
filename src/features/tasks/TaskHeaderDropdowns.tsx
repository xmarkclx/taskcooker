import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { projectAccentStyle } from '../../app/appShellHelpers';
import type { ProjectSummary, TodoState, TodoSummary } from '../../domain/domain';
import { ProjectSelectorMenu } from '../projects/ProjectSelectorMenu';
import { TODO_STATES } from '../../domain/domain';
import { todoStateToneClass } from './taskBadges';

function useHeaderMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return { open, setOpen, wrapRef };
}

export function TaskStateDropdown({
  ageLabel,
  onRequestChanges,
  onSelectState,
  stale,
  state,
}: {
  ageLabel?: string;
  onRequestChanges: () => void;
  onSelectState: (state: TodoState) => void;
  stale?: boolean;
  state: TodoState;
}) {
  const { open, setOpen, wrapRef } = useHeaderMenu();
  const label = ageLabel ? `${state} since ${ageLabel}` : state;

  return (
    <span className="detail-header-menu-wrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Change state (current: ${state})`}
        className={`state-badge state-badge-button ${todoStateToneClass(state)} ${
          stale ? 'stale' : ''
        }`}
        onClick={() => setOpen((current) => !current)}
        title="Change state"
        type="button"
      >
        {label}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div aria-label="Change state" className="task-list-menu detail-header-menu" role="menu">
          {TODO_STATES.map((option) => (
            <button
              aria-checked={option === state}
              className={`task-list-menu-row ${option === state ? 'selected' : ''}`}
              key={option}
              onClick={() => {
                setOpen(false);
                if (option !== state) {
                  onSelectState(option);
                }
              }}
              role="menuitemradio"
              type="button"
            >
              {option}
              <span className="task-list-menu-check">
                {option === state ? <Check size={12} /> : null}
              </span>
            </button>
          ))}
          <div className="task-list-menu-separator" />
          <button
            aria-label="Request changes"
            className="task-list-menu-row"
            onClick={() => {
              setOpen(false);
              onRequestChanges();
            }}
            role="menuitem"
            type="button"
          >
            Request changes
          </button>
        </div>
      ) : null}
    </span>
  );
}

export function TaskContextDropdown({
  onSelectContextProject,
  projects,
  todo,
}: {
  onSelectContextProject: (contextProjectId: number | null) => void;
  projects: ProjectSummary[];
  todo: TodoSummary;
}) {
  const { open, setOpen, wrapRef } = useHeaderMenu();
  const [contextSearch, setContextSearch] = useState('');
  const ownContextId = todo.contextProjectId ?? null;
  const effectiveContextId = todo.effectiveContextProjectId ?? null;
  const inherited = ownContextId === null && effectiveContextId !== null;
  const ownProject = projects.find((project) => project.id === todo.projectId);
  const contextProject =
    effectiveContextId === null
      ? undefined
      : projects.find((project) => project.id === effectiveContextId);
  const contextProjects = projects.filter((project) => project.id !== todo.projectId);

  useEffect(() => {
    if (!open) {
      setContextSearch('');
    }
  }, [open]);

  return (
    <span className="detail-header-menu-wrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          contextProject
            ? `Change context (current: ${contextProject.name})`
            : 'Set task context'
        }
        className={`context-badge-button ${contextProject ? 'has-context' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title={
          contextProject
            ? `Runs in ${contextProject.name}${inherited ? ' (from parent task)' : ''}`
            : 'Run this task in another project’s folder and notes'
        }
        type="button"
      >
        {contextProject ? contextProject.name : 'Context'}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <ProjectSelectorMenu
          ariaLabel="Task context"
          className="task-list-menu detail-header-menu project-menu task-context-switcher-menu"
          emptyLabel="No context projects found"
          onProjectSelect={(project) => {
            setOpen(false);
            onSelectContextProject(project.id);
          }}
          onSearchChange={setContextSearch}
          projectDotStyle={(project) => projectAccentStyle(project, projects)}
          projectRole="menuitemradio"
          projects={contextProjects}
          renderProjectSelectionIndicator={(project) => (
            <span className="task-list-menu-check">
              {ownContextId === project.id ? <Check size={12} /> : null}
            </span>
          )}
          rowClassName="project-menu-row task-context-option"
          searchAriaLabel="Search context projects"
          searchClassName="task-context-search"
          searchInputName="task-context-search"
          searchValue={contextSearch}
          selectedProjectId={ownContextId}
          showProjectDetails={false}
          staticRows={[
            {
              ariaLabel: inherited ? 'Default (from parent)' : 'This project',
              detail: ownProject?.name,
              id: 'this-project',
              label: inherited ? 'Default (from parent)' : 'This project',
              onSelect: () => {
                setOpen(false);
                onSelectContextProject(null);
              },
              selected: ownContextId === null,
              selectionIndicator: (
                <span className="task-list-menu-check">
                  {ownContextId === null ? <Check size={12} /> : null}
                </span>
              ),
              visibleWhenSearching: true,
            },
          ]}
        />
      ) : null}
    </span>
  );
}
