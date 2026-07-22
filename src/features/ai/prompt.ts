import type {
  AppSettingsSummary,
  MessageSummary,
  ProjectSummary,
  TaskDescriptionPromptMode,
  TodoSummary,
} from '../../domain/domain';

export type BuildTaskPromptInput = {
  additionalPrompt?: string;
  appSettings: AppSettingsSummary;
  binaryPath: string;
  /** Project the task runs in when a context is set; its notes replace the home project's. */
  contextProject?: ProjectSummary;
  includeProjectNotes: boolean;
  messages?: MessageSummary[];
  project: ProjectSummary;
  taskDescriptionMode: TaskDescriptionPromptMode;
  todo: TodoSummary;
  todos?: TodoSummary[];
};

export function buildTaskPrompt({
  additionalPrompt,
  appSettings,
  binaryPath,
  contextProject,
  includeProjectNotes,
  messages = [],
  project,
  taskDescriptionMode,
  todo,
  todos = [],
}: BuildTaskPromptInput): string {
  const descriptionEntries = taskDescriptionEntries(todo, todos, taskDescriptionMode);
  const curlCommand = curlCommandForTerminal(binaryPath, project.terminalWslEnabled);
  const attachmentPaths = uniquePaths(
    descriptionEntries.flatMap((entry) => extractLocalMarkdownImagePaths(entry.descriptionMarkdown)),
  );
  const pendingReplies = messages.filter(
    (message) =>
      message.todoId === todo.id &&
      message.actorType === 'human' &&
      message.delivery === 'Pending for next session',
  );
  const notesProject = contextProject ?? project;
  const sections = [
    `Task: ${todo.displayId}: ${todo.title}`,
    `Project: ${project.name}`,
    ...(contextProject ? [`Context project: ${contextProject.name}`] : []),
    `Working directory: ${todo.activeWorkingDirectory || notesProject.workingDirectory}`,
    `Current state: ${todo.state}`,
    '',
    'Required Boomerang updates:',
    `- CRITICAL, NON-NEGOTIABLE, EVERY TURN: whenever you are actively working, ${todo.displayId} MUST be Delegated, and the instant you finish replying it MUST be in "Ready to Test" or "Needs Feedback".`,
    ` Never end a reply with ${todo.displayId} left in To Do, Doing, or Delegated. Every single time the user messages you about this task: FIRST set ${todo.displayId} to Delegated, do the work, then set it to Ready to Test or Needs Feedback before you finish. No exceptions.`,
    ` Only set those statuses (Ready to Test, Needs Feedback, Delegated) unless specified, let user set Blocked, Done, etc. statuses themselves.`,
    `- When you are tasked something, aside from this initial prompt, and you start working, FIRST set ${todo.displayId} to Delegated.`,
    `- If you are resuming this task from Ready to Test or Needs Feedback because the user sent follow-up or requested changes, FIRST set ${todo.displayId} to Delegated before doing any new work.`,
    `- When you finish any work pass, immediately move ${todo.displayId} back to Review: set it to Ready to Test if the user can test the result, or Needs Feedback if you need user input.`,
    `- When you set ${todo.displayId} to Ready to Test, explain what changed.`,
    `- Whenever you ask the user a question or need input — including a clarifying question before you start — FIRST set ${todo.displayId} to Needs Feedback, then ask your specific question, so the user is alerted to respond.`,
    `- If blocked by an external dependency, set ${todo.displayId} to Blocked and explain why.`,
    `- Read the task artifacts before the task description/context; use them as the durable summary of what is going on before you start making changes.`,
    `- Start working on this task now without waiting for further input. Briefly note whether you were passed the project note and (task description or all parents' task descriptions), then proceed.`,
    '',
    ...boomerangApiPromptLines(
      todo.displayId,
      appSettings.mcpPort,
      appSettings.mcpToken,
      curlCommand.program,
      curlCommand.escapeJsonQuotes,
    ),
    'Valid states: Icebox, To Do, Doing, Blocked, Delegated, Waiting, Ready to Test, Needs Feedback, Done, Archived.',
  ];

  if (appSettings.appContextMarkdown.trim()) {
    sections.push('', 'App-wide context:', appSettings.appContextMarkdown.trim());
  }

  if (attachmentPaths.length) {
    sections.push('', 'Task attachments:', attachmentPaths.map((path) => `- ${path}`).join('\n'));
  }

  sections.push('', ...formatTaskArtifactsSection(todo));

  const dependencies = todo.dependencies.length ? todo.dependencies : todo.dependency ? [todo.dependency] : [];
  if (dependencies.length) {
    sections.push(
      '',
      dependencies.length === 1 ? 'Dependency warning:' : 'Dependency warnings:',
      dependencies
        .map((dependency) => `${dependency.displayId} ${dependency.title} (${dependency.state})`)
        .join('\n'),
    );
  }

  if (includeProjectNotes && notesProject.notesMarkdown.trim()) {
    sections.push('', 'Project notes:', notesProject.notesMarkdown.trim());
  }

  if (pendingReplies.length) {
    sections.push(
      '',
      'Pending human replies:',
      pendingReplies.map((message) => `- ${message.actorName}: ${message.body}`).join('\n'),
    );
  }

  if (additionalPrompt?.trim()) {
    sections.push('', 'Additional instructions:', additionalPrompt.trim());
  }

  const taskDescriptionSection = formatTaskDescriptionSection(descriptionEntries, todo);
  if (taskDescriptionSection.length) {
    sections.push('', ...taskDescriptionSection);
  }

  return sections.join('\n');
}

function formatTaskArtifactsSection(todo: TodoSummary): string[] {
  const artifactMarkdown = todo.artifactMarkdown.trim();
  const artifactPath = todo.artifactMarkdownPath.trim();
  return [
    'Task artifacts:',
    artifactPath ? `Artifact file: ${artifactPath}` : 'Artifact file: (not available)',
    'Keep task artifacts updated with durable summaries, charts, graphs, images, Markdown tables, Mermaid diagrams, important links, file links, and FAQ-style answers that another LLM or the user may need later.',
    artifactMarkdown || '(No task artifacts yet.)',
  ];
}

function taskDescriptionEntries(
  todo: TodoSummary,
  todos: TodoSummary[],
  mode: TaskDescriptionPromptMode,
): TodoSummary[] {
  if (mode === 'none') {
    return [];
  }
  if (mode === 'task') {
    return [todo];
  }

  return [...parentTaskChain(todo, todos), todo];
}

function parentTaskChain(todo: TodoSummary, todos: TodoSummary[]): TodoSummary[] {
  const byId = new Map(todos.map((item) => [item.id, item]));
  const chain: TodoSummary[] = [];
  const seen = new Set<number>([todo.id]);
  let parentId = todo.parentId ?? null;

  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }

    chain.unshift(parent);
    seen.add(parent.id);
    parentId = parent.parentId ?? null;
  }

  return chain;
}

function formatTaskDescriptionSection(
  entries: TodoSummary[],
  currentTodo: TodoSummary,
): string[] {
  if (!entries.length) {
    return [];
  }
  if (entries.length === 1 && entries[0]?.id === currentTodo.id) {
    return [
      'Task description:',
      currentTodo.descriptionMarkdown.trim() || '(No task description provided.)',
    ];
  }

  return [
    'Task description context:',
    entries
      .map((entry) =>
        [
          `${entry.id === currentTodo.id ? 'Current task' : 'Parent task'} ${entry.displayId}: ${entry.title}`,
          entry.descriptionMarkdown.trim() || '(No task description provided.)',
        ].join('\n'),
      )
      .join('\n\n'),
  ];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function curlCommandForTerminal(
  binaryPath: string,
  terminalWslEnabled: boolean,
): { escapeJsonQuotes: boolean; program: string } {
  const windowsHost = /^[a-zA-Z]:[\\/]/.test(binaryPath);
  // WSL uses Windows curl to reach the loopback-only host service, but only
  // native PowerShell needs JSON quotes escaped for Windows argv parsing.
  return {
    escapeJsonQuotes: windowsHost && !terminalWslEnabled,
    program: windowsHost ? 'curl.exe' : 'curl',
  };
}

function boomerangApiPromptLines(
  taskId: string,
  port: number,
  token: string,
  curlProgram: string,
  escapeJsonQuotes: boolean,
): string[] {
  const command = (toolName: string, argumentsValue: Record<string, string>): string => {
    const body = JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: argumentsValue, name: toolName },
    });
    const shellBody = escapeJsonQuotes ? body.replaceAll('"', '\\"') : body;
    return `${curlProgram} --fail --silent --show-error --request POST "http://127.0.0.1:${port}/mcp" --header "Authorization: Bearer ${token}" --header "Content-Type: application/json" --data-raw '${shellBody}'`;
  };

  return [
    'Use the Boomerang HTTP API for updates. These requests work from native Windows and WSL without launching the TaskCooker executable:',
    `- Set state (optionally with a message): ${command('update_todo_state', {
      taskId,
      state: 'Ready to Test',
      message: 'what changed',
      senderName: 'Agent API',
    })}`,
    `- Leave a message (optionally include a state): ${command('message_todo', {
      taskId,
      message: 'your note',
      senderName: 'Agent API',
    })}`,
    `- Read this task and its messages: ${command('get_todo', { taskId })}`,
    '- If Codex or Claude shows a native conversation/session id, include it as the conversationId field in update_todo_state or message_todo arguments.',
    '- When Boomerang started this session, the API port and token are also available in BOOMERANG_MCP_PORT and BOOMERANG_MCP_TOKEN.',
  ];
}

export function buildClaudeDesktopDeepLink(prompt: string, workingDirectory: string): string {
  return `claude://code/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(
    workingDirectory,
  )}`;
}

export function buildCodexAppDeepLink(prompt: string, workingDirectory: string): string {
  return `codex://threads/new?prompt=${encodeURIComponent(prompt)}&path=${encodeURIComponent(
    workingDirectory,
  )}`;
}

function extractLocalMarkdownImagePaths(markdown: string): string[] {
  const paths = new Set<string>();
  const imagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
  const htmlImagePattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(markdown)) !== null) {
    const path = normalizeMarkdownLinkTarget(match[1]);
    if (path && isLocalPath(path)) {
      paths.add(path);
    }
  }

  while ((match = htmlImagePattern.exec(markdown)) !== null) {
    const path = normalizeMarkdownLinkTarget(match[1] ?? match[2] ?? match[3] ?? '');
    if (path && isLocalPath(path)) {
      paths.add(path);
    }
  }

  return [...paths];
}

function normalizeMarkdownLinkTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function isLocalPath(path: string): boolean {
  return (
    path.startsWith('~/') ||
    path.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith('file://')
  );
}
