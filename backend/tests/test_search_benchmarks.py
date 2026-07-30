from __future__ import annotations

from dataclasses import dataclass

from app.models import Job, TalentListing, User
from app.services.search_service import SearchService, parse_search_intent


@dataclass(frozen=True)
class IntentBenchmark:
    query: str
    domain: str
    expected_roles: tuple[str, ...] = ()
    expected_tools: tuple[str, ...] = ()
    expected_platforms: tuple[str, ...] = ()
    expected_work_modes: tuple[str, ...] = ()
    expected_locations: tuple[str, ...] = ()


INTENT_BENCHMARKS = (
    IntentBenchmark(
        "YouTube video editor",
        "jobs",
        expected_roles=("video-editor",),
        expected_platforms=("youtube",),
    ),
    IntentBenchmark(
        "long-form editor for a money creator",
        "jobs",
        expected_roles=("video-editor",),
    ),
    IntentBenchmark(
        "YouTube edtor using Premier Pro",
        "talent",
        expected_roles=("video-editor",),
        expected_tools=("premiere-pro",),
        expected_platforms=("youtube",),
    ),
    IntentBenchmark("editor", "jobs"),
    IntentBenchmark(
        "must use Premiere Pro and After Effects",
        "jobs",
        expected_tools=("after-effects", "premiere-pro"),
    ),
    IntentBenchmark(
        "remote thumbnail designer under ₹40,000 per month",
        "jobs",
        expected_roles=("thumbnail-designer",),
        expected_work_modes=("remote",),
    ),
    IntentBenchmark(
        "Tamil creator strategist in Chennai",
        "talent",
        expected_roles=("content-strategist",),
        expected_locations=("Chennai",),
    ),
    IntentBenchmark(
        "Podcastle podcast editor",
        "talent",
        expected_roles=("podcast-editor",),
        expected_tools=("podcastle",),
        expected_platforms=("podcast",),
    ),
    IntentBenchmark(
        "video editor not remote",
        "jobs",
        expected_roles=("video-editor",),
    ),
    IntentBenchmark("on-camera host in Antarctica", "talent"),
)


def test_creator_search_intent_benchmark_is_deterministic() -> None:
    for benchmark in INTENT_BENCHMARKS:
        first = parse_search_intent(
            benchmark.query,
            domain=benchmark.domain,  # type: ignore[arg-type]
        )
        second = parse_search_intent(
            benchmark.query,
            domain=benchmark.domain,  # type: ignore[arg-type]
        )
        assert first == second
        assert tuple(first.roles) == benchmark.expected_roles
        assert tuple(first.tools) == benchmark.expected_tools
        assert tuple(first.platforms) == benchmark.expected_platforms
        assert tuple(first.work_modes) == benchmark.expected_work_modes
        assert tuple(first.locations) == benchmark.expected_locations

    ambiguous = parse_search_intent("editor", domain="jobs")
    assert ambiguous.roles == []
    assert ambiguous.free_text_terms == ["editor"]

    negated = parse_search_intent("video editor not remote", domain="jobs")
    assert negated.work_modes == []
    assert "remote" not in negated.free_text_terms

    budget = parse_search_intent(
        "remote thumbnail designer under ₹40,000 per month",
        domain="jobs",
    )
    assert budget.compensation is not None
    assert budget.compensation.amount == 40000
    assert budget.compensation.unit == "per month"
    assert budget.hard_constraints == ["compensation"]


def _job(
    title: str,
    *,
    tools: list[str],
    work_mode: str = "remote",
) -> Job:
    return Job(
        title=title,
        listing_schema_version=3,
        primary_role_name_snapshot="Video Editor",
        required_tool_keys=tools,
        platforms=["YouTube"],
        content_niches=["Finance"],
        formats_hired_for=["Long-form video"],
        work_mode=work_mode,
        compensation_mode="fixed",
        budget_amount=35000,
        budget_currency="INR",
        budget_unit="per month",
        status="published",
    )


def _talent(title: str, *, tools: list[str]) -> TalentListing:
    return TalentListing(
        title=title,
        primary_role="Video Editor",
        roles=["Video Editor"],
        tools=tools,
        platforms=["YouTube"],
        content_niches=["Finance"],
        formats=["Long-form video"],
        work_mode="remote",
        availability_status="available",
        status="published",
    )


class _BenchmarkRepository:
    def __init__(self) -> None:
        self.owner = User(display_name="Public benchmark creator")
        self.jobs = [
            _job(
                "Complete finance editor",
                tools=["premiere-pro", "after-effects"],
            ),
            _job("Premiere-only finance editor", tools=["premiere-pro"]),
            _job(
                "On-site After Effects editor",
                tools=["after-effects"],
                work_mode="onsite",
            ),
        ]
        self.talent = [
            (
                _talent(
                    "Complete YouTube editor",
                    tools=["Adobe Premiere Pro", "Adobe After Effects"],
                ),
                self.owner,
            ),
            (
                _talent("Premiere-only editor", tools=["Adobe Premiere Pro"]),
                self.owner,
            ),
        ]

    async def public_job_candidates(self) -> list[Job]:
        return self.jobs

    async def public_talent_candidates(
        self,
    ) -> list[tuple[TalentListing, User]]:
        return self.talent


async def test_multi_tool_hard_constraints_require_every_requested_tool() -> None:
    service = SearchService(_BenchmarkRepository())  # type: ignore[arg-type]
    intent, results, total, no_exact_match = await service.search_jobs(
        "video editor must use Premiere Pro and After Effects",
        limit=20,
        offset=0,
    )
    assert intent.hard_constraints == ["role", "tool"]
    assert total == 1
    assert results[0].item.title == "Complete finance editor"
    assert results[0].matched_all_recognized is True
    assert no_exact_match is False


async def test_preferred_multi_tool_matches_rank_by_coverage() -> None:
    service = SearchService(_BenchmarkRepository())  # type: ignore[arg-type]
    _intent, jobs, _total, no_exact_match = await service.search_jobs(
        "YouTube editor using Premiere Pro and After Effects",
        limit=20,
        offset=0,
    )
    assert jobs[0].item.title == "Complete finance editor"
    assert jobs[0].matched_all_recognized is True
    assert jobs[1].item.title == "Premiere-only finance editor"
    assert jobs[1].score < jobs[0].score
    assert no_exact_match is False

    _intent, talent, _total, no_exact_match = await service.search_talent(
        "YouTube editor using Premiere Pro and After Effects",
        limit=20,
        offset=0,
    )
    assert talent[0].item.title == "Complete YouTube editor"
    assert talent[0].matched_all_recognized is True
    assert talent[1].score < talent[0].score
    assert no_exact_match is False


async def test_impossible_benchmark_returns_an_honest_empty_result() -> None:
    service = SearchService(_BenchmarkRepository())  # type: ignore[arg-type]
    intent, results, total, no_exact_match = await service.search_talent(
        "on-camera host in Antarctica",
        limit=20,
        offset=0,
    )
    assert intent.free_text_terms == ["on-camera", "host", "antarctica"]
    assert results == []
    assert total == 0
    assert no_exact_match is False
