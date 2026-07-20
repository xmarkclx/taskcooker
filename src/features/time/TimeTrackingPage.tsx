import { ChevronRight, Clock3 } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ProjectSummary, TodoSummary } from '../../domain/domain';
import { formatDuration } from '../../domain/domain';
import { AppSegmentedControl } from '../../ui/SegmentedControl';
import { AppSelect } from '../../ui/Select';
import {
  buildTimeTrackingReport,
  timeTrackingSelection,
  type TimeTrackingPreset,
  type TimeTrackingTaskNode,
} from './timeTrackingTree';

const RANGE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
] as const;

export function TimeTrackingPage({
  onProjectSelect,
  onTaskSelect,
  projects,
  selectedProjectId,
  todos,
}: {
  onProjectSelect: (projectId: number) => void;
  onTaskSelect: (todoId: number) => void;
  projects: ProjectSummary[];
  selectedProjectId: number;
  todos: TodoSummary[];
}) {
  const [preset, setPreset] = useState<TimeTrackingPreset>('today');
  const now = new Date();
  const report = useMemo(
    () =>
      buildTimeTrackingReport({
        now,
        projectId: selectedProjectId,
        projects,
        selection: timeTrackingSelection(preset, now),
        todos,
      }),
    [now.toDateString(), preset, projects, selectedProjectId, todos],
  );
  const projectOptions = [
    { label: 'All Projects', value: '0' },
    ...projects
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((project) => ({ label: project.name, value: String(project.id) })),
  ];

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-[var(--color-background)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Clock3 aria-hidden="true" size={20} />
              <h1 className="m-0 text-xl font-semibold">Time Tracking</h1>
            </div>
            <p className="mb-0 mt-1 text-sm text-[var(--color-text-muted)]">
              Own task time and totals rolled up through every subtask.
            </p>
          </div>
          <label className="form-field min-w-56">
            <span>Project</span>
            <AppSelect
              aria-label="Filter time by project"
              onChange={(event) => onProjectSelect(Number(event.target.value))}
              options={projectOptions}
              value={String(selectedProjectId)}
            />
          </label>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <AppSegmentedControl
            aria-label="Time range"
            onChange={(value) => setPreset(value as TimeTrackingPreset)}
            options={RANGE_OPTIONS}
            value={preset}
          />
          <div className="text-right">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Total time
            </span>
            <strong className="font-mono text-2xl tabular-nums">
              {formatDuration(report.totalSeconds)}
            </strong>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            <span>Project / task</span>
            <span className="text-right">Task only</span>
            <span className="text-right">With subtasks</span>
          </div>
          {report.projects.length > 0 ? (
            report.projects.map((projectNode) => (
              <div key={projectNode.project.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3">
                  <strong className="truncate">{projectNode.project.name}</strong>
                  <span />
                  <strong className="text-right font-mono tabular-nums">
                    {formatDuration(projectNode.totalSeconds)}
                  </strong>
                </div>
                {projectNode.tasks.map((task) => (
                  <TimeTaskRow
                    depth={0}
                    key={task.todo.id}
                    node={task}
                    onTaskSelect={onTaskSelect}
                  />
                ))}
              </div>
            ))
          ) : (
            <p className="m-0 px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
              No tracked time or tasks in this range.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TimeTaskRow({
  depth,
  node,
  onTaskSelect,
}: {
  depth: number;
  node: TimeTrackingTaskNode;
  onTaskSelect: (todoId: number) => void;
}) {
  return (
    <>
      <button
        className="grid w-full grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-0 border-b border-solid border-[var(--color-border)] bg-transparent px-4 py-2.5 text-left text-[var(--color-text)] hover:bg-[var(--color-surface-warm)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        onClick={() => onTaskSelect(node.todo.id)}
        type="button"
      >
        <span
          className="flex min-w-0 items-center gap-2"
          style={{ paddingLeft: `${depth * 20}px` }}
        >
          <ChevronRight
            aria-hidden="true"
            className={node.children.length === 0 ? 'opacity-0' : undefined}
            size={14}
          />
          <span className="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
            {node.todo.displayId}
          </span>
          <span className="truncate">{node.todo.title}</span>
        </span>
        <span className="text-right font-mono text-sm tabular-nums">
          {formatDuration(node.ownTimeSeconds)}
        </span>
        <strong className="text-right font-mono text-sm tabular-nums">
          {formatDuration(node.rolledUpTimeSeconds)}
        </strong>
      </button>
      {node.children.map((child) => (
        <TimeTaskRow
          depth={depth + 1}
          key={child.todo.id}
          node={child}
          onTaskSelect={onTaskSelect}
        />
      ))}
    </>
  );
}
