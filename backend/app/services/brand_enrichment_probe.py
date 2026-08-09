"""A gate a browser test can hold background enrichment open with.

The race guarantees — recruiter typing wins, a switched brand discards the old
result, two tabs produce one attempt — are all about *what happens while work is
in flight*. Proving them through the product needs the ability to stop time in
the middle of an attempt, and enrichment normally runs to completion in a
background task nobody can reach from Playwright.

So this replaces the two slow parts, the official-site fetch and the model call,
with stand-ins a test can pause and release. It counts them separately too,
because "the endpoint was called" and "a brand's website was actually fetched"
are different facts and the cost contract is about the second one.

**It is inert in production.** ``install`` is only ever called from the dev
router, which is itself gated on ``app_env`` being development or test, and the
enrichment service asks for it through a hook that returns ``None`` unless a
test armed it. Nothing here changes what a real deployment does; it is a seam,
not a switch.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal

#: What a released attempt should do.
ReleaseMode = Literal["success", "fetch_failure", "model_decline"]

DEFAULT_EVIDENCE = (
    "Finance Simplified publishes personal finance videos aimed at helping young "
    "adults understand money, budgeting and investing. The channel produces "
    "explainers and short videos across YouTube and Instagram for viewers new to "
    "managing their own finances."
)


@dataclass
class BrandEnrichmentProbe:
    """Counters plus a gate. One per process; tests reset it between cases."""

    #: How many times a brand's own site was actually fetched. The number the
    #: cost contract cares about — endpoint requests are cheap and may repeat.
    fetches: int = 0
    #: How many times the summariser ran.
    model_calls: int = 0
    #: Set when an attempt reaches the gate, so a test can wait for "work has
    #: started" without sleeping.
    started: asyncio.Event = field(default_factory=asyncio.Event)
    #: Cleared to hold work open; set to let it finish.
    gate: asyncio.Event = field(default_factory=asyncio.Event)
    gated: bool = False
    mode: ReleaseMode = "success"
    evidence: str = DEFAULT_EVIDENCE
    summary: str = "Finance Simplified publishes personal finance videos for young adults."

    def reset(self) -> None:
        self.fetches = 0
        self.model_calls = 0
        self.started = asyncio.Event()
        self.gate = asyncio.Event()
        self.gate.set()
        self.gated = False
        self.mode = "success"

    def arm(self, *, mode: ReleaseMode = "success", summary: str | None = None) -> None:
        """Hold the next attempt at the gate until released."""

        self.started = asyncio.Event()
        self.gate = asyncio.Event()
        self.gated = True
        self.mode = mode
        if summary is not None:
            self.summary = summary
            # The grounding check refuses any content word the evidence does not
            # contain, which is exactly right and would reject a test sentinel.
            # The fixture supplies evidence that supports its own summary so the
            # race tests exercise the race rather than fighting the guard —
            # grounding itself is proven separately, against real prose.
            self.evidence = f"{DEFAULT_EVIDENCE} {summary}"

    def release(self) -> None:
        self.gate.set()

    async def wait_until_started(self, timeout: float = 20.0) -> bool:
        try:
            await asyncio.wait_for(self.started.wait(), timeout=timeout)
            return True
        except TimeoutError:
            return False

    async def _pause(self) -> None:
        self.started.set()
        if self.gated:
            await self.gate.wait()


_PROBE: BrandEnrichmentProbe | None = None


def install() -> BrandEnrichmentProbe:
    """Arm the seam. Dev/test only — the dev router is the sole caller."""

    global _PROBE
    if _PROBE is None:
        _PROBE = BrandEnrichmentProbe()
        _PROBE.reset()
    return _PROBE


def active_probe() -> BrandEnrichmentProbe | None:
    """The installed probe, or ``None`` in an ordinary process."""

    return _PROBE


class GatedFetcher:
    """Stands in for the official-site fetch, pausing at the gate."""

    def __init__(self, probe: BrandEnrichmentProbe) -> None:
        self._probe = probe

    async def fetch(self, url: str):
        self._probe.fetches += 1
        await self._probe._pause()
        if self._probe.mode == "fetch_failure":
            from app.services.job_url_fetcher import PublicJobUrlFetchError

            raise PublicJobUrlFetchError(
                "JOB_IMPORT_URL_ACCESS_DECLINED", "the fixture declined this fetch"
            )

        probe = self._probe

        class _Retrieval:
            normalized_text = probe.evidence
            final_url = url

        return _Retrieval()


class GatedSummarizer:
    """Stands in for the provider call."""

    def __init__(self, probe: BrandEnrichmentProbe) -> None:
        self._probe = probe

    async def summarize(self, *, brand_name: str, evidence: str) -> str | None:
        self._probe.model_calls += 1
        if self._probe.mode == "model_decline":
            return None
        return self._probe.summary
