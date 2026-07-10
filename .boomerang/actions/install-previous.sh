#!/usr/bin/env bash
# title: Install Previous App
# description: Restore the saved previous Boomerang Tasks app backup to ~/Applications.
# icon: RotateCcw

set -euo pipefail

APP_NAME="${APP_NAME:-Boomerang Tasks}"
BUNDLE_ID="${BUNDLE_ID:-com.marklopez.boomerangtasks}"
INSTALL_APP_PATH="${INSTALL_APP_PATH:-$HOME/Applications/$APP_NAME.app}"
BACKUP_APP_PATH="${BOOMERANG_BACKUP_APP_PATH:-$HOME/Library/Application Support/com.marklopez.boomerangtasks/backups/$APP_NAME-previous.app}"
OPEN_AFTER_INSTALL="${OPEN_AFTER_INSTALL:-1}"
WINDOW_TITLE="${WINDOW_TITLE:-Boomerang Tasks previous install}"
RUNNER="${TMPDIR:-/tmp}/boomerang-tasks-install-previous-$(date +%s).command"
LOG_FILE="${TMPDIR:-/tmp}/boomerang-tasks-install-previous.log"

ACTION_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
RESTORE_STAGE_DIR=""
RESTORE_CURRENT_STAGE_DIR=""

quote_for_shell() {
  printf "%q" "$1"
}

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

cleanup_restore_staging() {
  if [[ -n "$RESTORE_STAGE_DIR" ]]; then
    rm -rf "$RESTORE_STAGE_DIR"
  fi
  if [[ -n "$RESTORE_CURRENT_STAGE_DIR" ]]; then
    rm -rf "$RESTORE_CURRENT_STAGE_DIR"
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

restore_previous_app() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This rollback action currently supports macOS .app bundles only."
    exit 1
  fi

  if [[ "$INSTALL_APP_PATH" == "$BACKUP_APP_PATH" ]]; then
    echo "Install path and previous backup path must be different." >&2
    exit 1
  fi

  if [[ ! -d "$BACKUP_APP_PATH" ]]; then
    echo "No previous $APP_NAME backup found at $BACKUP_APP_PATH" >&2
    echo "Run Install App once after an app is already installed to create the backup." >&2
    exit 1
  fi

  echo "Restoring previous $APP_NAME from $BACKUP_APP_PATH"
  echo "Install path: $INSTALL_APP_PATH"

  if is_app_running; then
    echo "Quitting $APP_NAME..."
    osascript -e "tell application id \"$BUNDLE_ID\" to quit"
    wait_for_app_exit
  fi

  local install_parent
  local install_name
  local backup_parent
  local stage_dir
  local stage_app
  local current_stage_dir=""
  local current_backup=""

  install_parent="$(dirname "$INSTALL_APP_PATH")"
  install_name="$(basename "$INSTALL_APP_PATH")"
  backup_parent="$(dirname "$BACKUP_APP_PATH")"

  mkdir -p "$install_parent" "$backup_parent"
  stage_dir="$(mktemp -d "$install_parent/.${install_name}.restore.XXXXXX")"
  stage_app="$stage_dir/$install_name"
  RESTORE_STAGE_DIR="$stage_dir"
  trap cleanup_restore_staging EXIT

  echo "Preparing previous app bundle..."
  copy_app "$BACKUP_APP_PATH" "$stage_app"

  if [[ -d "$INSTALL_APP_PATH" ]]; then
    current_stage_dir="$(mktemp -d "$backup_parent/.current.XXXXXX")"
    RESTORE_CURRENT_STAGE_DIR="$current_stage_dir"
    current_backup="$current_stage_dir/$install_name"
    echo "Preserving currently installed $APP_NAME as the new previous backup..."
    copy_app "$INSTALL_APP_PATH" "$current_backup"
  fi

  echo "Installing previous $APP_NAME..."
  rm -rf "$INSTALL_APP_PATH"
  mv "$stage_app" "$INSTALL_APP_PATH"
  clear_quarantine "$INSTALL_APP_PATH"

  if [[ -n "$current_backup" ]]; then
    rm -rf "$BACKUP_APP_PATH"
    mv "$current_backup" "$BACKUP_APP_PATH"
  fi

  if [[ "$OPEN_AFTER_INSTALL" == "1" ]] && command -v open >/dev/null 2>&1; then
    echo "Starting $APP_NAME..."
    open "$INSTALL_APP_PATH"
  fi

  echo "Installed previous $APP_NAME at $INSTALL_APP_PATH"

  cleanup_restore_staging
  trap - EXIT
}

write_runner() {
  cat >"$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '\\033]0;$WINDOW_TITLE\\007'
APP_NAME=$(quote_for_shell "$APP_NAME")
BUNDLE_ID=$(quote_for_shell "$BUNDLE_ID")
INSTALL_APP_PATH=$(quote_for_shell "$INSTALL_APP_PATH")
BOOMERANG_BACKUP_APP_PATH=$(quote_for_shell "$BACKUP_APP_PATH")
OPEN_AFTER_INSTALL=$(quote_for_shell "$OPEN_AFTER_INSTALL")
WINDOW_TITLE=$(quote_for_shell "$WINDOW_TITLE")
export APP_NAME BUNDLE_ID INSTALL_APP_PATH BOOMERANG_BACKUP_APP_PATH OPEN_AFTER_INSTALL WINDOW_TITLE
BOOMERANG_INSTALL_PREVIOUS_INLINE=1 $(quote_for_shell "$ACTION_PATH")
status=\$?
if [[ "\$status" -eq 0 ]] && command -v osascript >/dev/null 2>&1; then
  (
    sleep 0.5
    osascript -e 'tell application "Terminal" to close (first window whose name contains "Boomerang Tasks previous install")' >/dev/null 2>&1 || true
  ) &
fi
exit "\$status"
EOF

  chmod +x "$RUNNER"
}

if [[ "${BOOMERANG_INSTALL_PREVIOUS_INLINE:-0}" == "1" ]]; then
  restore_previous_app
  exit 0
fi

write_runner

if command -v open >/dev/null 2>&1; then
  open "$RUNNER"
  echo "Started Boomerang Tasks previous-app install in a separate Terminal window."
else
  nohup "$RUNNER" >"$LOG_FILE" 2>&1 &
  echo "Started Boomerang Tasks previous-app install in the background."
  echo "Log: $LOG_FILE"
fi
