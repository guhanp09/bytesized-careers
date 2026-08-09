"""Test-only controls for holding brand enrichment open mid-attempt.

The race guarantees are all about what happens while work is in flight, and a
browser cannot observe that if the work always runs to completion inside a
background task. These endpoints let a Playwright test arm a gate, wait for an
attempt to reach it, release it as a success or a failure, and read how many
official fetches and model calls actually happened.

Gated exactly like the other dev tooling in this package: unreachable unless
``APP_ENV`` is development or test, which is why it is safe for the seam in
``build_brand_enrichment_service`` to exist at all.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.services.brand_enrichment_probe import ReleaseMode, active_probe, install

router = APIRouter(prefix="/dev/brand-enrichment", tags=["dev"])


def _ensure_dev_only() -> None:
    if settings.app_env not in {"development", "test"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


class ProbeState(BaseModel):
    fetches: int
    model_calls: int
    gated: bool
    started: bool


class ArmRequest(BaseModel):
    gated: bool = True
    mode: ReleaseMode = "success"
    summary: str | None = None


@router.post("/arm", response_model=ProbeState)
async def arm(payload: ArmRequest) -> ProbeState:
    _ensure_dev_only()
    probe = install()
    probe.reset()
    if payload.gated:
        probe.arm(mode=payload.mode, summary=payload.summary)
    else:
        probe.mode = payload.mode
        if payload.summary is not None:
            probe.arm(mode=payload.mode, summary=payload.summary)
            probe.gated = False
            probe.gate.set()
    return _state()


@router.post("/release", response_model=ProbeState)
async def release() -> ProbeState:
    _ensure_dev_only()
    probe = active_probe()
    if probe is not None:
        probe.release()
    return _state()


@router.get("/state", response_model=ProbeState)
async def state() -> ProbeState:
    _ensure_dev_only()
    return _state()


def _state() -> ProbeState:
    probe = active_probe()
    if probe is None:
        return ProbeState(fetches=0, model_calls=0, gated=False, started=False)
    return ProbeState(
        fetches=probe.fetches,
        model_calls=probe.model_calls,
        gated=probe.gated,
        started=probe.started.is_set(),
    )
