use std::sync::atomic::{AtomicU64, Ordering};

use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::utils::config::Color;
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{App, AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};

static IMAGE_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);
static TASK_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

pub const CONNECT_REMOTE_MENU_ID: &str = "taskcooker-connect-remote";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacosWindowMenuEntry {
    Minimize,
    Maximize,
    Separator,
    ShowAllWindows,
    BringAllToFront,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskWindowSpec {
    pub todo_id: i64,
    pub label: String,
    pub route: String,
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectTaskWindowSpec {
    pub project_id: i64,
    pub todo_id: i64,
    pub label: String,
    pub route: String,
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

pub fn macos_window_menu_id() -> &'static str {
    WINDOW_SUBMENU_ID
}

pub fn macos_window_menu_plan() -> &'static [MacosWindowMenuEntry] {
    &[
        MacosWindowMenuEntry::Minimize,
        MacosWindowMenuEntry::Maximize,
        MacosWindowMenuEntry::Separator,
        MacosWindowMenuEntry::ShowAllWindows,
        MacosWindowMenuEntry::BringAllToFront,
    ]
}

pub fn create_app_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        create_macos_app_menu(app_handle)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Menu::default(app_handle)
    }
}

#[cfg(target_os = "macos")]
fn create_macos_app_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app_handle,
        pkg_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::services(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::hide(app_handle, None)?,
            &PredefinedMenuItem::hide_others(app_handle, None)?,
            &PredefinedMenuItem::show_all(app_handle, Some("Show All Windows"))?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::quit(app_handle, None)?,
        ],
    )?;
    let connect_remote = MenuItem::with_id(
        app_handle,
        CONNECT_REMOTE_MENU_ID,
        "Connect to...",
        true,
        None::<&str>,
    )?;
    let file_menu = Submenu::with_items(app_handle, "File", true, &[&connect_remote])?;
    let edit_menu = Submenu::with_items(
        app_handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app_handle, None)?,
            &PredefinedMenuItem::redo(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::cut(app_handle, None)?,
            &PredefinedMenuItem::copy(app_handle, None)?,
            &PredefinedMenuItem::paste(app_handle, None)?,
            &PredefinedMenuItem::select_all(app_handle, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app_handle,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
    )?;
    let window_menu = Submenu::with_id_and_items(
        app_handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::show_all(app_handle, Some("Show All Windows"))?,
            &PredefinedMenuItem::bring_all_to_front(app_handle, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(app_handle, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app_handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn create_main_window<R: Runtime>(app: &mut App<R>) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    if let Some(window_config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
    {
        let app_handle = app.handle().clone();
        WebviewWindowBuilder::from_config(app.handle(), window_config)?
            .on_new_window(move |url, features| open_local_asset_window(&app_handle, url, features))
            .build()?;
    }

    Ok(())
}

pub fn open_task_window<R: Runtime>(app: &AppHandle<R>, spec: TaskWindowSpec) -> tauri::Result<()> {
    if let Some((_, window)) = app
        .webview_windows()
        .into_iter()
        .find(|(label, _)| task_window_label_matches_todo(label, spec.todo_id))
    {
        return window.set_focus();
    }

    let app_handle = app.clone();
    WebviewWindowBuilder::new(app, spec.label, WebviewUrl::App(spec.route.into()))
        .on_new_window(move |url, features| open_local_asset_window(&app_handle, url, features))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .center()
        .decorations(false)
        .focused(true)
        .shadow(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .build()?;

    Ok(())
}

pub fn open_project_task_window<R: Runtime>(
    app: &AppHandle<R>,
    spec: ProjectTaskWindowSpec,
) -> tauri::Result<()> {
    if let Some((_, window)) = app
        .webview_windows()
        .into_iter()
        .find(|(label, _)| project_window_label_matches_project(label, spec.project_id))
    {
        let route_json = serde_json::to_string(&spec.route)?;
        window.eval(format!("window.location.assign({route_json});"))?;
        return window.set_focus();
    }

    let app_handle = app.clone();
    WebviewWindowBuilder::new(app, spec.label, WebviewUrl::App(spec.route.into()))
        .on_new_window(move |url, features| open_local_asset_window(&app_handle, url, features))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .center()
        .decorations(false)
        .focused(true)
        .shadow(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .build()?;

    Ok(())
}

pub fn task_window_spec(
    todo_id: i64,
    project_id: i64,
    display_id: &str,
    title: &str,
    label_suffix: &str,
) -> TaskWindowSpec {
    TaskWindowSpec {
        todo_id,
        label: format!("task-{todo_id}-{}", sanitize_label_part(label_suffix)),
        route: build_task_window_route(project_id, todo_id),
        title: format!("{display_id} - {title}"),
        width: 960.0,
        height: 720.0,
        min_width: 760.0,
        min_height: 560.0,
    }
}

pub fn project_task_window_spec(
    project_id: i64,
    todo_id: i64,
    project_name: &str,
    label_suffix: &str,
) -> ProjectTaskWindowSpec {
    ProjectTaskWindowSpec {
        project_id,
        todo_id,
        label: format!("project-{project_id}-{}", sanitize_label_part(label_suffix)),
        route: build_project_task_window_route(project_id, todo_id),
        title: format!("{project_name} - TaskCooker"),
        width: 1180.0,
        height: 760.0,
        min_width: 960.0,
        min_height: 640.0,
    }
}

pub fn next_task_window_spec(
    todo_id: i64,
    project_id: i64,
    display_id: &str,
    title: &str,
) -> TaskWindowSpec {
    let suffix = TASK_WINDOW_COUNTER
        .fetch_add(1, Ordering::Relaxed)
        .to_string();
    task_window_spec(todo_id, project_id, display_id, title, &suffix)
}

pub fn is_local_asset_window_url(url: &Url) -> bool {
    let is_asset_protocol = url.scheme() == "asset";
    let is_asset_localhost = url.scheme() == "http" && url.host_str() == Some("asset.localhost");

    (is_asset_protocol || is_asset_localhost) && has_supported_image_extension(url.path())
}

fn open_local_asset_window<R: Runtime>(
    app: &AppHandle<R>,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<R> {
    if !is_local_asset_window_url(&url) {
        return NewWindowResponse::Deny;
    }

    let webview_url = WebviewUrl::App(build_image_window_route(&url).into());
    let app_handle = app.clone();

    let window = WebviewWindowBuilder::new(app, next_image_window_label(), webview_url)
        .window_features(features)
        .on_new_window(move |url, features| open_local_asset_window(&app_handle, url, features))
        .title("Image - TaskCooker")
        .inner_size(960.0, 720.0)
        .min_inner_size(360.0, 260.0)
        .resizable(true)
        .focused(true)
        .build();

    match window {
        Ok(window) => NewWindowResponse::Create { window },
        Err(err) => {
            eprintln!("warning: could not open image window: {err}");
            NewWindowResponse::Deny
        }
    }
}

pub fn build_image_window_route(url: &Url) -> String {
    format!(
        "/?imageWindow=1&imageSrc={}",
        encode_query_component(url.as_str())
    )
}

pub fn build_task_window_route(project_id: i64, todo_id: i64) -> String {
    format!("/?projectId={project_id}&todoId={todo_id}&taskWindow=1")
}

pub fn build_project_task_window_route(project_id: i64, todo_id: i64) -> String {
    format!("/?projectId={project_id}&todoId={todo_id}")
}

pub fn task_window_label_matches_todo(label: &str, todo_id: i64) -> bool {
    label.starts_with(&format!("task-{todo_id}-"))
}

pub fn project_window_label_matches_project(label: &str, project_id: i64) -> bool {
    label.starts_with(&format!("project-{project_id}-"))
}

fn next_image_window_label() -> String {
    let id = IMAGE_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("image-{id}")
}

fn has_supported_image_extension(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn encode_query_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn sanitize_label_part(value: &str) -> String {
    let safe_value: String = value
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '/' | ':' | '_' => ch,
            _ => '-',
        })
        .collect();
    if safe_value.is_empty() {
        TASK_WINDOW_COUNTER
            .fetch_add(1, Ordering::Relaxed)
            .to_string()
    } else {
        safe_value
    }
}
