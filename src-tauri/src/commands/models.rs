use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::TodoState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessCommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub display: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeCommandPlatform {
    WindowsPowerShell,
    Wsl2,
    MacOs,
    Linux,
}

impl WorktreeCommandPlatform {
    pub fn current(wsl_enabled: bool) -> Self {
        if cfg!(windows) {
            if wsl_enabled {
                Self::Wsl2
            } else {
                Self::WindowsPowerShell
            }
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderOpenCommandSpec {
    System { path: String, app: Option<String> },
    Process(ProcessCommandSpec),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoStateCommand {
    pub todo_id: i64,
    pub state: TodoState,
    pub message: Option<String>,
    pub actor_name: Option<String>,
    pub conversation_id: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodosStateCommand {
    pub todo_ids: Vec<i64>,
    pub state: TodoState,
    pub message: Option<String>,
    pub actor_name: Option<String>,
    pub conversation_id: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoPriorityCommand {
    pub todo_id: i64,
    pub priority: String,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoContextProjectCommand {
    pub todo_id: i64,
    pub context_project_id: Option<i64>,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTodoStarredCommand {
    pub todo_id: i64,
    pub starred: bool,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoTitleCommand {
    pub todo_id: i64,
    pub title: String,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoDeadlineCommand {
    pub todo_id: i64,
    pub deadline: Option<String>,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTodoTagsCommand {
    pub todo_id: i64,
    pub tags: Vec<String>,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTodoPanelVisibilityCommand {
    pub todo_id: i64,
    pub description_panel_hidden: bool,
    pub execution_panel_hidden: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTodoTocVisibilityCommand {
    pub todo_id: i64,
    pub description_toc_hidden: bool,
    pub artifact_toc_hidden: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTimerCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTodoDependencyCommand {
    pub todo_id: i64,
    pub depends_on_todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveTodoDependencyCommand {
    pub todo_id: i64,
    pub depends_on_todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubtaskCommand {
    pub parent_todo_id: i64,
    pub title: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddManualTimeLogCommand {
    pub todo_id: i64,
    pub duration_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTimeLogDurationCommand {
    pub time_log_id: i64,
    pub duration_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTimeLogCommand {
    pub time_log_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectCommand {
    pub name: String,
    pub working_directory: String,
    pub display_id_prefix: String,
    #[serde(default)]
    pub terminal_wsl_enabled: bool,
    #[serde(default)]
    pub parent_project_id: Option<i64>,
    #[serde(default)]
    pub inherit_parent: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingDirectoryCommand {
    pub path: String,
    #[serde(default)]
    pub terminal_wsl_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseWorkingDirectoryCommand {
    pub current_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoCommand {
    pub project_id: i64,
    pub title: String,
    pub description_markdown: Option<String>,
    pub parent_id: Option<i64>,
    pub position: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTodoTitleCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTodoCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTodosCommand {
    pub todo_ids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTodoCommand {
    pub todo_id: i64,
    #[serde(default)]
    pub new_project_id: Option<i64>,
    pub new_parent_id: Option<i64>,
    pub new_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTodoCommand {
    pub source_todo_id: i64,
    pub target_parent_todo_id: i64,
    pub position: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTodoCommand {
    pub todo_id: i64,
    pub message: String,
    pub actor_name: Option<String>,
    pub conversation_id: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMessageCommand {
    pub message_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearTodoMessagesCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkTodoMessagesReadCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPromptCopiedCommand {
    pub todo_id: i64,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoDescriptionCommand {
    pub todo_id: i64,
    pub description_markdown: String,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoJournalCommand {
    pub todo_id: i64,
    pub journal_markdown: String,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoArtifactCommand {
    pub todo_id: i64,
    pub artifact_markdown: String,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTodoArtifactCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePathCommand {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectNotesCommand {
    pub project_id: i64,
    pub notes_markdown: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordProjectUseCommand {
    pub project_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectSettingsCommand {
    pub project_id: i64,
    pub name: String,
    #[serde(default)]
    pub client: String,
    pub working_directory: String,
    pub display_id_prefix: String,
    pub actions_directory: String,
    pub project_folder_open_app: String,
    #[serde(default = "default_main_branch")]
    pub main_branch: String,
    #[serde(default)]
    pub terminal_wsl_enabled: bool,
    #[serde(default)]
    pub ai_default_include_project_notes: bool,
    pub ai_default_provider: Option<String>,
    #[serde(default)]
    pub inherit_parent: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkProjectCommand {
    pub parent_project_id: i64,
    pub child_project_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkProjectCommand {
    pub parent_project_id: i64,
    pub child_project_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderProjectLinkCommand {
    pub parent_project_id: i64,
    pub child_project_id: i64,
    pub new_index: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectStatusCommand {
    pub project_id: i64,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBackgroundImageCommand {
    pub project_id: i64,
}

fn default_main_branch() -> String {
    "main".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectPromptSettingsCommand {
    pub project_id: i64,
    pub ai_task_description_mode: String,
    pub ai_default_include_project_notes: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectActionsCommand {
    pub project_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionsDirectoryCommand {
    pub project_id: i64,
    pub remote_host: Option<String>,
    pub remote_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitRepositoryCommand {
    pub project_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectProjectGitHubRepositoryCommand {
    pub project_id: i64,
    pub owner: String,
    pub repo_name: String,
    pub visibility: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectActionCommand {
    pub project_id: i64,
    pub file_name: String,
    pub runtime: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionFileCommand {
    pub project_id: i64,
    pub file_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProjectActionCommand {
    pub project_id: i64,
    pub todo_id: Option<i64>,
    pub file_name: String,
    pub arguments: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestTodoWorktreeNameCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableTodoWorktreeCommand {
    pub todo_id: i64,
    pub worktree_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoWorktreeCommand {
    pub todo_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionCommand {
    pub todo_id: i64,
    pub provider: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExecutionTerminalCommand {
    pub todo_id: i64,
    pub kind: String,
    pub prompt: Option<String>,
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseExecutionTerminalCommand {
    pub pty_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameExecutionTerminalCommand {
    pub pty_id: i64,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopAgentSessionCommand {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorImageCommand {
    pub project_id: i64,
    pub todo_id: Option<i64>,
    pub scope: String,
    pub file_name: String,
    pub mime_type: String,
    pub base64_data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorImageResult {
    pub absolute_path: String,
    pub markdown_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppSettingsCommand {
    #[serde(default)]
    pub app_context_markdown: String,
    #[serde(default = "default_folder_open_app")]
    pub folder_open_app: String,
    pub mcp_enabled: bool,
    pub theme: String,
    pub claude_path: String,
    pub codex_path: String,
    pub task_titler: String,
    pub deep_link_fallback: bool,
    pub home_project_id: i64,
    pub project_accent_border_width: i64,
    pub slowdown_profiler_enabled: bool,
    pub terminal_tmux_enabled: bool,
    pub external_terminal_openers: String,
    #[serde(default = "default_markdown_editor_font_family")]
    pub markdown_editor_font_family: String,
    #[serde(default = "default_markdown_editor_font_size")]
    pub markdown_editor_font_size: String,
    #[serde(default = "default_markdown_editor_max_image_height")]
    pub markdown_editor_max_image_height: String,
}

fn default_folder_open_app() -> String {
    "code".to_string()
}

fn default_markdown_editor_font_family() -> String {
    "sans-serif".to_string()
}

fn default_markdown_editor_font_size() -> String {
    "12px".to_string()
}

fn default_markdown_editor_max_image_height() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalTerminalCommand {
    pub pty_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendSlowdownProfileRecordsCommand {
    pub records: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskDetailsRailHiddenCommand {
    pub hidden: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskListWidthCommand {
    pub width: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskListAccordionStateCommand {
    #[serde(default)]
    pub collapsed_project_ids: Vec<i64>,
    #[serde(default)]
    pub collapsed_subproject_ids: Vec<i64>,
    #[serde(default)]
    pub collapsed_todo_ids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskDetailDescriptionWidthCommand {
    pub width: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMarkdownEditorModeCommand {
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMarkdownTocHiddenCommand {
    pub hidden: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMarkdownTocWidthCommand {
    pub target: String,
    pub width: i64,
}
