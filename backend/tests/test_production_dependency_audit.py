from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from scripts.audit_production_dependencies import (
    AuditGateError,
    evaluate_report,
    load_allowlist,
)


def _ecdsa_report() -> dict[str, object]:
    return {
        "dependencies": [
            {
                "name": "ecdsa",
                "version": "0.19.2",
                "vulns": [
                    {
                        "id": "PYSEC-2026-1325",
                        "aliases": ["CVE-2024-23342", "GHSA-wj6h-64fc-37mp"],
                    }
                ],
            },
            {"name": "fastapi", "version": "0.141.1", "vulns": []},
        ]
    }


def test_exact_reviewed_finding_is_analysed() -> None:
    analysed, violations = evaluate_report(_ecdsa_report(), load_allowlist())

    assert len(analysed) == 1
    assert "ecdsa 0.19.2" in analysed[0]
    assert violations == []


def test_new_finding_fails_instead_of_inheriting_an_exception() -> None:
    report = _ecdsa_report()
    report["dependencies"].append(  # type: ignore[union-attr]
        {
            "name": "starlette",
            "version": "1.6.0",
            "vulns": [{"id": "GHSA-new-finding", "aliases": []}],
        }
    )

    _, violations = evaluate_report(report, load_allowlist())

    assert any(item.startswith("unanalysed: starlette 1.6.0") for item in violations)


def test_version_change_requires_a_fresh_reachability_review() -> None:
    report = _ecdsa_report()
    report["dependencies"][0]["version"] = "0.20.0"  # type: ignore[index]

    _, violations = evaluate_report(report, load_allowlist())

    assert any(item.startswith("unanalysed: ecdsa 0.20.0") for item in violations)
    assert any(item.startswith("stale exception: ecdsa 0.19.2") for item in violations)


def test_changed_advisory_identity_cannot_reuse_the_old_analysis() -> None:
    report = _ecdsa_report()
    report["dependencies"][0]["vulns"][0]["aliases"] = [  # type: ignore[index]
        "GHSA-wj6h-64fc-37mp"
    ]

    _, violations = evaluate_report(report, load_allowlist())

    assert any(item.startswith("changed identity: ecdsa 0.19.2") for item in violations)


def test_disappeared_finding_makes_the_exception_stale() -> None:
    report = _ecdsa_report()
    report["dependencies"][0]["vulns"] = []  # type: ignore[index]

    _, violations = evaluate_report(report, load_allowlist())

    assert violations == ["stale exception: ecdsa 0.19.2 is no longer reported"]


def test_policy_rejects_missing_executable_evidence(tmp_path: Path) -> None:
    policy = copy.deepcopy(load_allowlist())
    policy["advisories"][0]["evidence"] = ["tests/does-not-exist.py"]
    policy_path = tmp_path / "pip-audit-allowlist.json"
    policy_path.write_text(json.dumps(policy), encoding="utf-8")

    with pytest.raises(AuditGateError, match="missing evidence file"):
        load_allowlist(policy_path)
