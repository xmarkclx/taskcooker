import { afterEach, describe, expect, it, vi } from 'vitest';

import * as commandModule from './commands';
import {
  appendSlowdownProfileRecords,
  createRemoteInvokeClient,
  connectProjectGitHubRepository,
  loadAppSettings,
  createProject,
  createProjectAction,
  createProjectActionsDirectory,
  createWorkingDirectory,
  createTodo,
  clearTodoMessages,
  deleteProjectAction,
  deleteMessage,
  deleteTodo,
  deleteTodos,
  getProjectActionsDirectory,
  getProjectGitRepository,
  getWorkingDirectory,
  listProjectGitHubOwners,
  listProjectActions,
  loadAppSnapshot,
  linkTodo,
  markTodoMessagesRead,
  messageTodo,
  openProjectAction,
  openProjectActionsDirectory,
  openExternalUrl,
  openPathOrUrl,
  openProjectFolder,
  pushProjectGitRepository,
  openTodoArtifact,
  recordProjectUse,
  recordPromptCopied,
  renameExecutionTerminal,
  reorderTodo,
  reorderProjectLink,
  runProjectAction,
  saveEditorImage,
  setTodoTags,
  regenerateMcpToken,
  setMarkdownTocHidden,
  setMarkdownTocWidth,
  setTaskDetailDescriptionWidth,
  setTaskDetailsRailHidden,
  setTaskListAccordionState,
  setTaskListWidth,
  setTodoStarred,
  setTodoPanelVisibility,
  setTodoTocVisibility,
  startAgentSession,
  closeExecutionTerminal,
  commitAndMergeTodoWorktree,
  deleteTodoWorktree,
  enableTodoWorktree,
  getTodoWorktreeStatus,
  startExecutionTerminal,
  openTodoWorktreeDiff,
  openTodoWorktreeFolder,
  stopAgentSession,
  startTimer,
  stopTimer,
  suggestTodoWorktreeName,
  updateAppSettings,
  updateTodoDeadline,
  updateTodoArtifact,
  updateTodoJournal,
  updateProjectNotes,
  updateProjectPromptSettings,
  updateProjectSettings,
  updateTodoPriority,
  updateTodoState,
  updateTodosState,
  updateTodoTitle,
} from './commands';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'isTauri');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('Tauri command client', () => {
  it('routes remote data commands through remote_invoke and keeps local commands local', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const localClient = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'remote_invoke') {
          return { selectedProjectId: 42 } as T;
        }
        return undefined as T;
      },
    };
    const remoteClient = createRemoteInvokeClient(
      {
        baseUrl: 'http://127.0.0.1:49152',
        sshHost: 'wsl',
        remotePath: '/home/mark/project',
      },
      localClient,
    );

    const snapshot = await loadAppSnapshot(remoteClient);
    await openProjectFolder({ projectId: 42 }, remoteClient);

    expect(snapshot.selectedProjectId).toBe(42);
    expect(calls).toEqual([
      {
        command: 'remote_invoke',
        args: {
          input: {
            baseUrl: 'http://127.0.0.1:49152',
            command: 'app_snapshot',
          },
        },
      },
      {
        command: 'open_project_folder',
        args: {
          input: {
            projectId: 42,
            remoteHost: 'wsl',
            remotePath: '/home/mark/project',
          },
        },
      },
    ]);
  });

  it('falls back to seeded data when the Tauri invoke bridge is unavailable', async () => {
    const snapshot = await loadAppSnapshot({
      invoke: async () => {
        throw new Error('not running in Tauri');
      },
    });

    expect(snapshot.projects[0]?.name).toBe('tmatrix');
    expect(snapshot.todos.some((todo) => todo.displayId === 'T-128')).toBe(
      true,
    );
    expect(snapshot.sessions[0]?.provider).toBe('Claude');
  });

  it('records project use through the command bridge', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return undefined as T;
      },
    };

    await recordProjectUse({ projectId: 42 }, client);

    expect(calls).toEqual([
      {
        command: 'record_project_use',
        args: {
          input: {
            projectId: 42,
          },
        },
      },
    ]);
  });

  it('does not mask command failures inside a Tauri runtime', async () => {
    Object.defineProperty(globalThis, 'isTauri', {
      configurable: true,
      value: true,
    });
    const failingClient = {
      invoke: async () => {
        throw new Error('database unavailable');
      },
    };

    await expect(loadAppSnapshot(failingClient)).rejects.toThrow(
      'database unavailable',
    );
    await expect(loadAppSettings(failingClient)).rejects.toThrow(
      'database unavailable',
    );
  });

  it('invokes the typed project creation command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await createProject(
      {
        displayIdPrefix: 'NW',
        name: 'New Workspace',
        workingDirectory: '~/p/new-workspace',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return {
            ...loadSnapshotResult,
            selectedProjectId: 2,
            selectedTodoId: 0,
          } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'create_project',
        args: {
          input: {
            displayIdPrefix: 'NW',
            name: 'New Workspace',
            workingDirectory: '~/p/new-workspace',
          },
        },
      },
    ]);
  });

  it('invokes typed working directory commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return {
          exists: command === 'create_working_directory',
          path: '/Users/markcl/p/new-workspace',
        } as T;
      },
    };

    const status = await getWorkingDirectory(
      { path: '~/p/new-workspace', terminalWslEnabled: true },
      client,
    );
    const created = await createWorkingDirectory(
      { path: '~/p/new-workspace', terminalWslEnabled: true },
      client,
    );

    expect(status.exists).toBe(false);
    expect(created.exists).toBe(true);
    expect(calls).toEqual([
      {
        command: 'get_working_directory',
        args: {
          input: { path: '~/p/new-workspace', terminalWslEnabled: true },
        },
      },
      {
        command: 'create_working_directory',
        args: {
          input: { path: '~/p/new-workspace', terminalWslEnabled: true },
        },
      },
    ]);
  });

  it('invokes the typed working directory chooser command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const chosen = await (commandModule as any).chooseWorkingDirectory(
      { currentPath: '~/p/current-workspace' },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return '/Users/markcl/p/chosen-workspace' as T;
        },
      },
    );

    expect(chosen).toBe('/Users/markcl/p/chosen-workspace');
    expect(calls).toEqual([
      {
        command: 'choose_working_directory',
        args: { input: { currentPath: '~/p/current-workspace' } },
      },
    ]);
  });

  it('invokes the typed todo state update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const snapshot = await updateTodoState(
      {
        todoId: 128,
        state: 'Done',
        message: 'Accepted as done.',
        conversationId: 'local-review',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(snapshot.selectedTodoId).toBe(128);
    expect(calls).toEqual([
      {
        command: 'update_todo_state',
        args: {
          input: {
            todoId: 128,
            state: 'Done',
            message: 'Accepted as done.',
            conversationId: 'local-review',
          },
        },
      },
    ]);
  });

  it('invokes the typed todo title update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateTodoTitle(
      {
        actorName: 'Mark',
        title: 'Document MCP handoff',
        todoId: 128,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_todo_title',
        args: {
          input: {
            actorName: 'Mark',
            title: 'Document MCP handoff',
            todoId: 128,
          },
        },
      },
    ]);
  });

  it('invokes the typed todo priority update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateTodoPriority(
      {
        todoId: 128,
        priority: 'Urgent',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_todo_priority',
        args: {
          input: {
            todoId: 128,
            priority: 'Urgent',
          },
        },
      },
    ]);
  });

  it('invokes the typed todo starred update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await setTodoStarred(
      {
        todoId: 128,
        starred: true,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'set_todo_starred',
        args: {
          input: {
            todoId: 128,
            starred: true,
          },
        },
      },
    ]);
  });

  it('invokes typed deadline and tag update commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
      },
    };

    await updateTodoDeadline(
      {
        todoId: 128,
        deadline: '2026-06-22T12:30:00Z',
        actorName: 'Mark',
      },
      client,
    );
    await setTodoTags(
      {
        todoId: 128,
        tags: ['Client', 'AI'],
        actorName: 'Mark',
      },
      client,
    );

    expect(calls).toEqual([
      {
        command: 'update_todo_deadline',
        args: {
          input: {
            todoId: 128,
            deadline: '2026-06-22T12:30:00Z',
            actorName: 'Mark',
          },
        },
      },
      {
        command: 'set_todo_tags',
        args: {
          input: {
            todoId: 128,
            tags: ['Client', 'AI'],
            actorName: 'Mark',
          },
        },
      },
    ]);
  });

  it('invokes typed timer commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
      },
    };

    await startTimer({ todoId: 128 }, client);
    await stopTimer(client);

    expect(calls).toEqual([
      {
        command: 'start_timer',
        args: { input: { todoId: 128 } },
      },
      {
        command: 'stop_timer',
        args: undefined,
      },
    ]);
  });

  it('invokes the typed create todo command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await createTodo(
      {
        projectId: 1,
        title: 'Create new task from UI',
        descriptionMarkdown: 'Created through the app.',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 134 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'create_todo',
        args: {
          input: {
            projectId: 1,
            title: 'Create new task from UI',
            descriptionMarkdown: 'Created through the app.',
          },
        },
      },
    ]);
  });

  it('invokes the typed delete todo command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await deleteTodo(
      { todoId: 128 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 129 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'delete_todo',
        args: { input: { todoId: 128 } },
      },
    ]);
  });

  it('invokes the typed bulk delete todo command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await deleteTodos(
      { todoIds: [128, 132] },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 129 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'delete_todos',
        args: { input: { todoIds: [128, 132] } },
      },
    ]);
  });

  it('invokes the typed bulk state update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateTodosState(
      {
        actorName: 'Mark',
        state: 'Doing',
        todoIds: [128, 132],
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_todos_state',
        args: {
          input: {
            actorName: 'Mark',
            state: 'Doing',
            todoIds: [128, 132],
          },
        },
      },
    ]);
  });

  it('invokes the typed reorder todo command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await reorderTodo(
      { todoId: 9, newParentId: null, newIndex: 2 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 9 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'reorder_todo',
        args: {
          input: { todoId: 9, newParentId: null, newIndex: 2 },
        },
      },
    ]);
  });

  it('invokes reorder todo with a target project for cross-project moves', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await reorderTodo(
      { todoId: 9, newProjectId: 2, newParentId: null, newIndex: 0 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return {
            ...loadSnapshotResult,
            selectedProjectId: 2,
            selectedTodoId: 9,
          } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'reorder_todo',
        args: {
          input: { todoId: 9, newProjectId: 2, newParentId: null, newIndex: 0 },
        },
      },
    ]);
  });

  it('invokes the typed link todo command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await linkTodo(
      { sourceTodoId: 8, targetParentTodoId: 9, position: 1 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 9 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'link_todo',
        args: {
          input: { sourceTodoId: 8, targetParentTodoId: 9, position: 1 },
        },
      },
    ]);
  });

  it('invokes the typed reorder project link command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await reorderProjectLink(
      { parentProjectId: 1, childProjectId: 3, newIndex: 0 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedProjectId: 1 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'reorder_project_link',
        args: {
          input: { parentProjectId: 1, childProjectId: 3, newIndex: 0 },
        },
      },
    ]);
  });

  it('invokes the typed message todo command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await messageTodo(
      {
        todoId: 128,
        message: 'Please retry with a stable token.',
        conversationId: 'codex-demo',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'message_todo',
        args: {
          input: {
            todoId: 128,
            message: 'Please retry with a stable token.',
            conversationId: 'codex-demo',
          },
        },
      },
    ]);
  });

  it('invokes typed message delete and clear commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
      },
    };

    await deleteMessage({ messageId: 'm-42' }, client);
    await clearTodoMessages({ todoId: 128 }, client);

    expect(calls).toEqual([
      {
        command: 'delete_message',
        args: { input: { messageId: 'm-42' } },
      },
      {
        command: 'clear_todo_messages',
        args: { input: { todoId: 128 } },
      },
    ]);
  });

  it('invokes the typed mark messages read command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await markTodoMessagesRead(
      { todoId: 128 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'mark_todo_messages_read',
        args: { input: { todoId: 128 } },
      },
    ]);
  });

  it('invokes the typed prompt copied command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await recordPromptCopied(
      {
        todoId: 128,
        actorName: 'Mark',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'record_prompt_copied',
        args: {
          input: {
            todoId: 128,
            actorName: 'Mark',
          },
        },
      },
    ]);
  });

  it('invokes the typed project notes update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateProjectNotes(
      {
        projectId: 1,
        notesMarkdown: '# Notes\n\nKeep token stable.',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedProjectId: 1 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_project_notes',
        args: {
          input: {
            projectId: 1,
            notesMarkdown: '# Notes\n\nKeep token stable.',
          },
        },
      },
    ]);
  });

  it('invokes the typed todo artifact update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateTodoArtifact(
      {
        actorName: 'Mark',
        artifactMarkdown: '# Handoff\n\n- Keep this for the next agent.',
        todoId: 128,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_todo_artifact',
        args: {
          input: {
            actorName: 'Mark',
            artifactMarkdown: '# Handoff\n\n- Keep this for the next agent.',
            todoId: 128,
          },
        },
      },
    ]);
  });

  it('invokes the typed todo journal update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateTodoJournal(
      {
        actorName: 'Mark',
        journalMarkdown: '# Journal\n\nPrivate implementation notes.',
        todoId: 128,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_todo_journal',
        args: {
          input: {
            actorName: 'Mark',
            journalMarkdown: '# Journal\n\nPrivate implementation notes.',
            todoId: 128,
          },
        },
      },
    ]);
  });

  it('invokes the typed todo artifact open command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await openTodoArtifact(
      {
        todoId: 128,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return undefined as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'open_todo_artifact',
        args: {
          input: {
            todoId: 128,
          },
        },
      },
    ]);
  });

  it('invokes the typed project settings update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateProjectSettings(
      {
        projectId: 1,
        name: 'tmatrix app',
        client: 'Acme Studio',
        workingDirectory: '/Users/markcl/p/tmatrix',
        displayIdPrefix: 'TM',
        actionsDirectory: 'actions',
        projectFolderOpenApp: 'Finder',
        mainBranch: 'main',
        terminalWslEnabled: true,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedProjectId: 1 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_project_settings',
        args: {
          input: {
            projectId: 1,
            name: 'tmatrix app',
            client: 'Acme Studio',
            workingDirectory: '/Users/markcl/p/tmatrix',
            displayIdPrefix: 'TM',
            actionsDirectory: 'actions',
            projectFolderOpenApp: 'Finder',
            mainBranch: 'main',
            terminalWslEnabled: true,
          },
        },
      },
    ]);
  });

  it('invokes typed project git repository commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return null as T;
      },
    };

    await getProjectGitRepository({ projectId: 1 }, client);
    await listProjectGitHubOwners(client);
    await pushProjectGitRepository({ projectId: 1 }, client);
    await connectProjectGitHubRepository(
      {
        projectId: 1,
        owner: 'markcl',
        repoName: 'boomerangtasks',
        visibility: 'private',
      },
      client,
    );

    expect(calls).toEqual([
      {
        command: 'get_project_git_repository',
        args: { input: { projectId: 1 } },
      },
      {
        command: 'list_project_github_owners',
        args: undefined,
      },
      {
        command: 'push_project_git_repository',
        args: { input: { projectId: 1 } },
      },
      {
        command: 'connect_project_github_repository',
        args: {
          input: {
            projectId: 1,
            owner: 'markcl',
            repoName: 'boomerangtasks',
            visibility: 'private',
          },
        },
      },
    ]);
  });

  it('invokes the typed project prompt settings update command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await updateProjectPromptSettings(
      {
        projectId: 1,
        aiTaskDescriptionMode: 'ancestry',
        aiDefaultIncludeProjectNotes: true,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedProjectId: 1 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'update_project_prompt_settings',
        args: {
          input: {
            projectId: 1,
            aiTaskDescriptionMode: 'ancestry',
            aiDefaultIncludeProjectNotes: true,
          },
        },
      },
    ]);
  });

  it('invokes typed project action commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'run_project_action') {
          return {
            actionFileName: 'boomerang:open-folder',
            actionTitle: 'Open Folder',
            command: null,
            endedAt: '2026-06-20T10:00:00Z',
            exitCode: 0,
            id: 1,
            projectId: 1,
            ptyId: null,
            runtime: 'native',
            startedAt: '2026-06-20T10:00:00Z',
            state: 'succeeded',
            todoId: null,
            workingDirectory: '~/p/tmatrix',
          } as T;
        }

        return [] as T;
      },
    };

    await listProjectActions({ projectId: 1 }, client);
    await createProjectAction(
      {
        projectId: 1,
        fileName: 'reinstall.sh',
        runtime: 'shell',
        title: 'Reinstall App',
        description: 'Run reinstall flow.',
      },
      client,
    );
    await openProjectAction({ projectId: 1, fileName: 'reinstall.sh' }, client);
    await deleteProjectAction(
      { projectId: 1, fileName: 'reinstall.sh' },
      client,
    );
    await runProjectAction(
      {
        projectId: 1,
        fileName: 'boomerang:open-folder',
        todoId: 128,
      },
      client,
    );
    await runProjectAction(
      {
        arguments: {
          target: 'dev',
          verbose: true,
        },
        projectId: 1,
        fileName: 'deploy.sh',
      },
      client,
    );

    expect(calls).toEqual([
      {
        command: 'list_project_actions',
        args: { input: { projectId: 1 } },
      },
      {
        command: 'create_project_action',
        args: {
          input: {
            projectId: 1,
            fileName: 'reinstall.sh',
            runtime: 'shell',
            title: 'Reinstall App',
            description: 'Run reinstall flow.',
          },
        },
      },
      {
        command: 'open_project_action',
        args: {
          input: {
            projectId: 1,
            fileName: 'reinstall.sh',
          },
        },
      },
      {
        command: 'delete_project_action',
        args: {
          input: {
            projectId: 1,
            fileName: 'reinstall.sh',
          },
        },
      },
      {
        command: 'run_project_action',
        args: {
          input: {
            projectId: 1,
            fileName: 'boomerang:open-folder',
            todoId: 128,
          },
        },
      },
      {
        command: 'run_project_action',
        args: {
          input: {
            arguments: {
              target: 'dev',
              verbose: true,
            },
            projectId: 1,
            fileName: 'deploy.sh',
          },
        },
      },
    ]);
  });

  it('invokes typed todo worktree commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'suggest_todo_worktree_name') {
          return { name: 'B-39-worktrees-support' } as T;
        }
        if (command === 'open_todo_worktree_diff') {
          return {
            exitCode: null,
            kind: 'terminal',
            label: 'Open Diff',
            ptyId: 98,
            state: 'running',
            todoId: 39,
          } as T;
        }
        if (command === 'commit_and_merge_todo_worktree') {
          return {
            exitCode: null,
            kind: 'terminal',
            label: 'Commit & Merge',
            ptyId: 99,
            state: 'running',
            todoId: 39,
          } as T;
        }
        return { ...loadSnapshotResult, selectedTodoId: 39 } as T;
      },
    };

    const suggestion = await suggestTodoWorktreeName({ todoId: 39 }, client);
    await enableTodoWorktree(
      {
        todoId: 39,
        worktreeName: suggestion.name,
      },
      client,
    );
    await openTodoWorktreeFolder({ todoId: 39 }, client);
    await openTodoWorktreeDiff({ todoId: 39 }, client);
    await commitAndMergeTodoWorktree({ todoId: 39 }, client);
    await getTodoWorktreeStatus({ todoId: 39 }, client);
    await deleteTodoWorktree({ todoId: 39 }, client);

    expect(calls).toEqual([
      {
        command: 'suggest_todo_worktree_name',
        args: { input: { todoId: 39 } },
      },
      {
        command: 'enable_todo_worktree',
        args: {
          input: {
            todoId: 39,
            worktreeName: 'B-39-worktrees-support',
          },
        },
      },
      {
        command: 'open_todo_worktree_folder',
        args: { input: { todoId: 39 } },
      },
      {
        command: 'open_todo_worktree_diff',
        args: { input: { todoId: 39 } },
      },
      {
        command: 'commit_and_merge_todo_worktree',
        args: { input: { todoId: 39 } },
      },
      {
        command: 'todo_worktree_status',
        args: { input: { todoId: 39 } },
      },
      {
        command: 'delete_todo_worktree',
        args: { input: { todoId: 39 } },
      },
    ]);
  });

  it('invokes typed project action directory commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'get_project_actions_directory') {
          return {
            exists: false,
            path: '/Users/markcl/p/tmatrix/.boomerang/actions',
          } as T;
        }
        return { ok: true } as T;
      },
    };

    const directory = await getProjectActionsDirectory(
      { projectId: 1 },
      client,
    );
    await createProjectActionsDirectory({ projectId: 1 }, client);
    await openProjectActionsDirectory({ projectId: 1 }, client);
    await openProjectFolder({ projectId: 1 }, client);

    expect(directory).toEqual({
      exists: false,
      path: '/Users/markcl/p/tmatrix/.boomerang/actions',
    });
    expect(calls).toEqual([
      {
        command: 'get_project_actions_directory',
        args: { input: { projectId: 1 } },
      },
      {
        command: 'create_project_actions_directory',
        args: { input: { projectId: 1 } },
      },
      {
        command: 'open_project_actions_directory',
        args: { input: { projectId: 1 } },
      },
      {
        command: 'open_project_folder',
        args: { input: { projectId: 1 } },
      },
    ]);
  });

  it('opens external http and https URLs with the Tauri opener plugin', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return undefined as T;
      },
    };

    await openExternalUrl(
      {
        url: 'http://cdc-charter.test/charter/charter-enquiries/?LSCWP_CTRL=before_optm',
      },
      client,
    );

    expect(calls).toEqual([
      {
        command: 'plugin:opener|open_url',
        args: {
          url: 'http://cdc-charter.test/charter/charter-enquiries/?LSCWP_CTRL=before_optm',
        },
      },
    ]);
  });

  it('uses the Tauri opener when the invoke bridge exists without the runtime flag', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke },
    });

    await openExternalUrl({
      url: 'http://cdc-charter.test/charter/charter-enquiries/',
    });

    expect(invoke).toHaveBeenCalledWith(
      'plugin:opener|open_url',
      { url: 'http://cdc-charter.test/charter/charter-enquiries/' },
      undefined,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects non-browser URL schemes before invoking the opener plugin', async () => {
    const invoke = vi.fn();

    await expect(
      openExternalUrl({ url: 'javascript:alert(1)' }, { invoke }),
    ).rejects.toThrow(
      'Only http and https URLs can be opened from terminal links.',
    );

    expect(invoke).not.toHaveBeenCalled();
  });

  it('opens terminal link targets as URLs or local file paths', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return undefined as T;
      },
    };

    await openPathOrUrl(
      {
        target: 'https://example.com/docs',
      },
      client,
    );
    await openPathOrUrl(
      {
        target: '~/p/screenshot-alt/REQUIREMENTS.md',
      },
      client,
    );

    expect(calls).toEqual([
      {
        command: 'plugin:opener|open_url',
        args: {
          url: 'https://example.com/docs',
        },
      },
      {
        command: 'open_file_path',
        args: {
          input: {
            path: '~/p/screenshot-alt/REQUIREMENTS.md',
          },
        },
      },
    ]);
  });

  it('invokes typed app settings commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const settingsResult = {
      appContextMarkdown: '# App context',
      folderOpenApp: 'code',
      claudePath: 'claude',
      codexPath: 'codex',
      deepLinkFallback: true,
      homeProjectId: 7,
      mcpEnabled: true,
      mcpPort: 8787,
      mcpToken: 'token',
      markdownArtifactTocWidth: 244,
      markdownDescriptionTocWidth: 208,
      markdownEditorFontFamily: 'Atkinson Hyperlegible, fantasy',
      markdownEditorFontSize: 'clamp(14px, 1.2vw, 20px)',
      markdownEditorMaxImageHeight: '42vh',
      markdownEditorMode: 'rich',
      markdownTocHidden: false,
      projectAccentBorderWidth: 6,
      slowdownProfilerEnabled: true,
      terminalTmuxEnabled: false,
      externalTerminalOpeners:
        'open -na Ghostty.app --args --command={tmuxCommand}',
      taskTitler: 'codex-spark',
      taskDetailsRailHidden: true,
      taskListCollapsedProjectIds: [1],
      taskListCollapsedSubprojectIds: [2],
      taskListCollapsedTodoIds: [128],
      taskListWidth: 360,
      taskDetailDescriptionWidth: 560,
      theme: 'dark',
    };
    const client = {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return settingsResult as T;
      },
    };

    await loadAppSettings(client);
    await updateAppSettings(
      {
        appContextMarkdown: '# App context',
        folderOpenApp: 'code',
        claudePath: 'claude',
        codexPath: 'codex',
        deepLinkFallback: true,
        homeProjectId: 7,
        markdownEditorFontFamily: 'Atkinson Hyperlegible, fantasy',
        markdownEditorFontSize: 'clamp(14px, 1.2vw, 20px)',
        markdownEditorMaxImageHeight: '42vh',
        mcpEnabled: true,
        projectAccentBorderWidth: 6,
        slowdownProfilerEnabled: false,
        terminalTmuxEnabled: false,
        externalTerminalOpeners:
          'open -na Ghostty.app --args --command={tmuxCommand}',
        taskTitler: 'codex-spark',
        theme: 'dark',
      },
      client,
    );
    await setTaskDetailsRailHidden({ hidden: true }, client);
    await setTaskListAccordionState(
      {
        collapsedProjectIds: [1],
        collapsedSubprojectIds: [2],
        collapsedTodoIds: [128],
      },
      client,
    );
    await setTaskListWidth({ width: 360 }, client);
    await setTaskDetailDescriptionWidth({ width: 560 }, client);
    await setMarkdownTocWidth({ target: 'description', width: 208 }, client);
    await setMarkdownTocWidth({ target: 'artifact', width: 244 }, client);
    await setMarkdownTocHidden({ hidden: true }, client);
    await setTodoPanelVisibility(
      {
        descriptionPanelHidden: true,
        executionPanelHidden: false,
        todoId: 128,
      },
      client,
    );
    await setTodoTocVisibility(
      {
        artifactTocHidden: false,
        descriptionTocHidden: true,
        todoId: 128,
      },
      client,
    );
    await regenerateMcpToken(client);
    await appendSlowdownProfileRecords(
      [
        {
          durationMs: 182,
          kind: 'event-loop-lag',
          occurredAt: '2026-06-23T14:00:00.000Z',
          surface: 'app',
          windowLabel: 'main',
        },
      ],
      client,
    );

    expect(calls).toEqual([
      { command: 'app_settings', args: undefined },
      {
        command: 'update_app_settings',
        args: {
          input: {
            appContextMarkdown: '# App context',
            folderOpenApp: 'code',
            claudePath: 'claude',
            codexPath: 'codex',
            deepLinkFallback: true,
            homeProjectId: 7,
            markdownEditorFontFamily: 'Atkinson Hyperlegible, fantasy',
            markdownEditorFontSize: 'clamp(14px, 1.2vw, 20px)',
            markdownEditorMaxImageHeight: '42vh',
            mcpEnabled: true,
            projectAccentBorderWidth: 6,
            slowdownProfilerEnabled: false,
            terminalTmuxEnabled: false,
            externalTerminalOpeners:
              'open -na Ghostty.app --args --command={tmuxCommand}',
            taskTitler: 'codex-spark',
            theme: 'dark',
          },
        },
      },
      {
        command: 'set_task_details_rail_hidden',
        args: { input: { hidden: true } },
      },
      {
        command: 'set_task_list_accordion_state',
        args: {
          input: {
            collapsedProjectIds: [1],
            collapsedSubprojectIds: [2],
            collapsedTodoIds: [128],
          },
        },
      },
      {
        command: 'set_task_list_width',
        args: { input: { width: 360 } },
      },
      {
        command: 'set_task_detail_description_width',
        args: { input: { width: 560 } },
      },
      {
        command: 'set_markdown_toc_width',
        args: { input: { target: 'description', width: 208 } },
      },
      {
        command: 'set_markdown_toc_width',
        args: { input: { target: 'artifact', width: 244 } },
      },
      {
        command: 'set_markdown_toc_hidden',
        args: { input: { hidden: true } },
      },
      {
        command: 'set_todo_panel_visibility',
        args: {
          input: {
            descriptionPanelHidden: true,
            executionPanelHidden: false,
            todoId: 128,
          },
        },
      },
      {
        command: 'set_todo_toc_visibility',
        args: {
          input: {
            artifactTocHidden: false,
            descriptionTocHidden: true,
            todoId: 128,
          },
        },
      },
      { command: 'regenerate_mcp_token', args: undefined },
      {
        command: 'append_slowdown_profile_records',
        args: {
          input: {
            records: [
              {
                durationMs: 182,
                kind: 'event-loop-lag',
                occurredAt: '2026-06-23T14:00:00.000Z',
                surface: 'app',
                windowLabel: 'main',
              },
            ],
          },
        },
      },
    ]);
  });

  it('invokes the typed managed agent session command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await startAgentSession(
      {
        todoId: 128,
        provider: 'Claude',
        prompt: 'Work on T-128',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'start_agent_session',
        args: {
          input: {
            todoId: 128,
            provider: 'Claude',
            prompt: 'Work on T-128',
          },
        },
      },
    ]);
  });

  it('invokes the typed execution terminal command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    const terminal = await startExecutionTerminal(
      {
        kind: 'codex',
        prompt: 'Work on T-128 through the MCP server.',
        todoId: 128,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return {
            exitCode: null,
            kind: 'codex',
            label: 'Codex CLI',
            ptyId: 42,
            state: 'running',
            todoId: 128,
          } as T;
        },
      },
    );

    expect(terminal).toEqual({
      exitCode: null,
      kind: 'codex',
      label: 'Codex CLI',
      ptyId: 42,
      state: 'running',
      todoId: 128,
    });
    expect(calls).toEqual([
      {
        command: 'start_execution_terminal',
        args: {
          input: {
            kind: 'codex',
            prompt: 'Work on T-128 through the MCP server.',
            todoId: 128,
          },
        },
      },
    ]);
  });

  it('invokes the typed close execution terminal command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await closeExecutionTerminal(
      { ptyId: 42 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return undefined as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'close_execution_terminal',
        args: {
          input: {
            ptyId: 42,
          },
        },
      },
    ]);
  });

  it('invokes the typed rename execution terminal command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await renameExecutionTerminal(
      { label: 'Build watcher', ptyId: 42 },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return loadSnapshotResult as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'rename_execution_terminal',
        args: {
          input: {
            label: 'Build watcher',
            ptyId: 42,
          },
        },
      },
    ]);
  });

  it('does not expose OpenCode command wrappers', () => {
    expect(commandModule).not.toHaveProperty('startOpenCodeSession');
    expect(commandModule).not.toHaveProperty('stopOpenCodeSession');
    expect(commandModule).not.toHaveProperty('createOpenCodeTab');
    expect(commandModule).not.toHaveProperty('setOpenCodeTabSession');
    expect(commandModule).not.toHaveProperty('renameOpenCodeTab');
    expect(commandModule).not.toHaveProperty('deleteOpenCodeTab');
  });

  it('invokes the typed managed agent stop command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await stopAgentSession(
      {
        sessionId: 'session-1',
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ...loadSnapshotResult, selectedTodoId: 128 } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'stop_agent_session',
        args: {
          input: {
            sessionId: 'session-1',
          },
        },
      },
    ]);
  });

  it('invokes the typed editor image save command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];

    await saveEditorImage(
      {
        base64Data: 'aW1hZ2U=',
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        projectId: 1,
        scope: 'todo-description',
        todoId: 128,
      },
      {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return {
            absolutePath:
              '/Users/mark/Library/Application Support/app/image.png',
            markdownPath: '~/Library/Application Support/app/image.png',
          } as T;
        },
      },
    );

    expect(calls).toEqual([
      {
        command: 'save_editor_image',
        args: {
          input: {
            base64Data: 'aW1hZ2U=',
            fileName: 'screenshot.png',
            mimeType: 'image/png',
            projectId: 1,
            scope: 'todo-description',
            todoId: 128,
          },
        },
      },
    ]);
  });
});

const loadSnapshotResult = {
  executionTerminals: [],
  messages: [],
  projects: [],
  runningTimer: null,
  selectedProjectId: 1,
  selectedTodoId: 1,
  sessions: [],
  todos: [],
};
