import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';

import { previewSeedSnapshot } from '../data/seed';
import type {
  ActionRunSummary,
  AppSettingsSummary,
  AppSnapshot,
  ExecutionTerminalKind,
  ExecutionTerminalSummary,
  AppThemePreference,
  ProjectActionSummary,
  ProjectActionsDirectorySummary,
  ProjectGitRepositorySummary,
  TaskDescriptionPromptMode,
  TaskTitler,
  TodoPriority,
  TodoState,
} from '../domain/domain';

export type InvokeClient = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

const tauriClient: InvokeClient = {
  invoke: tauriInvoke,
};

let activeClient: InvokeClient = tauriClient;

const defaultClient: InvokeClient = {
  invoke: (command, args) => activeClient.invoke(command, args),
};

export type RemoteConnection = {
  baseUrl: string;
  sshHost: string;
  remotePath: string;
};

const localOnlyRemoteCommands = new Set([
  'open_file_path',
  'open_project_folder',
  'open_todo_artifact',
  'plugin:opener|open_url',
  'remote_invoke',
  'start_remote_tunnel',
  'stop_remote_tunnel',
]);

export function createRemoteInvokeClient(
  connection: RemoteConnection,
  localClient: InvokeClient = tauriClient,
): InvokeClient {
  return {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      if (localOnlyRemoteCommands.has(command)) {
        const nextArgs =
          command === 'open_project_folder'
            ? {
                ...args,
                input: {
                  ...(args?.input as Record<string, unknown> | undefined),
                  remoteHost: connection.sshHost,
                  remotePath: connection.remotePath,
                },
              }
            : args;
        return localClient.invoke<T>(command, nextArgs);
      }

      const input: Record<string, unknown> = {
        baseUrl: connection.baseUrl,
        command,
      };
      if (args !== undefined) {
        input.args = args;
      }
      return localClient.invoke<T>('remote_invoke', { input });
    },
  };
}

export function setActiveInvokeClient(client: InvokeClient | null): void {
  activeClient = client ?? tauriClient;
}

export type StartRemoteTunnelInput = {
  sshHost: string;
  serverPort: number;
  localPort?: number;
};

export type RemoteTunnelSummary = {
  baseUrl: string;
  localPort: number;
  serverPort: number;
  sshHost: string;
};

export async function startRemoteTunnel(
  input: StartRemoteTunnelInput,
  client: InvokeClient = tauriClient,
): Promise<RemoteTunnelSummary> {
  return client.invoke<RemoteTunnelSummary>('start_remote_tunnel', { input });
}

export async function stopRemoteTunnel(
  client: InvokeClient = tauriClient,
): Promise<void> {
  return client.invoke<void>('stop_remote_tunnel');
}

export const fallbackAppSettings: AppSettingsSummary = {
  appContextMarkdown: '',
  folderOpenApp: 'code',
  claudePath: 'claude',
  codexPath: 'codex',
  taskTitler: 'codex-spark',
  deepLinkFallback: true,
  homeProjectId: 0,
  mcpEnabled: true,
  mcpPort: 8787,
  mcpToken: 'local-preview-token',
  markdownArtifactTocWidth: 180,
  markdownDescriptionTocWidth: 180,
  markdownEditorFontFamily: 'sans-serif',
  markdownEditorFontSize: '12px',
  markdownEditorMaxImageHeight: 'none',
  markdownEditorMode: 'rich',
  projectAccentBorderWidth: 4,
  taskDetailsRailHidden: false,
  taskListCollapsedProjectIds: [],
  taskListCollapsedSubprojectIds: [],
  taskListCollapsedTodoIds: [],
  taskListWidth: 330,
  taskDetailDescriptionWidth: 420,
  markdownTocHidden: false,
  slowdownProfilerEnabled: true,
  terminalTmuxEnabled: false,
  externalTerminalOpeners:
    'open -na Ghostty.app --args --title={title} --working-directory={cwd} --command={tmuxCommand}, open -a Terminal.app {commandFile}',
  theme: 'system',
};

export async function loadAppSnapshot(
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  try {
    return await client.invoke<AppSnapshot>('app_snapshot');
  } catch (error) {
    if (isTauri()) {
      throw error;
    }

    return previewSeedSnapshot();
  }
}

export async function loadAppSettings(
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  try {
    return await client.invoke<AppSettingsSummary>('app_settings');
  } catch (error) {
    if (isTauri()) {
      throw error;
    }

    return fallbackAppSettings;
  }
}

export type UpdateAppSettingsInput = {
  appContextMarkdown: string;
  folderOpenApp: string;
  mcpEnabled: boolean;
  theme: AppThemePreference;
  claudePath: string;
  codexPath: string;
  taskTitler: TaskTitler;
  deepLinkFallback: boolean;
  homeProjectId: number;
  markdownEditorFontFamily: string;
  markdownEditorFontSize: string;
  markdownEditorMaxImageHeight: string;
  projectAccentBorderWidth: number;
  slowdownProfilerEnabled: boolean;
  terminalTmuxEnabled: boolean;
  externalTerminalOpeners: string;
};

export async function updateAppSettings(
  input: UpdateAppSettingsInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('update_app_settings', { input });
}

export async function openExternalTerminal(
  input: { ptyId: number },
  client: InvokeClient = defaultClient,
): Promise<void> {
  return client.invoke<void>('open_external_terminal', { input });
}

export type SlowdownProfileRecord = {
  count?: number;
  detail?: string;
  durationMs?: number;
  eventType?: string;
  kind: string;
  keyType?: string;
  occurredAt: string;
  route?: string;
  surface?: string;
  windowLabel?: string;
};

export async function appendSlowdownProfileRecords(
  records: SlowdownProfileRecord[],
  client: InvokeClient = defaultClient,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  return client.invoke<void>('append_slowdown_profile_records', {
    input: { records },
  });
}

export type CreateProjectInput = {
  name: string;
  workingDirectory: string;
  displayIdPrefix: string;
  parentProjectId?: number;
  inheritParent?: boolean;
};

export async function createProject(
  input: CreateProjectInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('create_project', { input });
}

export type RecordProjectUseInput = {
  projectId: number;
};

export async function recordProjectUse(
  input: RecordProjectUseInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  return client.invoke<void>('record_project_use', { input });
}

export type WorkingDirectoryInput = {
  path: string;
};

export type ChooseWorkingDirectoryInput = {
  currentPath: string;
};

export async function getWorkingDirectory(
  input: WorkingDirectoryInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  try {
    return await client.invoke<ProjectActionsDirectorySummary>(
      'get_working_directory',
      { input },
    );
  } catch (error) {
    if (isTauri()) {
      throw error;
    }

    return {
      exists: true,
      path: input.path,
    };
  }
}

export async function chooseWorkingDirectory(
  input: ChooseWorkingDirectoryInput,
  client: InvokeClient = defaultClient,
): Promise<string | null> {
  try {
    return await client.invoke<string | null>('choose_working_directory', {
      input,
    });
  } catch (error) {
    if (isTauri()) {
      throw error;
    }

    return null;
  }
}

export async function createWorkingDirectory(
  input: WorkingDirectoryInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  return client.invoke<ProjectActionsDirectorySummary>(
    'create_working_directory',
    { input },
  );
}

export async function regenerateMcpToken(
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('regenerate_mcp_token');
}

export type SetTaskDetailsRailHiddenInput = {
  hidden: boolean;
};

export async function setTaskDetailsRailHidden(
  input: SetTaskDetailsRailHiddenInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('set_task_details_rail_hidden', {
    input,
  });
}

export type SetTaskListWidthInput = {
  width: number;
};

export async function setTaskListWidth(
  input: SetTaskListWidthInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('set_task_list_width', { input });
}

export type SetTaskListAccordionStateInput = {
  collapsedProjectIds: number[];
  collapsedSubprojectIds: number[];
  collapsedTodoIds: number[];
};

export async function setTaskListAccordionState(
  input: SetTaskListAccordionStateInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('set_task_list_accordion_state', {
    input,
  });
}

export type SetTaskDetailDescriptionWidthInput = {
  width: number;
};

export async function setTaskDetailDescriptionWidth(
  input: SetTaskDetailDescriptionWidthInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>(
    'set_task_detail_description_width',
    { input },
  );
}

export type SetTodoPanelVisibilityInput = {
  todoId: number;
  descriptionPanelHidden: boolean;
  executionPanelHidden: boolean;
};

export async function setTodoPanelVisibility(
  input: SetTodoPanelVisibilityInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('set_todo_panel_visibility', { input });
}

export type SetTodoTocVisibilityInput = {
  todoId: number;
  descriptionTocHidden: boolean;
  artifactTocHidden: boolean;
};

export async function setTodoTocVisibility(
  input: SetTodoTocVisibilityInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('set_todo_toc_visibility', { input });
}

export type SetMarkdownEditorModeInput = {
  mode: 'rich' | 'raw';
};

export async function setMarkdownEditorMode(
  input: SetMarkdownEditorModeInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('set_markdown_editor_mode', {
    input,
  });
}

export type SetMarkdownTocHiddenInput = {
  hidden: boolean;
};

export async function setMarkdownTocHidden(
  input: SetMarkdownTocHiddenInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('set_markdown_toc_hidden', {
    input,
  });
}

export type SetMarkdownTocWidthInput = {
  target: 'description' | 'artifact';
  width: number;
};

export async function setMarkdownTocWidth(
  input: SetMarkdownTocWidthInput,
  client: InvokeClient = defaultClient,
): Promise<AppSettingsSummary> {
  return client.invoke<AppSettingsSummary>('set_markdown_toc_width', { input });
}

export type UpdateTodoStateInput = {
  todoId: number;
  state: TodoState;
  message?: string;
  actorName?: string;
  conversationId?: string;
  link?: string;
};

export async function updateTodoState(
  input: UpdateTodoStateInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_state', { input });
}

export type UpdateTodosStateInput = {
  todoIds: number[];
  state: TodoState;
  message?: string;
  actorName?: string;
  conversationId?: string;
  link?: string;
};

export async function updateTodosState(
  input: UpdateTodosStateInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todos_state', { input });
}

export type UpdateTodoPriorityInput = {
  todoId: number;
  priority: TodoPriority;
  actorName?: string;
};

export async function updateTodoPriority(
  input: UpdateTodoPriorityInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_priority', { input });
}

export type UpdateTodoContextProjectInput = {
  todoId: number;
  contextProjectId: number | null;
  actorName?: string;
};

export async function updateTodoContextProject(
  input: UpdateTodoContextProjectInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_context_project', { input });
}

export type SetTodoStarredInput = {
  todoId: number;
  starred: boolean;
  actorName?: string;
};

export async function setTodoStarred(
  input: SetTodoStarredInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('set_todo_starred', { input });
}

export type UpdateTodoTitleInput = {
  todoId: number;
  title: string;
  actorName?: string;
};

export async function updateTodoTitle(
  input: UpdateTodoTitleInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_title', { input });
}

export type UpdateTodoDeadlineInput = {
  todoId: number;
  deadline: string | null;
  actorName?: string;
};

export async function updateTodoDeadline(
  input: UpdateTodoDeadlineInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_deadline', { input });
}

export type SetTodoTagsInput = {
  todoId: number;
  tags: string[];
  actorName?: string;
};

export async function setTodoTags(
  input: SetTodoTagsInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('set_todo_tags', { input });
}

export type CreateTodoInput = {
  projectId: number;
  title: string;
  descriptionMarkdown?: string;
  parentId?: number | null;
  position?: number;
};

export async function createTodo(
  input: CreateTodoInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('create_todo', { input });
}

export type GenerateTodoTitleInput = {
  todoId: number;
};

export async function generateTodoTitle(
  input: GenerateTodoTitleInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  return client.invoke<void>('generate_todo_title', { input });
}

export type DeleteTodoInput = {
  todoId: number;
};

export async function deleteTodo(
  input: DeleteTodoInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('delete_todo', { input });
}

export type DeleteTodosInput = {
  todoIds: number[];
};

export async function deleteTodos(
  input: DeleteTodosInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('delete_todos', { input });
}

export type ReorderTodoInput = {
  todoId: number;
  newProjectId?: number;
  newParentId: number | null;
  newIndex: number;
};

export async function reorderTodo(
  input: ReorderTodoInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('reorder_todo', { input });
}

export type LinkTodoInput = {
  sourceTodoId: number;
  targetParentTodoId: number;
  position?: number;
};

export async function linkTodo(
  input: LinkTodoInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('link_todo', { input });
}

export type ReorderProjectLinkInput = {
  parentProjectId: number;
  childProjectId: number;
  newIndex: number;
};

export async function reorderProjectLink(
  input: ReorderProjectLinkInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('reorder_project_link', { input });
}

export type MessageTodoInput = {
  todoId: number;
  message: string;
  actorName?: string;
  conversationId?: string;
  link?: string;
};

export async function messageTodo(
  input: MessageTodoInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('message_todo', { input });
}

export type DeleteMessageInput = {
  messageId: string;
};

export async function deleteMessage(
  input: DeleteMessageInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('delete_message', { input });
}

export type ClearTodoMessagesInput = {
  todoId: number;
};

export async function clearTodoMessages(
  input: ClearTodoMessagesInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('clear_todo_messages', { input });
}

export type MarkTodoMessagesReadInput = {
  todoId: number;
};

export async function markTodoMessagesRead(
  input: MarkTodoMessagesReadInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('mark_todo_messages_read', { input });
}

export type RecordPromptCopiedInput = {
  todoId: number;
  actorName?: string;
};

export async function recordPromptCopied(
  input: RecordPromptCopiedInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('record_prompt_copied', { input });
}

export type UpdateTodoDescriptionInput = {
  todoId: number;
  descriptionMarkdown: string;
  actorName?: string;
};

export async function updateTodoDescription(
  input: UpdateTodoDescriptionInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_description', { input });
}

export type UpdateTodoJournalInput = {
  todoId: number;
  journalMarkdown: string;
  actorName?: string;
};

export async function updateTodoJournal(
  input: UpdateTodoJournalInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_journal', { input });
}

export type UpdateTodoArtifactInput = {
  todoId: number;
  artifactMarkdown: string;
  actorName?: string;
};

export async function updateTodoArtifact(
  input: UpdateTodoArtifactInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_todo_artifact', { input });
}

export type UpdateProjectNotesInput = {
  projectId: number;
  notesMarkdown: string;
};

export async function updateProjectNotes(
  input: UpdateProjectNotesInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_project_notes', { input });
}

export type UpdateProjectSettingsInput = {
  projectId: number;
  name: string;
  client: string;
  workingDirectory: string;
  displayIdPrefix: string;
  actionsDirectory: string;
  projectFolderOpenApp: string;
  mainBranch: string;
  terminalWslEnabled: boolean;
  aiDefaultIncludeProjectNotes?: boolean;
  aiDefaultProvider?: string | null;
  inheritParent?: boolean;
};

export async function updateProjectSettings(
  input: UpdateProjectSettingsInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_project_settings', { input });
}

export type ProjectBackgroundImageInput = {
  projectId: number;
};

export type LinkProjectInput = {
  parentProjectId: number;
  childProjectId: number;
};

export async function linkProject(
  input: LinkProjectInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('link_project', { input });
}

export type UnlinkProjectInput = {
  parentProjectId: number;
  childProjectId: number;
};

export async function unlinkProject(
  input: UnlinkProjectInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('unlink_project', { input });
}

export type UpdateProjectStatusInput = {
  projectId: number;
  status: 'Active' | 'Blocked' | 'Done' | 'Archived';
};

export async function updateProjectStatus(
  input: UpdateProjectStatusInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_project_status', { input });
}

export async function chooseProjectBackgroundImage(
  input: ProjectBackgroundImageInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('choose_project_background_image', {
    input,
  });
}

export async function clearProjectBackgroundImage(
  input: ProjectBackgroundImageInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('clear_project_background_image', {
    input,
  });
}

export type UpdateProjectPromptSettingsInput = {
  projectId: number;
  aiTaskDescriptionMode: TaskDescriptionPromptMode;
  aiDefaultIncludeProjectNotes: boolean;
};

export async function updateProjectPromptSettings(
  input: UpdateProjectPromptSettingsInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_project_prompt_settings', {
    input,
  });
}

export type ListProjectActionsInput = {
  projectId: number;
  remoteHost?: string;
  remotePath?: string;
};

export async function listProjectActions(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionSummary[]> {
  return client.invoke<ProjectActionSummary[]>('list_project_actions', {
    input,
  });
}

export async function getProjectActionsDirectory(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  return client.invoke<ProjectActionsDirectorySummary>(
    'get_project_actions_directory',
    { input },
  );
}

export type ConnectProjectGitHubRepositoryInput = {
  projectId: number;
  owner: string;
  repoName: string;
  visibility: 'public' | 'private';
};

export async function getProjectGitRepository(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectGitRepositorySummary | null> {
  return client.invoke<ProjectGitRepositorySummary | null>(
    'get_project_git_repository',
    { input },
  );
}

export async function listProjectGitHubOwners(
  client: InvokeClient = defaultClient,
): Promise<string[]> {
  return client.invoke<string[]>('list_project_github_owners');
}

export async function connectProjectGitHubRepository(
  input: ConnectProjectGitHubRepositoryInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectGitRepositorySummary> {
  return client.invoke<ProjectGitRepositorySummary>(
    'connect_project_github_repository',
    { input },
  );
}

export async function pushProjectGitRepository(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectGitRepositorySummary> {
  return client.invoke<ProjectGitRepositorySummary>(
    'push_project_git_repository',
    { input },
  );
}

export async function createProjectActionsDirectory(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  return client.invoke<ProjectActionsDirectorySummary>(
    'create_project_actions_directory',
    { input },
  );
}

export async function openProjectActionsDirectory(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  return client.invoke<ProjectActionsDirectorySummary>(
    'open_project_actions_directory',
    { input },
  );
}

export async function openProjectFolder(
  input: ListProjectActionsInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  return client.invoke<ProjectActionsDirectorySummary>('open_project_folder', {
    input,
  });
}

export type OpenTodoArtifactInput = {
  todoId: number;
};

export async function openTodoArtifact(
  input: OpenTodoArtifactInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  return client.invoke<void>('open_todo_artifact', { input });
}

export type OpenExternalUrlInput = {
  url: string;
};

export async function openExternalUrl(
  input: OpenExternalUrlInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  const url = browserUrl(input.url);

  if (!canInvokeTauri() && client === defaultClient) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  return client.invoke<void>('plugin:opener|open_url', { url });
}

export type OpenFilePathInput = {
  path: string;
};

export async function openFilePath(
  input: OpenFilePathInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  if (!canInvokeTauri() && client === defaultClient) {
    throw new Error('Local file paths can only be opened in the desktop app.');
  }

  return client.invoke<void>('open_file_path', { input });
}

export type OpenPathOrUrlInput = {
  target: string;
};

export async function openPathOrUrl(
  input: OpenPathOrUrlInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  const target = input.target.trim();
  if (isBrowserUrl(target)) {
    await openExternalUrl({ url: target }, client);
    return;
  }
  if (hasExplicitScheme(target)) {
    throw new Error(
      'Only http and https URLs, absolute paths, and ~/ paths can be opened.',
    );
  }

  await openFilePath({ path: target }, client);
}

export type CreateProjectActionInput = {
  projectId: number;
  fileName: string;
  runtime: 'shell' | 'python';
  title: string;
  description: string;
};

export async function createProjectAction(
  input: CreateProjectActionInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionSummary[]> {
  return client.invoke<ProjectActionSummary[]>('create_project_action', {
    input,
  });
}

export type ProjectActionFileInput = {
  projectId: number;
  fileName: string;
};

export async function openProjectAction(
  input: ProjectActionFileInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionsDirectorySummary> {
  return client.invoke<ProjectActionsDirectorySummary>('open_project_action', {
    input,
  });
}

export async function deleteProjectAction(
  input: ProjectActionFileInput,
  client: InvokeClient = defaultClient,
): Promise<ProjectActionSummary[]> {
  return client.invoke<ProjectActionSummary[]>('delete_project_action', {
    input,
  });
}

export type RunProjectActionInput = {
  arguments?: Record<string, string | boolean>;
  projectId: number;
  fileName: string;
  todoId?: number;
};

export async function runProjectAction(
  input: RunProjectActionInput,
  client: InvokeClient = defaultClient,
): Promise<ActionRunSummary> {
  return client.invoke<ActionRunSummary>('run_project_action', { input });
}

export type SuggestTodoWorktreeNameInput = {
  todoId: number;
};

export type WorktreeNameSuggestion = {
  name: string;
};

export async function suggestTodoWorktreeName(
  input: SuggestTodoWorktreeNameInput,
  client: InvokeClient = defaultClient,
): Promise<WorktreeNameSuggestion> {
  return client.invoke<WorktreeNameSuggestion>('suggest_todo_worktree_name', {
    input,
  });
}

export type EnableTodoWorktreeInput = {
  todoId: number;
  worktreeName: string;
};

export async function enableTodoWorktree(
  input: EnableTodoWorktreeInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('enable_todo_worktree', { input });
}

export type TodoWorktreeInput = {
  todoId: number;
};

export type TodoWorktreeStatus = {
  todoId: number;
  dirty: boolean;
};

export async function openTodoWorktreeFolder(
  input: TodoWorktreeInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  return client.invoke<void>('open_todo_worktree_folder', { input });
}

export async function openTodoWorktreeDiff(
  input: TodoWorktreeInput,
  client: InvokeClient = defaultClient,
): Promise<ExecutionTerminalSummary> {
  return client.invoke<ExecutionTerminalSummary>('open_todo_worktree_diff', {
    input,
  });
}

export async function getTodoWorktreeStatus(
  input: TodoWorktreeInput,
  client: InvokeClient = defaultClient,
): Promise<TodoWorktreeStatus> {
  return client.invoke<TodoWorktreeStatus>('todo_worktree_status', { input });
}

export async function deleteTodoWorktree(
  input: TodoWorktreeInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('delete_todo_worktree', { input });
}

export async function commitAndMergeTodoWorktree(
  input: TodoWorktreeInput,
  client: InvokeClient = defaultClient,
): Promise<ExecutionTerminalSummary> {
  return client.invoke<ExecutionTerminalSummary>(
    'commit_and_merge_todo_worktree',
    { input },
  );
}

export type StartAgentSessionInput = {
  todoId: number;
  provider: 'Claude' | 'Codex';
  prompt: string;
};

export async function startAgentSession(
  input: StartAgentSessionInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('start_agent_session', { input });
}

export type StartExecutionTerminalInput = {
  todoId: number;
  kind: ExecutionTerminalKind;
  prompt?: string;
  resumeSessionId?: string;
};

export async function startExecutionTerminal(
  input: StartExecutionTerminalInput,
  client: InvokeClient = defaultClient,
): Promise<ExecutionTerminalSummary> {
  return client.invoke<ExecutionTerminalSummary>('start_execution_terminal', {
    input,
  });
}

export type CloseExecutionTerminalInput = {
  ptyId: number;
};

// Returns nothing: callers remove the tab optimistically and the backend's
// `todos:changed` emit drives the coalesced snapshot refetch for all windows.
export async function closeExecutionTerminal(
  input: CloseExecutionTerminalInput,
  client: InvokeClient = defaultClient,
): Promise<void> {
  await client.invoke<void>('close_execution_terminal', { input });
}

export type RenameExecutionTerminalInput = {
  ptyId: number;
  label: string;
};

export async function renameExecutionTerminal(
  input: RenameExecutionTerminalInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('rename_execution_terminal', { input });
}

export type StopAgentSessionInput = {
  sessionId: string;
};

export async function stopAgentSession(
  input: StopAgentSessionInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('stop_agent_session', { input });
}

export type SaveEditorImageInput = {
  projectId: number;
  todoId?: number;
  scope: 'todo-description' | 'todo-artifact' | 'project-notes' | 'message';
  fileName: string;
  mimeType: string;
  base64Data: string;
};

export type SaveEditorImageResult = {
  absolutePath: string;
  markdownPath: string;
};

export async function saveEditorImage(
  input: SaveEditorImageInput,
  client: InvokeClient = defaultClient,
): Promise<SaveEditorImageResult> {
  return client.invoke<SaveEditorImageResult>('save_editor_image', { input });
}

export type StartTimerInput = {
  todoId: number;
};

export async function startTimer(
  input: StartTimerInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('start_timer', { input });
}

export async function stopTimer(
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('stop_timer');
}

export type AddTodoDependencyInput = {
  todoId: number;
  dependsOnTodoId: number;
};

export async function addTodoDependency(
  input: AddTodoDependencyInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('add_todo_dependency', { input });
}

export type RemoveTodoDependencyInput = {
  todoId: number;
  dependsOnTodoId: number;
};

export async function removeTodoDependency(
  input: RemoveTodoDependencyInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('remove_todo_dependency', { input });
}

export type CreateSubtaskInput = {
  parentTodoId: number;
  title: string;
};

export async function createSubtask(
  input: CreateSubtaskInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('create_subtask', { input });
}

export type AddManualTimeLogInput = {
  todoId: number;
  durationSeconds: number;
};

export async function addManualTimeLog(
  input: AddManualTimeLogInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('add_manual_time_log', { input });
}

export type UpdateTimeLogDurationInput = {
  timeLogId: number;
  durationSeconds: number;
};

export async function updateTimeLogDuration(
  input: UpdateTimeLogDurationInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('update_time_log_duration', { input });
}

export type DeleteTimeLogInput = {
  timeLogId: number;
};

export async function deleteTimeLog(
  input: DeleteTimeLogInput,
  client: InvokeClient = defaultClient,
): Promise<AppSnapshot> {
  return client.invoke<AppSnapshot>('delete_time_log', { input });
}

function browserUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Only http and https URLs can be opened from terminal links.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      'Only http and https URLs can be opened from terminal links.',
    );
  }

  return url.toString();
}

function isBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasExplicitScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value);
}

function canInvokeTauri(): boolean {
  if (isTauri()) {
    return true;
  }

  const tauriInternals =
    typeof window === 'undefined'
      ? undefined
      : (
          window as Window & {
            __TAURI_INTERNALS__?: {
              invoke?: unknown;
            };
          }
        ).__TAURI_INTERNALS__;

  return typeof tauriInternals?.invoke === 'function';
}
