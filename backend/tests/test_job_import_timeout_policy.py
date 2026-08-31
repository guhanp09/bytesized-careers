"""Timeout and retry policy for job-import extraction.

These exist because of a live production defect: the deployment ran a 30-second
timeout against a call that takes about 33 seconds. Every real import was killed
roughly three seconds before its answer arrived, and the recruiter was then asked
to supply, by hand, the facts the page already stated.

The lesson is that this configuration is not a preference. A value below the
floor is a guaranteed defect, so the floor is enforced in code and asserted here.
"""

from __future__ import annotations

import logging

import pytest

from app.api.deps import (
    MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS,
    _viable_timeout_seconds,
)
from app.core import config

#: Observed on live full-pipeline calls against real public job pages.
OBSERVED_EXTRACTION_SECONDS = 33.0


def test_the_committed_default_leaves_real_margin_over_observed_latency() -> None:
    default = config.Settings.model_fields["openai_request_timeout_seconds"].default
    assert default == 90
    # Roughly 2.7x the observed call. Enough for a longer page or a slow day,
    # without letting one request hang for minutes.
    assert default >= OBSERVED_EXTRACTION_SECONDS * 2


def test_the_timeout_stays_bounded_at_both_ends() -> None:
    field = config.Settings.model_fields["openai_request_timeout_seconds"]
    bounds = {type(item).__name__: item for item in field.metadata}
    assert "Le" in bounds, "an unbounded timeout would let one call hang forever"
    assert bounds["Le"].le == 180


def test_a_configured_timeout_is_honoured_when_it_is_viable() -> None:
    settings = config.Settings(OPENAI_REQUEST_TIMEOUT_SECONDS=120)
    assert settings.openai_request_timeout_seconds == 120
    assert _viable_timeout_seconds(120) == 120


def test_an_unsafe_timeout_is_raised_to_the_floor_and_never_silently(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The exact production misconfiguration, and what now happens to it.

    Rejecting the value outright would stop an existing deployment booting, so
    the floor is applied instead — but loudly. Silence is how 30 seconds
    survived long enough to look like an unintelligent assistant.
    """

    assert MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS > OBSERVED_EXTRACTION_SECONDS

    with caplog.at_level(logging.WARNING):
        applied = _viable_timeout_seconds(30)

    assert applied == MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS
    assert "job_import_extraction_timeout_too_low" in caplog.text
    # The warning must carry both numbers so an operator can act on it.
    record = next(
        item
        for item in caplog.records
        if item.getMessage() == "job_import_extraction_timeout_too_low"
    )
    assert record.configured_seconds == 30
    assert record.applied_seconds == MIN_VIABLE_EXTRACTION_TIMEOUT_SECONDS


def test_retries_are_one_by_default_and_bounded() -> None:
    """One transient retry: enough to survive a blip, not enough to hang.

    Two retries at a 90-second ceiling is a 4.5-minute worst case in front of a
    recruiter who is watching a progress bar.
    """

    assert config.Settings.model_fields["openai_max_retries"].default == 1
    with pytest.raises(ValueError):
        config.Settings(OPENAI_MAX_RETRIES=4)


def test_worst_case_wall_clock_is_bounded_and_stated() -> None:
    """One recruiter-visible wait, with a number attached to it.

    90s x (1 initial + 1 retry) plus backoff. Two retries would make this 4.5
    minutes in front of someone watching a progress bar, which is why the retry
    default is one.
    """

    settings = config.Settings(
        OPENAI_REQUEST_TIMEOUT_SECONDS=90, OPENAI_MAX_RETRIES=1
    )
    attempts = settings.openai_max_retries + 1
    worst_case = settings.openai_request_timeout_seconds * attempts
    assert attempts == 2
    assert worst_case == 180


@pytest.mark.parametrize(
    "code",
    ["OPENAI_TIMEOUT", "OPENAI_RATE_LIMITED", "OPENAI_TEMPORARILY_UNAVAILABLE"],
)
def test_transient_failures_are_retryable(code: str) -> None:
    import inspect
    import re

    from app.integrations.openai import job_import_adapter

    source = inspect.getsource(job_import_adapter)
    block = re.search(rf'"{code}",\n(?:.*\n){{1,5}}?\s*\)', source)
    assert block is not None, f"{code} is no longer raised by the adapter"
    assert "retryable=True" in block.group(0), f"{code} must survive a blip"


@pytest.mark.parametrize(
    "code",
    [
        "OPENAI_SCHEMA_MISMATCH",
        "OPENAI_AUTHENTICATION_FAILED",
        "OPENAI_PERMISSION_DENIED",
        "OPENAI_MODEL_UNAVAILABLE",
        "OPENAI_REQUEST_REJECTED",
        "OPENAI_REFUSED",
        "OPENAI_EVIDENCE_INVALID",
    ],
)
def test_permanent_failures_are_never_retried(code: str) -> None:
    """Retrying these burns the recruiter's time to reach the same answer."""

    import inspect
    import re

    from app.integrations.openai import job_import_adapter

    source = inspect.getsource(job_import_adapter)
    for block in re.finditer(rf'"{code}",\n(?:.*\n){{1,5}}?\s*\)', source):
        assert "retryable=True" not in block.group(0), f"{code} must not retry"
