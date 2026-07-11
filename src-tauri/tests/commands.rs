use boomerang_tasks_lib::commands::{
    agent_prompt_for_execution, app_snapshot_from_db, append_slowdown_profile_jsonl_with_rotation,
    build_agent_process_command, build_execution_process_command,
    build_folder_open_process_command, build_worktree_diff_process_command,
    build_worktree_merge_process_command, claude_status_close_input,
    claude_status_session_id_from_output, clear_todo_messages_in_db,
    codex_status_session_id_from_output, create_project_action_in_db,
    create_project_actions_directory_in_db, create_project_in_db, create_todo_in_db,
    delete_message_in_db, delete_todo_with_attachment_cleanup,
    delete_todos_with_attachment_cleanup, enable_todo_worktree_in_db,
    get_project_actions_directory_from_db, list_project_actions_from_db, load_app_settings_from_db,
    message_todo_in_db, omp_loaded_from_output, omp_session_command_input,
    omp_session_id_from_output, project_action_argument_values, project_action_environment,
    provider_prompt_submit_writes, provider_session_discovery_timeout_writes,
    provider_status_command_writes, record_prompt_copied_in_db, regenerate_mcp_token_in_db,
    reorder_project_link_in_db, reorder_todo_in_db, resolve_openable_file_path,
    run_project_action_in_db, set_markdown_editor_mode_in_db, set_markdown_toc_hidden_in_db,
    set_markdown_toc_width_in_db, set_project_background_image_from_path_in_db,
    set_task_detail_description_width_in_db, set_task_details_rail_hidden_in_db,
    set_task_list_accordion_state_in_db, set_task_list_width_in_db, start_timer_in_db,
    stop_agent_session_in_db, stop_timer_in_db, suggest_todo_worktree_name_in_db,
    update_app_settings_in_db, update_project_notes_in_db, update_project_prompt_settings_in_db,
    update_project_settings_in_db, update_todo_artifact_in_db, update_todo_priority_in_db,
    update_todo_state_in_db, update_todo_title_in_db, update_todos_state_in_db,
    ClearTodoMessagesCommand, CreateProjectActionCommand, CreateProjectCommand, CreateTodoCommand,
    DeleteMessageCommand, DeleteTodoCommand, DeleteTodosCommand, EnableTodoWorktreeCommand,
    ListProjectActionsCommand, MessageTodoCommand, OpenFilePathCommand,
    ProjectActionsDirectoryCommand, RecordPromptCopiedCommand, ReorderProjectLinkCommand,
    ReorderTodoCommand, RunProjectActionCommand, SetMarkdownEditorModeCommand,
    SetMarkdownTocHiddenCommand, SetMarkdownTocWidthCommand, SetTaskDetailDescriptionWidthCommand,
    SetTaskDetailsRailHiddenCommand, SetTaskListAccordionStateCommand, SetTaskListWidthCommand,
    StartTimerCommand, StopAgentSessionCommand, SuggestTodoWorktreeNameCommand,
    UpdateAppSettingsCommand, UpdateProjectNotesCommand, UpdateProjectPromptSettingsCommand,
    UpdateProjectSettingsCommand, UpdateTodoArtifactCommand, UpdateTodoPriorityCommand,
    UpdateTodoStateCommand, UpdateTodoTitleCommand, UpdateTodosStateCommand,
};
use boomerang_tasks_lib::core::{
    AppDb, AppSettingsSummary, NewProject, ProjectActionArgument, ProjectActionSummary, TodoState,
};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY: &str = "sans-serif";

fn create_git_project(db: &AppDb) -> (tempfile::TempDir, i64) {
    let temp = tempfile::tempdir().expect("temp dir created");
    let project_dir = temp.path().join("project");
    fs::create_dir(&project_dir).expect("project dir created");
    run_git(&project_dir, &["init", "-b", "main"]);
    fs::write(project_dir.join("README.md"), "fixture\n").expect("readme written");
    run_git(&project_dir, &["add", "README.md"]);
    run_git(
        &project_dir,
        &[
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "Initial commit",
        ],
    );

    let project_id = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: project_dir.to_string_lossy().to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created")
        .id;

    (temp, project_id)
}

fn run_git(cwd: &std::path::Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command starts");
    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn app_snapshot_seed_matches_frontend_contract_shape() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let snapshot = serde_json::to_value(app_snapshot_from_db(&db, None, None).unwrap()).unwrap();

    assert_eq!(snapshot["projects"][0]["name"], "tmatrix");
    assert_eq!(snapshot["selectedProjectId"], 1);
    assert_eq!(snapshot["todos"][1]["displayId"], "T-128");
    assert_eq!(snapshot["todos"][1]["createdAt"], "2026-06-20T09:40:00Z");
    assert_eq!(snapshot["sessions"][0]["provider"], "Claude");
    assert_eq!(snapshot["todos"][1]["state"], "Ready to Test");
}

#[test]
fn update_state_command_helper_writes_and_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let snapshot = update_todo_state_in_db(
        &db,
        UpdateTodoStateCommand {
            todo_id: selected_id,
            state: TodoState::Done,
            message: Some("Accepted as done.".to_string()),
            actor_name: Some("Mark".to_string()),
            conversation_id: Some("local-review".to_string()),
            link: None,
        },
    )
    .unwrap();

    let updated = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected_id)
        .expect("updated todo remains in snapshot");

    assert_eq!(updated.state, TodoState::Done);
    assert!(snapshot
        .messages
        .iter()
        .any(|message| message.body == "Accepted as done."));
}

#[test]
fn open_file_path_validation_accepts_absolute_and_home_aliased_paths_only() {
    let absolute_path = std::env::current_dir()
        .expect("current directory is available")
        .join("REQUIREMENTS.md");
    let absolute = resolve_openable_file_path(OpenFilePathCommand {
        path: absolute_path.display().to_string(),
    })
    .unwrap();
    assert!(absolute.is_absolute());

    let home_aliased = resolve_openable_file_path(OpenFilePathCommand {
        path: "~/p/screenshot-alt/REQUIREMENTS.md".to_string(),
    })
    .unwrap();
    assert!(home_aliased.is_absolute());

    let relative = resolve_openable_file_path(OpenFilePathCommand {
        path: "README.md".to_string(),
    })
    .unwrap_err();
    assert!(relative
        .to_string()
        .contains("Only absolute paths and ~/ paths can be opened."));

    let url = resolve_openable_file_path(OpenFilePathCommand {
        path: "javascript:alert(1)".to_string(),
    })
    .unwrap_err();
    assert!(url
        .to_string()
        .contains("Only absolute paths and ~/ paths can be opened."));
}

#[test]
fn update_priority_command_helper_writes_and_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let snapshot = update_todo_priority_in_db(
        &db,
        UpdateTodoPriorityCommand {
            todo_id: selected_id,
            priority: "Urgent".to_string(),
            actor_name: Some("Mark".to_string()),
        },
    )
    .unwrap();

    let updated = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected_id)
        .expect("updated todo remains in snapshot");

    assert_eq!(updated.priority, "Urgent");
}

#[test]
fn update_title_command_helper_writes_and_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let snapshot = update_todo_title_in_db(
        &db,
        UpdateTodoTitleCommand {
            todo_id: selected_id,
            title: "Document MCP handoff".to_string(),
            actor_name: Some("Mark".to_string()),
        },
    )
    .unwrap();

    let updated = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected_id)
        .expect("updated todo remains selected");

    assert_eq!(updated.title, "Document MCP handoff");
}

#[test]
fn message_todo_command_helper_appends_message_and_returns_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let snapshot = message_todo_in_db(
        &db,
        MessageTodoCommand {
            todo_id: selected_id,
            message: "Please retry with a stable token.".to_string(),
            actor_name: Some("Mark".to_string()),
            conversation_id: Some("codex-demo".to_string()),
            link: None,
        },
    )
    .unwrap();

    assert!(snapshot
        .messages
        .iter()
        .any(|message| message.body == "Please retry with a stable token."));
}

#[test]
fn message_command_helpers_delete_and_clear_messages() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let first = message_todo_in_db(
        &db,
        MessageTodoCommand {
            todo_id: selected_id,
            message: "First reply.".to_string(),
            actor_name: Some("Mark".to_string()),
            conversation_id: Some("codex-demo".to_string()),
            link: None,
        },
    )
    .unwrap();
    let message_id = first
        .messages
        .iter()
        .find(|message| message.body == "First reply.")
        .unwrap()
        .id
        .clone();

    let after_delete = delete_message_in_db(&db, DeleteMessageCommand { message_id }).unwrap();
    assert!(!after_delete
        .messages
        .iter()
        .any(|message| message.body == "First reply."));

    message_todo_in_db(
        &db,
        MessageTodoCommand {
            todo_id: selected_id,
            message: "Second reply.".to_string(),
            actor_name: Some("Mark".to_string()),
            conversation_id: Some("codex-demo".to_string()),
            link: None,
        },
    )
    .unwrap();
    let after_clear = clear_todo_messages_in_db(
        &db,
        ClearTodoMessagesCommand {
            todo_id: selected_id,
        },
    )
    .unwrap();
    assert!(after_clear
        .messages
        .iter()
        .all(|message| message.todo_id != selected_id));
}

#[test]
fn record_prompt_copied_command_helper_appends_prompt_event() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let snapshot = record_prompt_copied_in_db(
        &db,
        RecordPromptCopiedCommand {
            todo_id: selected_id,
            actor_name: Some("Mark".to_string()),
        },
    )
    .unwrap();

    let selected = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected_id)
        .expect("selected todo remains visible");
    assert_eq!(selected.events[0].event_type, "prompt_copied");
    assert_eq!(selected.events[0].actor_name, "Mark");
}

#[test]
fn update_todo_artifact_command_helper_writes_and_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let selected_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_todo_id;

    let snapshot = update_todo_artifact_in_db(
        &db,
        UpdateTodoArtifactCommand {
            todo_id: selected_id,
            artifact_markdown: "# Handoff\n\n- Important link: https://example.test".to_string(),
            actor_name: Some("Mark".to_string()),
        },
    )
    .unwrap();

    let updated = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected_id)
        .expect("updated todo remains visible");

    assert_eq!(
        updated.artifact_markdown,
        "# Handoff\n\n- Important link: https://example.test"
    );
    assert!(updated.artifact_markdown_path.ends_with(".md"));
}

#[test]
fn timer_command_helpers_start_and_stop_the_global_timer() {
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created");
    let todo = db
        .create_todo(project.id, "Track implementation")
        .expect("todo created");

    let started = start_timer_in_db(&db, StartTimerCommand { todo_id: todo.id }).unwrap();
    assert_eq!(db.running_timer().unwrap().unwrap().todo_id, todo.id);
    assert_eq!(started.selected_todo_id, todo.id);

    let stopped = stop_timer_in_db(&db).unwrap();
    assert!(db.running_timer().unwrap().is_none());
    assert_eq!(stopped.selected_todo_id, todo.id);
}

#[test]
fn create_todo_command_helper_allocates_and_selects_the_new_todo() {
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created");

    let snapshot = create_todo_in_db(
        &db,
        CreateTodoCommand {
            project_id: project.id,
            title: "Create new task from UI".to_string(),
            description_markdown: Some("Created through the app.".to_string()),
            parent_id: None,
            position: None,
        },
    )
    .unwrap();

    let created = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == snapshot.selected_todo_id)
        .expect("created todo is selected");

    assert_eq!(created.display_id, "T-1");
    assert_eq!(created.title, "Create new task from UI");
    assert_eq!(created.state, TodoState::ToDo);
}

#[test]
fn reorder_todo_command_helper_returns_reordered_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created");
    let first = db.create_todo(project.id, "First").unwrap();
    let second = db.create_todo(project.id, "Second").unwrap();

    let snapshot = reorder_todo_in_db(
        &db,
        ReorderTodoCommand {
            todo_id: second.id,
            new_project_id: None,
            new_parent_id: None,
            new_index: 0,
        },
    )
    .unwrap();

    let reordered = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == second.id)
        .expect("reordered todo is present");
    let shifted = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .expect("shifted todo is present");

    assert_eq!(snapshot.selected_todo_id, second.id);
    assert_eq!(reordered.position, 0);
    assert_eq!(shifted.position, 1);
}

#[test]
fn reorder_todo_command_helper_moves_todo_to_target_project() {
    let db = AppDb::open_in_memory().expect("database opens");
    let source_project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("source project created");
    let target_project = db
        .create_project(NewProject {
            name: "life".to_string(),
            working_directory: "/tmp/life".to_string(),
            display_id_prefix: "LIFE".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("target project created");
    let todo = db.create_todo(source_project.id, "Move to life").unwrap();

    let snapshot = reorder_todo_in_db(
        &db,
        ReorderTodoCommand {
            todo_id: todo.id,
            new_project_id: Some(target_project.id),
            new_parent_id: None,
            new_index: 0,
        },
    )
    .unwrap();

    let moved = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == todo.id)
        .expect("moved todo is present");

    assert_eq!(snapshot.selected_project_id, target_project.id);
    assert_eq!(moved.project_id, target_project.id);
    assert_eq!(moved.parent_id, None);
    assert_eq!(moved.position, 0);
}

#[test]
fn reorder_project_link_command_helper_returns_parent_snapshot_in_new_order() {
    let db = AppDb::open_in_memory().expect("database opens");
    let parent = db
        .create_project(NewProject {
            name: "Parent".to_string(),
            working_directory: "/tmp/parent".to_string(),
            display_id_prefix: "P".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("parent project created");
    let first = db
        .create_project(NewProject {
            name: "First".to_string(),
            working_directory: "/tmp/first".to_string(),
            display_id_prefix: "F".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("first project created");
    let second = db
        .create_project(NewProject {
            name: "Second".to_string(),
            working_directory: "/tmp/second".to_string(),
            display_id_prefix: "S".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("second project created");
    db.link_project(parent.id, first.id).expect("link first");
    db.link_project(parent.id, second.id).expect("link second");

    let snapshot = reorder_project_link_in_db(
        &db,
        ReorderProjectLinkCommand {
            parent_project_id: parent.id,
            child_project_id: second.id,
            new_index: 0,
        },
    )
    .unwrap();

    let parent_summary = snapshot
        .projects
        .iter()
        .find(|project| project.id == parent.id)
        .expect("parent summary");
    let ordered_ids = parent_summary
        .subprojects
        .iter()
        .map(|edge| edge.child_project_id)
        .collect::<Vec<_>>();
    assert_eq!(snapshot.selected_project_id, parent.id);
    assert_eq!(ordered_ids, vec![second.id, first.id]);
}

#[test]
fn delete_todo_command_helper_removes_todo_attachment_directory() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: temp.path().to_string_lossy().to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .unwrap();
    let todo = db.create_todo(project.id, "Delete screenshots").unwrap();
    let attachment_dir = temp
        .path()
        .join("attachments")
        .join(format!("project-{}", project.id))
        .join(&todo.display_id);
    fs::create_dir_all(&attachment_dir).unwrap();
    fs::write(attachment_dir.join("image.png"), b"fake image").unwrap();

    let snapshot = delete_todo_with_attachment_cleanup(
        &db,
        DeleteTodoCommand { todo_id: todo.id },
        temp.path(),
    )
    .unwrap();

    assert!(!attachment_dir.exists());
    assert!(snapshot.todos.iter().all(|item| item.id != todo.id));
}

#[test]
fn delete_todos_command_helper_removes_multiple_todos_and_attachment_directories() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: temp.path().to_string_lossy().to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .unwrap();
    let first = db.create_todo(project.id, "Delete screenshots").unwrap();
    let second = db.create_todo(project.id, "Delete logs").unwrap();
    let first_attachment_dir = temp
        .path()
        .join("attachments")
        .join(format!("project-{}", project.id))
        .join(&first.display_id);
    let second_attachment_dir = temp
        .path()
        .join("attachments")
        .join(format!("project-{}", project.id))
        .join(&second.display_id);
    fs::create_dir_all(&first_attachment_dir).unwrap();
    fs::create_dir_all(&second_attachment_dir).unwrap();
    fs::write(first_attachment_dir.join("image.png"), b"fake image").unwrap();
    fs::write(second_attachment_dir.join("log.txt"), b"fake log").unwrap();

    let snapshot = delete_todos_with_attachment_cleanup(
        &db,
        DeleteTodosCommand {
            todo_ids: vec![first.id, second.id],
        },
        temp.path(),
    )
    .unwrap();

    assert!(!first_attachment_dir.exists());
    assert!(!second_attachment_dir.exists());
    assert!(snapshot
        .todos
        .iter()
        .all(|item| item.id != first.id && item.id != second.id));
}

#[test]
fn update_todos_state_command_helper_updates_each_selected_todo() {
    let db = AppDb::open_in_memory().expect("database opens");
    let project_id = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .unwrap()
        .id;
    let first = db.create_todo(project_id, "First task").unwrap();
    let second = db.create_todo(project_id, "Second task").unwrap();

    let snapshot = update_todos_state_in_db(
        &db,
        UpdateTodosStateCommand {
            todo_ids: vec![first.id, second.id],
            state: TodoState::Doing,
            actor_name: Some("Mark".to_string()),
            message: None,
            conversation_id: None,
            link: None,
        },
    )
    .unwrap();

    assert!(snapshot
        .todos
        .iter()
        .filter(|todo| todo.id == first.id || todo.id == second.id)
        .all(|todo| todo.state == TodoState::Doing));
    assert!(db
        .list_events(first.id)
        .unwrap()
        .iter()
        .any(|event| event.event_type == "state_changed"));
    assert!(db
        .list_events(second.id)
        .unwrap()
        .iter()
        .any(|event| event.event_type == "state_changed"));
}

#[test]
fn create_project_command_helper_creates_and_selects_an_empty_project() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");

    let snapshot = create_project_in_db(
        &db,
        CreateProjectCommand {
            name: "New Workspace".to_string(),
            working_directory: "~/p/new-workspace".to_string(),
            display_id_prefix: "NW".to_string(),
            terminal_wsl_enabled: true,
            parent_project_id: None,
            inherit_parent: false,
        },
    )
    .unwrap();

    let project = snapshot
        .projects
        .iter()
        .find(|project| project.name == "New Workspace")
        .expect("created project is present");

    assert_eq!(snapshot.selected_project_id, project.id);
    assert_eq!(snapshot.selected_todo_id, 0);
    assert_eq!(project.working_directory, "~/p/new-workspace");
    assert_eq!(project.display_id_prefix, "NW");
    assert_eq!(project.actions_directory, "actions");
    assert!(project.terminal_wsl_enabled);
}

#[test]
fn update_project_notes_command_helper_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let project_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_project_id;

    let snapshot = update_project_notes_in_db(
        &db,
        UpdateProjectNotesCommand {
            project_id,
            notes_markdown: "# Project notes\n\nKeep token stable.".to_string(),
        },
    )
    .unwrap();

    assert_eq!(
        snapshot.projects[0].notes_markdown,
        "# Project notes\n\nKeep token stable."
    );
}

#[test]
fn update_project_settings_command_helper_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let project_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_project_id;

    let snapshot = update_project_settings_in_db(
        &db,
        UpdateProjectSettingsCommand {
            project_id,
            client: "Acme Studio".to_string(),
            name: "tmatrix app".to_string(),
            working_directory: "/Users/markcl/p/tmatrix".to_string(),
            display_id_prefix: "TM".to_string(),
            actions_directory: "actions".to_string(),
            project_folder_open_app: "Finder".to_string(),
            main_branch: "main".to_string(),
            terminal_wsl_enabled: true,
            ai_default_include_project_notes: false,
            ai_default_provider: None,
            inherit_parent: false,
        },
    )
    .unwrap();

    assert_eq!(snapshot.projects[0].name, "tmatrix app");
    assert_eq!(snapshot.projects[0].client, "Acme Studio");
    assert_eq!(snapshot.projects[0].display_id_prefix, "TM");
    assert_eq!(snapshot.projects[0].main_branch, "main");
    assert_eq!(snapshot.projects[0].project_folder_open_app, "Finder");
    assert!(snapshot.projects[0].terminal_wsl_enabled);
    assert!(!snapshot.projects[0].ai_default_include_project_notes);
}

#[test]
fn project_background_image_helper_copies_image_into_app_data() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let project_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_project_id;
    let temp = tempfile::tempdir().expect("temp dir created");
    let source = temp.path().join("header.png");
    fs::write(
        &source,
        b"not really png, extension is enough for this copy path",
    )
    .expect("source image written");
    let app_data_dir = temp.path().join("app-data");

    let snapshot =
        set_project_background_image_from_path_in_db(&db, &app_data_dir, project_id, &source)
            .unwrap();
    let copied = &snapshot.projects[0].background_image_path;
    let copied_path = PathBuf::from(copied.as_str());

    assert!(copied_path.starts_with(&app_data_dir));
    assert!(copied_path.starts_with(
        app_data_dir
            .join("attachments")
            .join(format!("project-{project_id}"))
            .join("background")
    ));
    assert_ne!(copied.as_str(), source.to_string_lossy().as_ref());
    assert_eq!(
        fs::read(copied).expect("copied image exists"),
        b"not really png, extension is enough for this copy path"
    );
}

#[test]
fn update_project_prompt_settings_command_helper_returns_fresh_snapshot() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let project_id = app_snapshot_from_db(&db, None, None)
        .unwrap()
        .selected_project_id;

    let snapshot = update_project_prompt_settings_in_db(
        &db,
        UpdateProjectPromptSettingsCommand {
            project_id,
            ai_task_description_mode: "ancestry".to_string(),
            ai_default_include_project_notes: true,
        },
    )
    .unwrap();

    assert_eq!(snapshot.projects[0].ai_task_description_mode, "ancestry");
    assert!(snapshot.projects[0].ai_default_include_project_notes);
}

#[test]
fn project_action_command_helpers_list_create_and_record_runs() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: temp.path().to_string_lossy().to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created");

    let initial = list_project_actions_from_db(
        &db,
        ListProjectActionsCommand {
            project_id: project.id,
        },
    )
    .unwrap();
    assert_eq!(initial[0].file_name, "boomerang:open-folder");

    let actions = create_project_action_in_db(
        &db,
        CreateProjectActionCommand {
            project_id: project.id,
            file_name: "reinstall.sh".to_string(),
            runtime: "shell".to_string(),
            title: "Reinstall App".to_string(),
            description: "Run reinstall flow.".to_string(),
        },
    )
    .unwrap();
    assert!(actions
        .iter()
        .any(|action| action.file_name == "reinstall.sh"));

    let run = run_project_action_in_db(
        &db,
        RunProjectActionCommand {
            arguments: None,
            project_id: project.id,
            todo_id: None,
            file_name: "boomerang:open-folder".to_string(),
        },
    )
    .unwrap();
    assert_eq!(run.action_file_name, "boomerang:open-folder");
    assert_eq!(run.state, "succeeded");
}

#[test]
fn worktree_command_helpers_suggest_and_enable_todo_worktrees() {
    let db = AppDb::open_in_memory().expect("database opens");
    let (_temp, project_id) = create_git_project(&db);
    let todo = db
        .create_todo(project_id, "Worktrees Support")
        .expect("todo created");

    let suggestion =
        suggest_todo_worktree_name_in_db(&db, SuggestTodoWorktreeNameCommand { todo_id: todo.id })
            .unwrap();
    assert_eq!(suggestion.name, "T-1");

    let snapshot = enable_todo_worktree_in_db(
        &db,
        EnableTodoWorktreeCommand {
            todo_id: todo.id,
            worktree_name: suggestion.name,
        },
    )
    .unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");

    assert_eq!(updated.worktree_name.as_deref(), Some("T-1"));
    assert!(updated
        .worktree_path
        .as_deref()
        .expect("worktree path is present")
        .ends_with("T-1"));
    assert_eq!(
        updated.active_working_directory,
        updated.worktree_path.clone().unwrap()
    );
}

#[test]
fn worktree_name_suggestion_uses_next_suffix_when_task_id_path_exists() {
    let db = AppDb::open_in_memory().expect("database opens");
    let (temp, project_id) = create_git_project(&db);
    let todo = db
        .create_todo(project_id, "Worktrees Support")
        .expect("todo created");
    fs::create_dir(temp.path().join("T-1")).expect("conflicting path created");
    fs::create_dir(temp.path().join("T-1-1")).expect("second conflicting path created");

    let suggestion =
        suggest_todo_worktree_name_in_db(&db, SuggestTodoWorktreeNameCommand { todo_id: todo.id })
            .unwrap();

    assert_eq!(suggestion.name, "T-1-2");
}

#[test]
fn worktree_diff_and_merge_process_commands_use_the_project_main_branch() {
    let diff = build_worktree_diff_process_command("/tmp/tmatrix-T-1", "main").unwrap();
    let merge = build_worktree_merge_process_command(
        "/tmp/tmatrix",
        "/tmp/tmatrix-T-1",
        "T-1-worktrees-support",
        "main",
        "T-1 Worktrees Support",
    )
    .unwrap();

    assert_eq!(diff.program, "bash");
    assert_eq!(diff.cwd, "/tmp/tmatrix-T-1");
    assert!(diff.display.contains("Diff range: main..HEAD"));
    assert!(diff
        .display
        .contains("git -C /tmp/tmatrix-T-1 diff main..HEAD"));
    assert!(!diff.display.contains("lazygit"));
    assert_eq!(merge.program, "bash");
    assert_eq!(merge.cwd, "/tmp/tmatrix");
    assert!(merge.display.contains("git -C /tmp/tmatrix-T-1 add -A"));
    assert!(merge
        .display
        .contains("git -C /tmp/tmatrix merge --squash --ff T-1-worktrees-support"));
    assert!(merge.display.contains("git -C /tmp/tmatrix commit -m"));
    assert!(merge.display.contains("T-1 Worktrees Support"));
}

#[test]
fn worktree_process_commands_expand_home_aliases_for_git_paths() {
    let home = PathBuf::from(std::env::var("HOME").expect("HOME is set for path expansion tests"));
    let project_dir = home.join("p/tmatrix").display().to_string();
    let worktree_dir = home.join("p/tmatrix-T-1").display().to_string();
    let diff = build_worktree_diff_process_command("~/p/tmatrix-T-1", "main").unwrap();
    let merge = build_worktree_merge_process_command(
        "~/p/tmatrix",
        "~/p/tmatrix-T-1",
        "T-1-worktrees-support",
        "main",
        "T-1 Worktrees Support",
    )
    .unwrap();

    assert_eq!(diff.cwd, worktree_dir);
    assert!(diff.display.contains(&worktree_dir));
    assert!(diff.display.contains("diff main..HEAD"));
    assert_eq!(merge.cwd, project_dir);
    assert!(merge.display.contains(&worktree_dir));
    assert!(merge.display.contains("add -A"));
    assert!(merge.display.contains(&project_dir));
    assert!(merge.display.contains("checkout main"));
    assert!(!merge.display.contains("git -C ~/"));
}

#[test]
fn worktree_merge_process_rebases_worktree_on_main_before_squash_merging() {
    let merge = build_worktree_merge_process_command(
        "/tmp/tmatrix",
        "/tmp/tmatrix-T-1",
        "T-1-worktrees-support",
        "main",
        "T-1 Worktrees Support",
    )
    .unwrap();

    assert!(merge
        .display
        .contains("git -C /tmp/tmatrix fetch --all --prune"));
    assert!(merge.display.contains("git -C /tmp/tmatrix checkout main"));
    assert!(merge.display.contains("git -C /tmp/tmatrix pull --ff-only"));
    let rebase_index = merge
        .display
        .find("git -C /tmp/tmatrix-T-1 rebase main")
        .expect("worktree branch is rebased onto main before merge");
    let merge_index = merge
        .display
        .find("git -C /tmp/tmatrix merge --squash --ff T-1-worktrees-support")
        .expect("worktree branch is squash merged back to main");
    assert!(rebase_index < merge_index);
    assert!(merge.display.contains("git -C /tmp/tmatrix commit -m"));
}

#[test]
fn project_actions_directory_command_helpers_resolve_and_create_directory() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = AppDb::open_in_memory().expect("database opens");
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: temp.path().to_string_lossy().to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created");

    let before = get_project_actions_directory_from_db(
        &db,
        ProjectActionsDirectoryCommand {
            project_id: project.id,
            remote_host: None,
            remote_path: None,
        },
    )
    .unwrap();
    assert!(!before.exists);
    assert!(before.path.ends_with(".boomerang/actions"));

    let after = create_project_actions_directory_in_db(
        &db,
        ProjectActionsDirectoryCommand {
            project_id: project.id,
            remote_host: None,
            remote_path: None,
        },
    )
    .unwrap();
    assert!(after.exists);
    assert_eq!(before.path, after.path);
    assert!(std::path::Path::new(&after.path).is_dir());
}

#[test]
fn create_project_rejects_duplicate_display_id_prefixes() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.create_project(NewProject {
        name: "tmatrix".to_string(),
        working_directory: "~/p/tmatrix".to_string(),
        display_id_prefix: "T".to_string(),
        actions_directory: ".boomerang/actions".to_string(),
        terminal_wsl_enabled: false,
        parent_project_id: None,
        inherit_parent: false,
    })
    .expect("project created");

    let duplicate = create_project_in_db(
        &db,
        CreateProjectCommand {
            name: "tools".to_string(),
            working_directory: "~/p/tools".to_string(),
            display_id_prefix: "t".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        },
    );

    assert_eq!(
        duplicate.unwrap_err(),
        "display id prefix already exists: T"
    );
}

#[test]
fn project_action_argument_values_validate_and_preserve_metadata_order() {
    let action = ProjectActionSummary {
        file_name: "deploy.sh".to_string(),
        path: Some("/tmp/deploy.sh".to_string()),
        title: "Deploy".to_string(),
        description: String::new(),
        icon: None,
        icon_configured: false,
        runtime: "shell".to_string(),
        arguments: vec![
            ProjectActionArgument {
                name: "target".to_string(),
                kind: "choice".to_string(),
                required: true,
                label: "Target".to_string(),
                choices: vec!["dev".to_string(), "prod".to_string()],
            },
            ProjectActionArgument {
                name: "verbose".to_string(),
                kind: "boolean".to_string(),
                required: false,
                label: "Verbose".to_string(),
                choices: vec![],
            },
            ProjectActionArgument {
                name: "note".to_string(),
                kind: "string".to_string(),
                required: false,
                label: "Note".to_string(),
                choices: vec![],
            },
        ],
        validation_error: None,
    };

    let values = project_action_argument_values(
        &action,
        Some(&json!({ "target": "dev", "verbose": true, "note": "ship it" })),
    )
    .unwrap();
    assert_eq!(values, vec!["dev", "true", "ship it"]);

    let missing = project_action_argument_values(&action, Some(&json!({}))).unwrap_err();
    assert!(missing.contains("missing required action argument: target"));

    let bad_choice =
        project_action_argument_values(&action, Some(&json!({ "target": "stage" }))).unwrap_err();
    assert!(bad_choice.contains("invalid choice for action argument target"));

    let unknown =
        project_action_argument_values(&action, Some(&json!({ "target": "dev", "extra": "nope" })))
            .unwrap_err();
    assert!(unknown.contains("unknown action argument: extra"));
}

#[test]
fn project_action_environment_includes_project_action_and_selected_todo_context() {
    let env = project_action_environment(
        7,
        "tmatrix",
        "/tmp/tmatrix",
        "deploy.sh",
        "Deploy",
        Some((42, "T-42")),
    );

    assert!(env.contains(&("BOOMERANG_PROJECT_ID".to_string(), "7".to_string())));
    assert!(env.contains(&("BOOMERANG_PROJECT_NAME".to_string(), "tmatrix".to_string())));
    assert!(env.contains(&(
        "BOOMERANG_PROJECT_DIR".to_string(),
        "/tmp/tmatrix".to_string()
    )));
    assert!(env.contains(&("BOOMERANG_ACTION_FILE".to_string(), "deploy.sh".to_string())));
    assert!(env.contains(&("BOOMERANG_ACTION_TITLE".to_string(), "Deploy".to_string())));
    assert!(env.contains(&("BOOMERANG_TODO_ID".to_string(), "42".to_string())));
    assert!(env.contains(&("BOOMERANG_TODO_DISPLAY_ID".to_string(), "T-42".to_string())));
}

#[test]
fn execution_process_commands_force_no_approval_provider_flags() {
    let settings = AppSettingsSummary {
        app_context_markdown: "".to_string(),
        folder_open_app: "code".to_string(),
        mcp_enabled: true,
        mcp_port: 8787,
        mcp_token: "token".to_string(),
        theme: "light".to_string(),
        claude_path: "claude".to_string(),
        codex_path: "codex".to_string(),
        task_titler: "codex-spark".to_string(),
        deep_link_fallback: true,
        home_project_id: 0,
        task_details_rail_hidden: false,
        task_list_collapsed_project_ids: Vec::new(),
        task_list_collapsed_subproject_ids: Vec::new(),
        task_list_collapsed_todo_ids: Vec::new(),
        task_list_width: 300,
        task_detail_description_width: 420,
        markdown_editor_mode: "rich".to_string(),
        markdown_editor_font_family: DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY.to_string(),
        markdown_editor_font_size: "12px".to_string(),
        markdown_editor_max_image_height: "none".to_string(),
        markdown_toc_hidden: false,
        markdown_description_toc_width: 180,
        markdown_artifact_toc_width: 180,
        project_accent_border_width: 4,
        slowdown_profiler_enabled: true,
        terminal_tmux_enabled: false,
        external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
            .to_string(),
    };

    let codex = build_execution_process_command(
        &settings,
        "codex",
        "/tmp/tmatrix",
        Some("Work on T-128"),
        None,
    )
    .unwrap();
    let claude = build_execution_process_command(
        &settings,
        "claude",
        "/tmp/tmatrix",
        Some("Work on T-128"),
        None,
    )
    .unwrap();

    assert_eq!(codex.program, "codex");
    assert_eq!(codex.args, vec!["--yolo", "--cd", "/tmp/tmatrix"]);
    assert_eq!(claude.program, "claude");
    assert_eq!(claude.args, vec!["--dangerously-skip-permissions"]);
}

#[test]
fn execution_process_commands_support_provider_start_and_resume() {
    let settings = AppSettingsSummary {
        app_context_markdown: "".to_string(),
        folder_open_app: "code".to_string(),
        mcp_enabled: true,
        mcp_port: 8787,
        mcp_token: "token".to_string(),
        theme: "light".to_string(),
        claude_path: "claude".to_string(),
        codex_path: "codex".to_string(),
        task_titler: "codex-spark".to_string(),
        deep_link_fallback: true,
        home_project_id: 0,
        task_details_rail_hidden: false,
        task_list_collapsed_project_ids: Vec::new(),
        task_list_collapsed_subproject_ids: Vec::new(),
        task_list_collapsed_todo_ids: Vec::new(),
        task_list_width: 300,
        task_detail_description_width: 420,
        markdown_editor_mode: "rich".to_string(),
        markdown_editor_font_family: DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY.to_string(),
        markdown_editor_font_size: "12px".to_string(),
        markdown_editor_max_image_height: "none".to_string(),
        markdown_toc_hidden: false,
        markdown_description_toc_width: 180,
        markdown_artifact_toc_width: 180,
        project_accent_border_width: 4,
        slowdown_profiler_enabled: true,
        terminal_tmux_enabled: false,
        external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
            .to_string(),
    };

    let omp_start = build_execution_process_command(
        &settings,
        "omp",
        "/tmp/tmatrix",
        Some("Work on T-128"),
        None,
    )
    .unwrap();
    let omp_resume = build_execution_process_command(
        &settings,
        "omp",
        "/tmp/tmatrix",
        None,
        Some("019efe10-60fc-7000-9f8e-6545a91a41ce"),
    )
    .unwrap();
    let codex_resume = build_execution_process_command(
        &settings,
        "codex",
        "/tmp/tmatrix",
        None,
        Some("019f016b-4fb4-79c1-9da5-f7bfb7a59092"),
    )
    .unwrap();
    let claude_resume = build_execution_process_command(
        &settings,
        "claude",
        "/tmp/tmatrix",
        None,
        Some("3eabfd51-a2e3-4a01-ba30-27c72e19f3c5"),
    )
    .unwrap();

    assert_eq!(omp_start.program, "omp");
    assert_eq!(omp_start.args, vec!["--yolo"]);
    assert_eq!(omp_resume.program, "omp");
    assert_eq!(
        omp_resume.args,
        vec!["--yolo", "--resume", "019efe10-60fc-7000-9f8e-6545a91a41ce",],
    );
    assert_eq!(codex_resume.program, "codex");
    assert_eq!(
        codex_resume.args,
        vec!["--yolo", "resume", "019f016b-4fb4-79c1-9da5-f7bfb7a59092"],
    );
    assert_eq!(claude_resume.program, "claude");
    assert_eq!(
        claude_resume.args,
        vec![
            "--dangerously-skip-permissions",
            "--resume",
            "3eabfd51-a2e3-4a01-ba30-27c72e19f3c5"
        ],
    );
}

#[test]
fn omp_session_output_parser_reads_the_session_info_id() {
    let output = "\n Session Info\n\n File:\n /Users/markcl/.omp/agent/sessions/demo.jsonl\n ID: 019efe10-60fc-7000-9f8e-6545a91a41ce\n\n Provider\n Name: openai-codex\n";

    assert_eq!(
        omp_session_id_from_output(output).as_deref(),
        Some("019efe10-60fc-7000-9f8e-6545a91a41ce"),
    );
}

#[test]
fn omp_session_command_input_executes_the_slash_command() {
    assert_eq!(omp_session_command_input(), "/session\r");
}

#[test]
fn provider_status_inputs_match_cli_interaction() {
    assert_eq!(provider_status_command_writes(), ["/status", "\r"]);
    assert_eq!(claude_status_close_input(), "\u{1b}");
}

#[test]
fn provider_status_parsers_read_session_ids() {
    let codex_output = "\n╭────────────────────────────────────────────────────────────────────────────────────────╮\n│  >_ OpenAI Codex (v0.142.0)                                                            │\n│  Session:                     019f016b-4fb4-79c1-9da5-f7bfb7a59092                     │\n╰────────────────────────────────────────────────────────────────────────────────────────╯\n";
    let claude_output = "\n   Settings  Status   Config   Usage   Stats\n\n   Version:          2.1.191\n   Session ID:       3eabfd51-a2e3-4a01-ba30-27c72e19f3c5\n\n   Esc to cancel\n";

    assert_eq!(
        codex_status_session_id_from_output(codex_output).as_deref(),
        Some("019f016b-4fb4-79c1-9da5-f7bfb7a59092"),
    );
    assert_eq!(
        claude_status_session_id_from_output(claude_output).as_deref(),
        Some("3eabfd51-a2e3-4a01-ba30-27c72e19f3c5"),
    );
}

#[test]
fn provider_prompt_submit_writes_paste_then_enter_as_separate_inputs() {
    assert_eq!(
        provider_prompt_submit_writes("Work on T-128"),
        vec!["Work on T-128", "\r"],
    );
}

#[test]
fn provider_session_discovery_timeout_falls_back_to_prompt_input() {
    assert_eq!(
        provider_session_discovery_timeout_writes("omp", "Work on T-128", true),
        vec!["Work on T-128", "\r"],
    );
    assert_eq!(
        provider_session_discovery_timeout_writes("codex", "Work on T-128", true),
        vec!["Work on T-128", "\r"],
    );
    assert_eq!(
        provider_session_discovery_timeout_writes("claude", "Work on T-128", true),
        vec!["\u{1b}", "Work on T-128", "\r"],
    );
    assert!(provider_session_discovery_timeout_writes("claude", "Work on T-128", false).is_empty());
}

#[test]
fn omp_loaded_detector_waits_for_the_ready_prompt() {
    assert!(!omp_loaded_from_output(
        "Update Available\nStill connecting: context7..."
    ));
    assert!(omp_loaded_from_output(
        "Connected to MCP servers: context7:context7, node_repl, openaiDeveloperDocs.\n╭── π  > ⬢ GPT-5.5 · ◒ med > 📁 ~/p/T-11 >\n╰─                                                                                      ─╯"
    ));
}

#[test]
fn execution_process_command_rejects_unknown_kind() {
    let settings = AppSettingsSummary {
        app_context_markdown: "".to_string(),
        folder_open_app: "code".to_string(),
        mcp_enabled: true,
        mcp_port: 8787,
        mcp_token: "token".to_string(),
        theme: "light".to_string(),
        claude_path: "claude".to_string(),
        codex_path: "codex".to_string(),
        task_titler: "codex-spark".to_string(),
        deep_link_fallback: true,
        home_project_id: 0,
        task_details_rail_hidden: false,
        task_list_collapsed_project_ids: Vec::new(),
        task_list_collapsed_subproject_ids: Vec::new(),
        task_list_collapsed_todo_ids: Vec::new(),
        task_list_width: 300,
        task_detail_description_width: 420,
        markdown_editor_mode: "rich".to_string(),
        markdown_editor_font_family: DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY.to_string(),
        markdown_editor_font_size: "12px".to_string(),
        markdown_editor_max_image_height: "none".to_string(),
        markdown_toc_hidden: false,
        markdown_description_toc_width: 180,
        markdown_artifact_toc_width: 180,
        project_accent_border_width: 4,
        slowdown_profiler_enabled: true,
        terminal_tmux_enabled: false,
        external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
            .to_string(),
    };

    let error =
        build_execution_process_command(&settings, "editor", "/tmp/tmatrix", Some("Work"), None)
            .unwrap_err();
    assert_eq!(error, "unknown execution terminal kind: editor");
}

#[test]
fn folder_open_process_command_builds_vscode_remote_argv() {
    let process = build_folder_open_process_command(
        "code",
        "/Users/markcl/p/local",
        Some("devbox"),
        Some("/home/markcl/p/remote path"),
    )
    .unwrap();

    assert_eq!(process.program, "code");
    assert_eq!(
        process.args,
        vec![
            "--remote",
            "ssh-remote+devbox",
            "/home/markcl/p/remote path",
        ],
    );
    assert_eq!(process.cwd, "/Users/markcl/p/local");
}

#[test]
fn agent_process_commands_are_built_as_argv_not_shell_strings() {
    let settings = AppSettingsSummary {
        app_context_markdown: "".to_string(),
        folder_open_app: "code".to_string(),
        mcp_enabled: true,
        mcp_port: 8787,
        mcp_token: "token".to_string(),
        theme: "light".to_string(),
        claude_path: "claude".to_string(),
        codex_path: "codex".to_string(),
        task_titler: "codex-spark".to_string(),
        deep_link_fallback: true,
        home_project_id: 0,
        task_details_rail_hidden: false,
        task_list_collapsed_project_ids: Vec::new(),
        task_list_collapsed_subproject_ids: Vec::new(),
        task_list_collapsed_todo_ids: Vec::new(),
        task_list_width: 300,
        task_detail_description_width: 420,
        markdown_editor_mode: "rich".to_string(),
        markdown_editor_font_family: DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY.to_string(),
        markdown_editor_font_size: "12px".to_string(),
        markdown_editor_max_image_height: "none".to_string(),
        markdown_toc_hidden: false,
        markdown_description_toc_width: 180,
        markdown_artifact_toc_width: 180,
        project_accent_border_width: 4,
        slowdown_profiler_enabled: true,
        terminal_tmux_enabled: false,
        external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
            .to_string(),
    };

    let claude = build_agent_process_command(
        &settings,
        "Claude",
        "/tmp/tmatrix",
        "boomerang-conversation",
        "Work on T-128",
    )
    .unwrap();
    let codex = build_agent_process_command(
        &settings,
        "Codex",
        "/tmp/tmatrix",
        "boomerang-conversation",
        "Work on T-128",
    )
    .unwrap();

    assert_eq!(claude.program, "claude");
    assert_eq!(&claude.args[..1], ["--dangerously-skip-permissions"]);
    assert_eq!(claude.args.len(), 2);
    assert!(!claude.args.iter().any(|arg| arg == "--session-id"));
    assert!(claude.args[1].contains("Work on T-128"));
    assert!(claude.args[1].contains("Boomerang conversation ID: boomerang-conversation"));
    assert!(!claude.args[1].contains("Provider session ID:"));
    assert_eq!(codex.program, "codex");
    assert_eq!(&codex.args[..3], ["--yolo", "--cd", "/tmp/tmatrix",],);
    assert!(codex.args[3].contains("Work on T-128"));
    assert!(codex.args[3].contains("Boomerang conversation ID: boomerang-conversation"));
    assert_eq!(codex.cwd, "/tmp/tmatrix");
}

#[test]
fn agent_process_prompts_include_boomerang_conversation_context() {
    let settings = AppSettingsSummary {
        app_context_markdown: "".to_string(),
        folder_open_app: "code".to_string(),
        mcp_enabled: true,
        mcp_port: 8787,
        mcp_token: "token".to_string(),
        theme: "light".to_string(),
        claude_path: "claude".to_string(),
        codex_path: "codex".to_string(),
        task_titler: "codex-spark".to_string(),
        deep_link_fallback: true,
        home_project_id: 0,
        task_details_rail_hidden: false,
        task_list_collapsed_project_ids: Vec::new(),
        task_list_collapsed_subproject_ids: Vec::new(),
        task_list_collapsed_todo_ids: Vec::new(),
        task_list_width: 300,
        task_detail_description_width: 420,
        markdown_editor_mode: "rich".to_string(),
        markdown_editor_font_family: DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY.to_string(),
        markdown_editor_font_size: "12px".to_string(),
        markdown_editor_max_image_height: "none".to_string(),
        markdown_toc_hidden: false,
        markdown_description_toc_width: 180,
        markdown_artifact_toc_width: 180,
        project_accent_border_width: 4,
        slowdown_profiler_enabled: true,
        terminal_tmux_enabled: false,
        external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
            .to_string(),
    };

    let codex = build_agent_process_command(
        &settings,
        "Codex",
        "/tmp/tmatrix",
        "boomerang-conversation",
        "Work on T-128",
    )
    .unwrap();

    let prompt = codex.args.last().expect("prompt arg is present");
    assert!(prompt.contains("Work on T-128"));
    assert!(prompt.contains("Boomerang conversation ID: boomerang-conversation"));
}

#[test]
fn provider_execution_prompts_remain_unchanged() {
    assert_eq!(
        agent_prompt_for_execution("codex", "B-146", "Resume Support", "Task details"),
        "Task details",
    );
    assert_eq!(
        agent_prompt_for_execution("claude", "B-146", "Resume Support", "Task details"),
        "Task details",
    );
}

#[test]
fn stop_agent_session_command_helper_removes_session() {
    let db = AppDb::open_in_memory().expect("database opens");
    db.seed_demo_data_if_empty().expect("demo data seeds");
    let session_id = app_snapshot_from_db(&db, None, None).unwrap().sessions[0]
        .id
        .clone();

    let snapshot = stop_agent_session_in_db(
        &db,
        StopAgentSessionCommand {
            session_id: session_id.clone(),
        },
    )
    .unwrap();

    assert!(!snapshot
        .sessions
        .iter()
        .any(|session| session.id == session_id));
}

#[test]
fn app_settings_command_helpers_update_and_regenerate_token() {
    let db = AppDb::open_in_memory().expect("database opens");
    let initial = load_app_settings_from_db(&db).unwrap();
    assert!(!initial.task_details_rail_hidden);
    assert_eq!(initial.task_list_collapsed_project_ids, Vec::<i64>::new());
    assert_eq!(
        initial.task_list_collapsed_subproject_ids,
        Vec::<i64>::new()
    );
    assert_eq!(initial.task_list_collapsed_todo_ids, Vec::<i64>::new());
    assert_eq!(initial.project_accent_border_width, 4);
    assert!(initial.slowdown_profiler_enabled);
    assert!(!initial.terminal_tmux_enabled);
    assert_eq!(initial.app_context_markdown, "");
    assert_eq!(initial.folder_open_app, "code");
    assert_eq!(
        initial.markdown_editor_font_family,
        DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY
    );
    assert_eq!(initial.markdown_editor_font_size, "12px");
    assert_eq!(initial.markdown_editor_max_image_height, "none");

    let updated = update_app_settings_in_db(
        &db,
        UpdateAppSettingsCommand {
            mcp_enabled: true,
            theme: "system".to_string(),
            claude_path: "claude".to_string(),
            codex_path: "codex".to_string(),
            task_titler: "codex-spark".to_string(),
            deep_link_fallback: true,
            home_project_id: 7,
            project_accent_border_width: 6,
            slowdown_profiler_enabled: false,
            terminal_tmux_enabled: false,
            external_terminal_openers: "open -na Ghostty.app --args --command={tmuxCommand}"
                .to_string(),
            folder_open_app: "code".to_string(),
            app_context_markdown: "# App context".to_string(),
            markdown_editor_font_family: "Atkinson Hyperlegible, fantasy".to_string(),
            markdown_editor_font_size: "clamp(14px, 1.2vw, 20px)".to_string(),
            markdown_editor_max_image_height: "42vh".to_string(),
        },
    )
    .unwrap();
    assert!(updated.mcp_enabled);
    assert_eq!(updated.theme, "system");
    assert_eq!(updated.task_titler, "codex-spark");
    assert_eq!(updated.home_project_id, 7);
    assert_eq!(updated.project_accent_border_width, 6);
    assert!(!updated.task_details_rail_hidden);
    assert!(!updated.slowdown_profiler_enabled);
    assert!(!updated.terminal_tmux_enabled);
    assert_eq!(updated.folder_open_app, "code");
    assert_eq!(updated.app_context_markdown, "# App context");
    assert_eq!(
        updated.markdown_editor_font_family,
        "Atkinson Hyperlegible, fantasy"
    );
    assert_eq!(
        updated.markdown_editor_font_size,
        "clamp(14px, 1.2vw, 20px)"
    );
    assert_eq!(updated.markdown_editor_max_image_height, "42vh");

    let hidden =
        set_task_details_rail_hidden_in_db(&db, SetTaskDetailsRailHiddenCommand { hidden: true })
            .unwrap();
    assert!(hidden.task_details_rail_hidden);

    let accordion = set_task_list_accordion_state_in_db(
        &db,
        SetTaskListAccordionStateCommand {
            collapsed_project_ids: vec![3],
            collapsed_subproject_ids: vec![4],
            collapsed_todo_ids: vec![128, 129],
        },
    )
    .unwrap();
    assert_eq!(accordion.task_list_collapsed_project_ids, vec![3]);
    assert_eq!(accordion.task_list_collapsed_subproject_ids, vec![4]);
    assert_eq!(accordion.task_list_collapsed_todo_ids, vec![128, 129]);

    let resized = set_task_list_width_in_db(&db, SetTaskListWidthCommand { width: 420 }).unwrap();
    assert_eq!(resized.task_list_width, 420);

    let clamped = set_task_list_width_in_db(&db, SetTaskListWidthCommand { width: 9999 }).unwrap();
    assert_eq!(clamped.task_list_width, 520);

    let resized_description = set_task_detail_description_width_in_db(
        &db,
        SetTaskDetailDescriptionWidthCommand { width: 560 },
    )
    .unwrap();
    assert_eq!(resized_description.task_detail_description_width, 560);

    let clamped_description = set_task_detail_description_width_in_db(
        &db,
        SetTaskDetailDescriptionWidthCommand { width: 9999 },
    )
    .unwrap();
    assert_eq!(clamped_description.task_detail_description_width, 760);

    let raw_mode = set_markdown_editor_mode_in_db(
        &db,
        SetMarkdownEditorModeCommand {
            mode: "raw".to_string(),
        },
    )
    .unwrap();
    assert_eq!(raw_mode.markdown_editor_mode, "raw");

    let hidden_toc =
        set_markdown_toc_hidden_in_db(&db, SetMarkdownTocHiddenCommand { hidden: true }).unwrap();
    assert!(hidden_toc.markdown_toc_hidden);

    let description_toc = set_markdown_toc_width_in_db(
        &db,
        SetMarkdownTocWidthCommand {
            target: "description".to_string(),
            width: 208,
        },
    )
    .unwrap();
    assert_eq!(description_toc.markdown_description_toc_width, 208);
    assert_eq!(description_toc.markdown_artifact_toc_width, 180);

    let artifact_toc = set_markdown_toc_width_in_db(
        &db,
        SetMarkdownTocWidthCommand {
            target: "artifact".to_string(),
            width: 9999,
        },
    )
    .unwrap();
    assert_eq!(artifact_toc.markdown_description_toc_width, 208);
    assert_eq!(artifact_toc.markdown_artifact_toc_width, 360);

    let regenerated = regenerate_mcp_token_in_db(&db).unwrap();
    assert_ne!(hidden.mcp_token, regenerated.mcp_token);
    assert!(regenerated.task_details_rail_hidden);
    assert_eq!(regenerated.task_list_collapsed_project_ids, vec![3]);
    assert_eq!(regenerated.task_list_collapsed_subproject_ids, vec![4]);
    assert_eq!(regenerated.task_list_collapsed_todo_ids, vec![128, 129]);
    assert_eq!(regenerated.task_list_width, 520);
    assert_eq!(regenerated.task_detail_description_width, 760);
    assert_eq!(regenerated.markdown_editor_mode, "raw");
    assert!(regenerated.markdown_toc_hidden);
    assert_eq!(regenerated.markdown_description_toc_width, 208);
    assert_eq!(regenerated.markdown_artifact_toc_width, 360);
    assert!(!regenerated.slowdown_profiler_enabled);
}

#[test]
fn slowdown_profile_writer_rotates_current_log_and_replaces_previous_when_full() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let log_path = temp.path().join("slowdown-profile.jsonl");
    let previous_log_path = temp.path().join("slowdown-profile.previous.jsonl");

    append_slowdown_profile_jsonl_with_rotation(
        &log_path,
        &previous_log_path,
        &[
            json!({"kind": "render-storm", "seq": 1, "payload": "aaaaaaaaaaaaaaaaaaaaaaaa"}),
            json!({"kind": "render-storm", "seq": 2, "payload": "bbbbbbbbbbbbbbbbbbbbbbbb"}),
        ],
        180,
    )
    .unwrap();
    append_slowdown_profile_jsonl_with_rotation(
        &log_path,
        &previous_log_path,
        &[json!({"kind": "event-loop-lag", "seq": 3, "payload": "cccccccccccccccccccccccc"})],
        180,
    )
    .unwrap();

    let text = fs::read_to_string(&log_path).expect("current log can be read");
    let previous_text = fs::read_to_string(&previous_log_path).expect("previous log can be read");
    assert!(fs::metadata(&log_path).unwrap().len() <= 180);
    assert!(fs::metadata(&previous_log_path).unwrap().len() <= 180);
    assert!(text.contains("\"seq\":3"));
    assert!(!text.contains("\"seq\":1"));
    assert!(previous_text.contains("\"seq\":1"));
    assert!(previous_text.contains("\"seq\":2"));
    for line in text.lines().chain(previous_text.lines()) {
        serde_json::from_str::<serde_json::Value>(line).expect("line remains valid JSON");
    }
}
