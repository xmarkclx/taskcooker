use boomerang_tasks_lib::core::{AppDb, AppError, NewProject, Project, ProjectSettingsUpdate};

fn seed_named_project(db: &AppDb, name: &str, prefix: &str) -> Project {
    db.create_project(NewProject {
        name: name.to_string(),
        working_directory: format!("/tmp/{name}"),
        display_id_prefix: prefix.to_string(),
        actions_directory: "actions".to_string(),
        terminal_wsl_enabled: false,
        parent_project_id: None,
        inherit_parent: false,
    })
    .expect("create project")
}

fn seed_project(db: &AppDb) -> Project {
    db.create_project(NewProject {
        name: "Journal Project".to_string(),
        working_directory: "/tmp/journal-project".to_string(),
        display_id_prefix: "J".to_string(),
        actions_directory: "actions".to_string(),
        terminal_wsl_enabled: false,
        parent_project_id: None,
        inherit_parent: false,
    })
    .expect("create project")
}

fn settings_input(project: &Project) -> ProjectSettingsUpdate {
    ProjectSettingsUpdate {
        project_id: project.id,
        name: project.name.clone(),
        client: String::new(),
        working_directory: project.working_directory.clone(),
        display_id_prefix: project.display_id_prefix.clone(),
        actions_directory: project.actions_directory.clone(),
        project_folder_open_app: "cursor".to_string(),
        main_branch: "main".to_string(),
        terminal_wsl_enabled: false,
        ai_default_include_project_notes: false,
        ai_default_provider: None,
        inherit_parent: false,
    }
}

fn subproject_input(parent_id: i64, name: &str, prefix: &str) -> NewProject {
    NewProject {
        name: name.to_string(),
        working_directory: String::new(),
        display_id_prefix: prefix.to_string(),
        actions_directory: "actions".to_string(),
        terminal_wsl_enabled: false,
        parent_project_id: Some(parent_id),
        inherit_parent: true,
    }
}

// -------- link_project --------

#[test]
fn link_project_creates_link_edge() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = seed_named_project(&db, "Child", "C");
    db.link_project(parent.id, child.id).expect("link");
    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert_eq!(proj.subprojects.len(), 1);
    assert_eq!(proj.subprojects[0].child_project_id, child.id);
    assert_eq!(proj.subprojects[0].kind, "link");
}

#[test]
fn link_project_rejects_self_link() {
    let db = AppDb::open_in_memory().expect("db");
    let project = seed_project(&db);
    let err = db.link_project(project.id, project.id).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn link_project_rejects_missing_parent() {
    let db = AppDb::open_in_memory().expect("db");
    let child = seed_named_project(&db, "Child", "C");
    let err = db.link_project(9999, child.id).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn link_project_rejects_missing_child() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let err = db.link_project(parent.id, 9999).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn link_project_rejects_duplicate_edge() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = seed_named_project(&db, "Child", "C");
    db.link_project(parent.id, child.id).expect("first link");
    let err = db.link_project(parent.id, child.id).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn link_project_rejects_subproject_child() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");
    let other = seed_named_project(&db, "Other", "O");
    let err = db.link_project(other.id, child.id).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn link_project_rejects_cycle() {
    let db = AppDb::open_in_memory().expect("db");
    let a = seed_named_project(&db, "A", "A");
    let b = seed_named_project(&db, "B", "B");
    db.link_project(a.id, b.id).expect("a -> b");
    let err = db.link_project(b.id, a.id).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

// -------- create_project with parent + inherit --------

#[test]
fn create_project_with_parent_creates_subproject_edge() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");
    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert_eq!(proj.subprojects.len(), 1);
    assert_eq!(proj.subprojects[0].child_project_id, child.id);
    assert_eq!(proj.subprojects[0].kind, "subproject");
}

#[test]
fn create_project_rejects_inherit_without_parent() {
    let db = AppDb::open_in_memory().expect("db");
    let err = db
        .create_project(NewProject {
            name: "Orphan".to_string(),
            working_directory: String::new(),
            display_id_prefix: "O".to_string(),
            actions_directory: "actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: None,
            inherit_parent: true,
        })
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn create_project_rejects_missing_parent() {
    let db = AppDb::open_in_memory().expect("db");
    let err = db
        .create_project(NewProject {
            name: "Orphan".to_string(),
            working_directory: String::new(),
            display_id_prefix: "O".to_string(),
            actions_directory: "actions".to_string(),
            terminal_wsl_enabled: false,
            parent_project_id: Some(9999),
            inherit_parent: true,
        })
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

// -------- effective config resolution --------

#[test]
fn inheriting_subproject_resolves_parent_dir_and_notes() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    db.update_project_notes(parent.id, "# Parent notes")
        .expect("notes");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");

    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let child_proj = summary
        .projects
        .iter()
        .find(|p| p.id == child.id)
        .expect("child summary");
    assert_eq!(child_proj.working_directory, "/tmp/Parent");
    assert_eq!(child_proj.notes_markdown, "# Parent notes");
    assert!(child_proj.inherit_parent);
}

#[test]
fn inheriting_subproject_resolves_multilevel_chain() {
    let db = AppDb::open_in_memory().expect("db");
    let root = seed_named_project(&db, "Root", "R");
    db.update_project_notes(root.id, "# Root notes")
        .expect("notes");
    let middle = db
        .create_project(subproject_input(root.id, "Middle", "M"))
        .expect("create middle");
    let leaf = db
        .create_project(subproject_input(middle.id, "Leaf", "L"))
        .expect("create leaf");

    let summary = db.app_snapshot(None, None).expect("snapshot");
    let leaf_proj = summary
        .projects
        .iter()
        .find(|p| p.id == leaf.id)
        .expect("leaf summary");
    assert_eq!(leaf_proj.working_directory, "/tmp/Root");
    assert_eq!(leaf_proj.notes_markdown, "# Root notes");
}

#[test]
fn update_project_notes_routes_to_resolved_owner() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");

    db.update_project_notes(child.id, "# Edited via child")
        .expect("notes update");

    let summary = db.app_snapshot(None, None).expect("snapshot");
    let parent_proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert_eq!(parent_proj.notes_markdown, "# Edited via child");
}

// -------- unlink_project --------

#[test]
fn unlink_project_removes_edge() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = seed_named_project(&db, "Child", "C");
    db.link_project(parent.id, child.id).expect("link");
    db.unlink_project(parent.id, child.id).expect("unlink");
    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert!(proj.subprojects.is_empty());
}

#[test]
fn unlink_project_errors_when_absent() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = seed_named_project(&db, "Child", "C");
    let err = db.unlink_project(parent.id, child.id).unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

#[test]
fn unlink_inheriting_subproject_materializes_folder() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    db.update_project_notes(parent.id, "# Parent notes")
        .expect("notes");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");

    db.unlink_project(parent.id, child.id).expect("unlink");

    let summary = db.app_snapshot(None, None).expect("snapshot");
    let child_proj = summary
        .projects
        .iter()
        .find(|p| p.id == child.id)
        .expect("child summary");
    assert_eq!(child_proj.working_directory, "/tmp/Parent");
    assert!(!child_proj.inherit_parent);
    assert_eq!(child_proj.notes_markdown, "");
    let parent_proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert_eq!(parent_proj.notes_markdown, "# Parent notes");
}

// -------- update_project_status --------

#[test]
fn update_project_status_accepts_four_statuses() {
    let db = AppDb::open_in_memory().expect("db");
    let project = seed_project(&db);
    for status in ["Active", "Blocked", "Done", "Archived"] {
        db.update_project_status(project.id, status)
            .expect("valid status");
    }
    db.update_project_status(project.id, "done")
        .expect("lowercase status");
}

#[test]
fn update_project_status_rejects_invalid() {
    let db = AppDb::open_in_memory().expect("db");
    let project = seed_project(&db);
    let err = db.update_project_status(project.id, "Doing").unwrap_err();
    assert!(matches!(err, AppError::InvalidInput(_)));
}

// -------- edge deletion cascade --------

#[test]
fn deleting_project_cascades_edges_both_directions() {
    // project_links uses ON DELETE CASCADE on both FK columns. The app does not
    // expose project deletion, so exercise the cascade via a tempfile DB that a
    // second rusqlite::Connection (with foreign_keys=ON) can DELETE from.
    let temp = tempfile::tempdir().expect("temp dir");
    let db_path = temp.path().join("db.sqlite3");
    let db = AppDb::open_path(&db_path).expect("open db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");
    drop(db);

    let conn = rusqlite::Connection::open(&db_path).expect("open sqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable FKs");
    conn.execute("DELETE FROM projects WHERE id = ?1", [child.id])
        .expect("delete child");
    drop(conn);

    let db = AppDb::open_path(&db_path).expect("reopen db");
    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let parent_proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert!(parent_proj.subprojects.is_empty());
}
// -------- ProjectSummary fields --------

#[test]
fn project_summary_has_status_and_subprojects() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    db.update_project_status(parent.id, "Blocked")
        .expect("status");
    let child = seed_named_project(&db, "Child", "C");
    db.link_project(parent.id, child.id).expect("link");

    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    assert_eq!(proj.status, "Blocked");
    assert!(!proj.inherit_parent);
    assert_eq!(proj.subprojects.len(), 1);
    assert_eq!(proj.subprojects[0].child_project_id, child.id);
    assert_eq!(proj.subprojects[0].kind, "link");
}

#[test]
fn reorder_project_link_moves_child_within_parent_root() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let alpha = seed_named_project(&db, "Alpha", "A");
    let beta = seed_named_project(&db, "Beta", "B");
    let gamma = seed_named_project(&db, "Gamma", "G");
    db.link_project(parent.id, alpha.id).expect("link alpha");
    db.link_project(parent.id, beta.id).expect("link beta");
    db.link_project(parent.id, gamma.id).expect("link gamma");

    db.reorder_project_link(parent.id, gamma.id, 0)
        .expect("reorder project link");

    let summary = db.app_snapshot(Some(parent.id), None).expect("snapshot");
    let proj = summary
        .projects
        .iter()
        .find(|p| p.id == parent.id)
        .expect("parent summary");
    let ordered_ids = proj
        .subprojects
        .iter()
        .map(|edge| edge.child_project_id)
        .collect::<Vec<_>>();
    assert_eq!(ordered_ids, vec![gamma.id, alpha.id, beta.id]);
}

// -------- app_snapshot todo filter --------

#[test]
fn app_snapshot_includes_child_project_todos_in_selection() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    let child = seed_named_project(&db, "Child", "C");
    db.link_project(parent.id, child.id).expect("link");
    let _parent_todo = db
        .create_todo(parent.id, "Parent task")
        .expect("parent todo");
    let child_todo = db.create_todo(child.id, "Child task").expect("child todo");

    let snapshot = db
        .app_snapshot(Some(parent.id), Some(child_todo.id))
        .expect("snapshot");
    assert_eq!(snapshot.selected_project_id, parent.id);
    assert_eq!(snapshot.selected_todo_id, child_todo.id);
    assert!(snapshot.todos.iter().any(|t| t.id == child_todo.id));
    let child_in_snapshot = snapshot
        .todos
        .iter()
        .find(|t| t.id == child_todo.id)
        .expect("child todo in snapshot");
    assert_eq!(child_in_snapshot.project_id, child.id);
}

// -------- update_project_settings inherit transitions --------

#[test]
fn update_project_settings_turning_inherit_off_materializes_folder_and_blanks_notes() {
    let db = AppDb::open_in_memory().expect("db");
    let parent = seed_named_project(&db, "Parent", "P");
    db.update_project_notes(parent.id, "# Parent notes")
        .expect("notes");
    let child = db
        .create_project(subproject_input(parent.id, "Sub", "S"))
        .expect("create subproject");

    let mut input = settings_input(&child);
    input.working_directory = String::new();
    input.inherit_parent = false;
    db.update_project_settings(input).expect("turn inherit off");

    let summary = db.app_snapshot(None, None).expect("snapshot");
    let child_proj = summary
        .projects
        .iter()
        .find(|p| p.id == child.id)
        .expect("child summary");
    assert_eq!(child_proj.working_directory, "/tmp/Parent");
    assert!(!child_proj.inherit_parent);
    assert_eq!(child_proj.notes_markdown, "");
}

#[test]
fn update_project_settings_normal_save_preserves_notes() {
    let db = AppDb::open_in_memory().expect("db");
    let project = seed_project(&db);
    db.update_project_notes(project.id, "# My notes")
        .expect("notes");

    let mut input = settings_input(&project);
    input.name = "Renamed".to_string();
    db.update_project_settings(input).expect("normal save");

    let summary = db.app_snapshot(None, None).expect("snapshot");
    let proj = summary
        .projects
        .iter()
        .find(|p| p.id == project.id)
        .expect("summary");
    assert_eq!(proj.notes_markdown, "# My notes");
    assert_eq!(proj.name, "Renamed");
}
