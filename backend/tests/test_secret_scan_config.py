"""Publication exceptions are specific nonsecrets, not scanning blind spots."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONFIG = tomllib.loads((ROOT / ".gitleaks.toml").read_text())


def permits(rule: str, path: str, value: str) -> bool:
    return any(
        rule in exception["targetRules"]
        and any(re.search(pattern, path) for pattern in exception["paths"])
        and any(re.search(pattern, value) for pattern in exception["regexes"])
        for exception in CONFIG["allowlists"]
    )


def test_default_rules_are_retained_with_no_broad_exclusions():
    assert CONFIG["extend"] == {"useDefault": True}
    assert set(CONFIG) == {"title", "extend", "allowlists"}
    assert len(CONFIG["allowlists"]) == 4
    for exception in CONFIG["allowlists"]:
        assert exception["condition"] == "AND"
        assert set(exception) == {
            "description",
            "targetRules",
            "condition",
            "paths",
            "regexTarget",
            "regexes",
        }
        assert exception["regexTarget"] in {"secret", "line"}
        assert all(pattern.endswith("$") for pattern in exception["paths"])
        assert all(
            pattern.startswith("^") and pattern.endswith("$") for pattern in exception["regexes"]
        )


@pytest.mark.parametrize(
    ("exception_index", "path"),
    [
        (0, "backend/app/main.py"),
        (1, "backend/tests/test_totp.py"),
        (1, "backend/tests/test_strong_auth_secrets.py"),
        (2, "backend/tests/test_health_contracts.py"),
        (3, "tests/strongAuthClient.test.mjs"),
        (3, "tests/e2e/admin-strong-auth.spec.ts"),
    ],
)
def test_only_the_reviewed_value_rule_and_path_combination_is_permitted(exception_index, path):
    exception = CONFIG["allowlists"][exception_index]
    rule = exception["targetRules"][0]
    # Read fixture material from its reviewed source, not another copy of a
    # token-shaped literal that would itself require a scanner exception.
    value = exception["regexes"][0][1:-1]
    if exception["regexTarget"] == "line":
        value = next(
            line
            for line in (ROOT / path).read_text().splitlines()
            if re.search(exception["regexes"][0], line)
        )
    else:
        assert value in (ROOT / path).read_text()
    assert permits(rule, path, value)
    assert permits(rule, f"/tmp/snapshot/{path}", value)
    assert not permits("different-credential-rule", path, value)
    assert not permits(rule, "backend/app/unreviewed.py", value)
    assert not permits(rule, path + ".backup", value)
    assert not permits(rule, path, "different-secret-must-still-be-scanned")


def test_rfc_fixture_remains_an_explicit_standard_vector():
    assert "RFC_6238_SHA1_SECRET" in (ROOT / "backend/tests/test_totp.py").read_text()
