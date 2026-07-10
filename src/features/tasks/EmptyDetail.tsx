import { ListTodo, Plus } from 'lucide-react';
import { useId } from 'react';

import { AppButton } from '../../ui/Button';

export function EmptyDetail({
  hasProject,
  onNewProject,
  onNewTask,
}: {
  hasProject: boolean;
  onNewProject: () => void;
  onNewTask: () => void;
}) {
  const headingId = useId();
  const actionLabel = hasProject ? 'Create Task' : 'Create Project';
  const action = hasProject ? onNewTask : onNewProject;
  const copy = hasProject
    ? 'Pick a task from the list or create a new one.'
    : 'Create a project, then add the first task.';

  return (
    <section
      aria-labelledby={headingId}
      className="detail-pane empty-detail items-center justify-center p-8 text-left"
    >
      <div className="flex w-full max-w-[32rem] flex-col items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-warm)] text-[var(--color-primary)] shadow-[0_8px_18px_rgb(var(--color-shadow-rgb)/10%)]"
        >
          <ListTodo size={24} strokeWidth={2.2} />
        </span>
        <div className="grid gap-2">
          <h1
            className="m-0 text-pretty text-[28px] font-extrabold leading-9 tracking-[0] text-[var(--color-text-strong)]"
            id={headingId}
          >
            No task selected
          </h1>
          <p className="m-0 max-w-[28rem] text-pretty text-[15px] font-semibold leading-6 tracking-[0] text-[var(--color-text-muted)]">
            {copy}
          </p>
        </div>
        <div className="empty-detail-actions mt-1">
          <AppButton onClick={action} variant="primary">
            <Plus aria-hidden="true" size={17} strokeWidth={2.4} />
            {actionLabel}
          </AppButton>
        </div>
      </div>
    </section>
  );
}
