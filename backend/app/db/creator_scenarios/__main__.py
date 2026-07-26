"""Regenerate the committed manifests, or verify they are current.

    python -m app.db.creator_scenarios            # write
    python -m app.db.creator_scenarios --check    # fail if anything differs

`--check` is what CI and the unit test use: it generates into memory and
compares byte-for-byte with what is committed, so a manifest edited by hand or
left stale after a generator change is caught rather than shipped.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .generator import generate, manifest_json
from .schema import SCENARIO_NAMES
from .validation import validate

#: backend/app/db/creator_scenarios -> repository root -> fixtures/...
MANIFEST_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "creator_scenarios" / "generated"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify without writing")
    parser.add_argument("--dir", type=Path, default=MANIFEST_DIR)
    args = parser.parse_args()

    args.dir.mkdir(parents=True, exist_ok=True)
    differing: list[str] = []
    for scenario in SCENARIO_NAMES:
        manifest = generate(scenario)
        validate(manifest)
        payload = manifest_json(manifest)
        path = args.dir / f"{scenario}.json"
        if args.check:
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            if current != payload:
                differing.append(scenario)
        else:
            path.write_text(payload, encoding="utf-8")
            print(f"wrote {path.relative_to(Path.cwd()) if path.is_relative_to(Path.cwd()) else path}")

    if args.check:
        if differing:
            print(
                "Manifests are out of date: " + ", ".join(differing) +
                "\nRun: python -m app.db.creator_scenarios",
                file=sys.stderr,
            )
            return 1
        print(f"all {len(SCENARIO_NAMES)} manifests are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
