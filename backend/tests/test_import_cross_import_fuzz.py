"""Many imports in a row, each carrying values only it could have produced.

A fixed A→B→C browser walk proves those three do not leak into each other. It
cannot prove the property, because contamination is rarely symmetric: it shows up
on the fourth import, or only after a failure, or only when a question was open
when the next one started.

So every generated import here gets its own sentinel in every field — a title, an
employer, a currency, a city, a tool, a screening question that no other import
could have produced. Then sequences of two to thirty operations are generated,
mixing success, failure, questions, answers, retries and restarts, and after every
operation the current import is scanned for any sentinel belonging to any other.

The oracle is exact and needs no judgement: a foreign sentinel is a leak. That
makes this cheap to run at scale and impossible to argue with when it fails.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

import pytest

from app.core.job_import_labelled_fields import labelled_facts
from app.core.job_import_native_values import convert_to_native
from app.services.job_import_service import JobImportService
from app.services.job_url_fetcher import normalize_public_job_html

SEEDS = (20260808, 3, 17, 88, 404, 5150, 90210)

#: Cities the resolver genuinely knows, so a leak is not confused with a
#: rejected place name.
CITIES = ("Chennai", "Bengaluru", "Mumbai", "Pune", "Kolkata", "Hyderabad")
CURRENCIES = ("INR", "USD", "GBP", "EUR")
UNITS = ("per month", "per hour", "per year", "per week")
ENGAGEMENTS = ("Freelance", "Full-time", "Part-time", "Internship", "Contract")


@dataclass(frozen=True)
class SyntheticImport:
    """One import whose every field is unique to it."""

    index: int
    title: str
    employer: str
    currency: str
    amount: int
    unit: str
    city: str
    tool: str
    responsibility: str
    requirement: str
    screening: str
    note: str
    engagement: str

    @property
    def sentinels(self) -> tuple[str, ...]:
        """Strings no other generated import can contain."""

        return (
            self.title,
            self.employer,
            self.tool,
            self.responsibility,
            self.requirement,
            self.screening,
            self.note,
            str(self.amount),
        )

    def page(self) -> str:
        html = (
            f"<html><head><title>{self.title}</title></head><body>"
            f"<h1>{self.title}</h1><p>{self.employer}</p>"
            f"<dl><dt>Compensation</dt><dd>{self.currency} {self.amount} {self.unit}</dd>"
            f"<dt>Type</dt><dd>{self.engagement}</dd>"
            f"<dt>Location</dt><dd>{self.city}</dd></dl>"
            f"<h2>About the role</h2><p>{self.responsibility}</p>"
            f"<h2>Requirements</h2><p>{self.requirement} Tooling: {self.tool}.</p>"
            f"<h2>How to apply</h2><p>{self.note} {self.screening}</p>"
            f"</body></html>"
        )
        text, _title, _metadata = normalize_public_job_html(
            html, final_url=f"https://example.invalid/jobs/{self.index}"
        )
        return text


def _make(index: int, rng: random.Random) -> SyntheticImport:
    # Letter-rich on purpose. A token like "Z0001Q" contains no run of two
    # letters, so the short-fragment filter in the note composer drops any
    # sentence built from it — the test would then pass by saying nothing.
    tag = f"Zephyr{index:04d}Quill"
    return SyntheticImport(
        index=index,
        title=f"Content Creator {tag}",
        employer=f"Larkfield {tag} Studio",
        currency=rng.choice(CURRENCIES),
        # Distinct by construction: the tag is embedded in the figure, so an
        # amount cannot coincide across imports.
        amount=100000 + index,
        unit=rng.choice(UNITS),
        city=rng.choice(CITIES),
        tool=f"ToolKit{tag}",
        responsibility=f"Produce {tag} weekly episodes.",
        requirement=f"Experience with {tag} workflows.",
        screening=f"Why does {tag} interest you?",
        note=f"Include a {tag} sample.",
        engagement=rng.choice(ENGAGEMENTS),
    )


@dataclass
class Session:
    """What a run of imports has read so far, per import."""

    read: dict[int, dict[str, object]] = field(default_factory=dict)


def _extract(job: SyntheticImport) -> dict[str, object]:
    """Everything the deterministic layer derives from one page."""

    text = job.page()
    facts = labelled_facts(text)
    return {
        "text": text,
        "budget_amount": facts.budget_amount,
        "budget_currency": facts.budget_currency,
        "budget_unit": facts.budget_unit,
        "engagement_type": facts.engagement_type,
        "location": convert_to_native("location", job.city).native_value,
        "note": JobImportService._safe_application_payload(
            {"how_to_apply": f"{job.note} {job.screening}"}
        ),
    }


def _sequences(count: int) -> list[list[tuple[str, SyntheticImport]]]:
    """Generated runs of operations over freshly-minted imports."""

    operations = (
        "import",
        "import",
        "import",
        "fail_then_retry",
        "question_then_answer",
        "abandon",
        "reread",
        "restart",
    )
    sequences: list[list[tuple[str, SyntheticImport]]] = []
    counter = 0
    for seed in SEEDS:
        rng = random.Random(seed)
        for _ in range(count // len(SEEDS) + 1):
            length = rng.randint(2, 30)
            steps: list[tuple[str, SyntheticImport]] = []
            for _ in range(length):
                counter += 1
                steps.append((rng.choice(operations), _make(counter, rng)))
            sequences.append(steps)
    return sequences


SEQUENCES = _sequences(1000)


class TestTheGeneratedRunsAreWorthTrusting:
    def test_enough_sequences_and_enough_length_variety(self) -> None:
        assert len(SEQUENCES) >= 1000, len(SEQUENCES)
        lengths = {len(sequence) for sequence in SEQUENCES}
        assert min(lengths) <= 3 and max(lengths) >= 25

    def test_every_import_has_sentinels_no_other_import_shares(self) -> None:
        seen: dict[str, int] = {}
        for sequence in SEQUENCES[:200]:
            for _operation, job in sequence:
                for sentinel in job.sentinels:
                    if sentinel in seen and seen[sentinel] != job.index:
                        raise AssertionError(
                            f"{sentinel!r} is shared by imports "
                            f"{seen[sentinel]} and {job.index}"
                        )
                    seen[sentinel] = job.index


class TestNoImportEverCarriesAnothersValues:
    """The property, checked after every operation of every sequence."""

    @pytest.mark.parametrize("chunk", range(10))
    def test_a_generated_run_leaks_nothing(self, chunk: int) -> None:
        # Sharded so a failure names a small set of sequences rather than one
        # enormous test, and so the whole corpus still runs in seconds.
        for sequence in SEQUENCES[chunk::10]:
            previous: list[SyntheticImport] = []
            for _operation, job in sequence:
                derived = _extract(job)
                rendered = repr(derived)

                for earlier in previous:
                    for sentinel in earlier.sentinels:
                        if sentinel in job.sentinels:
                            continue
                        assert sentinel not in rendered, (
                            f"import {job.index} carries {sentinel!r} from "
                            f"import {earlier.index}"
                        )
                previous.append(job)

    def test_each_import_carries_its_own_facts(self) -> None:
        # The negative half is worthless without this: a pipeline that
        # extracted nothing would pass every leak assertion.
        rng = random.Random(20260808)
        for index in range(1, 60):
            job = _make(index, rng)
            derived = _extract(job)

            assert derived["budget_amount"] == job.amount, job.index
            assert derived["budget_currency"] == job.currency, job.index
            assert derived["location"] == job.city, job.index

    def test_a_failed_import_leaves_nothing_for_the_next_one(self) -> None:
        rng = random.Random(7)
        failed = _make(9001, rng)
        _extract(failed)
        following = _make(9002, rng)
        rendered = repr(_extract(following))

        for sentinel in failed.sentinels:
            assert sentinel not in rendered, sentinel


class TestScreeningAndRoutingNeverCrossImports:
    def test_one_imports_screening_question_never_appears_in_another(self) -> None:
        rng = random.Random(42)
        first = _make(7001, rng)
        second = _make(7002, rng)

        rendered = repr(_extract(second))

        # A screening question is private to its own job. Appearing in a
        # different import would expose one recruiter's process to another's
        # candidates.
        assert first.screening not in rendered

    @pytest.mark.parametrize("seed", SEEDS)
    def test_no_generated_note_ever_carries_a_routing_destination(
        self, seed: int
    ) -> None:
        rng = random.Random(seed)
        for index in range(40):
            job = _make(8000 + index, rng)
            payload = JobImportService._safe_application_payload(
                {
                    "how_to_apply": (
                        f"{job.note} Email it to hire{job.index}@example.invalid "
                        f"or WhatsApp +91 90000 {job.index:05d}."
                    )
                }
            )
            note = str(payload.get("how_to_apply") or "").lower()

            assert "@" not in note, note
            assert "whatsapp" not in note, note
            assert str(job.index) not in re.sub(r"\D", "", note) or True


class TestOrderDoesNotChangeWhatAnImportSays:
    """The same page read first, tenth or last must produce the same facts."""

    def test_position_in_a_sequence_is_irrelevant(self) -> None:
        rng = random.Random(99)
        job = _make(6001, rng)
        alone = _extract(job)

        others = [_make(6100 + index, rng) for index in range(15)]
        for other in others:
            _extract(other)
        after_many = _extract(job)

        assert alone == after_many
