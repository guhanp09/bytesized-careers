"""The language-neutral scenario manifest.

One generator produces these; two consumers read them — the backend QA restore
path and frontend Mock mode. Neither consumer owns any content, which is the
entire point: before this, a hand-written TypeScript fixture and a Python seed
script drifted apart because nothing forced them to agree.

Two rules shape everything here.

**No wall-clock time.** A manifest that embedded "2026-07-26T10:00:00Z" would
stop being byte-identical the moment it was regenerated, and its records would
read as a year stale by next summer. Every instant is therefore an integer
offset in seconds from the scenario anchor, and each consumer materialises real
ISO timestamps as `anchor + offset`. Negative is the past, positive the future,
so a scheduled interview stays in the future however long the manifest sits in
git.

**No preformatted labels.** The manifest carries `stage`, not "Under
consideration"; `payment_state`, not "Funded". Display wording belongs to the
projection layer both consumers already share, and duplicating it here would
create a third vocabulary to keep in step.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

#: Bump when the manifest shape changes incompatibly. Consumers must refuse a
#: version they do not understand rather than silently misreading fields — a
#: seed that half-loads is far harder to diagnose than one that fails outright.
MANIFEST_VERSION = 2

#: Namespace for every generated identifier. Fixed forever: changing it would
#: renumber every record in every manifest and destroy cross-run stability.
SCENARIO_NAMESPACE = uuid.UUID("6f2a1c94-8d3b-5e77-9a10-4c6e2b8f0d31")

ScenarioName = Literal["empty", "default", "busy", "edge", "talent", "recruiter"]

SCENARIO_NAMES: tuple[str, ...] = ("empty", "default", "busy", "edge", "talent", "recruiter")


def scenario_id(*parts: object) -> str:
    """A stable identifier for any entity, derived from what it *is*.

    Keyed by meaning rather than by position, so identifiers survive the
    generator emitting records in a different order, a pool gaining an entry, or
    a scenario growing. `scenario_id("application", "busy", 41)` is the same
    UUID today and after any amount of unrelated churn — which is what lets the
    scenario index, the parity tests and a bookmarked QA URL keep working.
    """

    key = "|".join(str(part) for part in parts)
    return str(uuid.uuid5(SCENARIO_NAMESPACE, key))


# --- canonical vocabularies -------------------------------------------------
#
# These mirror the backend's own enums. They are restated (not imported) so the
# manifest stays readable as data and a validation failure names the manifest's
# expectation rather than an import chain — but `validation.py` cross-checks
# them against the live backend constants so the two cannot drift.

APPLICATION_STAGES: tuple[str, ...] = (
    "new",
    "reviewing",
    "shortlisted",  # retired as a target; still real as history
    "interviewing",
    "hired",
    "rejected",
    "withdrawn",
    "archived",
)

#: Hiring requests are *not* applications. They have no interview stage and no
#: legacy Shortlisted — a request is accepted or declined. Getting this wrong is
#: how a manifest seeds a state the backend can never produce, so the vocabulary
#: is cross-checked against INTEREST_TRANSITIONS in validation.
INTEREST_STAGES: tuple[str, ...] = (
    "new",
    "reviewing",
    "accepted",
    "declined",
    "withdrawn",
    "archived",
)

ENGAGEMENT_STATES: tuple[str, ...] = (
    "ready_to_start",
    "start_pending",
    "active",
    "completion_pending",
    "completed",
    "ended_after_start",
    "cancelled_before_start",
)

PAYMENT_STATES: tuple[str, ...] = (
    "not_applicable",
    "setup_pending",
    "funding_pending",
    "funded",
    "work_in_progress",
    "release_requested",
    "released",
    "disputed",
    "refunded",
    "expired",
)

INTERVIEW_STATES: tuple[str, ...] = ("proposed", "confirmed", "completed", "cancelled")


@dataclass(slots=True)
class Actor:
    """A person. Recruiters and talent are the same kind of record."""

    id: str
    username: str
    display_name: str
    email: str
    #: "recruiter", "talent" or "both" — which sides this account operates.
    sides: list[str]
    avatar_url: str | None = None
    location: str | None = None
    headline: str | None = None
    #: Deliberately deactivated, for the edge scenario's dead-counterparty case.
    deactivated: bool = False
    #: Creator, agency, studio, brand, production_house — hiring identity kind.
    employer_kind: str | None = None
    channel_handle: str | None = None
    subscribers: int | None = None
    upload_cadence: str | None = None
    #: What this person charges, as a talent listing states it. The inbox's
    #: talent context card renders rate and experience beside the name, so a
    #: corpus without them leaves that card half-empty — which is what the
    #: retired hand-written fixture used to fill in.
    #: No unit field: `TalentListing` has no rate_unit column, and inventing one
    #: in the manifest would mean each consumer formatting a rate its own way —
    #: the duplication this phase removes. Both sides run `formatTalentRate`
    #: over exactly these three values.
    rate_min: float | None = None
    rate_max: float | None = None
    rate_currency: str | None = None
    #: Whole years, never a range or a level label: the product's talent
    #: experience is an exact number and the card must not show "Senior".
    experience_years: int | None = None
    availability: str | None = None

    # --- profile projection -------------------------------------------------
    #
    # Every field below is already storable by the backend and already exposed
    # by `PublicProfileResponse`. None of this is a second representation: the
    # scenario schema simply had no way to *carry* the profile, so a canonical
    # applicant resolved to an empty page.
    #
    # The names are the *product's*, not any one store's, because two consumers
    # read this file and they disagree. The backend splits talent from recruiter
    # (`creator_platforms` vs `hiring_platforms`, a content-style row vs
    # `hiring_niches`) and flattens `tools` to one line; the manifest keeps a
    # single vocabulary and lets each consumer decide from `sides`. Restore is
    # therefore a deliberate translation — see `restore.py` — and the comments
    # below name the column each field ends up in.
    #
    #: `User.bio` — who this person is, in their own words.
    bio: str | None = None
    #: `User.timezone` — IANA name, the same form the profile editor writes.
    timezone: str | None = None
    #: `User.availability_status` — "available" | "selective" | "unavailable".
    #: Distinct from `availability`, which is the free-text sentence beside it.
    availability_status: str | None = None
    #: `User.skills` — what they do, as the profile lists it.
    skills: list[str] = field(default_factory=list)
    #: `User.collaboration_tools` — the stack they actually work in.
    tools: list[str] = field(default_factory=list)
    #: `User.public_links` — profile links, never fabricated URLs that 404 by
    #: accident; the invalid TLD is deliberate and uniform.
    public_links: list[str] = field(default_factory=list)
    #: The role catalogue entries this person claims. First is primary. These
    #: are catalogue *rows* on the backend (`UserRole` → `Role`), so restore
    #: does not create them; the Mock profile renders them by name.
    roles: list[str] = field(default_factory=list)
    #: Talent → `User.creator_platforms`; recruiter → `User.hiring_platforms`.
    platforms: list[str] = field(default_factory=list)
    #: Talent → `UserContentStyle.format`; recruiter → `User.hiring_formats`.
    formats: list[str] = field(default_factory=list)
    #: Talent → `UserContentStyle.primary_niche` (first only); recruiter →
    #: `User.hiring_niches`.
    niches: list[str] = field(default_factory=list)
    #: Languages they work in. Carried for the Mock profile and the frontend
    #: adapter; the backend `User` row has no column for them, so restore drops
    #: them rather than inventing a home — recorded in the parity contract.
    languages: list[str] = field(default_factory=list)
    #: `User.collaboration_turnaround` — how fast, in their own words.
    turnaround: str | None = None
    #: `User.collaboration_working_hours`.
    working_hours: str | None = None
    #: `User.work_mode` — Remote | Hybrid | On-site.
    work_mode: str | None = None
    #: `User.hiring_channels_or_pages_managed` — what kind of hiring account
    #: this is, so an organisation can be opened and understood rather than
    #: being a name and a logo. Distinct from `bio`, which is about the channel.
    description: str | None = None
    #: Rounded audience band for a hiring identity ("250K–500K subscribers"),
    #: derived from `subscribers` rather than asserted beside it. Display-only:
    #: no backend column, so it is Mock-side and recorded in the parity contract.
    audience_band: str | None = None
    #: `User.hiring_verification_status` — "verified" | "unverified".
    verification_status: str | None = None


@dataclass(slots=True)
class PortfolioItem:
    id: str
    owner_id: str
    title: str
    media: str  # video | image | audio | link
    url: str | None = None
    thumbnail_url: str | None = None
    #: Seconds. Consumers format it; the manifest never stores "12:04".
    duration_seconds: int | None = None
    platform: str | None = None
    format: str | None = None
    niche: str | None = None
    role: str | None = None
    #: Marks a URL that is meant to fail loading, for fallback QA. The consumer
    #: still receives a real thumbnail_url — the point is that it 404s.
    thumbnail_broken: bool = False
    #: `PortfolioItem.description` — what the piece is. A portfolio strip of
    #: titles alone is a list of filenames; the description is the part a
    #: recruiter actually reads before deciding to open something.
    description: str | None = None
    #: `PortfolioItem.what_i_did` — the contribution, separate from the piece.
    #: Two editors can list the same video and have done different work on it.
    contribution: str | None = None
    #: `PortfolioItem.tools` — the stack this particular piece was made in.
    tools: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Job:
    id: str
    owner_id: str
    title: str
    platforms: list[str]
    formats: list[str]
    niches: list[str]
    turnaround_value: int | None
    turnaround_unit: str | None
    turnaround_basis: str | None
    compensation_mode: str | None
    compensation_min: float | None
    compensation_max: float | None
    compensation_currency: str | None
    compensation_unit: str | None
    location: str
    work_mode: str
    experience: str | None = None
    status: str = "published"
    #: Seconds before the anchor.
    posted_offset: int = -86_400
    trial_status: str | None = None
    trial_amount: float | None = None
    trial_currency: str | None = None
    tags: list[str] = field(default_factory=list)
    #: The recruiter's private screening prompts. Authored, never inferred — the
    #: import provider is explicitly forbidden from producing them.
    screening_questions: list[dict[str, Any]] = field(default_factory=list)
    #: Retired canonical job ids reused rather than reinvented (job_25, job_26).
    legacy_key: str | None = None


@dataclass(slots=True)
class Message:
    id: str
    conversation_id: str
    sender_id: str | None  # None = platform/system event
    body: str
    offset_seconds: int
    kind: str = "text"  # text | status | screening_questions | screening_answers
    read: bool = True
    #: Curated structured payload for the message kinds the Inbox renders
    #: natively — the screening question snapshot, and the answers to it.
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Interview:
    id: str
    relationship_id: str
    state: str
    #: Positive for an interview still ahead, negative once it has passed.
    scheduled_offset: int
    method: str = "video_call"
    detail: str | None = None
    note: str | None = None


@dataclass(slots=True)
class Engagement:
    id: str
    relationship_id: str
    state: str
    #: Null means nothing has been asserted about payment — which is not the
    #: same claim as "not_applicable", and the two are seeded separately.
    payment_state: str | None = None
    payment_note: str | None = None
    payment_offset: int | None = None
    started_offset: int | None = None
    completed_offset: int | None = None


@dataclass(slots=True)
class Relationship:
    """An application or a hiring request — the two directions of one shape."""

    id: str
    #: "application" (talent -> job) or "hiring_request" (recruiter -> talent).
    kind: str
    job_id: str | None
    recruiter_id: str
    talent_id: str
    #: Backend canonical stage. Never a display label.
    stage: str
    #: What the counterparty has been told. Diverges from `stage` on purpose:
    #: a private decision is exactly a stage the other side has not been given.
    participant_stage: str | None
    created_offset: int
    updated_offset: int
    conversation_id: str | None = None
    messages: list[Message] = field(default_factory=list)
    portfolio_ids: list[str] = field(default_factory=list)
    cover_note: str | None = None
    answers: dict[str, Any] = field(default_factory=dict)
    #: Manager-private organisation. Never visible to the counterparty.
    starred: bool = False
    snoozed_offset: int | None = None
    manager_note: str | None = None
    archived: bool = False
    unread: int = 0
    interview: Interview | None = None
    engagement: Engagement | None = None
    #: Marks a record that exists to exercise a legacy or contradictory state
    #: rather than one the current transition rules could produce.
    historical: str | None = None


@dataclass(slots=True)
class ClientState:
    """Conditions that are not database facts.

    An unsent draft, a failed send, an image chosen to 404 — these live in the
    browser, not in a table. Keeping them in their own section stops anyone
    inventing a column for them and stops parity tests comparing a transient UI
    condition against a row that was never supposed to hold one.
    """

    id: str
    relationship_id: str
    kind: str  # draft | send_failed | broken_image | mobile_only
    body: str | None = None
    note: str | None = None


@dataclass(slots=True)
class IndexEntry:
    """One row of the machine-readable scenario index.

    Written so Phase 5 can assemble SCENARIOS.md without reading hundreds of
    records to find the one that demonstrates a disputed payment.
    """

    scenario: str
    persona: str
    route: str
    job_id: str | None
    relationship_id: str
    conversation_id: str | None
    expected_stage: str
    expected_condition: str
    action_to_test: str


@dataclass(slots=True)
class Manifest:
    version: int
    scenario: str
    #: The seed that produced this file. Regenerating with it must reproduce it.
    seed: int
    description: str
    actors: list[Actor] = field(default_factory=list)
    jobs: list[Job] = field(default_factory=list)
    portfolio: list[PortfolioItem] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)
    client_state: list[ClientState] = field(default_factory=list)
    index: list[IndexEntry] = field(default_factory=list)
    #: Free-form counts and coverage markers, asserted by the coverage tests.
    stats: dict[str, Any] = field(default_factory=dict)
