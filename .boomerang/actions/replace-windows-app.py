#!/usr/bin/env python3
# title: Replace Windows App
# description: Build a fresh TaskCooker NSIS installer and replace the installed Windows app.
# icon: RefreshCw
# arg: install_mode choice required "Install mode" choices=interactive,silent

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


def project_directory() -> Path:
    configured_directory = os.environ.get("BOOMERANG_PROJECT_DIR")
    if configured_directory:
        return Path(configured_directory).resolve()
    return Path(__file__).resolve().parents[2]


def require_windows() -> None:
    if os.name != "nt":
        raise RuntimeError("This action only supports Windows.")


def require_install_mode(arguments: list[str]) -> str:
    if len(arguments) != 1 or arguments[0] not in {"interactive", "silent"}:
        raise RuntimeError("Install mode must be either 'interactive' or 'silent'.")
    return arguments[0]


def find_pnpm() -> str:
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise RuntimeError("pnpm is required to build TaskCooker.")
    return pnpm


def build_installer(project_dir: Path, pnpm: str) -> Path:
    build_started_at = time.time()
    command = [
        pnpm,
        "tauri",
        "build",
        "--config",
        "src-tauri/tauri.release.conf.json",
        "--bundles",
        "nsis",
        "--ci",
    ]

    print("Building a fresh TaskCooker Windows installer...")
    print(f"Project: {project_dir}")
    subprocess.run(command, cwd=project_dir, check=True)

    bundle_dir = project_dir / "src-tauri" / "target" / "release" / "bundle" / "nsis"
    installers = sorted(
        bundle_dir.glob("*_x64-setup.exe"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not installers:
        raise RuntimeError(f"Build finished without an NSIS installer in {bundle_dir}.")

    installer = installers[0]
    if installer.stat().st_mtime < build_started_at - 2:
        raise RuntimeError(f"The installer was not refreshed by this build: {installer}")
    return installer


def launch_installer(installer: Path, install_mode: str) -> None:
    arguments = [str(installer)]
    if install_mode == "silent":
        arguments.append("/S")

    print(f"Launching {install_mode} installer: {installer}")
    print("TaskCooker may close while Windows replaces the installed app.")
    subprocess.Popen(
        arguments,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
        | subprocess.DETACHED_PROCESS,
        close_fds=True,
    )


def main() -> int:
    try:
        require_windows()
        install_mode = require_install_mode(sys.argv[1:])
        project_dir = project_directory()
        if not (project_dir / "package.json").is_file():
            raise RuntimeError(f"Cannot find package.json in {project_dir}.")

        installer = build_installer(project_dir, find_pnpm())
        launch_installer(installer, install_mode)
        print("The fresh installer was started successfully.")
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Replace Windows App failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
