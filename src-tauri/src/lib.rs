pub mod app_windows;
pub mod artifact_watcher;
pub mod cli;
pub mod commands;
pub mod core;
pub mod db_watcher;
pub mod mcp;
pub mod pty;
pub mod remote;
pub mod server;

use std::fs;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app_handle| app_windows::create_app_menu(app_handle))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_menu_event(|app, event| {
            if event.id() == app_windows::CONNECT_REMOTE_MENU_ID {
                let _ = app.emit("remote:connect-requested", ());
            }
        })
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;
            let db = core::AppDb::open_path(app_data_dir.join(core::DATABASE_FILE_NAME))?;
            app.manage(db);
            app.manage(mcp::McpServerState::default());
            app.manage(pty::PtyState::default());
            app.manage(remote::RemoteTunnelState::default());
            let db = app.state::<core::AppDb>();
            let settings = db.app_settings()?;
            // MCP startup should never abort the desktop app; port conflicts are
            // handled by picking and persisting a free loopback port.
            if let Err(err) = app.state::<mcp::McpServerState>().apply_settings(
                app.handle().clone(),
                &*db,
                &settings,
            ) {
                eprintln!("warning: MCP server did not start: {err}");
            }
            // Watch artifact files so external edits refresh the UI and engage the
            // editor's conflict guard instead of being silently overwritten.
            if let Err(err) = artifact_watcher::spawn(app.handle()) {
                eprintln!("warning: artifact watcher did not start: {err}");
            }
            // Watch the database file so changes made by the `boomerang` CLI (or a
            // delegated agent calling it) refresh an open board live, even though
            // those writes go straight to SQLite instead of through this process.
            if let Err(err) = db_watcher::spawn(app.handle()) {
                eprintln!("warning: database watcher did not start: {err}");
            }
            app_windows::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_manual_time_log,
            commands::add_todo_dependency,
            commands::app_snapshot,
            commands::app_settings,
            commands::append_slowdown_profile_records,
            commands::clear_todo_messages,
            commands::clear_project_background_image,
            commands::close_execution_terminal,
            commands::commit_and_merge_todo_worktree,
            commands::create_project,
            commands::create_project_action,
            commands::connect_project_github_repository,
            commands::create_project_actions_directory,
            commands::create_subtask,
            commands::create_todo,
            commands::create_working_directory,
            commands::choose_working_directory,
            commands::choose_project_background_image,
            commands::delete_project_action,
            commands::delete_message,
            commands::delete_todo,
            commands::delete_todo_worktree,
            commands::delete_todos,
            commands::delete_time_log,
            commands::enable_todo_worktree,
            commands::generate_todo_title,
            commands::link_project,
            commands::link_todo,
            commands::get_project_actions_directory,
            commands::get_project_git_repository,
            commands::get_working_directory,
            commands::list_project_github_owners,
            commands::list_project_actions,
            commands::mark_todo_messages_read,
            commands::message_todo,
            commands::open_todo_worktree_diff,
            commands::open_todo_worktree_folder,
            commands::open_external_terminal,
            commands::open_project_action,
            commands::open_project_actions_directory,
            commands::open_file_path,
            commands::open_project_folder,
            commands::push_project_git_repository,
            commands::open_todo_artifact,
            commands::record_project_use,
            commands::record_prompt_copied,
            commands::regenerate_mcp_token,
            commands::remove_todo_dependency,
            commands::rename_execution_terminal,
            commands::reorder_project_link,
            commands::reorder_todo,
            commands::run_project_action,
            commands::save_editor_image,
            commands::set_markdown_editor_mode,
            commands::set_markdown_toc_hidden,
            commands::set_markdown_toc_width,
            commands::set_task_detail_description_width,
            commands::set_task_details_rail_hidden,
            commands::set_task_list_accordion_state,
            commands::set_task_list_width,
            commands::set_todo_starred,
            commands::set_todo_panel_visibility,
            commands::set_todo_toc_visibility,
            commands::suggest_todo_worktree_name,
            commands::todo_worktree_status,
            commands::start_agent_session,
            commands::start_execution_terminal,
            commands::stop_agent_session,
            commands::set_todo_tags,
            commands::update_app_settings,
            commands::update_project_notes,
            commands::update_project_prompt_settings,
            commands::update_project_settings,
            commands::update_time_log_duration,
            commands::update_todo_artifact,
            commands::update_todo_deadline,
            commands::update_todo_description,
            commands::update_todo_journal,
            commands::update_todo_context_project,
            commands::update_todo_priority,
            commands::update_todo_state,
            commands::update_todos_state,
            commands::update_todo_title,
            pty::pty_claim_input,
            pty::pty_close,
            pty::pty_release_input,
            pty::pty_resize,
            pty::pty_scrollback,
            pty::pty_write,
            remote::remote_invoke,
            remote::start_remote_tunnel,
            commands::unlink_project,
            commands::update_project_status,
            remote::stop_remote_tunnel,
            commands::start_timer,
            commands::stop_timer
        ])
        .run(tauri::generate_context!())
        .expect("error while running TaskCooker");
}
