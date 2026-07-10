#!/usr/bin/env bash
# title: Install App
# description: Build and install Boomerang Tasks to ~/Applications.
# icon: Reinstall

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="${APP_NAME:-Boomerang Tasks}"
RUNNER="${TMPDIR:-/tmp}/boomerang-tasks-install-$(date +%s).command"
LOG_FILE="${TMPDIR:-/tmp}/boomerang-tasks-install.log"

cat >"$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '\\033]0;Boomerang Tasks install\\007'
APP_NAME="$APP_NAME"
cd "$PROJECT_DIR"
npm run install:app
status=\$?
if [[ "\$status" -eq 0 ]] && command -v osascript >/dev/null 2>&1; then
  (
    sleep 0.5
    osascript -e 'tell application "Terminal" to close (first window whose name contains "Boomerang Tasks install")' >/dev/null 2>&1 || true
  ) &
fi
exit "\$status"
EOF

chmod +x "$RUNNER"

if command -v open >/dev/null 2>&1; then
  open "$RUNNER"
  echo "Started Boomerang Tasks install in a separate Terminal window."
else
  nohup "$RUNNER" >"$LOG_FILE" 2>&1 &
  echo "Started Boomerang Tasks install in the background."
  echo "Log: $LOG_FILE"
fi
