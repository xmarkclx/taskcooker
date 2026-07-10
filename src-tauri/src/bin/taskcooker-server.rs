//! `taskcooker-server` — headless host for TaskCooker thin-client / WSL use.
//!
//! Run this on the machine where your projects live. A remote TaskCooker desktop
//! app connects over an SSH tunnel and operates against this server's database,
//! so all projects/todos/artifacts are already present — no client-side setup.
//!
//! Usage:
//!   taskcooker-server [--port <port>] [--data-dir <dir>] [--db <file>]
//!
//! Defaults: port 8790; database `boomerang.sqlite3` inside the platform app-data
//! directory for `com.marklopez.boomerangtasks.dev` (override with TASKCOOKER_DATA_DIR
//! / TASKCOOKER_DB or the flags above).

use std::path::PathBuf;
use std::process::ExitCode;

use boomerang_tasks_lib::core::AppDb;
use boomerang_tasks_lib::server;

const DEFAULT_PORT: u16 = 8790;
const APP_IDENTIFIER: &str = "com.marklopez.boomerangtasks.dev";
const DB_FILE_NAME: &str = "boomerang.sqlite3";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("taskcooker-server: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut port = DEFAULT_PORT;
    let mut data_dir: Option<PathBuf> = std::env::var_os("TASKCOOKER_DATA_DIR").map(PathBuf::from);
    let mut db_path: Option<PathBuf> = std::env::var_os("TASKCOOKER_DB").map(PathBuf::from);

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" | "-p" => {
                let value = args.next().ok_or("--port requires a value")?;
                port = value
                    .parse()
                    .map_err(|_| format!("invalid --port value: {value}"))?;
            }
            "--data-dir" => {
                let value = args.next().ok_or("--data-dir requires a value")?;
                data_dir = Some(PathBuf::from(value));
            }
            "--db" => {
                let value = args.next().ok_or("--db requires a value")?;
                db_path = Some(PathBuf::from(value));
            }
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    let db_path = match db_path {
        Some(path) => path,
        None => {
            let dir = match data_dir {
                Some(dir) => dir,
                None => default_data_dir()?,
            };
            std::fs::create_dir_all(&dir).map_err(|err| format!("cannot create {dir:?}: {err}"))?;
            dir.join(DB_FILE_NAME)
        }
    };

    let db = AppDb::open_path(&db_path).map_err(|err| format!("cannot open {db_path:?}: {err}"))?;
    let running =
        server::spawn(db, port).map_err(|err| format!("cannot bind port {port}: {err}"))?;

    println!(
        "{} listening on http://127.0.0.1:{} (db: {})",
        server::SERVER_NAME,
        running.port,
        db_path.display()
    );
    println!("Connect from a remote TaskCooker via an SSH tunnel to this loopback port.");
    running.wait();
    Ok(())
}

fn print_help() {
    println!(
        "taskcooker-server — headless TaskCooker host for thin-client / WSL use\n\n\
         USAGE:\n    taskcooker-server [--port <port>] [--data-dir <dir>] [--db <file>]\n\n\
         OPTIONS:\n\
         \x20   -p, --port <port>      Loopback port to listen on (default {DEFAULT_PORT})\n\
         \x20       --data-dir <dir>   Directory holding {DB_FILE_NAME}\n\
         \x20       --db <file>        Explicit path to the SQLite database\n\
         \x20   -h, --help             Show this help"
    );
}

/// Platform app-data directory matching the desktop app's identifier so a server
/// started on a machine that also ran the desktop app sees the same database.
fn default_data_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "macos") {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_IDENTIFIER))
    } else if cfg!(target_os = "windows") {
        let base = std::env::var_os("APPDATA").ok_or("APPDATA is not set")?;
        Ok(PathBuf::from(base).join(APP_IDENTIFIER))
    } else {
        // Linux / WSL: follow XDG.
        if let Some(base) = std::env::var_os("XDG_DATA_HOME") {
            Ok(PathBuf::from(base).join(APP_IDENTIFIER))
        } else {
            let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
            Ok(PathBuf::from(home)
                .join(".local")
                .join("share")
                .join(APP_IDENTIFIER))
        }
    }
}
