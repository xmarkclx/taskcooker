#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-TaskCooker}"
BUNDLE_ID="${BUNDLE_ID:-com.marklopez.boomerangtasks}"
SOURCE_APP="${SOURCE_APP:-$ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app}"
INSTALL_APP_PATH="${INSTALL_APP_PATH:-$HOME/Applications/$APP_NAME.app}"
BACKUP_APP_PATH="${BOOMERANG_BACKUP_APP_PATH:-$HOME/Library/Application Support/com.marklopez.boomerangtasks/backups/$APP_NAME-previous.app}"
OPEN_AFTER_INSTALL="${OPEN_AFTER_INSTALL:-1}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer currently supports macOS .app bundles only."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build $APP_NAME."
  exit 1
fi

copy_app() {
  local source="$1"
  local target="$2"

  if command -v ditto >/dev/null 2>&1; then
    ditto "$source" "$target"
  else
    cp -R "$source" "$target"
  fi
}

clear_quarantine() {
  local target="$1"

  if command -v xattr >/dev/null 2>&1; then
    find "$target" -exec xattr -d com.apple.quarantine {} + >/dev/null 2>&1 || true
  fi
}

is_app_running() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null | grep -q "true"
  else
    return 1
  fi
}

wait_for_app_exit() {
  local deadline=$((SECONDS + 30))

  while is_app_running; do
    if (( SECONDS >= deadline )); then
      echo "$APP_NAME did not quit in time."
      return 1
    fi
    sleep 1
  done
}

echo "Building $APP_NAME..."
cd "$ROOT"
# The base tauri.conf.json carries the .dev identity so the installed app can run
# alongside `npm run tauri dev`. Override it back to the canonical id/name here so
# the live build keeps its bundle identifier, product name, and existing data.
npm run tauri -- build --config \
  "{\"productName\": \"$APP_NAME\", \"identifier\": \"$BUNDLE_ID\"}"

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "Build finished, but no app bundle was found at $SOURCE_APP"
  exit 1
fi

echo "Quitting $APP_NAME..."
if is_app_running; then
  osascript -e "tell application id \"$BUNDLE_ID\" to quit"
  wait_for_app_exit
fi

if [[ -d "$INSTALL_APP_PATH" ]]; then
  echo "Backing up previous $APP_NAME from $INSTALL_APP_PATH to $BACKUP_APP_PATH..."
  rm -rf "$BACKUP_APP_PATH"
  mkdir -p "$(dirname "$BACKUP_APP_PATH")"
  copy_app "$INSTALL_APP_PATH" "$BACKUP_APP_PATH"
else
  echo "No installed $APP_NAME app found at $INSTALL_APP_PATH; skipping backup."
fi

install_parent="$(dirname "$INSTALL_APP_PATH")"
install_name="$(basename "$INSTALL_APP_PATH")"
mkdir -p "$install_parent"
stage_dir="$(mktemp -d "$install_parent/.${install_name}.install.XXXXXX")"
stage_app="$stage_dir/$install_name"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

echo "Copying $SOURCE_APP to $INSTALL_APP_PATH..."
copy_app "$SOURCE_APP" "$stage_app"
rm -rf "$INSTALL_APP_PATH"
mv "$stage_app" "$INSTALL_APP_PATH"
clear_quarantine "$INSTALL_APP_PATH"

if [[ "$OPEN_AFTER_INSTALL" == "1" ]] && command -v open >/dev/null 2>&1; then
  echo "Starting $APP_NAME..."
  open "$INSTALL_APP_PATH"
fi

echo "Installed $APP_NAME at $INSTALL_APP_PATH"
