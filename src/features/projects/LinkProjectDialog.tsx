import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { AppSnapshot, ProjectSummary } from '../../domain/domain';
import { linkProject, type LinkProjectInput } from '../../tauri/commands';
import { queryKeys } from '../../tauri/queryKeys';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { linkableProjects } from './projectChildren';

export type LinkProjectDialogProps = {
  parent: ProjectSummary;
  projects: ProjectSummary[];
  onClose: () => void;
  onLinked?: (snapshot: AppSnapshot, childProjectId: number) => void;
};

export function LinkProjectDialog({ parent, projects, onClose, onLinked }: LinkProjectDialogProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: LinkProjectInput) => linkProject(input),
    onSuccess: (snapshot, input) => {
      if (onLinked) {
        onLinked(snapshot, input.childProjectId);
        return;
      }
      queryClient.setQueryData(queryKeys.appSnapshot(), snapshot);
      onClose();
    },
  });
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);

  return (
    <DialogBackdrop className="dialog-backdrop">
      <DialogPanel
        aria-labelledby="link-project-title"
        aria-modal="true"
        className="dialog-panel"
        onCancel={onClose}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id="link-project-title">Link Project to {parent.name}</h2>
            <p>Choose an existing project to link under {parent.name}.</p>
          </div>
          <AppButton aria-label="Close link project" onClick={onClose} variant="icon">
            <X size={16} />
          </AppButton>
        </header>

        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedProject) {
              return;
            }
            mutation.mutate({
              parentProjectId: parent.id,
              childProjectId: selectedProject.id,
            });
          }}
        >
          <ProjectCombobox
            options={linkableProjects(parent.id, projects)}
            selected={selectedProject}
            onSelect={setSelectedProject}
          />

          <div className="dialog-actions">
            <AppButton onClick={onClose} type="button" variant="secondary">
              Cancel
            </AppButton>
            <AppButton
              disabled={selectedProject === null || mutation.isPending}
              type="submit"
              variant="primary"
            >
              {mutation.isPending ? 'Linking…' : 'Link Project'}
            </AppButton>
          </div>
        </form>
      </DialogPanel>
    </DialogBackdrop>
  );
}

type ProjectComboboxProps = {
  options: ProjectSummary[];
  selected: ProjectSummary | null;
  onSelect: (project: ProjectSummary | null) => void;
};

function ProjectCombobox({ options, selected, onSelect }: ProjectComboboxProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState('');
  const displayValue = selected ? selected.name : query;

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(normalizedQuery) ||
        option.displayIdPrefix.toLowerCase().includes(normalizedQuery),
    );
  }, [options, query]);

  const listOpen = open && filteredOptions.length > 0;
  const activeOptionIndex = Math.min(activeIndex, Math.max(filteredOptions.length - 1, 0));
  const activeOption = filteredOptions[activeOptionIndex];

  const selectOption = (project: ProjectSummary) => {
    onSelect(project);
    setQuery('');
    setActiveIndex(0);
    setOpen(false);
  };

  return (
    <div className="form-field">
      <span>Project</span>
      <div
        className="client-combobox"
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setOpen(false);
          }
        }}
      >
        <input
          aria-activedescendant={
            listOpen && activeOption ? `${listboxId}-option-${activeOptionIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={listOpen}
          aria-haspopup="listbox"
          aria-label="Project"
          autoComplete="off"
          autoFocus
          name="project"
          onChange={(event) => {
            onSelect(null);
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setActiveIndex(0);
            setQuery(selected ? '' : displayValue);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) =>
                Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)),
              );
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(index - 1, 0));
            }

            if (event.key === 'Enter' && listOpen && activeOption) {
              event.preventDefault();
              selectOption(activeOption);
            }

            if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Project name"
          role="combobox"
          value={displayValue}
        />
        {listOpen ? (
          <div className="client-combobox-list" id={listboxId} role="listbox">
            {filteredOptions.map((project, index) => (
              <button
                aria-selected={index === activeOptionIndex}
                className="client-combobox-option"
                id={`${listboxId}-option-${index}`}
                key={project.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(project);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {project.name} ({project.displayIdPrefix})
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
