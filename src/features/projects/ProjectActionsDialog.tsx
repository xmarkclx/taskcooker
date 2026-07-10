import { RefreshCw, Search, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ProjectActionSummary, ProjectSummary } from '../../domain/domain';
import { AppButton } from '../../ui/Button';
import { DialogBackdrop, DialogPanel } from '../../ui/Dialog';
import { ProjectActionIcon } from './ProjectActionIcon';

type ProjectActionsDialogProps = {
  actions: ProjectActionSummary[];
  onClose: () => void;
  onNewActionTask: () => void;
  onRefresh: () => void;
  onRunAction: (action: ProjectActionSummary) => void;
  project: ProjectSummary;
};

export function ProjectActionsDialog({
  actions,
  onClose,
  onNewActionTask,
  onRefresh,
  onRunAction,
  project,
}: ProjectActionsDialogProps) {
  const [query, setQuery] = useState('');
  const filteredActions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return actions;
    }

    return actions.filter((action) =>
      `${action.title} ${action.fileName}`.toLowerCase().includes(normalizedQuery),
    );
  }, [actions, query]);

  return (
    <DialogBackdrop>
      <DialogPanel
        aria-labelledby="project-actions-title"
        aria-modal="true"
        className="project-actions-dialog"
        onCancel={onClose}
        role="dialog"
      >
        <header className="project-actions-header">
          <div>
            <h2 id="project-actions-title">Project Actions</h2>
            <p>
              {project.name} · {project.actionsDirectory}
            </p>
          </div>
          <div className="project-actions-header-controls">
            <AppButton onClick={onNewActionTask} variant="secondary">
              <Wrench size={15} />
              New action
            </AppButton>
            <AppButton aria-label="Close project actions" onClick={onClose} variant="icon">
              <X size={16} />
            </AppButton>
          </div>
        </header>

        <div className="project-actions-toolbar">
          <label className="project-actions-search">
            <Search size={17} />
            <input
              aria-label="Search actions"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions"
              value={query}
            />
          </label>
          <div className="project-actions-controls">
            <span className="project-actions-count" title={`${filteredActions.length} of ${actions.length} actions`}>
              <span className="project-actions-count-dot" />
              {filteredActions.length} {filteredActions.length === 1 ? 'action' : 'actions'}
            </span>
            <AppButton
              aria-label="Refresh actions"
              onClick={onRefresh}
              title="Refresh"
              variant="secondary"
            >
              <RefreshCw size={14} />
            </AppButton>
          </div>
        </div>

        <div className="project-actions-grid">
          {filteredActions.map((action) => (
            <article
              aria-label={`${action.title} ${action.fileName}`}
              className="project-action-card"
              key={action.fileName}
            >
              <div className="project-action-card-head">
                <div className="project-action-card-leading">
                  <ProjectActionIcon
                    action={action}
                    className="project-action-card-icon"
                    size={18}
                  />
                  <div className="project-action-card-title-block">
                    <h3>{action.title}</h3>
                    <span className="project-action-card-file">{action.fileName}</span>
                  </div>
                </div>
                <AppButton
                  aria-label={`Run ${action.title}`}
                  disabled={Boolean(action.validationError)}
                  onClick={() => onRunAction(action)}
                  title={action.validationError ?? `Run ${action.title}`}
                  variant="primary"
                >
                  Run
                </AppButton>
              </div>
              <span className="project-action-card-meta">
                {action.runtime} · {action.arguments.length} args
              </span>
              <p className="project-action-card-description">
                {action.description || action.fileName}
              </p>
            </article>
          ))}
        </div>
      </DialogPanel>
    </DialogBackdrop>
  );
}
