from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load_seed_script():
    path = Path(__file__).resolve().parents[1] / "scripts" / "seed_staging_demo.py"
    spec = importlib.util.spec_from_file_location("seed_staging_demo", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_staging_seed_script_allows_staging_confirmation() -> None:
    module = _load_seed_script()
    module.validate_seed_environment("staging", "staging")


def test_staging_seed_script_refuses_production() -> None:
    module = _load_seed_script()
    with pytest.raises(module.SeedEnvironmentError):
        module.validate_seed_environment("production", "production")


def test_staging_seed_script_requires_matching_confirmation() -> None:
    module = _load_seed_script()
    with pytest.raises(module.SeedEnvironmentError):
        module.validate_seed_environment("staging", "development")

