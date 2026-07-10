use boomerang_tasks_lib::app_windows::{
    build_image_window_route, build_project_task_window_route, build_task_window_route,
    is_local_asset_window_url, macos_window_menu_id, macos_window_menu_plan,
    project_task_window_spec, project_window_label_matches_project, task_window_label_matches_todo,
    task_window_spec, MacosWindowMenuEntry,
};

#[test]
fn local_asset_urls_are_allowed_for_native_image_new_window_requests() {
    assert!(is_local_asset_window_url(
        &tauri::Url::parse("asset://localhost/Users/mark/image.png").unwrap()
    ));
    assert!(is_local_asset_window_url(
        &tauri::Url::parse("http://asset.localhost/Users/mark/image.png").unwrap()
    ));
}

#[test]
fn non_asset_urls_are_denied_for_native_new_window_requests() {
    for url in [
        "file:///Users/mark/image.png",
        "https://example.com/image.png",
        "http://localhost:1420/",
        "tauri://localhost/",
    ] {
        assert!(!is_local_asset_window_url(&tauri::Url::parse(url).unwrap()));
    }
}

#[test]
fn local_asset_image_windows_open_the_boomerang_viewer_route() {
    let route = build_image_window_route(
        &tauri::Url::parse("asset://localhost/Users/mark/image.png").unwrap(),
    );

    assert_eq!(
        route,
        "/?imageWindow=1&imageSrc=asset%3A%2F%2Flocalhost%2FUsers%2Fmark%2Fimage.png"
    );
}

#[test]
fn task_windows_open_the_focused_task_route() {
    assert_eq!(
        build_task_window_route(2, 68),
        "/?projectId=2&todoId=68&taskWindow=1"
    );
}

#[test]
fn project_task_windows_open_the_project_route_with_focused_task() {
    assert_eq!(
        build_project_task_window_route(2, 68),
        "/?projectId=2&todoId=68"
    );
}

#[test]
fn project_task_window_specs_match_frontend_project_windows_with_selected_task() {
    let spec = project_task_window_spec(2, 68, "Boomerang Tasks", "test");

    assert_eq!(spec.project_id, 2);
    assert_eq!(spec.todo_id, 68);
    assert_eq!(spec.label, "project-2-test");
    assert_eq!(spec.route, "/?projectId=2&todoId=68");
    assert_eq!(spec.title, "Boomerang Tasks - TaskCooker");
    assert_eq!(spec.width, 1180.0);
    assert_eq!(spec.height, 760.0);
    assert_eq!(spec.min_width, 960.0);
    assert_eq!(spec.min_height, 640.0);
}

#[test]
fn task_window_specs_match_frontend_task_windows() {
    let spec = task_window_spec(68, 2, "B-48", "Double clicking on a notification", "test");

    assert_eq!(spec.label, "task-68-test");
    assert_eq!(spec.route, "/?projectId=2&todoId=68&taskWindow=1");
    assert_eq!(spec.title, "B-48 - Double clicking on a notification");
    assert_eq!(spec.width, 960.0);
    assert_eq!(spec.height, 720.0);
    assert_eq!(spec.min_width, 760.0);
    assert_eq!(spec.min_height, 560.0);
}

#[test]
fn task_window_labels_match_their_todo_id() {
    assert!(task_window_label_matches_todo("task-68-test", 68));
    assert!(task_window_label_matches_todo(
        "task-68-uuid-with-dashes",
        68
    ));
    assert!(!task_window_label_matches_todo("task-680-test", 68));
    assert!(!task_window_label_matches_todo("project-68-test", 68));
}

#[test]
fn project_window_labels_match_their_project_id() {
    assert!(project_window_label_matches_project("project-2-test", 2));
    assert!(project_window_label_matches_project(
        "project-2-uuid-with-dashes",
        2
    ));
    assert!(!project_window_label_matches_project("project-20-test", 2));
    assert!(!project_window_label_matches_project("task-2-test", 2));
}

#[test]
fn macos_window_menu_is_configured_for_native_window_switching() {
    assert_eq!(macos_window_menu_id(), tauri::menu::WINDOW_SUBMENU_ID);
    assert_eq!(
        macos_window_menu_plan(),
        &[
            MacosWindowMenuEntry::Minimize,
            MacosWindowMenuEntry::Maximize,
            MacosWindowMenuEntry::Separator,
            MacosWindowMenuEntry::ShowAllWindows,
            MacosWindowMenuEntry::BringAllToFront,
        ]
    );
}

#[test]
fn macos_menu_does_not_reserve_cmd_w_for_native_window_closing() {
    let app_windows_source = include_str!("../src/app_windows.rs");

    assert!(!app_windows_source.contains("PredefinedMenuItem::close_window"));
}
