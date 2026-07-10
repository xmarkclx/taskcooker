use boomerang_tasks_lib::core::{Actor, AppDb, NewProject};

fn new_db() -> AppDb {
    AppDb::open_in_memory().expect("in-memory database opens")
}

fn actor() -> Actor {
    Actor {
        actor_type: "human".to_string(),
        actor_name: "Mark".to_string(),
    }
}

fn project_fixture(db: &AppDb, name: &str, working_directory: &str, prefix: &str) -> i64 {
    db.create_project(NewProject {
        name: name.to_string(),
        working_directory: working_directory.to_string(),
        display_id_prefix: prefix.to_string(),
        actions_directory: ".boomerang/actions".to_string(),
        parent_project_id: None,
        inherit_parent: false,
    })
    .expect("project created")
    .id
}

#[test]
fn context_project_switches_todo_working_directory() {
    let db = new_db();
    let home_id = project_fixture(&db, "home", "/tmp/home-project", "H");
    let context_id = project_fixture(&db, "context", "/tmp/context-project", "C");
    let todo = db.create_todo(home_id, "Runs elsewhere").unwrap();

    assert_eq!(
        db.todo_working_directory(todo.id).unwrap(),
        "/tmp/home-project"
    );

    db.update_todo_context_project(todo.id, Some(context_id), actor())
        .unwrap();

    assert_eq!(
        db.todo_working_directory(todo.id).unwrap(),
        "/tmp/context-project"
    );
}

#[test]
fn subtasks_inherit_parent_context_by_default() {
    let db = new_db();
    let home_id = project_fixture(&db, "home", "/tmp/home-project", "H");
    let context_id = project_fixture(&db, "context", "/tmp/context-project", "C");
    let parent = db.create_todo(home_id, "Parent task").unwrap();
    let subtask = db.create_subtask(parent.id, "Child task").unwrap();
    let grandchild = db.create_subtask(subtask.id, "Grandchild task").unwrap();

    db.update_todo_context_project(parent.id, Some(context_id), actor())
        .unwrap();

    assert_eq!(
        db.todo_working_directory(subtask.id).unwrap(),
        "/tmp/context-project"
    );
    assert_eq!(
        db.todo_working_directory(grandchild.id).unwrap(),
        "/tmp/context-project"
    );

    // A subtask's own context wins over the inherited one.
    let other_id = project_fixture(&db, "other", "/tmp/other-project", "O");
    db.update_todo_context_project(subtask.id, Some(other_id), actor())
        .unwrap();
    assert_eq!(
        db.todo_working_directory(subtask.id).unwrap(),
        "/tmp/other-project"
    );
    assert_eq!(
        db.todo_working_directory(grandchild.id).unwrap(),
        "/tmp/other-project"
    );
}

#[test]
fn snapshot_exposes_own_and_inherited_context() {
    let db = new_db();
    let home_id = project_fixture(&db, "home", "/tmp/home-project", "H");
    let context_id = project_fixture(&db, "context", "/tmp/context-project", "C");
    let parent = db.create_todo(home_id, "Parent task").unwrap();
    let subtask = db.create_subtask(parent.id, "Child task").unwrap();

    db.update_todo_context_project(parent.id, Some(context_id), actor())
        .unwrap();

    let snapshot = db.app_snapshot(Some(home_id), Some(parent.id)).unwrap();
    let parent_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == parent.id)
        .unwrap();
    assert_eq!(parent_summary.context_project_id, Some(context_id));
    assert_eq!(
        parent_summary.effective_context_project_id,
        Some(context_id)
    );
    assert_eq!(
        parent_summary.active_working_directory,
        "/tmp/context-project"
    );

    let subtask_summary = snapshot
        .todos
        .iter()
        .find(|todo| todo.id == subtask.id)
        .unwrap();
    assert_eq!(subtask_summary.context_project_id, None);
    assert_eq!(
        subtask_summary.effective_context_project_id,
        Some(context_id)
    );
    assert_eq!(
        subtask_summary.active_working_directory,
        "/tmp/context-project"
    );
}

#[test]
fn context_project_change_appends_event_and_clears() {
    let db = new_db();
    let home_id = project_fixture(&db, "home", "/tmp/home-project", "H");
    let context_id = project_fixture(&db, "context", "/tmp/context-project", "C");
    let todo = db.create_todo(home_id, "Audited change").unwrap();

    db.update_todo_context_project(todo.id, Some(context_id), actor())
        .unwrap();

    let snapshot = db.app_snapshot(Some(home_id), Some(todo.id)).unwrap();
    let summary = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .unwrap();
    assert_eq!(summary.context_project_id, Some(context_id));

    let events = db.list_events(todo.id).unwrap();
    let event = events
        .iter()
        .find(|event| event.event_type == "context_project_changed")
        .expect("context change event appended");
    assert_eq!(event.after["context_project_id"], context_id);

    db.update_todo_context_project(todo.id, None, actor())
        .unwrap();
    assert_eq!(
        db.todo_working_directory(todo.id).unwrap(),
        "/tmp/home-project"
    );
}

#[test]
fn context_project_must_exist_and_own_project_clears() {
    let db = new_db();
    let home_id = project_fixture(&db, "home", "/tmp/home-project", "H");
    let todo = db.create_todo(home_id, "Validated").unwrap();

    let err = db
        .update_todo_context_project(todo.id, Some(9999), actor())
        .unwrap_err();
    assert!(err.to_string().contains("context project not found"));

    // Selecting the todo's own project stores no separate context.
    db.update_todo_context_project(todo.id, Some(home_id), actor())
        .unwrap();
    let snapshot = db.app_snapshot(Some(home_id), Some(todo.id)).unwrap();
    let summary = snapshot
        .todos
        .iter()
        .find(|item| item.id == todo.id)
        .unwrap();
    assert_eq!(summary.context_project_id, None);
    assert_eq!(summary.effective_context_project_id, None);
}
