fn main() {
    // When invoked with a CLI subcommand, act as the `boomerang` CLI and exit
    // instead of launching the desktop GUI.
    if let Some(code) = boomerang_tasks_lib::cli::run_from_env() {
        std::process::exit(code);
    }
    boomerang_tasks_lib::run();
}
