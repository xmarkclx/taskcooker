use std::fs;
use std::path::PathBuf;
use std::process::Command;

use boomerang_tasks_lib::core::{
    expand_home_alias, Actor, AppDb, NewActionRun, NewAgentSession, NewProject,
    ProjectPromptSettingsUpdate, ProjectSettingsUpdate, TodoState, UpdateTodoStarred,
    UpdateTodoState,
};
use rusqlite::Connection;

const DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY: &str = "sans-serif";

fn new_db() -> AppDb {
    AppDb::open_in_memory().expect("in-memory database opens")
}

fn project_fixture(db: &AppDb) -> i64 {
    db.create_project(NewProject {
        name: "tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
        display_id_prefix: "T".to_string(),
        actions_directory: ".boomerang/actions".to_string(),
        terminal_wsl_enabled: false,
        parent_project_id: None,
        inherit_parent: false,
    })
    .expect("project created")
    .id
}

fn git_project_fixture(db: &AppDb) -> (tempfile::TempDir, i64) {
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
fn todo_display_ids_are_allocated_atomically_and_never_reused() {
    let db = new_db();
    let project_id = project_fixture(&db);

    let first = db
        .create_todo(project_id, "Set up SQLite migrations")
        .unwrap();
    let second = db
        .create_todo(project_id, "Wire app snapshot command")
        .unwrap();
    db.delete_todo(first.id).unwrap();
    let third = db
        .create_todo(project_id, "Create project actions shell")
        .unwrap();

    assert_eq!(first.display_id, "T-1");
    assert_eq!(second.display_id, "T-2");
    assert_eq!(third.display_id, "T-3");
}

#[test]
fn creating_a_todo_defaults_to_to_do_and_logs_the_created_state() {
    let db = new_db();
    let project_id = project_fixture(&db);

    let todo = db
        .create_todo(project_id, "Default to planned work")
        .unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(todo.state, TodoState::ToDo);
    assert_eq!(events[0].event_type, "created");
    assert_eq!(events[0].after["state"], "To Do");
}

#[test]
fn todo_provider_state_stores_latest_session_id_per_provider() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Try managed CLIs").unwrap();

    db.record_todo_provider_session_id(todo.id, "omp", "019efe10-60fc-7000-9f8e-6545a91a41ce")
        .unwrap();
    db.record_todo_provider_session_id(todo.id, "omp", "019efe26-d4bb-7000-8c7d-c7fbf726b9d2")
        .unwrap();
    db.record_todo_provider_session_id(todo.id, "codex", "019f016b-4fb4-79c1-9da5-f7bfb7a59092")
        .unwrap();
    db.record_todo_provider_session_id(todo.id, "claude", "3eabfd51-a2e3-4a01-ba30-27c72e19f3c5")
        .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains in snapshot");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(
        updated.omp_session_id.as_deref(),
        Some("019efe26-d4bb-7000-8c7d-c7fbf726b9d2"),
    );
    assert_eq!(
        updated.codex_session_id.as_deref(),
        Some("019f016b-4fb4-79c1-9da5-f7bfb7a59092"),
    );
    assert_eq!(
        updated.claude_session_id.as_deref(),
        Some("3eabfd51-a2e3-4a01-ba30-27c72e19f3c5"),
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event.event_type == "provider_session_saved")
            .count(),
        4,
    );
}

#[test]
fn generated_title_update_does_not_overwrite_a_manual_title_edit() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Fallback title").unwrap();

    assert!(db
        .update_todo_title_if_current(
            todo.id,
            "Fallback title",
            "Generated title",
            Actor::system("Boomerang"),
        )
        .unwrap());
    assert_eq!(db.get_todo(todo.id).unwrap().title, "Generated title");

    db.update_todo_title(todo.id, "Manual title", Actor::system("Test"))
        .unwrap();
    assert!(!db
        .update_todo_title_if_current(
            todo.id,
            "Fallback title",
            "Late generated title",
            Actor::system("Boomerang"),
        )
        .unwrap());
    assert_eq!(db.get_todo(todo.id).unwrap().title, "Manual title");
}

#[test]
fn opening_an_existing_database_migrates_legacy_inbox_todos_to_to_do() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db_path = temp.path().join("boomerang.sqlite3");
    {
        let db = AppDb::open_path(&db_path).expect("database opens");
        let project_id = project_fixture(&db);
        let todo = db.create_todo(project_id, "Legacy inbox task").unwrap();
        drop(db);

        let conn = Connection::open(&db_path).expect("raw database opens");
        conn.execute("UPDATE todos SET state = 'Inbox' WHERE id = ?1", [todo.id])
            .expect("legacy todo state written");
        conn.execute(
            "UPDATE events
                SET after_json = '{\"state\":\"Inbox\",\"title\":\"Legacy inbox task\"}'
              WHERE todo_id = ?1 AND event_type = 'created'",
            [todo.id],
        )
        .expect("legacy event state written");
    }

    let migrated = AppDb::open_path(&db_path).expect("database migrates");
    let snapshot = migrated.app_snapshot(None, None).unwrap();
    let todo = snapshot
        .todos
        .iter()
        .find(|item| item.title == "Legacy inbox task")
        .expect("legacy todo remains");
    let events = migrated.list_events(todo.id).unwrap();

    assert_eq!(todo.state, TodoState::ToDo);
    assert!(events.iter().all(|event| {
        event.before.get("state") != Some(&serde_json::json!("Inbox"))
            && event.after.get("state") != Some(&serde_json::json!("Inbox"))
    }));
}

#[test]
fn opening_an_existing_database_removes_legacy_opencode_storage() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db_path = temp.path().join("boomerang.sqlite3");
    {
        let conn = Connection::open(&db_path).expect("raw database opens");
        conn.execute_batch(
            "
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                client TEXT NOT NULL DEFAULT '',
                working_directory TEXT NOT NULL,
                display_id_prefix TEXT NOT NULL,
                actions_directory TEXT NOT NULL,
                opencode_directory TEXT NOT NULL DEFAULT '',
                project_folder_open_app TEXT NOT NULL DEFAULT 'cursor',
                main_branch TEXT NOT NULL DEFAULT 'main',
                background_image_path TEXT NOT NULL DEFAULT '',
                last_seq INTEGER NOT NULL DEFAULT 0,
                notes_markdown TEXT NOT NULL DEFAULT '',
                notes_updated_at TEXT,
                ai_default_include_project_notes INTEGER NOT NULL DEFAULT 0,
                ai_default_provider TEXT,
                ai_task_description_mode TEXT NOT NULL DEFAULT 'task',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE opencode_tabs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                todo_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                session_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )
        .expect("legacy schema written");
    }

    AppDb::open_path(&db_path).expect("database migrates");

    let conn = Connection::open(&db_path).expect("raw database reopens");
    let table_count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
               FROM sqlite_master
              WHERE type = 'table' AND name = 'opencode_tabs'",
            [],
            |row| row.get(0),
        )
        .expect("legacy table lookup succeeds");
    let mut stmt = conn
        .prepare("PRAGMA table_info(projects)")
        .expect("project columns load");
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .expect("project columns map")
        .collect::<Result<Vec<_>, _>>()
        .expect("project columns collect");

    assert_eq!(table_count, 0);
    assert!(!columns.iter().any(|column| column == "opencode_directory"));
}

#[test]
fn creating_a_todo_rejects_blank_titles() {
    let db = new_db();
    let project_id = project_fixture(&db);

    let err = db.create_todo(project_id, "   ").unwrap_err();

    assert!(err.to_string().contains("title is required"));
}

#[test]
fn todo_mutations_append_events_in_the_same_write_path() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Wire up MCP server").unwrap();

    db.update_todo_state(UpdateTodoState {
        todo_id: todo.id,
        state: TodoState::ReadyToTest,
        actor: Actor::system("test"),
        message: Some("ready for verification".to_string()),
        conversation_id: Some("codex-abc".to_string()),
        link: Some("codex://threads/codex-abc".to_string()),
    })
    .unwrap();

    let updated = db.get_todo(todo.id).unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(updated.state, TodoState::ReadyToTest);
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].event_type, "created");
    assert_eq!(events[1].event_type, "state_changed");
    assert_eq!(events[1].before["state"], "To Do");
    assert_eq!(events[1].after["state"], "Ready to Test");
    assert_eq!(events[1].message.as_deref(), Some("ready for verification"));
}

#[test]
fn todo_star_toggle_persists_and_logs_the_change() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Pin the important task")
        .unwrap();

    db.update_todo_starred(UpdateTodoStarred {
        todo_id: todo.id,
        starred: true,
        actor: Actor::system("test"),
    })
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains in snapshot");
    let events = db.list_events(todo.id).unwrap();

    assert!(updated.starred);
    assert_eq!(events.last().unwrap().event_type, "starred_changed");
    assert_eq!(events.last().unwrap().before["starred"], false);
    assert_eq!(events.last().unwrap().after["starred"], true);
}

#[test]
fn projects_default_to_main_as_the_worktree_merge_branch() {
    let db = new_db();
    let project_id = project_fixture(&db);

    let snapshot = db.app_snapshot(Some(project_id), None).unwrap();

    assert_eq!(snapshot.projects[0].main_branch, "main");
}

#[test]
fn todo_worktree_name_is_suggested_from_display_id() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Worktrees Support!!!").unwrap();

    let suggestion = db.suggest_todo_worktree_name(todo.id).unwrap();

    assert_eq!(suggestion, "T-1");
}

#[test]
fn todo_worktree_creation_is_one_way_and_updates_the_snapshot() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Worktrees Support").unwrap();

    let worktree = db.enable_todo_worktree(todo.id, "T-1").unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(worktree.name, "T-1");
    assert!(worktree.path.ends_with("T-1"));
    assert!(std::path::Path::new(&worktree.path).is_dir());
    assert_eq!(updated.worktree_name.as_deref(), Some("T-1"));
    assert_eq!(
        updated.worktree_path.as_deref(),
        Some(worktree.path.as_str())
    );
    assert_eq!(updated.active_working_directory, worktree.path);
    assert!(events.iter().any(
        |event| event.event_type == "worktree_created" && event.after["worktree_name"] == "T-1"
    ));

    let err = db
        .enable_todo_worktree(todo.id, "T-1-second-worktree")
        .unwrap_err();
    assert!(err.to_string().contains("todo already has a worktree"));
}

#[test]
fn todo_can_reuse_an_existing_worktree_from_the_same_project() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent work").unwrap();
    let child = db.create_todo(project_id, "Child work").unwrap();
    let parent_worktree = db.enable_todo_worktree(parent.id, "T-1").unwrap();

    let child_worktree = db.enable_todo_worktree(child.id, "T-1").unwrap();

    assert_eq!(child_worktree.path, parent_worktree.path);
    assert_eq!(
        db.todo_working_directory(child.id).unwrap(),
        parent_worktree.path
    );
}

#[test]
fn deleting_a_shared_todo_worktree_removes_it_from_every_referencing_task() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent work").unwrap();
    let child = db.create_todo(project_id, "Child work").unwrap();
    let worktree = db.enable_todo_worktree(parent.id, "T-1").unwrap();
    db.enable_todo_worktree(child.id, "T-1").unwrap();

    db.delete_todo_worktree(child.id).unwrap();

    assert!(!std::path::Path::new(&worktree.path).exists());
    assert_ne!(db.todo_working_directory(parent.id).unwrap(), worktree.path);
    assert_ne!(db.todo_working_directory(child.id).unwrap(), worktree.path);
}

#[test]
fn task_working_directory_falls_back_to_the_project_directory_until_worktree_exists() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Use task worktree").unwrap();
    let project = db.get_project(project_id).unwrap();

    let before = db.todo_working_directory(todo.id).unwrap();
    db.enable_todo_worktree(todo.id, "T-1-use-task-worktree")
        .unwrap();
    let after = db.todo_working_directory(todo.id).unwrap();

    assert_eq!(before, project.working_directory);
    assert!(after.ends_with("T-1-use-task-worktree"));
    assert_ne!(after, project.working_directory);
}

#[test]
fn selected_todo_project_actions_record_the_worktree_as_the_working_directory() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Run action from worktree")
        .unwrap();
    let worktree = db
        .enable_todo_worktree(todo.id, "T-1-run-action-from-worktree")
        .unwrap();

    let run = db
        .record_action_run(NewActionRun {
            project_id,
            todo_id: Some(todo.id),
            file_name: "boomerang:open-folder".to_string(),
            pty_id: None,
            command: None,
            state: "succeeded".to_string(),
            exit_code: Some(0),
        })
        .unwrap();

    assert_eq!(run.working_directory, worktree.path);
}

#[test]
fn todo_worktree_status_reports_dirty_files() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Check dirty worktree").unwrap();
    let worktree = db.enable_todo_worktree(todo.id, "T-1").unwrap();

    assert!(!db.todo_worktree_status(todo.id).unwrap().dirty);
    fs::write(
        std::path::Path::new(&worktree.path).join("dirty.txt"),
        "dirty\n",
    )
    .expect("dirty file written");

    assert!(db.todo_worktree_status(todo.id).unwrap().dirty);
}

#[test]
fn deleting_a_todo_worktree_removes_files_and_clears_task_worktree_fields() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Delete worktree").unwrap();
    let worktree = db.enable_todo_worktree(todo.id, "T-1").unwrap();
    fs::write(
        std::path::Path::new(&worktree.path).join("dirty.txt"),
        "dirty\n",
    )
    .expect("dirty file written");

    db.delete_todo_worktree(todo.id).unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .unwrap();
    let project = db.get_project(project_id).unwrap();

    assert!(!std::path::Path::new(&worktree.path).exists());
    assert_eq!(updated.worktree_name, None);
    assert_eq!(updated.worktree_path, None);
    assert_eq!(updated.active_working_directory, project.working_directory);
}

#[test]
fn deleting_an_already_removed_worktree_clears_stale_task_worktree_fields() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Delete stale worktree").unwrap();
    let worktree = db.enable_todo_worktree(todo.id, "T-1").unwrap();
    let project = db.get_project(project_id).unwrap();
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&project.working_directory)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(&worktree.path)
        .output()
        .expect("git worktree remove runs");
    assert!(output.status.success());

    db.delete_todo_worktree(todo.id).unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .unwrap();
    assert_eq!(updated.worktree_name, None);
    assert_eq!(updated.worktree_path, None);
    assert_eq!(updated.active_working_directory, project.working_directory);
}

#[test]
fn successful_worktree_merge_terminal_marks_the_todo_worktree_merged() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Merge worktree").unwrap();
    db.enable_todo_worktree(todo.id, "T-1").unwrap();
    db.record_execution_terminal(todo.id, 9001, "worktree_merge", "Commit & Merge")
        .unwrap();

    let before =
        serde_json::to_value(db.app_snapshot(Some(project_id), Some(todo.id)).unwrap()).unwrap();
    assert_eq!(
        before["todos"][0]["worktreeMergedAt"],
        serde_json::Value::Null
    );

    db.finish_execution_terminal_for_pty(9001, 0).unwrap();

    let after =
        serde_json::to_value(db.app_snapshot(Some(project_id), Some(todo.id)).unwrap()).unwrap();
    assert!(after["todos"][0]["worktreeMergedAt"].as_str().is_some());
}

#[test]
fn successful_shared_worktree_merge_marks_every_referencing_task_merged() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent work").unwrap();
    let child = db.create_todo(project_id, "Child work").unwrap();
    db.enable_todo_worktree(parent.id, "T-1").unwrap();
    db.enable_todo_worktree(child.id, "T-1").unwrap();
    db.record_execution_terminal(child.id, 9003, "worktree_merge", "Commit & Merge")
        .unwrap();

    db.finish_execution_terminal_for_pty(9003, 0).unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(child.id)).unwrap();
    assert!(snapshot
        .todos
        .iter()
        .filter(|todo| todo.id == parent.id || todo.id == child.id)
        .all(|todo| todo.worktree_merged_at.is_some()));
}

#[test]
fn failed_worktree_merge_terminal_leaves_the_todo_worktree_unmerged() {
    let db = new_db();
    let (_temp, project_id) = git_project_fixture(&db);
    let todo = db.create_todo(project_id, "Merge worktree").unwrap();
    db.enable_todo_worktree(todo.id, "T-1").unwrap();
    db.record_execution_terminal(todo.id, 9002, "worktree_merge", "Commit & Merge")
        .unwrap();

    db.finish_execution_terminal_for_pty(9002, 1).unwrap();

    let snapshot =
        serde_json::to_value(db.app_snapshot(Some(project_id), Some(todo.id)).unwrap()).unwrap();
    assert_eq!(
        snapshot["todos"][0]["worktreeMergedAt"],
        serde_json::Value::Null
    );
}

#[test]
fn todo_artifacts_are_stored_as_app_data_markdown_and_surfaced_in_snapshots() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Write handoff artifacts")
        .unwrap();

    db.update_todo_artifact(
        todo.id,
        "# Handoff\n\n- Chart: ~/charts/progress.png",
        Actor::system("test"),
    )
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains in snapshot");
    let artifact_path = expand_home_alias(&updated.artifact_markdown_path);
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(
        updated.artifact_markdown,
        "# Handoff\n\n- Chart: ~/charts/progress.png"
    );
    assert!(artifact_path.ends_with(
        PathBuf::from("artifacts")
            .join(format!("project-{project_id}"))
            .join(format!("{}.md", todo.display_id))
    ));
    assert_eq!(
        fs::read_to_string(artifact_path).unwrap(),
        "# Handoff\n\n- Chart: ~/charts/progress.png"
    );
    assert!(events
        .iter()
        .any(|event| event.event_type == "artifact_changed"
            && event.after["length"] == "# Handoff\n\n- Chart: ~/charts/progress.png".len()));
}

#[test]
fn todo_artifact_file_is_created_before_opening() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Open handoff artifacts")
        .unwrap();

    let artifact_path = db.ensure_todo_artifact_file(todo.id).unwrap();

    assert!(artifact_path.ends_with(format!(
        "artifacts/project-{project_id}/{}.md",
        todo.display_id
    )));
    assert_eq!(fs::read_to_string(&artifact_path).unwrap(), "");
}

#[test]
fn priority_updates_are_validated_and_logged() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Prioritize metadata").unwrap();

    db.update_todo_priority(todo.id, "Urgent", Actor::system("test"))
        .unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(updated.priority, "Urgent");
    assert!(events
        .iter()
        .any(|event| event.event_type == "priority_changed"
            && event.before["priority"] == "None"
            && event.after["priority"] == "Urgent"));

    let err = db
        .update_todo_priority(todo.id, "Critical", Actor::system("test"))
        .unwrap_err();
    assert!(err.to_string().contains("unknown todo priority"));
}

#[test]
fn backfills_position_contiguously_per_sibling_group() {
    let db = new_db();
    let project_id = project_fixture(&db);

    let a = db.create_todo(project_id, "A").unwrap();
    let b = db.create_todo(project_id, "B").unwrap();
    let c = db.create_todo(project_id, "C").unwrap();
    db.update_todo_priority(b.id, "Urgent", Actor::system("test"))
        .unwrap();
    db.update_todo_priority(c.id, "High", Actor::system("test"))
        .unwrap();

    db.debug_reset_positions().unwrap();
    db.debug_backfill_positions().unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(a.id)).unwrap();
    let pos = |id: i64| {
        snapshot
            .todos
            .iter()
            .find(|summary| summary.id == id)
            .unwrap()
            .position
    };

    assert_eq!(pos(b.id), 0);
    assert_eq!(pos(c.id), 1);
    assert_eq!(pos(a.id), 2);
}

#[test]
fn subtask_summaries_are_ordered_by_position() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent").unwrap();
    let a = db.create_subtask(parent.id, "A").unwrap();
    let b = db.create_subtask(parent.id, "B").unwrap();
    let c = db.create_subtask(parent.id, "C").unwrap();
    db.update_todo_priority(b.id, "Urgent", Actor::system("test"))
        .unwrap();
    db.update_todo_priority(c.id, "High", Actor::system("test"))
        .unwrap();

    db.debug_reset_positions().unwrap();
    db.debug_backfill_positions().unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(parent.id)).unwrap();
    let selected = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == parent.id)
        .expect("parent remains visible");

    assert_eq!(
        selected
            .subtasks
            .iter()
            .map(|subtask| subtask.id)
            .collect::<Vec<_>>(),
        vec![b.id, c.id, a.id]
    );
}

#[test]
fn linked_todo_mounts_under_target_parent_without_moving_source_tree() {
    let db = new_db();
    let source_project_id = project_fixture(&db);
    let target_project_id = db
        .create_project(NewProject {
            name: "Client".to_string(),
            working_directory: "/tmp/client".to_string(),
            display_id_prefix: "C".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("target project created")
        .id;
    let source = db
        .create_todo(source_project_id, "Shared implementation task")
        .unwrap();
    let source_child = db.create_subtask(source.id, "Real source subtask").unwrap();
    let target_parent = db
        .create_todo(target_project_id, "Client milestone")
        .unwrap();

    db.link_todo_under_parent(source.id, target_parent.id, None)
        .expect("todo linked");

    let source_after = db.get_todo(source.id).unwrap();
    let snapshot = db
        .app_snapshot(Some(target_project_id), Some(target_parent.id))
        .unwrap();
    let parent_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == target_parent.id)
        .expect("target parent remains visible");
    let linked_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == source.id)
        .expect("linked source appears in target project snapshot");

    assert_eq!(source_after.project_id, source_project_id);
    assert_eq!(source_after.parent_id, None);
    assert_eq!(parent_summary.linked_tasks[0].id, source.id);
    assert_eq!(parent_summary.linked_tasks[0].display_id, source.display_id);
    assert_eq!(linked_summary.subtasks[0].id, source_child.id);
    assert!(snapshot.todos.iter().any(|todo| todo.id == source_child.id));
}

#[test]
fn create_todo_inserts_at_position_and_shifts_siblings() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let a = db.create_todo(project_id, "A").unwrap();
    let b = db.create_todo(project_id, "B").unwrap();

    let c = db
        .create_todo_with_position(project_id, "C", "", None, Some(1))
        .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(c.id)).unwrap();
    let pos = |id: i64| {
        snapshot
            .todos
            .iter()
            .find(|summary| summary.id == id)
            .unwrap()
            .position
    };

    assert_eq!(pos(a.id), 0);
    assert_eq!(pos(c.id), 1);
    assert_eq!(pos(b.id), 2);
}

#[test]
fn reorder_moves_within_group_and_renumbers() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let a = db.create_todo(project_id, "A").unwrap();
    let b = db.create_todo(project_id, "B").unwrap();
    let c = db.create_todo(project_id, "C").unwrap();

    db.reorder_todo(c.id, None, 0).unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(c.id)).unwrap();
    let pos = |id: i64| {
        snapshot
            .todos
            .iter()
            .find(|summary| summary.id == id)
            .unwrap()
            .position
    };

    assert_eq!(pos(c.id), 0);
    assert_eq!(pos(a.id), 1);
    assert_eq!(pos(b.id), 2);
}

#[test]
fn reorder_moves_root_todo_to_another_project_with_its_subtree() {
    let db = new_db();
    let source_project_id = project_fixture(&db);
    let target_project_id = db
        .create_project(NewProject {
            name: "life".to_string(),
            working_directory: "/tmp/life".to_string(),
            display_id_prefix: "LIFE".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .unwrap()
        .id;
    let moving = db.create_todo(source_project_id, "Move me").unwrap();
    let child = db.create_subtask(moving.id, "Move child").unwrap();
    let existing = db
        .create_todo(target_project_id, "Existing target")
        .unwrap();

    db.reorder_todo_with_project(moving.id, Some(target_project_id), None, 1)
        .unwrap();

    let snapshot = db.app_snapshot(Some(0), Some(moving.id)).unwrap();
    let moved = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == moving.id)
        .unwrap();
    let moved_child = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == child.id)
        .unwrap();
    let target_existing = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == existing.id)
        .unwrap();

    assert_eq!(moved.project_id, target_project_id);
    assert_eq!(moved.parent_id, None);
    assert_eq!(moved.position, 1);
    assert_eq!(moved.display_id, "T-1");
    assert_eq!(moved_child.project_id, target_project_id);
    assert_eq!(moved_child.parent_id, Some(moving.id));
    assert_eq!(target_existing.position, 0);
}

#[test]
fn reorder_reparents_and_renumbers_both_groups() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent").unwrap();
    let a = db.create_todo(project_id, "A").unwrap();
    let b = db.create_todo(project_id, "B").unwrap();

    db.reorder_todo(a.id, Some(parent.id), 0).unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(a.id)).unwrap();
    let moved = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == a.id)
        .unwrap();
    let parent_row = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == parent.id)
        .unwrap();
    let b_row = snapshot
        .todos
        .iter()
        .find(|summary| summary.id == b.id)
        .unwrap();

    assert_eq!(moved.parent_id, Some(parent.id));
    assert_eq!(moved.position, 0);
    assert_eq!(parent_row.position, 0);
    assert_eq!(b_row.position, 1);
}

#[test]
fn reorder_rejects_descendant_parent() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent").unwrap();
    let child = db.create_todo(project_id, "Child").unwrap();
    db.reorder_todo(child.id, Some(parent.id), 0).unwrap();

    let err = db.reorder_todo(parent.id, Some(child.id), 0);

    assert!(err.is_err());
    assert_eq!(db.get_todo(parent.id).unwrap().parent_id, None);
}

#[test]
fn deadline_and_tag_updates_are_persisted_and_logged() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Edit metadata").unwrap();

    db.update_todo_deadline(todo.id, Some("2026-06-22T12:30:00Z"), Actor::system("test"))
        .unwrap();
    db.set_todo_tags(
        todo.id,
        vec!["Client".to_string(), "AI".to_string(), "Client".to_string()],
        Actor::system("test"),
    )
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(updated.deadline.as_deref(), Some("2026-06-22T12:30:00Z"));
    assert_eq!(updated.tags, vec!["AI", "Client"]);
    assert!(events
        .iter()
        .any(|event| event.event_type == "deadline_changed"));
    assert!(events
        .iter()
        .any(|event| event.event_type == "tag_added"
            && event.after["tag"] == serde_json::json!("AI")));
    assert!(events.iter().any(|event| event.event_type == "tag_added"
        && event.after["tag"] == serde_json::json!("Client")));
}

#[test]
fn tag_updates_log_additions_and_removals_individually() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Audit tag diffs").unwrap();

    db.set_todo_tags(
        todo.id,
        vec!["AI".to_string(), "Client".to_string()],
        Actor::system("test"),
    )
    .unwrap();
    db.set_todo_tags(
        todo.id,
        vec!["Backend".to_string(), "Client".to_string()],
        Actor::system("test"),
    )
    .unwrap();

    let events = db.list_events(todo.id).unwrap();

    assert!(events
        .iter()
        .any(|event| event.event_type == "tag_removed"
            && event.before["tag"] == serde_json::json!("AI")));
    assert!(events.iter().any(|event| event.event_type == "tag_added"
        && event.after["tag"] == serde_json::json!("Backend")));
}

#[test]
fn dependency_cycles_are_rejected_without_writing_edges_or_events() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let a = db.create_todo(project_id, "A").unwrap();
    let b = db.create_todo(project_id, "B").unwrap();
    let c = db.create_todo(project_id, "C").unwrap();

    db.add_dependency(a.id, b.id).unwrap();
    db.add_dependency(b.id, c.id).unwrap();

    let err = db.add_dependency(c.id, a.id).unwrap_err();

    assert!(err.to_string().contains("would create cycle"));
    assert!(err.to_string().contains("T-1"));
    assert!(err.to_string().contains("T-2"));
    assert!(err.to_string().contains("T-3"));
    assert_eq!(db.list_dependencies(c.id).unwrap().len(), 0);
}

#[test]
fn subtask_parent_cycles_are_rejected() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent").unwrap();
    let child = db.create_todo(project_id, "Child").unwrap();
    let grandchild = db.create_todo(project_id, "Grandchild").unwrap();

    db.set_parent(child.id, Some(parent.id)).unwrap();
    db.set_parent(grandchild.id, Some(child.id)).unwrap();

    let err = db.set_parent(parent.id, Some(grandchild.id)).unwrap_err();

    assert!(err.to_string().contains("would create parent cycle"));
    assert_eq!(db.get_todo(parent.id).unwrap().parent_id, None);
}

#[test]
fn dependency_and_subtask_mutations_are_visible_in_the_snapshot() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let parent = db.create_todo(project_id, "Parent").unwrap();
    let dependency = db.create_todo(project_id, "Dependency").unwrap();

    db.add_dependency(parent.id, dependency.id).unwrap();
    let child = db.create_subtask(parent.id, "Child task").unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(parent.id)).unwrap();
    let selected = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == parent.id)
        .expect("parent remains visible");

    assert_eq!(child.parent_id, Some(parent.id));
    assert_eq!(selected.dependencies.len(), 1);
    assert_eq!(selected.dependencies[0].id, dependency.id);
    assert_eq!(selected.subtasks.len(), 1);
    assert_eq!(selected.subtasks[0].id, child.id);

    db.remove_dependency(parent.id, dependency.id).unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(parent.id)).unwrap();
    let selected = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == parent.id)
        .expect("parent remains visible");

    assert!(selected.dependencies.is_empty());
    assert!(db
        .list_events(parent.id)
        .unwrap()
        .iter()
        .any(|event| event.event_type == "dependency_removed"));
}

#[test]
fn manual_time_logs_are_editable_and_logged() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Track manual work").unwrap();

    let log = db.add_manual_time_log(todo.id, 15 * 60).unwrap();
    let updated = db.update_time_log_duration(log.id, 20 * 60).unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let selected = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");

    assert_eq!(updated.duration_seconds, 20 * 60);
    assert_eq!(selected.own_time_seconds, 20 * 60);
    assert_eq!(selected.time_logs.len(), 1);
    assert_eq!(selected.time_logs[0].duration_seconds, 20 * 60);

    db.delete_time_log(log.id).unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let selected = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(selected.own_time_seconds, 0);
    assert!(selected.time_logs.is_empty());
    assert!(events
        .iter()
        .any(|event| event.event_type == "time_log_added"));
    assert!(events
        .iter()
        .any(|event| event.event_type == "time_log_updated"));
    assert!(events
        .iter()
        .any(|event| event.event_type == "time_log_deleted"));
}

#[test]
fn starting_a_timer_stops_the_previous_running_timer_globally() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let first = db.create_todo(project_id, "First").unwrap();
    let second = db.create_todo(project_id, "Second").unwrap();

    let first_log = db.start_timer(first.id).unwrap();
    let second_log = db.start_timer(second.id).unwrap();

    let first_after = db.get_time_log(first_log.id).unwrap();
    let second_after = db.get_time_log(second_log.id).unwrap();

    assert_eq!(first_after.todo_id, first.id);
    assert!(first_after.ended_at.is_some());
    assert!(first_after.duration_seconds >= 0);
    assert_eq!(second_after.todo_id, second.id);
    assert!(second_after.ended_at.is_none());
    assert_eq!(db.running_timer().unwrap().unwrap().todo_id, second.id);
}

#[test]
fn stopping_a_running_timer_closes_the_log_and_records_an_event() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Track implementation").unwrap();

    db.start_timer(todo.id).unwrap();
    let stopped = db
        .stop_running_timer()
        .unwrap()
        .expect("running timer was stopped");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(stopped.todo_id, todo.id);
    assert!(stopped.ended_at.is_some());
    assert!(stopped.duration_seconds >= 0);
    assert!(db.running_timer().unwrap().is_none());
    assert!(events
        .iter()
        .any(|event| event.event_type == "timer_stopped"));
}

#[test]
fn seeded_database_builds_the_app_snapshot_contract() {
    let db = new_db();
    db.seed_demo_data_if_empty().unwrap();

    let snapshot = db.app_snapshot(None, None).unwrap();
    let selected = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == snapshot.selected_todo_id)
        .expect("selected todo exists");

    assert_eq!(snapshot.projects[0].name, "tmatrix");
    assert_eq!(selected.display_id, "T-128");
    assert_eq!(selected.title, "Wire up MCP server");
    assert_eq!(selected.state, TodoState::ReadyToTest);
    assert_eq!(selected.priority, "High");
    assert_eq!(selected.tags, vec!["AI", "Backend"]);
    assert_eq!(
        selected
            .dependency
            .as_ref()
            .map(|item| item.display_id.as_str()),
        Some("T-104")
    );
    assert_eq!(selected.subtasks.len(), 3);
    assert_eq!(
        snapshot
            .running_timer
            .as_ref()
            .map(|timer| timer.display_id.as_str()),
        Some("T-128")
    );
    assert_eq!(snapshot.sessions[0].provider, "Claude");
    assert!(snapshot
        .messages
        .iter()
        .any(|message| message.body.contains("token rotate")));
}

#[test]
fn app_snapshot_includes_archived_todos_for_the_archived_filter() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let active = db.create_todo(project_id, "Visible task").unwrap();
    let archived = db.create_todo(project_id, "Archived reference").unwrap();
    db.update_todo_state(UpdateTodoState {
        todo_id: archived.id,
        state: TodoState::Archived,
        actor: Actor::system("test"),
        message: None,
        conversation_id: None,
        link: None,
    })
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(active.id)).unwrap();

    assert!(snapshot
        .todos
        .iter()
        .any(|todo| todo.id == archived.id && todo.state == TodoState::Archived));
    assert_eq!(snapshot.selected_todo_id, active.id);
}

#[test]
fn app_snapshot_can_select_all_projects() {
    let db = new_db();
    let first_project_id = project_fixture(&db);
    let first = db
        .create_todo(first_project_id, "First project task")
        .unwrap();
    let second_project_id = db
        .create_project(NewProject {
            name: "life".to_string(),
            working_directory: "/tmp/life".to_string(),
            display_id_prefix: "LIFE".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .unwrap()
        .id;
    let second = db
        .create_todo(second_project_id, "Second project task")
        .unwrap();

    let snapshot = db.app_snapshot(Some(0), Some(second.id)).unwrap();

    assert_eq!(snapshot.selected_project_id, 0);
    assert_eq!(snapshot.selected_todo_id, second.id);
    assert!(snapshot.todos.iter().any(|todo| todo.id == first.id));
    assert!(snapshot.todos.iter().any(|todo| todo.id == second.id));
}

#[test]
fn project_summaries_sort_recently_used_projects_first() {
    let db = new_db();
    let first_project_id = project_fixture(&db);
    let second_project_id = db
        .create_project(NewProject {
            name: "life".to_string(),
            working_directory: "/tmp/life".to_string(),
            display_id_prefix: "LIFE".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .unwrap()
        .id;

    db.record_project_use(first_project_id).unwrap();
    let snapshot = db.app_snapshot(None, None).unwrap();
    assert_eq!(snapshot.projects[0].id, first_project_id);

    db.record_project_use(second_project_id).unwrap();
    let snapshot = db.app_snapshot(None, None).unwrap();
    assert_eq!(snapshot.projects[0].id, second_project_id);
}

#[test]
fn app_snapshot_hydrates_events_for_the_selected_todo_only() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let selected = db.create_todo(project_id, "Selected task").unwrap();
    let unselected = db.create_todo(project_id, "Unselected task").unwrap();

    db.message_todo(
        selected.id,
        Actor::system("test"),
        "selected event",
        None,
        None,
    )
    .unwrap();
    db.message_todo(
        unselected.id,
        Actor::system("test"),
        "unselected event",
        None,
        None,
    )
    .unwrap();

    let snapshot = db
        .app_snapshot(Some(project_id), Some(selected.id))
        .unwrap();
    let selected_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected.id)
        .unwrap();
    let unselected_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == unselected.id)
        .unwrap();

    assert!(selected_summary
        .events
        .iter()
        .any(|event| event.message.as_deref() == Some("selected event")));
    assert!(unselected_summary.events.is_empty());
    assert!(snapshot
        .messages
        .iter()
        .any(|message| message.body == "unselected event"));
}

#[test]
fn state_writes_are_visible_in_the_snapshot_and_message_thread() {
    let db = new_db();
    db.seed_demo_data_if_empty().unwrap();
    let selected_id = db.app_snapshot(None, None).unwrap().selected_todo_id;

    db.update_todo_state(UpdateTodoState {
        todo_id: selected_id,
        state: TodoState::Done,
        actor: Actor {
            actor_type: "human".to_string(),
            actor_name: "Mark".to_string(),
        },
        message: Some("Accepted as done.".to_string()),
        conversation_id: Some("local-review".to_string()),
        link: None,
    })
    .unwrap();

    let snapshot = db.app_snapshot(None, Some(selected_id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == selected_id)
        .expect("updated todo is present");

    assert_eq!(updated.state, TodoState::Done);
    assert!(snapshot
        .messages
        .iter()
        .any(|message| message.actor_name == "Mark" && message.body == "Accepted as done."));
    assert!(updated
        .events
        .iter()
        .any(|event| event.event_type == "marked_done"
            && event.before["state"] == "Ready to Test"
            && event.after["state"] == "Done"));
}

#[test]
fn message_todo_appends_a_thread_message_event() {
    let db = new_db();
    db.seed_demo_data_if_empty().unwrap();
    let selected_id = db.app_snapshot(None, None).unwrap().selected_todo_id;

    db.message_todo(
        selected_id,
        Actor {
            actor_type: "human".to_string(),
            actor_name: "Mark".to_string(),
        },
        "Please retry with a stable token.",
        Some("codex-demo"),
        None,
    )
    .unwrap();

    let snapshot = db.app_snapshot(None, Some(selected_id)).unwrap();
    assert!(snapshot.messages.iter().any(|message| {
        message.actor_name == "Mark" && message.body == "Please retry with a stable token."
    }));
}

#[test]
fn message_todo_with_state_records_both_message_and_state_events() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Receive external status")
        .unwrap();

    db.message_todo_with_state(
        todo.id,
        Actor {
            actor_type: "external".to_string(),
            actor_name: "Codex".to_string(),
        },
        "Ready for review.",
        Some(TodoState::ReadyToTest),
        Some("codex-thread"),
        Some("codex://threads/codex-thread"),
    )
    .unwrap();

    let updated = db.get_todo(todo.id).unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(updated.state, TodoState::ReadyToTest);
    assert!(snapshot
        .messages
        .iter()
        .any(|message| message.actor_name == "Codex" && message.body == "Ready for review."));
    assert!(events
        .iter()
        .any(|event| event.event_type == "message_received"
            && event.message.as_deref() == Some("Ready for review.")));
    assert!(events
        .iter()
        .any(|event| event.event_type == "state_changed"
            && event.before["state"] == "To Do"
            && event.after["state"] == "Ready to Test"
            && event.message.as_deref() == Some("Ready for review.")));
}

#[test]
fn marking_todo_messages_read_clears_only_existing_external_unread_messages() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Read agent updates").unwrap();

    db.message_todo(
        todo.id,
        Actor {
            actor_type: "external".to_string(),
            actor_name: "Codex".to_string(),
        },
        "First update.",
        Some("codex-thread"),
        None,
    )
    .unwrap();

    let before = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    assert_eq!(
        before
            .messages
            .iter()
            .find(|message| message.body == "First update.")
            .and_then(|message| message.unread),
        Some(true)
    );

    db.mark_todo_messages_read(todo.id).unwrap();

    let after_read = db.todo_messages(todo.id).unwrap();
    assert_eq!(
        after_read
            .iter()
            .find(|message| message.body == "First update.")
            .and_then(|message| message.unread),
        Some(false)
    );

    db.message_todo(
        todo.id,
        Actor {
            actor_type: "external".to_string(),
            actor_name: "Codex".to_string(),
        },
        "Second update.",
        Some("codex-thread"),
        None,
    )
    .unwrap();

    let after_second = db.todo_messages(todo.id).unwrap();
    assert_eq!(
        after_second
            .iter()
            .find(|message| message.body == "First update.")
            .and_then(|message| message.unread),
        Some(false)
    );
    assert_eq!(
        after_second
            .iter()
            .find(|message| message.body == "Second update.")
            .and_then(|message| message.unread),
        Some(true)
    );
}

#[test]
fn managed_agent_sessions_record_pty_and_audit_event() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Hand task to a managed CLI")
        .unwrap();

    let session = db
        .create_agent_session(NewAgentSession {
            todo_id: todo.id,
            conversation_id: "boomerang-session-1".to_string(),
            provider: "Claude".to_string(),
            provider_session_id: Some("claude-session-1".to_string()),
            pty_id: 7,
            command: "claude --session-id boomerang-session-1".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
        })
        .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(session.conversation_id, "boomerang-session-1");
    assert_eq!(session.pty_id, Some(7));
    assert_eq!(
        session.provider_session_id.as_deref(),
        Some("claude-session-1")
    );
    assert_eq!(session.state, "running");
    assert!(snapshot
        .sessions
        .iter()
        .any(|item| item.id == session.id && item.pty_id == Some(7)));
    assert!(events.iter().any(|event| {
        event.event_type == "ai_session_spawned"
            && event.after["provider"] == "Claude"
            && event.after["conversation_id"] == "boomerang-session-1"
    }));
}

#[test]
fn managed_agent_sessions_can_be_stopped_by_the_user() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Stop managed CLI").unwrap();
    let session = db
        .create_agent_session(NewAgentSession {
            todo_id: todo.id,
            conversation_id: "boomerang-session-stop".to_string(),
            provider: "Claude".to_string(),
            provider_session_id: Some("boomerang-session-stop".to_string()),
            pty_id: 87,
            command: "claude --session-id boomerang-session-stop".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
        })
        .unwrap();

    let stopped_todo_id = db
        .stop_agent_session(
            &session.id,
            Actor {
                actor_type: "human".to_string(),
                actor_name: "Mark".to_string(),
            },
        )
        .unwrap();
    let events = db.list_events(todo.id).unwrap();
    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();

    assert_eq!(stopped_todo_id, todo.id);
    assert!(!snapshot.sessions.iter().any(|item| item.id == session.id));
    assert!(events.iter().any(|event| {
        event.event_type == "ai_session_stopped"
            && event.before["state"] == "running"
            && event.after["state"] == "stopped"
            && event.after["pty_id"] == 87
    }));
}

#[test]
fn managed_agent_sessions_finish_from_pty_exit_codes() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Track managed CLI lifecycle")
        .unwrap();
    db.create_agent_session(NewAgentSession {
        todo_id: todo.id,
        conversation_id: "boomerang-session-2".to_string(),
        provider: "Codex".to_string(),
        provider_session_id: Some("codex-session-2".to_string()),
        pty_id: 88,
        command: "codex --cd /tmp/tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();

    let finished = db.finish_agent_session_for_pty(88, 1).unwrap().unwrap();
    let ignored = db.finish_agent_session_for_pty(88, 0).unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(finished.state, "failed");
    assert_eq!(finished.last_activity, "session exited with code 1");
    assert_eq!(
        finished.provider_session_id.as_deref(),
        Some("codex-session-2")
    );
    assert_eq!(finished.pending_reply_count, 0);
    assert!(ignored.is_none());
    assert!(events.iter().any(|event| {
        event.event_type == "ai_session_exited"
            && event.after["provider"] == "Codex"
            && event.after["pty_id"] == 88
            && event.after["exit_code"] == 1
    }));
}

#[test]
fn opening_database_expires_process_owned_running_agent_sessions() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db_path = temp.path().join("boomerang.sqlite3");
    {
        let db = AppDb::open_path(&db_path).expect("database opens");
        let project_id = project_fixture(&db);
        let todo = db.create_todo(project_id, "Recover stale session").unwrap();
        db.create_agent_session(NewAgentSession {
            todo_id: todo.id,
            conversation_id: "boomerang-stale-session".to_string(),
            provider: "Codex".to_string(),
            provider_session_id: Some("codex-stale-session".to_string()),
            pty_id: 91,
            command: "codex --cd /tmp/tmatrix".to_string(),
            working_directory: "/tmp/tmatrix".to_string(),
        })
        .unwrap();
    }

    let reopened = AppDb::open_path(&db_path).expect("database reopens");
    let snapshot = reopened.app_snapshot(None, None).unwrap();
    let session = snapshot
        .sessions
        .iter()
        .find(|item| item.conversation_id == "boomerang-stale-session")
        .expect("stale session remains historical");

    assert_eq!(session.state, "exited");
    assert_eq!(
        session.last_activity,
        "session ended when TaskCooker closed"
    );
    assert!(!snapshot
        .execution_terminals
        .iter()
        .any(|terminal| terminal.pty_id == 91));
}

#[test]
fn pty_exit_finishes_every_running_agent_session_with_that_pty() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let first = db.create_todo(project_id, "First duplicate PTY").unwrap();
    let second = db.create_todo(project_id, "Second duplicate PTY").unwrap();
    db.create_agent_session(NewAgentSession {
        todo_id: first.id,
        conversation_id: "boomerang-duplicate-session-a".to_string(),
        provider: "Codex".to_string(),
        provider_session_id: Some("codex-duplicate-session-a".to_string()),
        pty_id: 92,
        command: "codex --cd /tmp/tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();
    db.create_agent_session(NewAgentSession {
        todo_id: second.id,
        conversation_id: "boomerang-duplicate-session-b".to_string(),
        provider: "Codex".to_string(),
        provider_session_id: Some("codex-duplicate-session-b".to_string()),
        pty_id: 92,
        command: "codex --cd /tmp/tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();

    db.finish_agent_session_for_pty(92, 0).unwrap().unwrap();
    let snapshot = db.app_snapshot(Some(project_id), None).unwrap();

    assert!(snapshot
        .sessions
        .iter()
        .filter(|session| session.pty_id == Some(92))
        .all(|session| session.state == "exited"));
}

#[test]
fn stopped_agent_sessions_report_pending_reply_count() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Resume with pending feedback")
        .unwrap();
    let provider_session_id = "550e8400-e29b-41d4-a716-446655440000";
    db.create_agent_session(NewAgentSession {
        todo_id: todo.id,
        conversation_id: "boomerang-session-3".to_string(),
        provider: "Claude".to_string(),
        provider_session_id: Some(provider_session_id.to_string()),
        pty_id: 89,
        command: "claude --dangerously-skip-permissions".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();
    db.finish_agent_session_for_pty(89, 0).unwrap().unwrap();
    db.message_todo(
        todo.id,
        Actor {
            actor_type: "human".to_string(),
            actor_name: "Mark".to_string(),
        },
        "Use the alternate fixture before retrying.",
        Some("boomerang-session-3"),
        None,
    )
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let session = snapshot
        .sessions
        .iter()
        .find(|item| item.conversation_id == "boomerang-session-3")
        .unwrap();

    assert_eq!(session.state, "exited");
    assert_eq!(session.pending_reply_count, 1);
}

#[test]
fn agent_session_summaries_do_not_expose_native_resume_affordances() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Stopped provider session")
        .unwrap();
    db.create_agent_session(NewAgentSession {
        todo_id: todo.id,
        conversation_id: "boomerang-session-no-resume".to_string(),
        provider: "Codex".to_string(),
        provider_session_id: Some("codex-native-session".to_string()),
        pty_id: 89,
        command: "codex --cd /tmp/tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();
    db.finish_agent_session_for_pty(89, 0).unwrap().unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let session = snapshot
        .sessions
        .iter()
        .find(|item| item.conversation_id == "boomerang-session-no-resume")
        .unwrap();
    let serialized = serde_json::to_value(session).unwrap();

    assert!(serialized.get("resumeAvailable").is_none());
}

#[test]
fn provider_session_ids_can_be_discovered_from_pty_output() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Discover provider session")
        .unwrap();
    db.create_agent_session(NewAgentSession {
        todo_id: todo.id,
        conversation_id: "boomerang-session-5".to_string(),
        provider: "Codex".to_string(),
        provider_session_id: None,
        pty_id: 92,
        command: "codex --cd /tmp/tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();

    let updated = db
        .record_agent_session_provider_session_from_pty(92, "codex-native-session")
        .unwrap()
        .unwrap();
    let ignored = db
        .record_agent_session_provider_session_from_pty(92, "other-session")
        .unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(
        updated.provider_session_id.as_deref(),
        Some("codex-native-session"),
    );
    assert!(ignored.is_none());
    assert!(events.iter().any(|event| {
        event.event_type == "ai_session_provider_discovered"
            && event.after["provider_session_id"] == "codex-native-session"
            && event.after["pty_id"] == 92
    }));
}

#[test]
fn provider_session_ids_can_be_reported_from_cli_messages() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Report provider session")
        .unwrap();
    db.create_agent_session(NewAgentSession {
        todo_id: todo.id,
        conversation_id: "boomerang-session-6".to_string(),
        provider: "Codex".to_string(),
        provider_session_id: None,
        pty_id: 93,
        command: "codex --cd /tmp/tmatrix".to_string(),
        working_directory: "/tmp/tmatrix".to_string(),
    })
    .unwrap();

    let updated = db
        .record_agent_session_provider_session_for_todo(todo.id, "codex-reported-session")
        .unwrap()
        .unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(
        updated.provider_session_id.as_deref(),
        Some("codex-reported-session"),
    );
    assert!(events.iter().any(|event| {
        event.event_type == "ai_session_provider_discovered"
            && event.after["provider_session_id"] == "codex-reported-session"
            && event.after["pty_id"] == 93
    }));
}

#[test]
fn description_updates_are_persisted_and_logged() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Document task context").unwrap();

    db.update_todo_description(
        todo.id,
        "# Context\n\nUse the stable token.",
        Actor {
            actor_type: "human".to_string(),
            actor_name: "Mark".to_string(),
        },
    )
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    let updated = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .expect("todo remains visible");
    let events = db.list_events(todo.id).unwrap();

    assert_eq!(
        updated.description_markdown,
        "# Context\n\nUse the stable token."
    );
    assert!(events
        .iter()
        .any(|event| event.event_type == "description_changed"));
}

#[test]
fn project_notes_updates_are_persisted_in_the_project_snapshot() {
    let db = new_db();
    let project_id = project_fixture(&db);

    db.update_project_notes(project_id, "# Runbook\n\nUse Homebrew MySQL 8.4.")
        .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), None).unwrap();
    let updated = snapshot
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .expect("project remains visible");

    assert_eq!(
        updated.notes_markdown,
        "# Runbook\n\nUse Homebrew MySQL 8.4."
    );
    assert_eq!(updated.actions_directory, ".boomerang/actions");
    assert_eq!(updated.display_id_prefix, "T");
}

#[test]
fn project_settings_updates_are_persisted_in_the_project_snapshot() {
    let db = new_db();
    let project_id = project_fixture(&db);

    db.update_project_settings(ProjectSettingsUpdate {
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
    })
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), None).unwrap();
    let updated = snapshot
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .expect("project remains visible");

    assert_eq!(updated.name, "tmatrix app");
    assert_eq!(updated.client, "Acme Studio");
    assert_eq!(updated.working_directory, "/Users/markcl/p/tmatrix");
    assert_eq!(updated.display_id_prefix, "TM");
    assert_eq!(updated.actions_directory, "actions");
    assert_eq!(updated.project_folder_open_app, "Finder");
    assert_eq!(updated.main_branch, "main");
    assert!(updated.terminal_wsl_enabled);
    assert!(!updated.ai_default_include_project_notes);
}

#[test]
fn project_background_image_path_is_persisted_in_the_project_snapshot() {
    let db = new_db();
    let project_id = project_fixture(&db);

    db.update_project_background_image(
        project_id,
        "/Users/markcl/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-1/background/header.png",
    )
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), None).unwrap();
    let updated = snapshot
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .expect("project remains visible");

    assert_eq!(
        updated.background_image_path,
        "/Users/markcl/Library/Application Support/com.marklopez.boomerangtasks/attachments/project-1/background/header.png"
    );
}

#[test]
fn project_prompt_settings_are_persisted_in_the_project_snapshot() {
    let db = new_db();
    let project_id = project_fixture(&db);

    db.update_project_prompt_settings(ProjectPromptSettingsUpdate {
        project_id,
        ai_task_description_mode: "ancestry".to_string(),
        ai_default_include_project_notes: true,
    })
    .unwrap();

    let snapshot = db.app_snapshot(Some(project_id), None).unwrap();
    let updated = snapshot
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .expect("project remains visible");

    assert_eq!(updated.ai_task_description_mode, "ancestry");
    assert!(updated.ai_default_include_project_notes);
}

#[test]
fn project_prompt_settings_reject_unknown_task_description_modes() {
    let db = new_db();
    let project_id = project_fixture(&db);

    let err = db
        .update_project_prompt_settings(ProjectPromptSettingsUpdate {
            project_id,
            ai_task_description_mode: "everything".to_string(),
            ai_default_include_project_notes: false,
        })
        .unwrap_err();

    assert!(err
        .to_string()
        .contains("unknown task description mode: everything"));
}

#[test]
fn project_actions_include_native_open_folder_and_script_metadata() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let actions_dir = temp.path().join(".boomerang/actions");
    fs::create_dir_all(&actions_dir).expect("actions dir created");
    fs::write(
        actions_dir.join("reinstall.sh"),
        "#!/usr/bin/env bash\n# title: Reinstall App\n# description: Run reinstall flow.\n# icon: RefreshCw\n# arg: target choice required \"Target\" choices=dev,prod\n",
    )
    .expect("action written");
    fs::write(actions_dir.join(".hidden.sh"), "# title: Hidden").expect("hidden written");

    let db = new_db();
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

    let actions = db.list_project_actions(project.id).unwrap();

    assert!(actions
        .iter()
        .any(|action| action.file_name == "boomerang:open-folder" && action.runtime == "native"));
    let reinstall = actions
        .iter()
        .find(|action| action.file_name == "reinstall.sh")
        .expect("script action discovered");
    assert_eq!(reinstall.title, "Reinstall App");
    assert_eq!(reinstall.description, "Run reinstall flow.");
    assert_eq!(reinstall.icon.as_deref(), Some("RefreshCw"));
    assert_eq!(reinstall.arguments[0].name, "target");
    assert_eq!(reinstall.arguments[0].kind, "choice");
    assert_eq!(reinstall.arguments[0].choices, vec!["dev", "prod"]);
    assert!(!actions
        .iter()
        .any(|action| action.file_name == ".hidden.sh"));
}

#[test]
fn project_actions_sort_recently_run_actions_first() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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
    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();

    db.record_action_run(NewActionRun {
        project_id: project.id,
        todo_id: None,
        file_name: "reinstall.sh".to_string(),
        pty_id: None,
        command: None,
        state: "succeeded".to_string(),
        exit_code: Some(0),
    })
    .unwrap();

    let actions = db.list_project_actions(project.id).unwrap();

    assert_eq!(actions[0].file_name, "reinstall.sh");
    assert_eq!(actions[1].file_name, "boomerang:open-folder");
}

#[test]
fn project_action_delete_removes_script_files_and_rejects_native_actions() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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
    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();
    let action_path = temp.path().join(".boomerang/actions/reinstall.sh");

    db.delete_project_action(project.id, "reinstall.sh")
        .unwrap();

    assert!(!action_path.exists());
    let actions = db.list_project_actions(project.id).unwrap();
    assert!(!actions
        .iter()
        .any(|action| action.file_name == "reinstall.sh"));

    let err = db
        .delete_project_action(project.id, "boomerang:open-folder")
        .unwrap_err();
    assert!(err
        .to_string()
        .contains("native project actions cannot be deleted"));
}

#[test]
fn project_action_creation_rejects_traversal_and_writes_single_files() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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

    let err = db
        .create_project_action(project.id, "../bad.sh", "shell", "Bad", "")
        .unwrap_err();
    assert!(err.to_string().contains("action file name cannot contain"));

    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();

    let action_path = temp.path().join(".boomerang/actions/reinstall.sh");
    let content = fs::read_to_string(action_path).expect("action exists");
    assert!(content.contains("# title: Reinstall App"));
    assert!(content.contains("# description: Run reinstall flow."));
}

#[test]
fn script_action_runs_record_running_pty_metadata() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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
    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();

    let run = db
        .record_action_run(NewActionRun {
            project_id: project.id,
            todo_id: None,
            file_name: "reinstall.sh".to_string(),
            pty_id: Some(11),
            command: Some("bash /tmp/reinstall.sh".to_string()),
            state: "running".to_string(),
            exit_code: None,
        })
        .unwrap();

    assert_eq!(run.action_file_name, "reinstall.sh");
    assert_eq!(run.runtime, "shell");
    assert_eq!(run.pty_id, Some(11));
    assert_eq!(run.command.as_deref(), Some("bash /tmp/reinstall.sh"));
    assert_eq!(run.state, "running");
    assert_eq!(run.exit_code, None);
}

#[test]
fn action_runs_with_todo_context_append_a_todo_event() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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
    let todo = db.create_todo(project.id, "Run helper").unwrap();
    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();

    let run = db
        .record_action_run(NewActionRun {
            project_id: project.id,
            todo_id: Some(todo.id),
            file_name: "reinstall.sh".to_string(),
            pty_id: Some(11),
            command: Some("bash /tmp/reinstall.sh".to_string()),
            state: "running".to_string(),
            exit_code: None,
        })
        .unwrap();
    let events = db.list_events(todo.id).unwrap();

    assert!(events.iter().any(|event| {
        event.event_type == "action_run_started"
            && event.after["action_run_id"] == serde_json::json!(run.id)
            && event.after["action_file_name"] == "reinstall.sh"
            && event.after["action_title"] == "Reinstall App"
    }));
}

#[test]
fn action_runs_with_todo_context_are_task_execution_terminals() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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
    let todo = db.create_todo(project.id, "Run helper").unwrap();
    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();

    db.record_action_run(NewActionRun {
        project_id: project.id,
        todo_id: Some(todo.id),
        file_name: "reinstall.sh".to_string(),
        pty_id: Some(11),
        command: Some("bash /tmp/reinstall.sh".to_string()),
        state: "running".to_string(),
        exit_code: None,
    })
    .unwrap();

    let snapshot = db.app_snapshot(None, Some(todo.id)).unwrap();
    let terminal = snapshot
        .execution_terminals
        .iter()
        .find(|terminal| terminal.pty_id == 11)
        .expect("action run pty is exposed as a task terminal");

    assert_eq!(terminal.todo_id, todo.id);
    assert_eq!(terminal.kind, "terminal");
    assert_eq!(terminal.label, "Action · Reinstall App");
    assert_eq!(terminal.state, "running");
}

#[test]
fn action_runs_reject_todo_context_from_another_project() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
    let project = db
        .create_project(NewProject {
            name: "tmatrix".to_string(),
            working_directory: temp.path().join("tmatrix").to_string_lossy().to_string(),
            display_id_prefix: "T".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("project created");
    let other_project = db
        .create_project(NewProject {
            name: "life".to_string(),
            working_directory: temp.path().join("life").to_string_lossy().to_string(),
            display_id_prefix: "LIFE".to_string(),
            actions_directory: ".boomerang/actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: false,
        })
        .expect("other project created");
    let other_todo = db
        .create_todo(other_project.id, "Buy replacement cable")
        .expect("todo created");
    db.create_project_action(
        project.id,
        "reinstall.sh",
        "shell",
        "Reinstall App",
        "Run reinstall flow.",
    )
    .unwrap();

    let err = db
        .record_action_run(NewActionRun {
            project_id: project.id,
            todo_id: Some(other_todo.id),
            file_name: "reinstall.sh".to_string(),
            pty_id: Some(11),
            command: Some("bash /tmp/reinstall.sh".to_string()),
            state: "running".to_string(),
            exit_code: None,
        })
        .unwrap_err();

    assert!(err
        .to_string()
        .contains("todo does not belong to action project"));
}

#[test]
fn action_runs_finish_from_pty_exit_codes() {
    let temp = tempfile::tempdir().expect("temp dir created");
    let db = new_db();
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
    db.create_project_action(
        project.id,
        "deploy.sh",
        "shell",
        "Deploy",
        "Run deploy flow.",
    )
    .unwrap();
    db.record_action_run(NewActionRun {
        project_id: project.id,
        todo_id: None,
        file_name: "deploy.sh".to_string(),
        pty_id: Some(77),
        command: Some("bash /tmp/deploy.sh".to_string()),
        state: "running".to_string(),
        exit_code: None,
    })
    .unwrap();

    let finished = db.finish_action_run_for_pty(77, 1).unwrap().unwrap();
    let ignored = db.finish_action_run_for_pty(77, 0).unwrap();

    assert_eq!(finished.state, "failed");
    assert_eq!(finished.exit_code, Some(1));
    assert!(finished.ended_at.is_some());
    assert!(ignored.is_none());
}

#[test]
fn execution_terminals_persist_per_task_until_closed() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db
        .create_todo(project_id, "Keep terminal tabs with the task")
        .unwrap();

    let terminal = db
        .record_execution_terminal(todo.id, 42, "terminal", "Terminal")
        .unwrap();
    assert_eq!(terminal.todo_id, todo.id);
    assert_eq!(terminal.pty_id, 42);
    assert_eq!(terminal.kind, "terminal");
    assert_eq!(terminal.state, "running");

    let hydrated = db.app_snapshot(Some(project_id), Some(todo.id)).unwrap();
    assert!(hydrated
        .execution_terminals
        .iter()
        .any(|item| item.todo_id == todo.id && item.pty_id == 42));

    let exited = db
        .finish_execution_terminal_for_pty(42, 0)
        .unwrap()
        .unwrap();
    assert_eq!(exited.state, "exited");
    assert_eq!(exited.exit_code, Some(0));
    assert_eq!(
        db.app_snapshot(Some(project_id), Some(todo.id))
            .unwrap()
            .execution_terminals
            .len(),
        1
    );

    let closed = db.close_execution_terminal_for_pty(42).unwrap().unwrap();
    assert_eq!(closed.pty_id, 42);
    assert!(db
        .app_snapshot(Some(project_id), Some(todo.id))
        .unwrap()
        .execution_terminals
        .is_empty());
}

#[test]
fn execution_terminal_labels_can_be_renamed() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let todo = db.create_todo(project_id, "Rename terminal tabs").unwrap();

    db.record_execution_terminal(todo.id, 42, "terminal", "Terminal")
        .unwrap();

    let renamed = db
        .rename_execution_terminal(42, "  Build watcher  ")
        .unwrap()
        .unwrap();

    assert_eq!(renamed.label, "Build watcher");
    assert_eq!(
        db.app_snapshot(Some(project_id), Some(todo.id))
            .unwrap()
            .execution_terminals
            .first()
            .unwrap()
            .label,
        "Build watcher"
    );

    let blank = db.rename_execution_terminal(42, "   ").unwrap_err();
    assert!(blank
        .to_string()
        .contains("execution terminal label is required"));
}

#[test]
fn app_settings_are_persisted_and_token_can_regenerate() {
    let db = new_db();

    let initial = db.app_settings().unwrap();
    assert!(initial.mcp_enabled);
    assert!(!initial.mcp_token.is_empty());
    assert!(!initial.task_details_rail_hidden);
    assert_eq!(initial.task_list_collapsed_project_ids, Vec::<i64>::new());
    assert_eq!(
        initial.task_list_collapsed_subproject_ids,
        Vec::<i64>::new()
    );
    assert_eq!(initial.task_list_collapsed_todo_ids, Vec::<i64>::new());
    assert_eq!(initial.task_list_width, 330);
    assert_eq!(initial.task_detail_description_width, 420);
    assert_eq!(initial.markdown_editor_mode, "rich");
    assert_eq!(
        initial.markdown_editor_font_family,
        DEFAULT_MARKDOWN_EDITOR_FONT_FAMILY
    );
    assert_eq!(initial.markdown_editor_font_size, "12px");
    assert_eq!(initial.markdown_editor_max_image_height, "none");
    assert!(!initial.markdown_toc_hidden);
    assert_eq!(initial.project_accent_border_width, 4);
    assert_eq!(initial.theme, "system");
    assert_eq!(initial.task_titler, "codex-spark");
    assert!(initial.slowdown_profiler_enabled);
    assert!(!initial.terminal_tmux_enabled);
    assert!(initial.external_terminal_openers.contains("Ghostty.app"));
    assert_eq!(initial.folder_open_app, "code");
    assert_eq!(initial.app_context_markdown, "");
    assert_eq!(initial.home_project_id, 0);

    db.update_app_settings(
        true,
        "system",
        "claude",
        "codex",
        "codex-spark",
        true,
        42,
        6,
        false,
        true,
        "open -na Ghostty.app --args --command={tmuxCommand}",
        "code-insiders",
        "# App context\n\nUse repo rules.",
        "Atkinson Hyperlegible, fantasy",
        "clamp(14px, 1.2vw, 20px)",
        "42vh",
    )
    .unwrap();
    let updated = db.app_settings().unwrap();
    assert!(updated.mcp_enabled);
    assert_eq!(updated.theme, "system");
    assert_eq!(updated.task_titler, "codex-spark");
    assert!(updated.deep_link_fallback);
    assert_eq!(updated.home_project_id, 42);
    assert_eq!(updated.project_accent_border_width, 6);
    assert_eq!(
        updated.markdown_editor_font_family,
        "Atkinson Hyperlegible, fantasy"
    );
    assert_eq!(
        updated.markdown_editor_font_size,
        "clamp(14px, 1.2vw, 20px)"
    );
    assert_eq!(updated.markdown_editor_max_image_height, "42vh");
    assert!(!updated.slowdown_profiler_enabled);
    assert!(updated.terminal_tmux_enabled);
    assert_eq!(updated.folder_open_app, "code-insiders");
    assert_eq!(
        updated.external_terminal_openers,
        "open -na Ghostty.app --args --command={tmuxCommand}"
    );
    assert_eq!(
        updated.app_context_markdown,
        "# App context\n\nUse repo rules."
    );
    assert!(!updated.task_details_rail_hidden);

    let hidden = db.set_task_details_rail_hidden(true).unwrap();
    assert!(hidden.task_details_rail_hidden);
    assert!(db.app_settings().unwrap().task_details_rail_hidden);

    let accordion = db
        .set_task_list_accordion_state(vec![3], vec![4], vec![128, 129])
        .unwrap();
    assert_eq!(accordion.task_list_collapsed_project_ids, vec![3]);
    assert_eq!(accordion.task_list_collapsed_subproject_ids, vec![4]);
    assert_eq!(accordion.task_list_collapsed_todo_ids, vec![128, 129]);
    assert_eq!(
        db.app_settings().unwrap().task_list_collapsed_todo_ids,
        vec![128, 129]
    );

    let narrow = db.set_task_list_width(180).unwrap();
    assert_eq!(narrow.task_list_width, 330);
    let resized = db.set_task_list_width(420).unwrap();
    assert_eq!(resized.task_list_width, 420);
    let narrow_description = db.set_task_detail_description_width(200).unwrap();
    assert_eq!(narrow_description.task_detail_description_width, 320);
    let resized_description = db.set_task_detail_description_width(560).unwrap();
    assert_eq!(resized_description.task_detail_description_width, 560);
    let wide_description = db.set_task_detail_description_width(9999).unwrap();
    assert_eq!(wide_description.task_detail_description_width, 760);

    let raw_mode = db.set_markdown_editor_mode("raw").unwrap();
    assert_eq!(raw_mode.markdown_editor_mode, "raw");
    assert_eq!(db.app_settings().unwrap().markdown_editor_mode, "raw");
    assert!(db.set_markdown_editor_mode("bogus").is_err());
    let hidden_toc = db.set_markdown_toc_hidden(true).unwrap();
    assert!(hidden_toc.markdown_toc_hidden);
    let description_toc = db.set_markdown_toc_width("description", 208).unwrap();
    assert_eq!(description_toc.markdown_description_toc_width, 208);
    assert_eq!(description_toc.markdown_artifact_toc_width, 180);
    let artifact_toc = db.set_markdown_toc_width("artifact", 9999).unwrap();
    assert_eq!(artifact_toc.markdown_description_toc_width, 208);
    assert_eq!(artifact_toc.markdown_artifact_toc_width, 360);
    assert!(db.set_markdown_toc_width("project-notes", 208).is_err());

    let regenerated = db.regenerate_mcp_token().unwrap();
    assert_ne!(hidden.mcp_token, regenerated.mcp_token);
    assert!(regenerated.task_details_rail_hidden);
    assert_eq!(regenerated.task_list_collapsed_project_ids, vec![3]);
    assert_eq!(regenerated.task_list_collapsed_subproject_ids, vec![4]);
    assert_eq!(regenerated.task_list_collapsed_todo_ids, vec![128, 129]);
    assert_eq!(regenerated.task_list_width, 420);
    assert_eq!(regenerated.task_detail_description_width, 760);
    assert_eq!(regenerated.markdown_editor_mode, "raw");
    assert!(regenerated.markdown_toc_hidden);
    assert_eq!(regenerated.markdown_description_toc_width, 208);
    assert_eq!(regenerated.markdown_artifact_toc_width, 360);
}

#[test]
fn todo_panel_visibility_is_persisted_per_task() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let first = db.create_todo(project_id, "First task").unwrap();
    let second = db.create_todo(project_id, "Second task").unwrap();

    let initial = db.app_snapshot(Some(project_id), Some(first.id)).unwrap();
    let first_summary = initial
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    let second_summary = initial
        .todos
        .iter()
        .find(|todo| todo.id == second.id)
        .unwrap();
    assert!(!first_summary.description_panel_hidden);
    assert!(!first_summary.execution_panel_hidden);
    assert!(!second_summary.description_panel_hidden);
    assert!(!second_summary.execution_panel_hidden);

    let snapshot = db.set_todo_panel_visibility(first.id, true, false).unwrap();
    let first_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    let second_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == second.id)
        .unwrap();
    assert!(first_summary.description_panel_hidden);
    assert!(!first_summary.execution_panel_hidden);
    assert!(!second_summary.description_panel_hidden);
    assert!(!second_summary.execution_panel_hidden);

    let reloaded = db.app_snapshot(Some(project_id), Some(first.id)).unwrap();
    let first_summary = reloaded
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    assert!(first_summary.description_panel_hidden);
    assert!(!first_summary.execution_panel_hidden);
}

#[test]
fn todo_toc_visibility_defaults_closed_and_is_persisted_per_task_and_surface() {
    let db = new_db();
    let project_id = project_fixture(&db);
    let first = db.create_todo(project_id, "First task").unwrap();
    let second = db.create_todo(project_id, "Second task").unwrap();

    let initial = db.app_snapshot(Some(project_id), Some(first.id)).unwrap();
    let first_summary = initial
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    let second_summary = initial
        .todos
        .iter()
        .find(|todo| todo.id == second.id)
        .unwrap();
    assert!(first_summary.description_toc_hidden);
    assert!(first_summary.artifact_toc_hidden);
    assert!(second_summary.description_toc_hidden);
    assert!(second_summary.artifact_toc_hidden);

    let snapshot = db.set_todo_toc_visibility(first.id, false, true).unwrap();
    let first_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    let second_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == second.id)
        .unwrap();
    assert!(!first_summary.description_toc_hidden);
    assert!(first_summary.artifact_toc_hidden);
    assert!(second_summary.description_toc_hidden);
    assert!(second_summary.artifact_toc_hidden);

    let snapshot = db.set_todo_toc_visibility(first.id, false, false).unwrap();
    let first_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    assert!(!first_summary.description_toc_hidden);
    assert!(!first_summary.artifact_toc_hidden);

    let reloaded = db.app_snapshot(Some(project_id), Some(first.id)).unwrap();
    let first_summary = reloaded
        .todos
        .iter()
        .find(|todo| todo.id == first.id)
        .unwrap();
    assert!(!first_summary.description_toc_hidden);
    assert!(!first_summary.artifact_toc_hidden);
}
