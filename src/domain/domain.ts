export const TODO_STATES = [
  'Icebox',
  'To Do',
  'Doing',
  'Blocked',
  'Delegated',
  'Waiting',
  'Ready to Test',
  'Needs Feedback',
  'Done',
  'Archived',
] as const;

export const TODO_PRIORITIES = [
  'None',
  'Low',
  'Medium',
  'High',
  'Urgent',
] as const;

export type TodoState = (typeof TODO_STATES)[number];
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const PRIORITY_EMOJI: Record<TodoPriority, string> = {
  None: '⚪',
  Low: '🔵',
  Medium: '🟢',
  High: '🟠',
  Urgent: '🔴',
};
export type AppThemePreference = 'system' | 'light' | 'dark';
export type ResolvedAppTheme = 'light' | 'dark';
export type TaskDescriptionPromptMode = 'none' | 'task' | 'ancestry';
export type TaskTitler = 'codex-spark' | 'local-fallback';

export type SortableTodo = {
  id: string | number;
  state: TodoState | string;
  priority: TodoPriority | string;
  deadline: string | null;
  updatedAt: string;
};

export type DeadlineBadge = {
  label: string;
  tone: 'soon' | 'upcoming' | 'overdue';
};

export type ProjectStatus = 'Active' | 'Blocked' | 'Done' | 'Archived';

export type ProjectSummary = {
  id: number;
  name: string;
  client: string;
  workingDirectory: string;
  displayIdPrefix: string;
  actionsDirectory: string;
  projectFolderOpenApp: string;
  mainBranch: string;
  terminalWslEnabled: boolean;
  backgroundImagePath: string;
  notesMarkdown: string;
  aiDefaultIncludeProjectNotes: boolean;
  aiTaskDescriptionMode: TaskDescriptionPromptMode;
  aiDefaultProvider?: string | null;
  activeTodoCount: number;
  status: ProjectStatus;
  inheritParent: boolean;
  subprojects: Array<{
    childProjectId: number;
    kind: 'subproject' | 'link';
  }>;
};

export type TodoSummary = {
  id: number;
  projectId: number;
  parentId?: number | null;
  contextProjectId?: number | null;
  effectiveContextProjectId?: number | null;
  position: number;
  displayId: string;
  title: string;
  descriptionMarkdown: string;
  journalMarkdown?: string;
  descriptionPanelHidden?: boolean;
  descriptionTocHidden?: boolean;
  executionPanelHidden?: boolean;
  artifactMarkdown: string;
  artifactMarkdownPath: string;
  artifactTocHidden?: boolean;
  state: TodoState;
  starred?: boolean;
  priority: TodoPriority;
  deadline: string | null;
  worktreeName?: string | null;
  worktreePath?: string | null;
  worktreeMergedAt?: string | null;
  ompSessionId?: string | null;
  codexSessionId?: string | null;
  claudeSessionId?: string | null;
  activeWorkingDirectory: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  ownTimeSeconds: number;
  rolledUpTimeSeconds: number;
  stateAgeLabel?: string;
  stale: boolean;
  dependency?: {
    id: number;
    displayId: string;
    title: string;
    state: TodoState;
  };
  dependencies: Array<{
    id: number;
    displayId: string;
    title: string;
    state: TodoState;
  }>;
  subtasks: Array<{
    id: number;
    displayId: string;
    title: string;
    state: TodoState;
    done: boolean;
  }>;
  linkedTasks?: Array<{
    id: number;
    displayId: string;
    title: string;
    state: TodoState;
    done: boolean;
    sourceProjectId: number;
    targetProjectId: number;
    parentTodoId?: number | null;
    position: number;
  }>;
  timeLogs: Array<{
    id: number;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    source: string;
    running: boolean;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    actorType: 'human' | 'ai' | 'external' | 'system' | string;
    actorName: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    message?: string | null;
    link?: string | null;
    createdAt: string;
  }>;
};

export type AgentSessionSummary = {
  id: string;
  todoId: number;
  conversationId: string;
  provider: 'Claude' | 'Codex';
  providerSessionId: string | null;
  ptyId: number | null;
  command: string;
  state: 'starting' | 'running' | 'stopped' | 'exited' | 'failed';
  pendingReplyCount: number;
  elapsedLabel: string;
  workingDirectory: string;
  lastActivity: string;
};

export type RunningTimerSummary = {
  todoId: number;
  projectId: number;
  displayId: string;
  title: string;
  elapsedSeconds: number;
};

export type MessageSummary = {
  id: string;
  todoId: number;
  actorName: string;
  actorType: 'human' | 'ai' | 'external' | 'system';
  createdLabel: string;
  body: string;
  conversationId?: string | null;
  delivery?: string;
  link?: string | null;
  unread?: boolean;
};

export type ProjectActionArgument = {
  name: string;
  kind: 'string' | 'boolean' | 'choice' | string;
  required: boolean;
  label: string;
  choices: string[];
};

export type ProjectActionSummary = {
  fileName: string;
  path: string | null;
  title: string;
  description: string;
  icon: string | null;
  iconConfigured: boolean;
  runtime: 'native' | 'shell' | 'python' | string;
  arguments: ProjectActionArgument[];
  validationError: string | null;
};

export type ProjectActionsDirectorySummary = {
  path: string;
  exists: boolean;
};

export type ProjectGitRepositorySummary = {
  fullName: string;
  htmlUrl: string;
  remoteUrl: string;
};

export type ActionRunSummary = {
  id: number;
  projectId: number;
  todoId: number | null;
  actionFileName: string;
  actionTitle: string;
  runtime: string;
  ptyId: number | null;
  command: string | null;
  workingDirectory: string;
  state: string;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
};

export type ExecutionTerminalKind =
  | 'terminal'
  | 'codex'
  | 'claude'
  | 'omp'
  | 'worktree_merge';

export type ExecutionTerminalSummary = {
  todoId: number;
  ptyId: number;
  label: string;
  kind: ExecutionTerminalKind;
  state: 'running' | 'exited' | 'failed' | string;
  exitCode: number | null;
};

export type AppSettingsSummary = {
  appContextMarkdown: string;
  folderOpenApp: string;
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
  theme: AppThemePreference;
  claudePath: string;
  codexPath: string;
  taskTitler: TaskTitler;
  deepLinkFallback: boolean;
  homeProjectId: number;
  taskDetailsRailHidden: boolean;
  taskListCollapsedProjectIds: number[];
  taskListCollapsedSubprojectIds: number[];
  taskListCollapsedTodoIds: number[];
  taskListWidth: number;
  taskDetailDescriptionWidth: number;
  markdownEditorMode: 'rich' | 'raw';
  markdownEditorFontFamily: string;
  markdownEditorFontSize: string;
  markdownEditorMaxImageHeight: string;
  markdownTocHidden: boolean;
  markdownDescriptionTocWidth: number;
  markdownArtifactTocWidth: number;
  projectAccentBorderWidth: number;
  slowdownProfilerEnabled: boolean;
  terminalTmuxEnabled: boolean;
  externalTerminalOpeners: string;
};

export type AppSnapshot = {
  projects: ProjectSummary[];
  selectedProjectId: number;
  selectedTodoId: number;
  todos: TodoSummary[];
  runningTimer: RunningTimerSummary | null;
  sessions: AgentSessionSummary[];
  executionTerminals: ExecutionTerminalSummary[];
  messages: MessageSummary[];
  boomerangBinaryPath: string;
};

const normalizedStateLookup = new Map(
  TODO_STATES.map((state) => [normalizeStateKey(state), state]),
);

const priorityRank: Record<TodoPriority, number> = {
  None: 0,
  Low: 1,
  Medium: 2,
  High: 3,
  Urgent: 4,
};

export function normalizeTodoState(value: string): TodoState | null {
  return normalizedStateLookup.get(normalizeStateKey(value)) ?? null;
}

export function isReviewState(state: TodoState | string): boolean {
  const normalized = normalizeTodoState(state);
  return normalized === 'Ready to Test' || normalized === 'Needs Feedback';
}

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':');
}

export function formatDeadlineBadge(
  deadlineIso: string | null,
  now = new Date(),
): DeadlineBadge | null {
  if (!deadlineIso) {
    return null;
  }

  const deadline = new Date(deadlineIso);
  const deltaSeconds = Math.round((deadline.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  const phrase = formatRelativeDuration(absSeconds);

  if (deltaSeconds < 0) {
    return { label: `Overdue ${phrase}`, tone: 'overdue' };
  }

  return {
    label: `Due in ${phrase}`,
    tone: deltaSeconds <= 24 * 60 * 60 ? 'soon' : 'upcoming',
  };
}

export function compareTodos(a: SortableTodo, b: SortableTodo): number {
  const reviewDelta =
    Number(isReviewState(b.state)) - Number(isReviewState(a.state));
  if (reviewDelta !== 0) {
    return reviewDelta;
  }

  const priorityDelta =
    getPriorityRank(b.priority) - getPriorityRank(a.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const deadlineDelta =
    getDeadlineRank(a.deadline) - getDeadlineRank(b.deadline);
  if (deadlineDelta !== 0) {
    return deadlineDelta;
  }

  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function normalizeStateKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

function getPriorityRank(priority: TodoPriority | string): number {
  return priority in priorityRank ? priorityRank[priority as TodoPriority] : 0;
}

function getDeadlineRank(deadline: string | null): number {
  return deadline ? new Date(deadline).getTime() : Number.MAX_SAFE_INTEGER;
}

function formatRelativeDuration(totalSeconds: number): string {
  const day = 24 * 60 * 60;
  const hour = 60 * 60;
  const minute = 60;

  if (totalSeconds >= day) {
    const days = Math.floor(totalSeconds / day);
    const hours = Math.floor((totalSeconds % day) / hour);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  const hours = Math.floor(totalSeconds / hour);
  const minutes = Math.floor((totalSeconds % hour) / minute);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${Math.max(1, minutes)}m`;
}
