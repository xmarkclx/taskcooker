use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use super::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    pub working_directory: String,
    pub display_id_prefix: String,
    pub actions_directory: String,
    #[serde(default)]
    pub parent_project_id: Option<i64>,
    #[serde(default)]
    pub inherit_parent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub client: String,
    pub working_directory: String,
    pub display_id_prefix: String,
    pub actions_directory: String,
    pub project_folder_open_app: String,
    pub main_branch: String,
    pub terminal_wsl_enabled: bool,
    pub ai_default_include_project_notes: bool,
    pub ai_default_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSettingsUpdate {
    pub project_id: i64,
    pub name: String,
    pub client: String,
    pub working_directory: String,
    pub display_id_prefix: String,
    pub actions_directory: String,
    pub project_folder_open_app: String,
    pub main_branch: String,
    pub terminal_wsl_enabled: bool,
    pub ai_default_include_project_notes: bool,
    pub ai_default_provider: Option<String>,
    #[serde(default)]
    pub inherit_parent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectPromptSettingsUpdate {
    pub project_id: i64,
    pub ai_task_description_mode: String,
    pub ai_default_include_project_notes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: i64,
    pub project_id: i64,
    pub seq: i64,
    pub display_id: String,
    pub title: String,
    pub description_markdown: String,
    pub state: TodoState,
    pub starred: bool,
    pub parent_id: Option<i64>,
    pub context_project_id: Option<i64>,
    pub worktree_name: Option<String>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeNameSuggestion {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoWorktreeSummary {
    pub todo_id: i64,
    pub name: String,
    pub path: String,
    pub branch: String,
    pub main_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoWorktreeStatusSummary {
    pub todo_id: i64,
    pub dirty: bool,
}

#[derive(Debug, Clone)]
pub struct TodoWorktreeTarget {
    pub todo_id: i64,
    pub display_id: String,
    pub title: String,
    pub project_id: i64,
    pub project_name: String,
    pub project_working_directory: String,
    pub worktree_name: String,
    pub worktree_path: String,
    pub main_branch: String,
    pub terminal_wsl_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoState {
    Icebox,
    ToDo,
    Doing,
    Blocked,
    Delegated,
    Waiting,
    ReadyToTest,
    NeedsFeedback,
    Done,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub actor_type: String,
    pub actor_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTodoState {
    pub todo_id: i64,
    pub state: TodoState,
    pub actor: Actor,
    pub message: Option<String>,
    pub conversation_id: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTodosState {
    pub todo_ids: Vec<i64>,
    pub state: TodoState,
    pub actor: Actor,
    pub message: Option<String>,
    pub conversation_id: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTodoStarred {
    pub todo_id: i64,
    pub starred: bool,
    pub actor: Actor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewAgentSession {
    pub todo_id: i64,
    pub conversation_id: String,
    pub provider: String,
    pub provider_session_id: Option<String>,
    pub pty_id: i64,
    pub command: String,
    pub working_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewActionRun {
    pub project_id: i64,
    pub todo_id: Option<i64>,
    pub file_name: String,
    pub pty_id: Option<i64>,
    pub command: Option<String>,
    pub state: String,
    pub exit_code: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub todo_id: i64,
    pub event_type: String,
    pub actor_type: String,
    pub actor_name: String,
    pub conversation_id: Option<String>,
    pub before: Value,
    pub after: Value,
    pub message: Option<String>,
    pub link: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeLog {
    pub id: i64,
    pub todo_id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_seconds: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub projects: Vec<ProjectSummary>,
    pub selected_project_id: i64,
    pub selected_todo_id: i64,
    pub todos: Vec<TodoSummary>,
    pub running_timer: Option<RunningTimerSummary>,
    pub sessions: Vec<AgentSessionSummary>,
    pub execution_terminals: Vec<ExecutionTerminalSummary>,
    pub messages: Vec<MessageSummary>,
    pub boomerang_binary_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: i64,
    pub name: String,
    pub client: String,
    pub working_directory: String,
    pub display_id_prefix: String,
    pub actions_directory: String,
    pub project_folder_open_app: String,
    pub main_branch: String,
    pub terminal_wsl_enabled: bool,
    pub background_image_path: String,
    pub notes_markdown: String,
    pub ai_default_include_project_notes: bool,
    pub ai_task_description_mode: String,
    pub ai_default_provider: Option<String>,
    pub active_todo_count: i64,
    pub status: String,
    pub inherit_parent: bool,
    pub subprojects: Vec<ProjectLinkSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinkSummary {
    pub child_project_id: i64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSummary {
    pub id: i64,
    pub project_id: i64,
    pub parent_id: Option<i64>,
    pub context_project_id: Option<i64>,
    pub effective_context_project_id: Option<i64>,
    pub position: i64,
    pub display_id: String,
    pub title: String,
    pub description_markdown: String,
    pub journal_markdown: String,
    pub artifact_markdown: String,
    pub artifact_markdown_path: String,
    pub description_panel_hidden: bool,
    pub execution_panel_hidden: bool,
    pub description_toc_hidden: bool,
    pub artifact_toc_hidden: bool,
    pub state: TodoState,
    pub starred: bool,
    pub priority: String,
    pub deadline: Option<String>,
    pub worktree_name: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_merged_at: Option<String>,
    pub omp_session_id: Option<String>,
    pub codex_session_id: Option<String>,
    pub claude_session_id: Option<String>,
    pub active_working_directory: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub own_time_seconds: i64,
    pub rolled_up_time_seconds: i64,
    pub state_age_label: Option<String>,
    pub stale: bool,
    pub dependency: Option<TodoDependencySummary>,
    pub dependencies: Vec<TodoDependencySummary>,
    pub subtasks: Vec<SubtaskSummary>,
    pub linked_tasks: Vec<LinkedTaskSummary>,
    pub time_logs: Vec<TimeLogSummary>,
    pub events: Vec<EventSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoDependencySummary {
    pub id: i64,
    pub display_id: String,
    pub title: String,
    pub state: TodoState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskSummary {
    pub id: i64,
    pub display_id: String,
    pub title: String,
    pub state: TodoState,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedTaskSummary {
    pub id: i64,
    pub display_id: String,
    pub title: String,
    pub state: TodoState,
    pub done: bool,
    pub source_project_id: i64,
    pub target_project_id: i64,
    pub parent_todo_id: Option<i64>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeLogSummary {
    pub id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_seconds: i64,
    pub source: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSummary {
    pub id: String,
    pub event_type: String,
    pub actor_type: String,
    pub actor_name: String,
    pub before: Value,
    pub after: Value,
    pub message: Option<String>,
    pub link: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningTimerSummary {
    pub todo_id: i64,
    pub project_id: i64,
    pub display_id: String,
    pub title: String,
    pub elapsed_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub id: String,
    pub todo_id: i64,
    pub conversation_id: String,
    pub provider: String,
    pub provider_session_id: Option<String>,
    pub pty_id: Option<i64>,
    pub command: String,
    pub state: String,
    pub pending_reply_count: i64,
    pub elapsed_label: String,
    pub working_directory: String,
    pub last_activity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTerminalSummary {
    pub todo_id: i64,
    pub pty_id: i64,
    pub label: String,
    pub kind: String,
    pub state: String,
    pub exit_code: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: String,
    pub todo_id: i64,
    pub actor_name: String,
    pub actor_type: String,
    pub created_label: String,
    pub body: String,
    pub conversation_id: Option<String>,
    pub delivery: Option<String>,
    pub link: Option<String>,
    pub unread: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionSummary {
    pub file_name: String,
    pub path: Option<String>,
    pub title: String,
    pub description: String,
    pub icon: Option<String>,
    pub icon_configured: bool,
    pub runtime: String,
    pub arguments: Vec<ProjectActionArgument>,
    pub validation_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionsDirectorySummary {
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionArgument {
    pub name: String,
    pub kind: String,
    pub required: bool,
    pub label: String,
    pub choices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRunSummary {
    pub id: i64,
    pub project_id: i64,
    pub todo_id: Option<i64>,
    pub action_file_name: String,
    pub action_title: String,
    pub runtime: String,
    pub pty_id: Option<i64>,
    pub command: Option<String>,
    pub working_directory: String,
    pub state: String,
    pub exit_code: Option<i64>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsSummary {
    pub app_context_markdown: String,
    pub folder_open_app: String,
    pub mcp_enabled: bool,
    pub mcp_port: i64,
    pub mcp_token: String,
    pub theme: String,
    pub claude_path: String,
    pub codex_path: String,
    pub task_titler: String,
    pub deep_link_fallback: bool,
    pub home_project_id: i64,
    pub task_details_rail_hidden: bool,
    pub task_list_collapsed_project_ids: Vec<i64>,
    pub task_list_collapsed_subproject_ids: Vec<i64>,
    pub task_list_collapsed_todo_ids: Vec<i64>,
    pub task_list_width: i64,
    pub task_detail_description_width: i64,
    pub markdown_editor_mode: String,
    pub markdown_editor_font_family: String,
    pub markdown_editor_font_size: String,
    pub markdown_editor_max_image_height: String,
    pub markdown_toc_hidden: bool,
    pub markdown_description_toc_width: i64,
    pub markdown_artifact_toc_width: i64,
    pub project_accent_border_width: i64,
    pub slowdown_profiler_enabled: bool,
    pub terminal_tmux_enabled: bool,
    pub external_terminal_openers: String,
}

impl Actor {
    pub fn system(name: impl Into<String>) -> Self {
        Self {
            actor_type: "system".to_string(),
            actor_name: name.into(),
        }
    }
}

impl TodoState {
    /// States that signal an agent has handed a task back for the human to
    /// review (test the result or answer a question). Used to decide when to
    /// raise a system notification.
    pub fn is_review_state(&self) -> bool {
        matches!(self, Self::ReadyToTest | Self::NeedsFeedback)
    }

    pub fn as_label(&self) -> &'static str {
        match self {
            Self::Icebox => "Icebox",
            Self::ToDo => "To Do",
            Self::Doing => "Doing",
            Self::Blocked => "Blocked",
            Self::Delegated => "Delegated",
            Self::Waiting => "Waiting",
            Self::ReadyToTest => "Ready to Test",
            Self::NeedsFeedback => "Needs Feedback",
            Self::Done => "Done",
            Self::Archived => "Archived",
        }
    }

    pub(crate) fn from_label(label: &str) -> AppResult<Self> {
        match normalize_state_key(label).as_str() {
            "icebox" => Ok(Self::Icebox),
            "todo" => Ok(Self::ToDo),
            "doing" => Ok(Self::Doing),
            "blocked" => Ok(Self::Blocked),
            "delegated" => Ok(Self::Delegated),
            "waiting" => Ok(Self::Waiting),
            "readytotest" => Ok(Self::ReadyToTest),
            "needsfeedback" => Ok(Self::NeedsFeedback),
            "done" => Ok(Self::Done),
            "archived" => Ok(Self::Archived),
            other => Err(AppError::InvalidInput(format!(
                "unknown todo state: {other}"
            ))),
        }
    }
}

impl Serialize for TodoState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_label())
    }
}

impl<'de> Deserialize<'de> for TodoState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let label = String::deserialize(deserializer)?;
        Self::from_label(&label).map_err(serde::de::Error::custom)
    }
}

fn normalize_state_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '-' | '_'))
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::TodoState;

    #[test]
    fn review_states_are_ready_to_test_and_needs_feedback() {
        assert!(TodoState::ReadyToTest.is_review_state());
        assert!(TodoState::NeedsFeedback.is_review_state());
    }

    #[test]
    fn non_review_states_do_not_trigger_review() {
        for state in [
            TodoState::Icebox,
            TodoState::ToDo,
            TodoState::Doing,
            TodoState::Blocked,
            TodoState::Delegated,
            TodoState::Waiting,
            TodoState::Done,
            TodoState::Archived,
        ] {
            assert!(
                !state.is_review_state(),
                "{state:?} should not be a review state"
            );
        }
    }
}
