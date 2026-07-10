//! Watches the on-disk artifact files for external edits.
//!
//! Artifact Markdown is read from disk on every snapshot (the file is the source
//! of truth), but external writes (an agent or another editor changing the file)
//! emit no Boomerang event, so the UI could stay stale for up to a refetch
//! interval and the editor could overwrite newer on-disk content. This watcher
//! emits `todos:changed` when an artifact file changes on disk so the UI
//! converges quickly and the editor's conflict guard can engage.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::AppDb;

/// Filesystem watchers fire several events per logical save; coalesce a burst into
/// a single refresh per artifact within this window.
const COALESCE_WINDOW: Duration = Duration::from_millis(200);

/// Keeps the watcher alive for the lifetime of the app. Dropping the watcher stops
/// the watch, so it is stored in Tauri managed state.
pub struct ArtifactWatcher(#[allow(dead_code)] Mutex<RecommendedWatcher>);

/// Starts watching the artifacts directory. Safe to call once during setup; the
/// watcher handle is stored in managed state. Returns `Ok(())` even if the app db
/// is not yet managed (nothing to watch).
pub fn spawn(app: &AppHandle) -> notify::Result<()> {
    let Some(db) = app.try_state::<AppDb>() else {
        return Ok(());
    };
    let artifacts_root = db.artifacts_root();
    // Watching a missing directory fails; create it so external writes are caught
    // from the first save.
    let _ = std::fs::create_dir_all(&artifacts_root);

    let (tx, rx) = channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            for path in event.paths {
                let _ = tx.send(path);
            }
        }
    })?;
    watcher.watch(&artifacts_root, RecursiveMode::Recursive)?;

    let thread_app = app.clone();
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut changed: HashSet<PathBuf> = HashSet::new();
            changed.insert(first);
            loop {
                match rx.recv_timeout(COALESCE_WINDOW) {
                    Ok(path) => {
                        changed.insert(path);
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            for path in changed {
                emit_for_path(&thread_app, &path);
            }
        }
    });

    app.manage(ArtifactWatcher(Mutex::new(watcher)));
    Ok(())
}

fn emit_for_path(app: &AppHandle, path: &Path) {
    let Some((project_id, display_id)) = parse_artifact_path(path) else {
        return;
    };
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let Some(todo_id) = db.todo_id_for_artifact(project_id, &display_id) else {
        return;
    };
    let _ = app.emit(
        "todos:changed",
        json!({ "todoId": todo_id, "changeType": "artifact_file_changed" }),
    );
}

/// Parses `.../artifacts/project-<projectId>/<displayId>.md` into `(projectId,
/// displayId)`. Returns `None` for anything that is not a project artifact file
/// (wrong extension, editor swap/temp files, files outside a `project-*` dir).
pub fn parse_artifact_path(path: &Path) -> Option<(i64, String)> {
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return None;
    }
    let display_id = path.file_stem()?.to_str()?.trim().to_string();
    if display_id.is_empty() {
        return None;
    }
    let project_dir = path.parent()?.file_name()?.to_str()?;
    let project_id = project_dir.strip_prefix("project-")?.parse::<i64>().ok()?;
    Some((project_id, display_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_artifact_path() {
        let path = Path::new("/data/artifacts/project-3/H-7.md");
        assert_eq!(parse_artifact_path(path), Some((3, "H-7".to_string())));
    }

    #[test]
    fn rejects_non_markdown_and_temp_files() {
        assert_eq!(
            parse_artifact_path(Path::new("/data/artifacts/project-3/H-7.txt")),
            None,
        );
        assert_eq!(
            parse_artifact_path(Path::new("/data/artifacts/project-3/H-7.md.swp")),
            None,
        );
    }

    #[test]
    fn rejects_paths_outside_a_project_directory() {
        assert_eq!(
            parse_artifact_path(Path::new("/data/artifacts/notes/H-7.md")),
            None,
        );
        assert_eq!(
            parse_artifact_path(Path::new("/data/artifacts/project-x/H-7.md")),
            None,
        );
    }
}
