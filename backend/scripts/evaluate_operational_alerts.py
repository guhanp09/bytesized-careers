"""Evaluate CreatorJobs JSON logs using the finite local alert contract.

Usage:

    python -m scripts.evaluate_operational_alerts < captured-logs.jsonl

One static ``alert_event`` is written per alert key in the input batch.  Exit 2
means at least one alert was selected; exit 0 means none was selected.  Invalid
or unrelated lines are ignored without echoing them, because they may contain
data this process is not allowed to copy.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from typing import TextIO

from app.core.operational_alerts import AlertKey, evaluate_log_record


def evaluate_stream(lines: Iterable[str], output: TextIO) -> int:
    """Consume one finite batch and return a shell-friendly status."""

    emitted: set[AlertKey] = set()
    for line in lines:
        try:
            record = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        for alert in evaluate_log_record(record):
            key = alert.definition.key
            if key in emitted:
                continue
            emitted.add(key)
            output.write(
                json.dumps({"alert_event": alert.as_dict()}, ensure_ascii=True) + "\n"
            )
    return 2 if emitted else 0


def main() -> int:
    return evaluate_stream(sys.stdin, sys.stdout)


if __name__ == "__main__":  # pragma: no cover - operator entry point
    raise SystemExit(main())
