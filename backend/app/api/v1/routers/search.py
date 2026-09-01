from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_search_service
from app.core.rate_limit import PUBLIC_SEARCH_LIMIT, rate_limit
from app.schemas.search import (
    JobDeepSearchResponse,
    JobSearchMatch,
    TalentDeepSearchResponse,
    TalentSearchMatch,
)
from app.services.public_listing_serializer import public_job_read, public_talent_read
from app.services.search_service import MAX_QUERY_LENGTH, SearchService

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/jobs", response_model=JobDeepSearchResponse)
async def search_jobs(
    q: str = Query(min_length=1, max_length=MAX_QUERY_LENGTH),
    role: list[str] | None = Query(default=None),
    platform: list[str] | None = Query(default=None),
    format_filter: list[str] | None = Query(default=None, alias="format"),
    work_mode: list[str] | None = Query(default=None),
    engagement_type: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _limit: None = rate_limit(PUBLIC_SEARCH_LIMIT),
    service: SearchService = Depends(get_search_service),
) -> JobDeepSearchResponse:
    intent, results, total, no_exact_match = await service.search_jobs(
        q,
        limit=limit,
        offset=offset,
        roles=role,
        platforms=platform,
        formats=format_filter,
        work_modes=work_mode,
        engagement_types=engagement_type,
        locations=location,
    )
    return JobDeepSearchResponse(
        intent=intent,
        items=[
            JobSearchMatch(
                item=public_job_read(result.item),
                score=result.score,
                reasons=result.reasons,
                matched_all_recognized=result.matched_all_recognized,
            )
            for result in results
        ],
        total=total,
        limit=limit,
        offset=offset,
        no_exact_match=no_exact_match,
    )


@router.get("/talent", response_model=TalentDeepSearchResponse)
async def search_talent(
    q: str = Query(min_length=1, max_length=MAX_QUERY_LENGTH),
    role: list[str] | None = Query(default=None),
    platform: list[str] | None = Query(default=None),
    format_filter: list[str] | None = Query(default=None, alias="format"),
    work_mode: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
    availability: list[str] | None = Query(default=None),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _limit: None = rate_limit(PUBLIC_SEARCH_LIMIT),
    service: SearchService = Depends(get_search_service),
) -> TalentDeepSearchResponse:
    intent, results, total, no_exact_match = await service.search_talent(
        q,
        limit=limit,
        offset=offset,
        roles=role,
        platforms=platform,
        formats=format_filter,
        work_modes=work_mode,
        locations=location,
        availability=availability,
    )
    return TalentDeepSearchResponse(
        intent=intent,
        items=[
            TalentSearchMatch(
                item=public_talent_read(result.item, result.owner),
                score=result.score,
                reasons=result.reasons,
                matched_all_recognized=result.matched_all_recognized,
            )
            for result in results
        ],
        total=total,
        limit=limit,
        offset=offset,
        no_exact_match=no_exact_match,
    )
