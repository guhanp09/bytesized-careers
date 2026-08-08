"""The manifest the editor's contract reads, kept honest by the backend.

`lib/importJob/importableFields.json` tells a frontend test which fields an
import can populate, so that test can check every one of them has a way to be
reviewed and edited. A manifest nobody verifies is worse than none: it would go
stale silently and the contract built on it would keep passing.

The first attempt at that contract scraped the policy module with a regular
expression, found nothing, and passed every assertion against an empty list.
This exists so the same thing cannot happen twice.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.core.job_import_policy import (
    JOB_IMPORT_FIELD_POLICIES,
    LEGACY_COMPATIBILITY_IMPORT_FIELDS,
    SYSTEM_OWNED_IMPORT_FIELDS,
)

MANIFEST = Path(__file__).resolve().parents[2] / "lib" / "importJob" / "importableFields.json"


def _current() -> dict[str, list[str]]:
    return {
        "importable": sorted(set(JOB_IMPORT_FIELD_POLICIES) - set(SYSTEM_OWNED_IMPORT_FIELDS)),
        "system_owned": sorted(SYSTEM_OWNED_IMPORT_FIELDS),
        "legacy": sorted(LEGACY_COMPATIBILITY_IMPORT_FIELDS),
    }


def test_the_manifest_matches_what_the_importer_can_populate() -> None:
    stored = json.loads(MANIFEST.read_text())
    current = _current()

    for key, expected in current.items():
        assert stored[key] == expected, (
            f"{key} has drifted. Regenerate lib/importJob/importableFields.json — "
            f"missing {sorted(set(expected) - set(stored[key]))}, "
            f"stale {sorted(set(stored[key]) - set(expected))}"
        )


def test_the_manifest_is_not_empty() -> None:
    stored = json.loads(MANIFEST.read_text())

    # The failure this file exists to prevent: an empty oracle looks exactly
    # like an oracle with nothing to report.
    assert len(stored["importable"]) >= 60, len(stored["importable"])
    assert "title" in stored["importable"]
    assert "experience_level" in stored["importable"]
