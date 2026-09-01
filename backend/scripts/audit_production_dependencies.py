from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = ROOT / "security" / "pip-audit-allowlist.json"
PIP_AUDIT_VERSION = "2.10.1"
ANALYSED_CLASSIFICATION = "NOT_REACHABLE_WITH_EVIDENCE"


class AuditGateError(RuntimeError):
    """Raised when the production dependency report cannot pass safely."""


def _require_tool(name: str) -> str:
    executable = shutil.which(name)
    if executable is not None:
        return executable
    sibling = Path(sys.executable).with_name(name)
    if sibling.is_file():
        return str(sibling)
    raise AuditGateError(f"Required dependency-audit tool is unavailable: {name}")


def load_allowlist(path: Path = ALLOWLIST_PATH) -> dict[str, Any]:
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AuditGateError(f"Cannot read dependency-audit policy: {path}") from exc

    entries = policy.get("advisories")
    if not isinstance(entries, list):
        raise AuditGateError("Dependency-audit policy must contain an advisories list")

    identities: set[tuple[str, str, tuple[str, ...]]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise AuditGateError("Every dependency-audit exception must be an object")
        package = entry.get("package")
        version = entry.get("version")
        ids = entry.get("ids")
        reason = entry.get("reason")
        evidence = entry.get("evidence")
        if not isinstance(package, str) or not package:
            raise AuditGateError("Every exception must name one package")
        if not isinstance(version, str) or not version:
            raise AuditGateError(f"{package}: exception must pin the reviewed version")
        if not isinstance(ids, list) or not ids or not all(isinstance(item, str) for item in ids):
            raise AuditGateError(f"{package}: exception must list the reviewed advisory IDs")
        if entry.get("classification") != ANALYSED_CLASSIFICATION:
            raise AuditGateError(
                f"{package}: exception classification must be {ANALYSED_CLASSIFICATION}"
            )
        if not isinstance(reason, str) or len(reason.strip()) < 80:
            raise AuditGateError(f"{package}: exception requires a concrete reachability analysis")
        if not isinstance(evidence, list) or not evidence:
            raise AuditGateError(f"{package}: exception must name its executable evidence")
        for relative in evidence:
            if not isinstance(relative, str) or not (ROOT / relative).is_file():
                raise AuditGateError(f"{package}: missing evidence file {relative!r}")

        identity = (package, version, tuple(sorted(ids)))
        if identity in identities:
            raise AuditGateError(f"Duplicate dependency-audit exception: {package} {version}")
        identities.add(identity)
    return policy


def evaluate_report(
    report: dict[str, Any], policy: dict[str, Any]
) -> tuple[list[str], list[str]]:
    dependencies = report.get("dependencies")
    if not isinstance(dependencies, list):
        raise AuditGateError("pip-audit returned no dependency list")

    entries = policy["advisories"]
    seen_entries: set[int] = set()
    analysed: list[str] = []
    violations: list[str] = []

    for dependency in dependencies:
        if not isinstance(dependency, dict):
            raise AuditGateError("pip-audit returned a malformed dependency entry")
        package = dependency.get("name")
        version = dependency.get("version")
        vulnerabilities = dependency.get("vulns")
        if not isinstance(package, str) or not isinstance(version, str):
            raise AuditGateError("pip-audit returned a dependency without a name or version")
        if not isinstance(vulnerabilities, list):
            raise AuditGateError(f"pip-audit returned no vulnerability list for {package}")

        for vulnerability in vulnerabilities:
            if not isinstance(vulnerability, dict) or not isinstance(
                vulnerability.get("id"), str
            ):
                raise AuditGateError(f"pip-audit returned a malformed finding for {package}")
            aliases = vulnerability.get("aliases", [])
            if not isinstance(aliases, list) or not all(isinstance(alias, str) for alias in aliases):
                raise AuditGateError(f"pip-audit returned malformed aliases for {package}")
            found_ids = {vulnerability["id"], *aliases}

            matching = [
                (index, entry)
                for index, entry in enumerate(entries)
                if entry["package"] == package
                and entry["version"] == version
                and found_ids.intersection(entry["ids"])
            ]
            if len(matching) != 1:
                violations.append(
                    f"unanalysed: {package} {version} — {', '.join(sorted(found_ids))}"
                )
                continue

            index, entry = matching[0]
            expected_ids = set(entry["ids"])
            if not expected_ids.issubset(found_ids):
                violations.append(
                    f"changed identity: {package} {version} — expected "
                    f"{', '.join(sorted(expected_ids))}, received {', '.join(sorted(found_ids))}"
                )
                continue
            seen_entries.add(index)
            analysed.append(
                f"{package} {version} — {vulnerability['id']} — {entry['reason']}"
            )

    for index, entry in enumerate(entries):
        if index not in seen_entries:
            violations.append(
                f"stale exception: {entry['package']} {entry['version']} is no longer reported"
            )

    return analysed, violations


def collect_report() -> dict[str, Any]:
    uv = _require_tool("uv")
    uvx = _require_tool("uvx")
    with tempfile.TemporaryDirectory(prefix="creatorjobs-production-audit-") as temporary:
        requirements = Path(temporary) / "requirements.txt"
        exported = subprocess.run(
            [
                uv,
                "--quiet",
                "export",
                "--locked",
                "--no-dev",
                "--no-emit-project",
                "--format",
                "requirements-txt",
                "--output-file",
                str(requirements),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if exported.returncode != 0:
            raise AuditGateError(
                "Could not export the locked production dependency set: "
                + exported.stderr.strip()
            )

        audited = subprocess.run(
            [
                uvx,
                "--from",
                f"pip-audit=={PIP_AUDIT_VERSION}",
                "pip-audit",
                "--requirement",
                str(requirements),
                "--require-hashes",
                "--progress-spinner",
                "off",
                "--strict",
                "--format",
                "json",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if audited.returncode not in {0, 1}:
            raise AuditGateError("pip-audit failed: " + audited.stderr.strip())
        try:
            report = json.loads(audited.stdout)
        except json.JSONDecodeError as exc:
            raise AuditGateError("pip-audit did not return a JSON report") from exc
        if not isinstance(report, dict):
            raise AuditGateError("pip-audit returned a malformed JSON report")
        return report


def main() -> int:
    try:
        policy = load_allowlist()
        analysed, violations = evaluate_report(collect_report(), policy)
    except AuditGateError as exc:
        print(f"Production dependency audit failed: {exc}", file=sys.stderr)
        return 1

    for finding in analysed:
        print(f"analysed: {finding}")
    if violations:
        print("Production dependency findings require action:", file=sys.stderr)
        for violation in violations:
            print(f"  {violation}", file=sys.stderr)
        return 1

    print(
        f"Production dependency audit: {len(analysed)} analysed, "
        "0 unanalysed advisories."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
