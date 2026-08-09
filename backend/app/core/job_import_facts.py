"""What the source said, before anything asks what CreatorJobs can store.

The architecture had a strong evidence layer at one end and a conversion gate
that refuses to narrow at the other, and nothing in between that could hold a
fact the native schema could not express. So everything between extraction and
`JobCreate` spoke only the native vocabulary — and a fact with nowhere to exist,
even briefly, is a fact that gets dropped no matter which layer understood it.

"Up to ₹20,000 a month" is the case that proved it. The model read the qualifier
correctly and had only two native slots to choose between: an exact amount it
would have had to invent, or nothing. It chose nothing, and put the qualifier in
a free-text note where no consumer could act on it.

This module is the missing middle. It represents *what a source states* —
including the qualifier — so that deciding what CreatorJobs can store is a
separate, later, auditable step.

Two distinctions carry most of the value:

**A qualifier is part of the fact.** ``maximum_only`` is not a range missing a
number; it is a different statement about the world, and converting it to
``exact`` claims something the employer did not say.

**Not finding something is not evidence that it is absent.** A parser that
returns nothing has reported on itself, not on the page. Conflating the two is
how a regex that could not read "20k" came to overrule a model that could.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Final, Literal

#: How precisely a source states a quantity.
#:
#: ``unknown`` exists so a detector can say "there is a fact here and I cannot
#: bound it" without that being mistaken for "there is no fact".
Qualifier = Literal[
    "exact",
    "minimum_only",
    "maximum_only",
    "range",
    "approximate",
    "negotiable",
    "unknown",
]

#: Whether a detector found a fact, found nothing, or found irreconcilable ones.
#:
#: The middle value is the one that matters. ``not_found`` must never be able to
#: displace a fact another layer did find.
DetectionState = Literal["found", "not_found", "conflict"]

#: How much weight a fact's origin carries, highest first.
#:
#: Ordered by *how directly the source states it*, deliberately not by whether a
#: regex or a model produced it. A page that prints "Compensation: ₹5,000/month"
#: under a label has settled its own pay more firmly than any interpretation of
#: prose — and an interpretation of clear prose, cited to a verified span, is
#: firmer than a heuristic that happened to match.
Authority = Literal[
    "recruiter",
    "labelled_source",
    "structured_source",
    "evidenced_interpretation",
    "heuristic",
]

#: Rank for comparison. Lower is stronger.
_AUTHORITY_RANK: Final[dict[str, int]] = {
    "recruiter": 0,
    "labelled_source": 1,
    "structured_source": 2,
    "evidenced_interpretation": 3,
    "heuristic": 4,
}


def authority_rank(authority: str) -> int:
    """Strength of an origin. Unknown origins sort weakest."""

    return _AUTHORITY_RANK.get(authority, max(_AUTHORITY_RANK.values()) + 1)


def outranks(challenger: str, incumbent: str) -> bool:
    """Whether a fact from ``challenger`` may replace one from ``incumbent``.

    Strictly stronger only. Equal authority is a disagreement to be surfaced,
    not a race for whichever arrived last — that race is what let markup saying
    INTERN beat a page's own "Part-time / Freelance".
    """

    return authority_rank(challenger) < authority_rank(incumbent)


@dataclass(frozen=True)
class Quantity:
    """A bounded quantity as a source states it.

    ``minimum`` and ``maximum`` are independently optional. That is the whole
    point: "up to ₹20,000" has a maximum and no minimum, and inventing a floor
    of zero would advertise a spread the employer never offered.
    """

    qualifier: Qualifier
    minimum: float | None = None
    maximum: float | None = None
    #: The period or measure — "per month", "years". Never guessed.
    unit: str | None = None
    #: Currency code for money; ``None`` for dimensionless quantities.
    currency: str | None = None
    #: The slice of source text this came from, for evidence.
    text: str = ""

    def __post_init__(self) -> None:
        if self.qualifier == "range" and (self.minimum is None or self.maximum is None):
            # A one-sided bound is minimum_only or maximum_only. Calling it a
            # range invites every consumer to look for the other end.
            raise ValueError("a range needs both ends; use minimum_only/maximum_only")
        if self.qualifier == "exact" and self.minimum is None:
            raise ValueError("an exact quantity needs a value")
        if (
            self.qualifier == "minimum_only"
            and (self.minimum is None or self.maximum is not None)
        ):
            raise ValueError("minimum_only carries a minimum and no maximum")
        if (
            self.qualifier == "maximum_only"
            and (self.maximum is None or self.minimum is not None)
        ):
            raise ValueError("maximum_only carries a maximum and no minimum")

    @property
    def states_a_figure(self) -> bool:
        """Whether the source named any number at all."""

        return self.minimum is not None or self.maximum is not None

    @property
    def is_complete_rate(self) -> bool:
        """Whether this is usable as pay without asking anything further.

        A figure with no period is not a rate — supplying one would understate
        an annual salary twelvefold — and a currency is what separates money
        from a count of videos.
        """

        return bool(self.states_a_figure and self.unit and self.currency)


@dataclass(frozen=True)
class Detection:
    """One detector's report about one field.

    Carries its own authority so reconciliation can compare evidence strength
    rather than implementation type.
    """

    state: DetectionState
    authority: Authority
    #: Present when ``state`` is ``found``.
    quantity: Quantity | None = None
    #: Present when ``state`` is ``conflict`` — two or more supported readings.
    alternatives: tuple[Quantity, ...] = ()
    #: Which detector spoke, for diagnostics. Never shown to a recruiter.
    detector: str = ""

    @property
    def found(self) -> bool:
        return self.state == "found" and self.quantity is not None

    @property
    def silent(self) -> bool:
        """A detector that reported nothing has said nothing about the page."""

        return self.state == "not_found"


def not_found(detector: str, authority: Authority = "heuristic") -> Detection:
    """A detector reporting on itself rather than on the page."""

    return Detection(state="not_found", authority=authority, detector=detector)


def found(
    quantity: Quantity, *, authority: Authority, detector: str = ""
) -> Detection:
    return Detection(
        state="found", authority=authority, quantity=quantity, detector=detector
    )


def reconcile(detections: tuple[Detection, ...]) -> Detection:
    """The reading that should win, given what each detector actually saw.

    The rules, in order:

    1. A detector that found nothing is ignored entirely. It has reported on its
       own coverage, not on the source, and a parser's blind spot is not
       evidence that a fact is absent. This is the rule whose absence let a
       regex that could not read "20k" erase a model that could.
    2. Among detectors that did find something, the strongest evidence wins.
    3. Equal-authority detectors that disagree produce a conflict rather than a
       winner, because choosing between two equally-supported readings of
       somebody's pay is not a machine's decision.
    """

    speaking = [detection for detection in detections if not detection.silent]
    if not speaking:
        return not_found("reconcile")

    conflicts = [detection for detection in speaking if detection.state == "conflict"]
    facts = [detection for detection in speaking if detection.found]
    if not facts:
        return conflicts[0]

    facts.sort(key=lambda detection: authority_rank(detection.authority))
    best = facts[0]
    rivals = [
        detection
        for detection in facts[1:]
        if authority_rank(detection.authority) == authority_rank(best.authority)
        and detection.quantity != best.quantity
    ]
    if rivals:
        return Detection(
            state="conflict",
            authority=best.authority,
            alternatives=tuple(
                detection.quantity
                for detection in [best, *rivals]
                if detection.quantity is not None
            ),
            detector="reconcile",
        )
    return best


def broaden_to(quantity: Quantity, qualifier: Qualifier) -> Quantity:
    """Restate a quantity less precisely, never more.

    Only ever used to make a fact *safer*. Narrowing is refused rather than
    clamped, so a caller cannot quietly turn a ceiling into a rate by asking.
    """

    if qualifier == quantity.qualifier:
        return quantity
    if qualifier == "unknown":
        return replace(quantity, qualifier="unknown")
    if quantity.qualifier == "range" and qualifier == "minimum_only":
        return Quantity(
            qualifier="minimum_only",
            minimum=quantity.minimum,
            unit=quantity.unit,
            currency=quantity.currency,
            text=quantity.text,
        )
    if quantity.qualifier == "range" and qualifier == "maximum_only":
        return Quantity(
            qualifier="maximum_only",
            maximum=quantity.maximum,
            unit=quantity.unit,
            currency=quantity.currency,
            text=quantity.text,
        )
    raise ValueError(f"{quantity.qualifier} cannot be restated as {qualifier}")
