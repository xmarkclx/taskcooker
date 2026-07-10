#!/usr/bin/env bash
# title: Dev Server
# description: Start Boomerang Tasks in Tauri dev mode.
# icon: Play

set -euo pipefail

PROJECT_DIR="${BOOMERANG_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
  echo "Cannot find package.json in $PROJECT_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"

pnpm install
echo "Starting Boomerang Tasks in Tauri dev mode"
echo "Project: $PROJECT_DIR"
echo "Command: npm run tauri -- dev"
echo

exec npm run tauri -- dev
