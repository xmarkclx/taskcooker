//! Watches the SQLite database file for external writes.
//!
//! The `boomerang` CLI (and delegated agents that call it) now write task state,
//! messages, and new todos straight to the database instead of going through this
//! process over a loopback port. Those writes emit no in-process Boomerang event,
//! so an open board could stay stale until the next refetch. This watcher emits a
//! generic `todos:changed` whenever the database (or its WAL sidecar) changes on
//! disk, so the UI converges quickly regardless of who made the change.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::{AppDb, DATABASE_FILE_NAME};

/// SQLite in WAL mode rewrites the `-wal` sidecar on every commit and the main
/// file on checkpoint; coalesce a burst of those events into one refresh.
const COALESCE_WINDOW: Duration = Duration::from_millis(300);

/// Keeps the watcher alive for the lifetime of the app. Dropping it stops the
/// watch, so it is stored in Tauri managed state.
pub struct DatabaseWatcher(#[allow(dead_code)] Mutex<RecommendedWatcher>);

/// Starts watching the database file's directory. Safe to call once during setup.
/// Returns `Ok(())` even if the app db is not yet managed (nothing to watch).
pub fn spawn(app: &AppHandle) -> notify::Result<()> {
    let Some(db) = app.try_state::<AppDb>() else {
        return Ok(());
    };
    // Watch the containing directory (non-recursively) rather than the file: the
    // `-wal`/`-shm` sidecars are created and replaced alongside the main file, and
    // some editors/SQLite operations swap the inode, which a single-file watch can
    // miss.
    let data_dir = db.app_data_dir().to_path_buf();

    let (tx, rx) = channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            for path in event.paths {
                let _ = tx.send(path);
            }
        }
    })?;
    watcher.watch(&data_dir, RecursiveMode::NonRecursive)?;

    let thread_app = app.clone();
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut touched = is_database_path(&first);
            // Drain the coalesce window so a single logical write emits once.
            loop {
                match rx.recv_timeout(COALESCE_WINDOW) {
                    Ok(path) => touched |= is_database_path(&path),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if touched {
                let _ = thread_app.emit(
                    "todos:changed",
                    json!({ "changeType": "database_file_changed" }),
                );
            }
        }
    });

    app.manage(DatabaseWatcher(Mutex::new(watcher)));
    Ok(())
}

/// True for the database file and its WAL/SHM sidecars
/// (`boomerang.sqlite3`, `boomerang.sqlite3-wal`, `boomerang.sqlite3-shm`, and the
/// `-journal` used outside WAL mode). Ignores unrelated files in the data dir.
fn is_database_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name.starts_with(DATABASE_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_database_and_sidecar_files() {
        assert!(is_database_path(Path::new("/data/boomerang.sqlite3")));
        assert!(is_database_path(Path::new("/data/boomerang.sqlite3-wal")));
        assert!(is_database_path(Path::new("/data/boomerang.sqlite3-shm")));
        assert!(is_database_path(Path::new(
            "/data/boomerang.sqlite3-journal"
        )));
    }

    #[test]
    fn ignores_unrelated_files() {
        assert!(!is_database_path(Path::new(
            "/data/artifacts/project-1/B-7.md"
        )));
        assert!(!is_database_path(Path::new("/data/settings.json")));
    }
}
