use std::path::Path;

fn main() {
    // Surface the bundle identifier as a compile-time env so CLI mode can resolve
    // the same app-data directory the GUI uses (e.g. boomerang.sqlite3), without a
    // running app or any --port/--token. The release install overrides the id via
    // `tauri build --config '{"identifier": "..."}'`, which Tauri exposes through
    // the TAURI_CONFIG env var; honor that first so dev (`.dev`) and release builds
    // each point at their own database.
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let identifier =
        resolve_bundle_identifier().unwrap_or_else(|| "com.marklopez.boomerangtasks".to_string());
    println!("cargo:rustc-env=BOOMERANG_BUNDLE_IDENTIFIER={identifier}");

    tauri_build::build();
}

/// Resolve the bundle identifier the same way the build does: the `--config`
/// override (passed through `TAURI_CONFIG` as inline JSON or a file path) wins,
/// otherwise fall back to the base `tauri.conf.json`.
fn resolve_bundle_identifier() -> Option<String> {
    if let Ok(raw) = std::env::var("TAURI_CONFIG") {
        if let Some(identifier) = identifier_from_config(&raw) {
            return Some(identifier);
        }
    }
    let text = std::fs::read_to_string("tauri.conf.json").ok()?;
    identifier_from_str(&text)
}

/// `raw` may be inline JSON or a path to a JSON config file.
fn identifier_from_config(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') {
        return identifier_from_str(trimmed);
    }
    let text = std::fs::read_to_string(Path::new(trimmed)).ok()?;
    identifier_from_str(&text)
}

fn identifier_from_str(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value
        .get("identifier")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}
