import type {
  AgentSessionSummary,
  AppSnapshot,
  ExecutionTerminalSummary,
  MessageSummary,
  ProjectSummary,
  TaskDescriptionPromptMode,
  TodoPriority,
  TodoSummary,
  TodoState,
} from './domain';

type SnapshotActionOptions = {
  now?: string;
  sessionId?: string;
};

export type LocalCreateTodoInput = {
  projectId: number;
  title: string;
  descriptionMarkdown?: string;
  parentId?: number | null;
  position?: number;
};

export type LocalCreateProjectInput = {
  name: string;
  workingDirectory: string;
  displayIdPrefix: string;
  terminalWslEnabled?: boolean;
  parentProjectId?: number;
  inheritParent?: boolean;
};

export type LocalMessageTodoInput = {
  todoId: number;
  message: string;
  conversationId?: string;
};

export type LocalUpdateProjectSettingsInput = Pick<
  ProjectSummary,
  | 'actionsDirectory'
  | 'client'
  | 'displayIdPrefix'
  | 'mainBranch'
  | 'name'
  | 'projectFolderOpenApp'
  | 'terminalWslEnabled'
  | 'workingDirectory'
> & {
  projectId: number;
  inheritParent?: boolean;
};

export type LocalUpdateProjectPromptSettingsInput = {
  projectId: number;
  aiTaskDescriptionMode: TaskDescriptionPromptMode;
  aiDefaultIncludeProjectNotes: boolean;
};

export function acceptTodoDone(
  snapshot: AppSnapshot,
  todoId: number,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  return updateTodoState(
    snapshot,
    todoId,
    'Done',
    'Accepted as done.',
    options,
  );
}

export function requestTodoChanges(
  snapshot: AppSnapshot,
  todoId: number,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  return updateTodoState(
    snapshot,
    todoId,
    'Delegated',
    'Requested changes.',
    options,
  );
}

export function recordPromptCopiedLocally(
  snapshot: AppSnapshot,
  todoId: number,
): AppSnapshot {
  const now = new Date().toISOString();
  return mapTodo(snapshot, todoId, (todo) => ({
    ...todo,
    events: makeLocalEvent(todo, 'prompt_copied'),
    stale: false,
    updatedAt: now,
  }));
}

export function stopRunningSession(
  snapshot: AppSnapshot,
  todoId: number,
  _options: SnapshotActionOptions = {},
): AppSnapshot {
  const sessions = snapshot.sessions.filter(
    (session) => session.todoId !== todoId || session.state !== 'running',
  );

  return sessions.length === snapshot.sessions.length
    ? snapshot
    : { ...snapshot, sessions };
}

export function startTaskTimer(
  snapshot: AppSnapshot,
  todoId: number,
): AppSnapshot {
  const todo = snapshot.todos.find((item) => item.id === todoId);
  if (!todo) {
    return snapshot;
  }

  return {
    ...snapshot,
    runningTimer: {
      displayId: todo.displayId,
      elapsedSeconds: 0,
      projectId: todo.projectId,
      title: todo.title,
      todoId,
    },
  };
}

export function stopTaskTimer(snapshot: AppSnapshot): AppSnapshot {
  return snapshot.runningTimer ? { ...snapshot, runningTimer: null } : snapshot;
}

export function addExecutionTerminalLocally(
  snapshot: AppSnapshot,
  terminal: ExecutionTerminalSummary,
): AppSnapshot {
  if (
    snapshot.executionTerminals.some((item) => item.ptyId === terminal.ptyId)
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    executionTerminals: [...snapshot.executionTerminals, terminal],
  };
}

export function removeExecutionTerminalLocally(
  snapshot: AppSnapshot,
  ptyId: number,
): AppSnapshot {
  const executionTerminals = snapshot.executionTerminals.filter(
    (terminal) => terminal.ptyId !== ptyId,
  );

  return executionTerminals.length === snapshot.executionTerminals.length
    ? snapshot
    : { ...snapshot, executionTerminals };
}

export function updateTodoPriorityLocally(
  snapshot: AppSnapshot,
  todoId: number,
  priority: TodoPriority,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      priority,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoContextProjectLocally(
  snapshot: AppSnapshot,
  todoId: number,
  contextProjectId: number | null,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    // Effective/inherited values are recomputed by the backend; this keeps the
    // dropdown responsive until the refreshed snapshot lands.
    return {
      ...todo,
      contextProjectId,
      effectiveContextProjectId: contextProjectId,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoStarredLocally(
  snapshot: AppSnapshot,
  todoId: number,
  starred: boolean,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      stale: false,
      starred,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoTitleLocally(
  snapshot: AppSnapshot,
  todoId: number,
  title: string,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return snapshot;
  }

  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      stale: false,
      title: nextTitle,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoDeadlineLocally(
  snapshot: AppSnapshot,
  todoId: number,
  deadline: string | null,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      deadline,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function setTodoTagsLocally(
  snapshot: AppSnapshot,
  todoId: number,
  tags: string[],
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  const normalized = Array.from(
    new Map(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => [tag.toLowerCase(), tag]),
    ).values(),
  ).sort((a, b) => a.localeCompare(b));
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      stale: false,
      tags: normalized,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoStateLocally(
  snapshot: AppSnapshot,
  todoId: number,
  state: TodoState,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      state,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function messageTodoLocally(
  snapshot: AppSnapshot,
  input: LocalMessageTodoInput,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const body = input.message.trim();
  if (!body) {
    return snapshot;
  }

  const now = options.now ?? new Date().toISOString();
  const runningSession = snapshot.sessions.find(
    (session) => session.todoId === input.todoId && session.state === 'running',
  );

  return {
    ...snapshot,
    messages: [
      ...snapshot.messages,
      {
        ...makeHumanMessage(input.todoId, body, now, input.conversationId),
        delivery: runningSession
          ? `Sent to ${runningSession.provider} session`
          : 'Pending for next session',
      },
    ],
    todos: snapshot.todos.map((todo) =>
      todo.id === input.todoId
        ? { ...todo, stale: false, updatedAt: now }
        : todo,
    ),
  };
}

export function deleteMessageLocally(
  snapshot: AppSnapshot,
  messageId: string,
): AppSnapshot {
  const messages = snapshot.messages.filter(
    (message) => message.id !== messageId,
  );
  return messages.length === snapshot.messages.length
    ? snapshot
    : { ...snapshot, messages };
}

export function clearTodoMessagesLocally(
  snapshot: AppSnapshot,
  todoId: number,
): AppSnapshot {
  const messages = snapshot.messages.filter(
    (message) => message.todoId !== todoId,
  );
  return messages.length === snapshot.messages.length
    ? snapshot
    : { ...snapshot, messages };
}

export function markTodoMessagesReadLocally(
  snapshot: AppSnapshot,
  todoId: number,
): AppSnapshot {
  let changed = false;
  const messages = snapshot.messages.map((message) => {
    if (message.todoId !== todoId || !message.unread) {
      return message;
    }

    changed = true;
    return { ...message, unread: false };
  });
  return changed ? { ...snapshot, messages } : snapshot;
}

export function updateTodoDescriptionLocally(
  snapshot: AppSnapshot,
  todoId: number,
  descriptionMarkdown: string,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      descriptionMarkdown,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoJournalLocally(
  snapshot: AppSnapshot,
  todoId: number,
  journalMarkdown: string,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      journalMarkdown,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoPanelVisibilityLocally(
  snapshot: AppSnapshot,
  todoId: number,
  visibility: {
    descriptionPanelHidden: boolean;
    executionPanelHidden: boolean;
  },
): AppSnapshot {
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      descriptionPanelHidden: visibility.descriptionPanelHidden,
      executionPanelHidden: visibility.executionPanelHidden,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoTocVisibilityLocally(
  snapshot: AppSnapshot,
  todoId: number,
  visibility: {
    descriptionTocHidden: boolean;
    artifactTocHidden: boolean;
  },
): AppSnapshot {
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      artifactTocHidden: visibility.artifactTocHidden,
      descriptionTocHidden: visibility.descriptionTocHidden,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateTodoArtifactLocally(
  snapshot: AppSnapshot,
  todoId: number,
  artifactMarkdown: string,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      artifactMarkdown,
      stale: false,
      updatedAt: now,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function updateProjectNotesLocally(
  snapshot: AppSnapshot,
  projectId: number,
  notesMarkdown: string,
): AppSnapshot {
  let changed = false;
  const projects = snapshot.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    changed = true;
    return {
      ...project,
      notesMarkdown,
    };
  });

  return changed ? { ...snapshot, projects } : snapshot;
}

export function updateProjectSettingsLocally(
  snapshot: AppSnapshot,
  input: LocalUpdateProjectSettingsInput,
): AppSnapshot {
  let changed = false;
  const projects = snapshot.projects.map((project) => {
    if (project.id !== input.projectId) {
      return project;
    }

    changed = true;
    return {
      ...project,
      actionsDirectory: input.actionsDirectory,
      client: input.client,
      displayIdPrefix: input.displayIdPrefix,
      ...(input.inheritParent !== undefined ? { inheritParent: input.inheritParent } : {}),
      name: input.name,
      projectFolderOpenApp: input.projectFolderOpenApp,
      mainBranch: input.mainBranch,
      terminalWslEnabled: input.terminalWslEnabled,
      workingDirectory: input.workingDirectory,
    };
  });

  return changed ? { ...snapshot, projects } : snapshot;
}

export function updateProjectPromptSettingsLocally(
  snapshot: AppSnapshot,
  input: LocalUpdateProjectPromptSettingsInput,
): AppSnapshot {
  let changed = false;
  const projects = snapshot.projects.map((project) => {
    if (project.id !== input.projectId) {
      return project;
    }

    changed = true;
    return {
      ...project,
      aiDefaultIncludeProjectNotes: input.aiDefaultIncludeProjectNotes,
      aiTaskDescriptionMode: input.aiTaskDescriptionMode,
    };
  });

  return changed ? { ...snapshot, projects } : snapshot;
}

export function createProjectLocally(
  snapshot: AppSnapshot,
  input: LocalCreateProjectInput,
): AppSnapshot {
  const name = input.name.trim();
  const workingDirectory = input.workingDirectory.trim();
  const displayIdPrefix = input.displayIdPrefix
    .trim()
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  if (!name || !workingDirectory || !displayIdPrefix) {
    return snapshot;
  }

  const id = Math.max(0, ...snapshot.projects.map((project) => project.id)) + 1;
  const inheritParent = input.inheritParent ?? false;
  const hasParent = input.parentProjectId !== undefined;
  const project: ProjectSummary = {
    actionsDirectory: 'actions',
    activeTodoCount: 0,
    status: 'Active',
    inheritParent,
    subprojects: [],
    aiDefaultIncludeProjectNotes: false,
    aiTaskDescriptionMode: 'task',
    client: '',
    displayIdPrefix,
    id,
    name,
    notesMarkdown: '',
    projectFolderOpenApp: 'cursor',
    mainBranch: 'main',
    terminalWslEnabled: input.terminalWslEnabled ?? false,
    backgroundImagePath: '',
    workingDirectory,
  };

  const projects = hasParent
    ? snapshot.projects.map((p) =>
        p.id === input.parentProjectId
          ? {
              ...p,
              subprojects: [
                ...p.subprojects,
                {
                  childProjectId: id,
                  kind: 'subproject' as const,
                },
              ],
            }
          : p,
      )
    : [...snapshot.projects];

  return {
    ...snapshot,
    messages: [],
    projects: [...projects, project],
    selectedProjectId: id,
    selectedTodoId: 0,
    sessions: [],
    todos: snapshot.todos.filter((todo) => todo.projectId === id),
  };
}

export function createTodoLocally(
  snapshot: AppSnapshot,
  input: LocalCreateTodoInput,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const title = input.title.trim();
  if (!title) {
    return snapshot;
  }

  const project = snapshot.projects.find((item) => item.id === input.projectId);
  if (!project) {
    return snapshot;
  }

  const projectTodos = snapshot.todos.filter(
    (todo) => todo.projectId === input.projectId,
  );
  const nextSeq =
    Math.max(
      0,
      ...projectTodos.map((todo) => displaySequence(todo.displayId)),
    ) + 1;
  const parentId = input.parentId ?? null;
  const siblings = projectTodos.filter(
    (todo) => (todo.parentId ?? null) === parentId,
  );
  const insertPosition = Math.max(
    0,
    Math.min(input.position ?? siblings.length, siblings.length),
  );
  const displayPrefix = project.displayIdPrefix || 'T';
  const id = Math.max(0, ...snapshot.todos.map((todo) => todo.id)) + 1;
  const now = options.now ?? new Date().toISOString();
  const displayId = `${displayPrefix}-${nextSeq}`;
  const newTodo: TodoSummary = {
    artifactMarkdown: '',
    artifactMarkdownPath: '',
    artifactTocHidden: true,
    activeWorkingDirectory: project.workingDirectory,
    createdAt: now,
    deadline: null,
    descriptionMarkdown: input.descriptionMarkdown ?? '',
    journalMarkdown: '',
    descriptionPanelHidden: false,
    descriptionTocHidden: true,
    displayId,
    dependencies: [],
    executionPanelHidden: false,
    id,
    events: [],
    ownTimeSeconds: 0,
    parentId,
    position: insertPosition,
    priority: 'None',
    projectId: input.projectId,
    rolledUpTimeSeconds: 0,
    stale: false,
    state: 'To Do',
    subtasks: [],
    tags: [],
    timeLogs: [],
    title,
    updatedAt: now,
  };
  const shiftedTodos = snapshot.todos.map((todo) => {
    if (
      todo.projectId === input.projectId &&
      (todo.parentId ?? null) === parentId &&
      todo.position >= insertPosition
    ) {
      return { ...todo, position: todo.position + 1 };
    }
    if (parentId !== null && todo.id === parentId) {
      const subtasks = [...todo.subtasks];
      subtasks.splice(insertPosition, 0, {
        displayId,
        done: false,
        id,
        state: 'To Do',
        title,
      });
      return { ...todo, stale: false, subtasks, updatedAt: now };
    }
    return todo;
  });

  return {
    ...snapshot,
    projects: snapshot.projects.map((item) =>
      item.id === input.projectId
        ? { ...item, activeTodoCount: item.activeTodoCount + 1 }
        : item,
    ),
    selectedProjectId: input.projectId,
    selectedTodoId: id,
    todos: [...shiftedTodos, newTodo],
  };
}

export function deleteTodoLocally(
  snapshot: AppSnapshot,
  todoId: number,
): AppSnapshot {
  const deleted = snapshot.todos.find((todo) => todo.id === todoId);
  if (!deleted) {
    return snapshot;
  }

  const todos = snapshot.todos.filter((todo) => todo.id !== todoId);
  const nextSelected =
    todos.find((todo) => todo.projectId === deleted.projectId)?.id ??
    todos[0]?.id ??
    0;

  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === deleted.projectId
        ? {
            ...project,
            activeTodoCount: Math.max(0, project.activeTodoCount - 1),
          }
        : project,
    ),
    selectedTodoId: nextSelected,
    todos,
  };
}

export function addTodoDependencyLocally(
  snapshot: AppSnapshot,
  todoId: number,
  dependsOnTodoId: number,
): AppSnapshot {
  const dependency = snapshot.todos.find((todo) => todo.id === dependsOnTodoId);
  if (!dependency) {
    return snapshot;
  }

  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (
      todo.id !== todoId ||
      todo.dependencies.some((item) => item.id === dependsOnTodoId)
    ) {
      return todo;
    }

    changed = true;
    const dependencies = [
      ...todo.dependencies,
      {
        displayId: dependency.displayId,
        id: dependency.id,
        state: dependency.state,
        title: dependency.title,
      },
    ].sort((a, b) => a.displayId.localeCompare(b.displayId));

    return {
      ...todo,
      dependency: dependencies[0],
      dependencies,
      events: makeLocalEvent(todo, 'dependency_added'),
      stale: false,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function removeTodoDependencyLocally(
  snapshot: AppSnapshot,
  todoId: number,
  dependsOnTodoId: number,
): AppSnapshot {
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    const dependencies = todo.dependencies.filter(
      (item) => item.id !== dependsOnTodoId,
    );
    if (dependencies.length === todo.dependencies.length) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      dependency: dependencies[0],
      dependencies,
      events: makeLocalEvent(todo, 'dependency_removed'),
      stale: false,
    };
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

export function createSubtaskLocally(
  snapshot: AppSnapshot,
  parentTodoId: number,
  title: string,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const parent = snapshot.todos.find((todo) => todo.id === parentTodoId);
  if (!parent || !title.trim()) {
    return snapshot;
  }

  const project = snapshot.projects.find(
    (item) => item.id === parent.projectId,
  );
  if (!project) {
    return snapshot;
  }

  const projectTodos = snapshot.todos.filter(
    (todo) => todo.projectId === parent.projectId,
  );
  const nextSeq =
    Math.max(
      0,
      ...projectTodos.map((todo) => displaySequence(todo.displayId)),
    ) + 1;
  const childPosition = snapshot.todos.filter(
    (todo) => todo.parentId === parentTodoId,
  ).length;
  const id = Math.max(0, ...snapshot.todos.map((todo) => todo.id)) + 1;
  const now = options.now ?? new Date().toISOString();
  const childDisplayId = `${project.displayIdPrefix || 'T'}-${nextSeq}`;

  return {
    ...snapshot,
    projects: snapshot.projects.map((item) =>
      item.id === parent.projectId
        ? { ...item, activeTodoCount: item.activeTodoCount + 1 }
        : item,
    ),
    todos: [
      ...snapshot.todos.map((todo) =>
        todo.id === parentTodoId
          ? {
              ...todo,
              subtasks: [
                ...todo.subtasks,
                {
                  displayId: childDisplayId,
                  done: false,
                  id,
                  state: 'To Do' as const,
                  title: title.trim(),
                },
              ],
              stale: false,
              updatedAt: now,
            }
          : todo,
      ),
      {
        artifactMarkdown: '',
        artifactMarkdownPath: '',
        artifactTocHidden: true,
        activeWorkingDirectory: project.workingDirectory,
        createdAt: now,
        deadline: null,
        dependencies: [],
        descriptionMarkdown: '',
        journalMarkdown: '',
        descriptionPanelHidden: false,
        descriptionTocHidden: true,
        displayId: childDisplayId,
        events: [],
        executionPanelHidden: false,
        id,
        ownTimeSeconds: 0,
        parentId: parentTodoId,
        position: childPosition,
        priority: 'None' as const,
        projectId: parent.projectId,
        rolledUpTimeSeconds: 0,
        stale: false,
        state: 'To Do' as const,
        subtasks: [],
        tags: [],
        timeLogs: [],
        title: title.trim(),
        updatedAt: now,
      },
    ],
  };
}

export function addManualTimeLogLocally(
  snapshot: AppSnapshot,
  todoId: number,
  durationSeconds: number,
): AppSnapshot {
  if (durationSeconds <= 0) {
    return snapshot;
  }

  const now = new Date().toISOString();
  const id =
    Math.max(
      0,
      ...snapshot.todos.flatMap((todo) => todo.timeLogs.map((log) => log.id)),
    ) + 1;
  return mapTodo(snapshot, todoId, (todo) => ({
    ...todo,
    events: makeLocalEvent(todo, 'time_log_added'),
    ownTimeSeconds: todo.ownTimeSeconds + durationSeconds,
    rolledUpTimeSeconds: todo.rolledUpTimeSeconds + durationSeconds,
    stale: false,
    timeLogs: [
      {
        durationSeconds,
        endedAt: now,
        id,
        running: false,
        source: 'manual',
        startedAt: now,
      },
      ...todo.timeLogs,
    ],
  }));
}

export function updateTimeLogDurationLocally(
  snapshot: AppSnapshot,
  timeLogId: number,
  durationSeconds: number,
): AppSnapshot {
  if (durationSeconds <= 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    todos: snapshot.todos.map((todo) => {
      const existing = todo.timeLogs.find((log) => log.id === timeLogId);
      if (!existing || existing.running) {
        return todo;
      }

      const delta = durationSeconds - existing.durationSeconds;
      return {
        ...todo,
        events: makeLocalEvent(todo, 'time_log_updated'),
        ownTimeSeconds: Math.max(0, todo.ownTimeSeconds + delta),
        rolledUpTimeSeconds: Math.max(0, todo.rolledUpTimeSeconds + delta),
        stale: false,
        timeLogs: todo.timeLogs.map((log) =>
          log.id === timeLogId ? { ...log, durationSeconds } : log,
        ),
      };
    }),
  };
}

export function deleteTimeLogLocally(
  snapshot: AppSnapshot,
  timeLogId: number,
): AppSnapshot {
  return {
    ...snapshot,
    todos: snapshot.todos.map((todo) => {
      const existing = todo.timeLogs.find((log) => log.id === timeLogId);
      if (!existing) {
        return todo;
      }

      return {
        ...todo,
        events: makeLocalEvent(todo, 'time_log_deleted'),
        ownTimeSeconds: Math.max(
          0,
          todo.ownTimeSeconds - existing.durationSeconds,
        ),
        rolledUpTimeSeconds: Math.max(
          0,
          todo.rolledUpTimeSeconds - existing.durationSeconds,
        ),
        stale: false,
        timeLogs: todo.timeLogs.filter((log) => log.id !== timeLogId),
      };
    }),
  };
}

export function startClaudeSession(
  snapshot: AppSnapshot,
  todoId: number,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  return startAgentSession(snapshot, todoId, 'Claude', options);
}

export function startCodexSession(
  snapshot: AppSnapshot,
  todoId: number,
  options: SnapshotActionOptions = {},
): AppSnapshot {
  return startAgentSession(snapshot, todoId, 'Codex', options);
}

function startAgentSession(
  snapshot: AppSnapshot,
  todoId: number,
  provider: AgentSessionSummary['provider'],
  options: SnapshotActionOptions = {},
): AppSnapshot {
  const hasRunningSession = snapshot.sessions.some(
    (session) =>
      session.todoId === todoId &&
      session.provider === provider &&
      session.state === 'running',
  );
  if (hasRunningSession) {
    return snapshot;
  }

  const todo = snapshot.todos.find((item) => item.id === todoId);
  if (!todo) {
    return snapshot;
  }

  const project = snapshot.projects.find((item) => item.id === todo.projectId);
  if (!project) {
    return snapshot;
  }

  const now = options.now ?? new Date().toISOString();
  const session: AgentSessionSummary = {
    id: options.sessionId ?? `session-${todoId}-${sanitizeIdPart(now)}`,
    command:
      provider === 'Claude'
        ? `claude --session-id ${options.sessionId ?? `session-${todoId}`}`
        : `codex --cd ${todo.activeWorkingDirectory}`,
    conversationId:
      options.sessionId ?? `session-${todoId}-${sanitizeIdPart(now)}`,
    elapsedLabel: '0m',
    lastActivity: 'started by Mark',
    pendingReplyCount: 0,
    providerSessionId: null,
    provider,
    ptyId: null,
    state: 'running',
    todoId,
    workingDirectory: todo.activeWorkingDirectory,
  };

  return {
    ...snapshot,
    sessions: [...snapshot.sessions, session],
  };
}

function updateTodoState(
  snapshot: AppSnapshot,
  todoId: number,
  state: TodoState,
  messageBody: string,
  options: SnapshotActionOptions,
): AppSnapshot {
  const now = options.now ?? new Date().toISOString();
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return {
      ...todo,
      state,
      stale: false,
      updatedAt: now,
    };
  });

  if (!changed) {
    return snapshot;
  }

  return {
    ...snapshot,
    messages: [
      ...snapshot.messages,
      makeHumanMessage(todoId, messageBody, now),
    ],
    todos,
  };
}

function makeHumanMessage(
  todoId: number,
  body: string,
  now: string,
  conversationId?: string,
): MessageSummary {
  return {
    actorName: 'Mark',
    actorType: 'human',
    body,
    conversationId,
    createdLabel: 'just now',
    delivery: 'Recorded locally',
    id: `local-${todoId}-${sanitizeIdPart(now)}`,
    todoId,
  };
}

function mapTodo(
  snapshot: AppSnapshot,
  todoId: number,
  updater: (todo: AppSnapshot['todos'][number]) => AppSnapshot['todos'][number],
): AppSnapshot {
  let changed = false;
  const todos = snapshot.todos.map((todo) => {
    if (todo.id !== todoId) {
      return todo;
    }

    changed = true;
    return updater(todo);
  });

  return changed ? { ...snapshot, todos } : snapshot;
}

function makeLocalEvent(
  todo: AppSnapshot['todos'][number],
  eventType: string,
): AppSnapshot['todos'][number]['events'] {
  return [
    {
      actorName: 'Mark',
      actorType: 'human',
      after: {},
      before: {},
      createdAt: new Date().toISOString(),
      eventType,
      id: `local-${eventType}-${todo.id}-${todo.events.length + 1}`,
      message: null,
      link: null,
    },
    ...todo.events,
  ];
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '');
}

function displaySequence(displayId: string): number {
  const value = Number(displayId.split('-').at(-1));
  return Number.isInteger(value) && value > 0 ? value : 0;
}
