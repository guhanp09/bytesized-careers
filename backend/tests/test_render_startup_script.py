from __future__ import annotations

import os
import subprocess
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "start_render.sh"


def test_render_startup_script_exists_and_uses_exec_for_uvicorn() -> None:
    script = SCRIPT_PATH.read_text()

    # Through the release step, not raw alembic: this script runs on every
    # instance, and concurrent `alembic upgrade head` runs race each other.
    # See scripts/release_migrate and tests/test_release_migration.
    assert "uv run python -m scripts.release_migrate" in script
    assert "uv run python scripts/seed_staging_demo.py --confirm \"$app_env\"" in script
    assert 'exec uv run uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"' in script


def test_render_startup_script_refuses_staging_seed_in_production() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "production",
            "RUN_DB_MIGRATIONS": "false",
            "RUN_STAGING_SEED": "true",
        }
    )

    result = subprocess.run(
        ["sh", str(SCRIPT_PATH)],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "Refusing to run staging demo seed when APP_ENV=production." in result.stderr


def test_render_startup_script_runs_migrations_seed_then_api(
    tmp_path: Path,
) -> None:
    command_log = tmp_path / "uv-commands.log"
    fake_uv = tmp_path / "uv"
    fake_uv.write_text(
        "#!/usr/bin/env sh\n"
        'printf "%s\\n" "$*" >> "$STARTUP_TEST_LOG"\n'
        "exit 0\n"
    )
    fake_uv.chmod(0o755)

    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "staging",
            "RUN_DB_MIGRATIONS": "true",
            "RUN_STAGING_SEED": "true",
            "PORT": "4321",
            "STARTUP_TEST_LOG": str(command_log),
            "PATH": f"{tmp_path}{os.pathsep}{env['PATH']}",
        }
    )

    result = subprocess.run(
        ["sh", str(SCRIPT_PATH)],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert command_log.read_text().splitlines() == [
        "run python -m scripts.release_migrate",
        "run python scripts/seed_staging_demo.py --confirm staging",
        "run uvicorn app.main:app --host 0.0.0.0 --port 4321",
    ]
