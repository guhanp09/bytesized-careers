"""The checkpointed conversation loop.

The rule the whole design turns on: **the provider is never called while a
question is open.** Reaching ``waiting_for_recruiter`` stops the workflow, and
the only thing that restarts it is a valid recruiter answer or an explicit
recruiter action. Polling, refresh, reopening and abandonment all resolve to
"read the stored state and render it" — none of them can start work.

A second, quieter economy: most answers need no provider call at all. Applying
"there is no trial" or "applications come through CreatorJobs" is deterministic,
so the loop resolves them locally and only spends a continuation when an answer
genuinely changes how the source must be read. ``answer()`` therefore causes *at
most* one continuation, usually zero.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID, uuid4

from app.core.job_import_answer_effects import (
    AnswerSuggestion,
    effects_for_answer,
    pay_range_from_conflict,
    suppressed_by_answers,
)
from app.core.job_import_answer_shapes import (
    answer_shape_for,
    conversation_answer_errors,
    matching_choices,
    native_schema_constraints,
)
from app.core.job_import_conversation import (
    MAX_PROVIDER_CONTINUATIONS,
    ConversationState,
    assert_transition,
    is_waiting,
    may_start_provider_stage,
    resume_state_for,
)
from app.core.job_import_location_resolution import city_for_location, resolve_locations
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_questions import (
    ESSENTIAL_CONVERSATION_FIELDS,
    ProposedQuestion,
    QueueCandidate,
    assistant_preparation_complete,
    deterministic_question_queue,
    essential_work_remains,
    suppressed_by_stated_pay,
    validate_proposed_question,
)
from app.core.job_import_title_signals import title_signals
from app.models import JobImportDraft
from app.services.job_import_service import JobImportError, JobImportService


@dataclass(frozen=True)
class ConversationSnapshot:
    """Everything the client needs to render the conversation, and nothing more."""

    state: ConversationState
    active_question: dict[str, Any] | None
    recruiter_context_version: int
    continuation_count: int
    #: True when the workflow is stopped on a person and nothing is running.
    waiting: bool
    #: True once the assistant has finished the conversation it started.
    #:
    #: Deliberately *not* the same as "a native draft could exist". A private
    #: draft can exist almost from the start; that says nothing about whether
    #: the assistant still has questions open.
    ready_for_draft: bool
    #: Which half of the conversation is running: the questions the assistant
    #: needs, or the improvements it is merely offering.
    phase: str
    #: Essential questions still to answer. Optional ones are not counted —
    #: they never block, so counting them would overstate the work left.
    essential_remaining: int
    #: True when the recruiter has taken the manual route out.
    manual_continuation: bool


#: Marker stored on the draft when the recruiter chooses manual editing.
#: It is the one normal route that may hand off with questions still open.
_MANUAL_CONTINUATION = "manual_continuation"


class JobImportConversationService:
    """Drives one import draft through the checkpointed loop."""

    def __init__(self, import_service: JobImportService) -> None:
        self.import_service = import_service

    @staticmethod
    def _require_successful_processing(draft: JobImportDraft) -> None:
        if draft.processing_status == "processing_failed":
            raise JobImportError(
                "JOB_IMPORT_INVALID_TRANSITION",
                "Draft preparation must be retried before continuing the conversation.",
                status_code=409,
            )

    @staticmethod
    def _effective_answer_errors(
        values: dict[str, object], *, changed_fields: frozenset[str]
    ) -> list[str]:
        """Validate relationships only visible in the merged draft.

        Per-field validation cannot know that a range ceiling is below its
        floor, or that a fixed engagement ends before it starts. Recruiter
        answers, confirmed extraction, and grouped answers are merged first so
        whichever side is answered second cannot create an impossible pair.
        Unrelated answers are not blocked by an old unresolved pair elsewhere.
        """

        errors: list[str] = []
        if changed_fields & {"compensation_mode", "budget_amount", "budget_max"}:
            amount = values.get("budget_amount")
            maximum = values.get("budget_max")
            if amount is not None and maximum is not None:
                try:
                    if Decimal(str(maximum)) < Decimal(str(amount)):
                        errors.append(
                            "Maximum compensation must be greater than or equal "
                            "to minimum compensation."
                        )
                except (InvalidOperation, TypeError, ValueError):
                    # Canonical field validation owns malformed individual values.
                    pass

        if changed_fields & {
            "expected_weekly_hours_min",
            "expected_weekly_hours_max",
        }:
            minimum = values.get("expected_weekly_hours_min")
            maximum = values.get("expected_weekly_hours_max")
            if maximum is not None and minimum is None:
                errors.append(
                    "Add minimum weekly hours before setting a maximum."
                )
            elif minimum is not None and maximum is not None:
                try:
                    if Decimal(str(maximum)) < Decimal(str(minimum)):
                        errors.append(
                            "Maximum weekly hours must be greater than or equal "
                            "to minimum weekly hours."
                        )
                except (InvalidOperation, TypeError, ValueError):
                    # Canonical field validation owns malformed individual values.
                    pass

        if changed_fields & {
            "start_timing",
            "start_date",
            "duration_type",
            "engagement_end_date",
        }:
            parsed: dict[str, date] = {}
            for path in ("start_date", "engagement_end_date"):
                candidate = values.get(path)
                try:
                    if isinstance(candidate, datetime):
                        parsed[path] = candidate.date()
                    elif isinstance(candidate, date):
                        parsed[path] = candidate
                    elif isinstance(candidate, str):
                        parsed[path] = date.fromisoformat(candidate)
                except ValueError:
                    # Canonical field validation owns malformed individual values.
                    continue
            if (
                "start_date" in parsed
                and "engagement_end_date" in parsed
                and parsed["engagement_end_date"] <= parsed["start_date"]
            ):
                errors.append("The engagement end date must be after its start date.")
        return errors

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    async def snapshot(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Read the conversation without touching it.

        Every passive surface — polling, refresh, reopening a tab — goes through
        here. It performs no transition and starts no work, which is what makes
        those actions provably free.
        """

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        return self._snapshot_of(draft, await self._queue_for(draft))

    @staticmethod
    def _safe_active_question(value: object) -> dict[str, Any] | None:
        """Never expose a conflict control with fewer than two real choices.

        Active questions are checkpointed. Fixing the builder alone would leave
        an older one-option question broken forever on refresh, so reads apply
        the same cardinality invariant without mutating or discarding the saved
        checkpoint.
        """

        if not isinstance(value, dict):
            return None
        question = dict(value)
        if question.get("reason") not in {
            "MISSING_IMPORTANT_BUSINESS_DECISION",
            "GENUINE_AMBIGUITY",
            "UNRESOLVED_SOURCE_CONFLICT",
            "OPTIONAL_HIGH_VALUE_REFINEMENT",
        }:
            question["reason"] = (
                "UNRESOLVED_SOURCE_CONFLICT"
                if isinstance(question.get("alternatives"), list)
                and len(question["alternatives"]) >= 2
                else "OPTIONAL_HIGH_VALUE_REFINEMENT"
                if question.get("kind") == "optional"
                else "GENUINE_AMBIGUITY"
                if "suggested_value" in question or "recommended_value" in question
                else "MISSING_IMPORTANT_BUSINESS_DECISION"
            )
        raw_alternatives = question.get("alternatives")
        if not isinstance(raw_alternatives, list):
            return question

        alternatives: list[dict[str, Any]] = []
        for item in raw_alternatives:
            if not isinstance(item, dict) or "value" not in item:
                continue
            if any(
                existing.get("value") == item.get("value")
                for existing in alternatives
            ):
                continue
            alternatives.append(item)
        if len(alternatives) >= 2:
            question["alternatives"] = alternatives
        else:
            question.pop("alternatives", None)
        return question

    @staticmethod
    def _snapshot_of(
        draft: JobImportDraft, queue: list[QueueCandidate] | None = None
    ) -> ConversationSnapshot:
        state: ConversationState = (
            draft.conversation_state or "source_received"
        )  # type: ignore[assignment]
        question = JobImportConversationService._safe_active_question(
            draft.active_question
        )
        manual = (draft.last_completed_stage or "") == _MANUAL_CONTINUATION
        remaining = (
            len([item for item in queue if item.kind != "optional"])
            if queue is not None
            else (1 if question and question.get("kind") != "optional" else 0)
        )
        phase = (
            "complete"
            if state in {"ready_for_native_draft", "converted"} or manual
            else "optional"
            if state == "optional_improvements"
            else "essential"
        )
        return ConversationSnapshot(
            state=state,
            active_question=question,
            recruiter_context_version=draft.recruiter_context_version or 0,
            continuation_count=draft.continuation_count or 0,
            waiting=is_waiting(state),
            # Completion is the assistant's own rule, not native creatability.
            ready_for_draft=state in {"ready_for_native_draft", "converted"} or manual,
            phase=phase,
            essential_remaining=remaining,
            manual_continuation=manual,
        )

    async def resume(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Bring a returning recruiter back to exactly where they left.

        Explicitly does not run a provider stage. Reopening a page is not an
        instruction to spend money.
        """

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        current: ConversationState | None = draft.conversation_state  # type: ignore[assignment]
        restored = resume_state_for(current)
        if restored != current:
            await self._store(draft, {"conversation_state": restored})
        return self._snapshot_of(draft)

    async def mark_abandoned(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Record that the recruiter stepped away. Never destructive."""

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        current: ConversationState | None = draft.conversation_state  # type: ignore[assignment]
        if current in {"converted", "abandoned", None}:
            return self._snapshot_of(draft)
        # The active question is kept exactly as-is so returning restores it.
        await self._store(draft, {"conversation_state": "abandoned"})
        return self._snapshot_of(draft)

    # ------------------------------------------------------------------
    # Answering
    # ------------------------------------------------------------------

    async def answer_active_question(
        self,
        draft_id: UUID,
        field_path: str,
        value: object,
        *,
        owner_user_id: UUID,
        expected_context_version: int | None = None,
    ) -> ConversationSnapshot:
        """Accept the answer to the open question and take one step forward.

        Idempotency and staleness are handled by ``expected_context_version``: a
        second submission of the same answer carries a version that has already
        been superseded, so it is accepted as a no-op rather than advancing the
        workflow twice.
        """

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        self._require_successful_processing(draft)
        snapshot = self._snapshot_of(draft)

        if (
            expected_context_version is not None
            and expected_context_version != snapshot.recruiter_context_version
        ):
            # A duplicate or late submission. The answer already landed; saying
            # so is honest and, critically, starts no new work.
            return snapshot

        # A click can land a moment after the conversation moved on — the poll
        # refreshes on a timer, so the button the recruiter pressed may already
        # be one step behind. Versioned clients receive the idempotent no-op
        # above. An unversioned direct caller, however, may answer only the turn
        # actually on screen; otherwise it could silently populate arbitrary
        # fields and manufacture completion.
        active_path = (
            snapshot.active_question.get("field_path")
            if snapshot.active_question
            else None
        )
        if active_path != field_path:
            already_answered = field_path in self._stored_answers(draft)
            if already_answered:
                # Genuinely settled, so the click was a duplicate. Report the
                # current state rather than an error about it.
                return snapshot
            raise JobImportError(
                "JOB_IMPORT_QUESTION_MISMATCH",
                "Answer the question currently shown before continuing.",
                status_code=409,
                details={"active_field_path": active_path},
            )

        policy = JOB_IMPORT_FIELD_POLICIES.get(field_path)
        if policy is None:
            raise JobImportError(
                "JOB_IMPORT_UNSUPPORTED_FIELD",
                "That detail cannot be answered here.",
                status_code=422,
            )
        # A yes/no control sends the word it displayed. Translating it back here
        # keeps the control honest — the alternative is offering two buttons and
        # then rejecting whichever one is pressed.
        if answer_shape_for(field_path).choices == ["yes", "no"] and isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"yes", "no"}:
                value = lowered == "yes"

        grouped_extras = self._grouped_side_effects(
            draft.active_question if isinstance(draft.active_question, dict) else None,
            value,
        )

        normalized, errors = await self.import_service._validate_field_value(policy, value)
        errors.extend(conversation_answer_errors(field_path, normalized))
        if errors:
            raise JobImportError(
                "JOB_IMPORT_FIELD_INVALID",
                "That answer is not valid for this detail.",
                details={"errors": errors},
            )

        # Validate grouped values before writing anything. A failed range must
        # leave the entire checkpoint unchanged rather than persisting its first
        # half and rejecting the second.
        normalized_extras: dict[str, object] = {}
        for extra_path, extra_value in grouped_extras.items():
            extra_policy = JOB_IMPORT_FIELD_POLICIES.get(extra_path)
            if extra_policy is None:
                continue
            extra_normalized, extra_errors = (
                await self.import_service._validate_field_value(
                    extra_policy, extra_value
                )
            )
            extra_errors.extend(
                conversation_answer_errors(extra_path, extra_normalized)
            )
            if extra_errors:
                continue
            normalized_extras[extra_path] = extra_normalized

        effective_values = await self._effective_values(draft)
        effective_values[field_path] = normalized
        effective_values.update(normalized_extras)
        relationship_errors = self._effective_answer_errors(
            effective_values,
            changed_fields=frozenset({field_path, *normalized_extras}),
        )
        if relationship_errors:
            raise JobImportError(
                "JOB_IMPORT_FIELD_INVALID",
                "That answer is not valid for this detail.",
                details={"errors": relationship_errors},
            )

        answers = self._stored_answers(draft)
        answers[field_path] = normalized

        # Conversion reads field rows, so the answer has to become one.
        await self._persist_answer(draft, field_path, normalized)

        # One choice, both fields. Every value and their merged relationship was
        # validated before the primary answer was persisted.
        for extra_path, extra_normalized in normalized_extras.items():
            answers[extra_path] = extra_normalized
            await self._persist_answer(draft, extra_path, extra_normalized)

        # The answer is authoritative from this moment. Bumping the version is
        # what makes any provider result issued before now provably stale.
        await self._store(
            draft,
            {
                "recruiter_prefill": answers,
                "recruiter_prefill_updated_at": datetime.now(UTC),
                "recruiter_context_version": (draft.recruiter_context_version or 0) + 1,
                "conversation_state": assert_transition(
                    draft.conversation_state, "resuming"  # type: ignore[arg-type]
                ),
                "active_question": None,
            },
        )

        return await self._advance(draft, owner_user_id=owner_user_id)

    async def dismiss_active_question(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Skip an optional suggestion without answering it.

        Recorded so it cannot reappear this session, and deliberately free: a
        skip is not a reason to call the provider.
        """

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        snapshot = self._snapshot_of(draft)
        if snapshot.active_question is None:
            return snapshot
        if snapshot.active_question.get("kind") != "optional":
            raise JobImportError(
                "JOB_IMPORT_QUESTION_NOT_SKIPPABLE",
                "This detail is needed before the draft can be prepared.",
                status_code=409,
            )

        dismissed = list(self._dismissed(draft))
        path = str(snapshot.active_question.get("field_path") or "")
        if path and path not in dismissed:
            dismissed.append(path)
        await self._store(
            draft, {"dismissed_suggestions": dismissed, "active_question": None}
        )
        return await self._advance(draft, owner_user_id=owner_user_id)

    async def skip_remaining_suggestions(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Wave off every remaining optional improvement at once."""

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        queue = await self._queue_for(draft)
        dismissed = list(self._dismissed(draft))
        for candidate in queue:
            if candidate.kind == "optional" and candidate.field_path not in dismissed:
                dismissed.append(candidate.field_path)
        await self._store(
            draft, {"dismissed_suggestions": dismissed, "active_question": None}
        )
        return await self._advance(draft, owner_user_id=owner_user_id)

    async def continue_manually(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """The recruiter chose to finish in the ordinary editor.

        Everything answered so far is kept, the conversation stops, and the
        remaining questions simply become ordinary empty draft fields. This is
        the only normal route that hands off with questions still open.
        """

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        await self._store(
            draft,
            {
                "conversation_state": "ready_for_native_draft",
                "active_question": None,
                "last_completed_stage": _MANUAL_CONTINUATION,
            },
        )
        return self._snapshot_of(draft, [])

    # ------------------------------------------------------------------
    # The loop
    # ------------------------------------------------------------------

    async def _resolve_compensation_mode(self, draft: JobImportDraft) -> bool:
        """A stated figure already says how the role is paid.

        A page reading "Stipend: 15,000 per month" has answered "how is this
        role paid?" — the amount and the unit are both there. Asking anyway is
        the clearest possible way to look like the assistant did not read the
        post it was given.

        One figure is a fixed rate; two are a range. Nothing is invented: this
        only names a mode the numbers already imply, and it never runs when the
        recruiter or the source has settled the mode themselves.
        """

        answers = self._stored_answers(draft)
        if "compensation_mode" in answers:
            return False

        fields = await self.import_service.repository.list_fields(draft.id)
        by_path = {item.field_path: item for item in fields}

        mode = by_path.get("compensation_mode")
        if mode is not None and mode.provenance_state != "missing":
            return False

        def known(path: str) -> bool:
            field = by_path.get(path)
            if path in answers:
                return True
            return field is not None and field.provenance_state not in {
                "missing",
                "conflicting_source_values",
            }

        if not known("budget_amount"):
            return False
        implied = "range" if known("budget_max") else "fixed"

        policy = JOB_IMPORT_FIELD_POLICIES["compensation_mode"]
        normalized, errors = await self.import_service._validate_field_value(policy, implied)
        if errors:
            return False

        amount = by_path.get("budget_amount")
        payload = {
            "provenance_state": "extracted_from_source",
            "proposed_value": normalized,
            "confirmed_value": normalized,
            "review_status": "confirmed",
            "requires_confirmation": False,
            "validation_errors": [],
            "explanation": "The post states a pay figure, which sets how the role is paid.",
            "evidence": list(amount.evidence or []) if amount is not None else [],
            "conflicting_values": [],
        }
        if mode is not None:
            await self.import_service.repository.update_field(mode, payload)
        else:
            await self.import_service.repository.create_fields(
                [
                    {
                        "draft_id": draft.id,
                        "field_path": "compensation_mode",
                        "provider_confidence": None,
                        "missing_requirement": policy.missing_requirement,
                        "edited_value": None,
                        **payload,
                    }
                ]
            )
        return True

    async def _resolve_pay_range(self, draft: JobImportDraft) -> bool:
        """Settle a two-figure pay conflict as a range instead of asking.

        Both numbers came from the recruiter's own post, so a band spanning them
        discards nothing and is shown in the editor for them to keep or change.
        Returns True when something was resolved, so the caller rebuilds the
        queue without the question.
        """

        answers = self._stored_answers(draft)
        if any(path in answers for path in ("budget_amount", "budget_max")):
            return False

        fields = await self.import_service.repository.list_fields(draft.id)
        conflict = next(
            (
                field
                for field in fields
                if field.field_path == "budget_amount"
                and field.provenance_state == "conflicting_source_values"
                and field.review_status == "pending"
            ),
            None,
        )
        if conflict is None or not conflict.conflicting_values:
            return False

        resolved = pay_range_from_conflict(
            [item.get("value") for item in conflict.conflicting_values if isinstance(item, dict)]
        )
        if resolved is None:
            return False

        for path, value in resolved.items():
            await self._persist_answer(draft, path, value)
        await self._store(
            draft,
            {
                "recruiter_prefill": {**answers, **resolved},
                "recruiter_prefill_updated_at": datetime.now(UTC),
            },
        )
        return True

    @staticmethod
    def _conflicting_values(field: Any) -> list[object]:
        """The values a contradicted field is actually torn between."""

        raw = field.conflicting_values or []
        values: list[object] = []
        for entry in raw:
            if isinstance(entry, dict) and "value" in entry:
                values.append(entry["value"])
            else:
                values.append(entry)
        return values

    async def _apply_title_signals(
        self, draft: JobImportDraft, *, owner_user_id: UUID
    ) -> bool:
        """Stop asking for what the title already says.

        "…intern - 6 months onsite" states the engagement, the duration and the
        work mode in its own headline. Asking the recruiter for those is the
        clearest way to look like a scraper: the answer was in the first line of
        what they handed over.

        Only settled signals are applied. They remain machine interpretations:
        unlike a recruiter reply, they never enter recruiter_prefill and never
        receive a reviewed_by_user marker.
        """

        answers = self._stored_answers(draft)
        fields = await self.import_service.repository.list_fields(draft.id)
        by_path = {item.field_path: item for item in fields}

        title = next(
            (
                item.proposed_value
                for item in fields
                if item.field_path == "title" and isinstance(item.proposed_value, str)
            ),
            None,
        ) or (answers.get("title") if isinstance(answers.get("title"), str) else None)

        # Settled inferences use title evidence only. Body text can mention a
        # remote team, a six-month project, or another craft without describing
        # this role's actual terms.
        signals = title_signals(title)
        # Never override the source, and never re-decide something answered.
        fresh: dict[str, object] = {}
        for path, value in signals.settled.items():
            if path in answers:
                continue
            existing = by_path.get(path)
            # Whole-job reconciliation can establish that an otherwise valid
            # catalog title belongs to a different occupation: for example an
            # office-operations Community Manager rather than an audience
            # manager.  Preserve that contextual exclusion here instead of
            # weakening the shared title catalog, which must still recognize
            # the seeded role when the title is all the evidence available.
            if (
                path == "primary_role_key"
                and existing is not None
                and existing.provenance_state == "missing"
                and existing.explanation
                == "The source title does not establish a supported creator role."
            ):
                continue
            if existing is None or existing.provenance_state == "missing":
                fresh[path] = value
                continue
            # Upgrade the same pending semantic suggestion when the exact title
            # settles it. Never overwrite explicit source wording or a different
            # machine interpretation.
            if (
                existing.provenance_state == "suggested_inference"
                and existing.reviewed_by_user_id is None
            ):
                # A guess nobody confirmed yields to what the title says outright.
                #
                # The status matters less than who set it: an inference may be
                # auto-confirmed by the pipeline, which is not the same as a
                # recruiter agreeing to it. Only a row an actual person reviewed
                # is safe from this, and that case is caught by the answers check
                # above.
                #
                # A page titled "...Intern 6 months onsite" whose structured data
                # claims FULL_TIME is not ambiguous — boards default that field,
                # and the headline is the posting's own words. Leaving the guess
                # in place shipped a draft that called an internship a full-time
                # job, which is worse than any question: nobody is asked to check
                # a value that looks settled.
                fresh[path] = value
                continue
            # Some job boards stamp every listing ``FULL_TIME`` in JSON-LD,
            # including postings whose own title says ``Intern`` or
            # ``Freelance``.  That syndication default is a real source claim,
            # but it is weaker than the employer's role-defining headline for
            # the engagement structure.  A live Social Media Intern otherwise
            # became a full-time role without a question.  Keep this exception
            # narrow: only an exact title engagement may replace an untouched
            # machine reading, and any recruiter-owned decision still wins via
            # the answers/reviewer guards above.
            if (
                path == "engagement_type"
                and existing.provenance_state == "extracted_from_source"
                and existing.reviewed_by_user_id is None
                and (existing.confirmed_value or existing.proposed_value) != value
            ):
                fresh[path] = value
                continue
            # Resolve a contradiction the title already decides.
            #
            # Job boards mislabel their own structured data. A real listing
            # titled "...Intern 6 months onsite", whose body is headed
            # "Internship Details", published employmentType FULL_TIME — so the
            # page disagreed with itself and the recruiter was asked to settle
            # something their title had already said twice.
            #
            # Only when the title's value is one of the values actually in
            # dispute: this breaks a tie between readings of the source, it
            # never introduces a third answer of its own.
            if (
                existing.provenance_state == "conflicting_source_values"
                and existing.review_status == "pending"
                and value in self._conflicting_values(existing)
            ):
                fresh[path] = value
        if not fresh:
            return False

        for path, value in fresh.items():
            policy = JOB_IMPORT_FIELD_POLICIES[path]
            normalized, errors = await self.import_service._validate_field_value(policy, value)
            if errors:
                continue
            existing = by_path.get(path)
            title_field = by_path.get("title")
            row = {
                "proposed_value": normalized,
                "provenance_state": "suggested_inference",
                "evidence": list(title_field.evidence or []) if title_field is not None else [],
                "conflicting_values": [],
                "explanation": "Interpreted from exact wording in the job title.",
                "provider_confidence": {
                    "origin": "contextual_inference",
                    "confidence": "high",
                    "rationale_code": "exact_title_signal",
                    "epistemic_state": "logically_entailed",
                    "inference_type": "exact_title_signal",
                    "needs_review": False,
                    "risk": policy.inference_risk,
                },
                "review_status": "confirmed",
                "confirmed_value": normalized,
                "edited_value": None,
                "missing_requirement": policy.missing_requirement,
                "requires_confirmation": False,
                "validation_errors": [],
                "reviewed_by_user_id": None,
                "reviewed_at": None,
            }
            if existing is not None:
                await self.import_service.repository.update_field(existing, row)
            else:
                await self.import_service.repository.create_fields(
                    [{"draft_id": draft.id, "field_path": path, **row}]
                )
        await self.import_service._refresh_draft_state(
            draft, owner_user_id=owner_user_id
        )
        await self.import_service.repository.session.commit()
        return True

    async def _title_role_options(self, draft: JobImportDraft) -> list[str]:
        """The crafts the title names, when it names more than one."""

        fields = await self.import_service.repository.list_fields(draft.id)
        title = next(
            (
                item.proposed_value
                for item in fields
                if item.field_path == "title" and isinstance(item.proposed_value, str)
            ),
            None,
        )
        options = title_signals(title).suggested.get("primary_role_key_options")
        return list(options) if isinstance(options, list) else []

    async def _title_suggestions(self, draft: JobImportDraft) -> dict[str, object]:
        """Values the source hints at without stating outright."""

        fields = await self.import_service.repository.list_fields(draft.id)
        title = next(
            (
                item.proposed_value
                for item in fields
                if item.field_path == "title" and isinstance(item.proposed_value, str)
            ),
            None,
        )
        return dict(title_signals(title).suggested)

    async def _advance(
        self,
        draft: JobImportDraft,
        *,
        owner_user_id: UUID,
        provider_question: ProposedQuestion | None = None,
    ) -> ConversationSnapshot:
        """Take exactly one step: ask the next question, or declare readiness.

        No provider call happens here. Deterministic application of an answer is
        the common case and costs nothing; a provider continuation is a separate,
        explicitly gated step.
        """

        # Read the title before deciding what to ask; anything it settles is
        # not a question.
        await self._apply_title_signals(draft, owner_user_id=owner_user_id)
        await self._resolve_pay_range(draft)
        await self._resolve_compensation_mode(draft)
        # Conversation answers write the same field rows as the ordinary review
        # workspace, so they must refresh the same draft-level readiness cache.
        # Do this after every deterministic consequence has landed (rather than
        # only after the directly answered row) so the answer response, a
        # subsequent GET, and an immediate native-draft application all observe
        # one coherent state.  The final checkpoint store below commits both the
        # refresh and the next conversation state together.
        await self.import_service._refresh_draft_state(
            draft, owner_user_id=owner_user_id
        )
        queue = await self._queue_for(draft)
        candidate = queue[0] if queue else None

        # A provider proposal is only preferred when the server agrees it is
        # askable; otherwise the deterministic queue takes over silently.
        if provider_question is not None:
            validation = await self._validate_provider_question(
                draft, provider_question, queue=queue
            )
            if validation.ok and validation.accepted is not None:
                candidate = QueueCandidate(
                    validation.accepted.field_path,
                    validation.accepted.kind,
                    -1,
                )

        if candidate is None:
            # Nothing essential and nothing worth suggesting: the assistant is
            # genuinely done. A clean import reaches here immediately, which is
            # exactly the point — no questions are manufactured for it.
            assert assistant_preparation_complete(queue)
            await self._store(
                draft,
                {
                    "conversation_state": "ready_for_native_draft",
                    "active_question": None,
                    "last_completed_stage": "questions_complete",
                },
            )
            return self._snapshot_of(draft, queue)

        pending_suggestion = self._pending_suggestion(draft)
        fields = await self.import_service.repository.list_fields(draft.id)
        field_row = next(
            (item for item in fields if item.field_path == candidate.field_path), None
        )
        # The creator role is the one field whose allowed values live in the
        # roles catalog rather than the job schema, so they are read from there.
        role_choices: list[str] = []
        role_labels: dict[str, str] = {}
        recommended_role_choices: list[str] = []
        if candidate.field_path == "primary_role_key":
            roles = await self.import_service.repository.list_active_roles()
            by_slug = {role.slug: role.name for role in roles}
            named = [slug for slug in await self._title_role_options(draft) if slug in by_slug]
            recommended_role_choices = named
            ordered = [*named, *(slug for slug in by_slug if slug not in named)]
            for slug in ordered[:40]:
                role_choices.append(slug)
                # A slug identifies; a name reads. The buttons need the name.
                role_labels[slug] = by_slug[slug]
        question = self._build_question(
            draft,
            candidate,
            pending_suggestion,
            field_row,
            role_choices,
            role_labels,
            recommended_role_choices,
            await self._title_suggestions(draft),
        )
        if (
            candidate.field_path == "primary_role_key"
            and len(recommended_role_choices) >= 2
        ):
            question["reason"] = "GENUINE_AMBIGUITY"
        await self._group_workplace_question(draft, question)
        await self._group_money_question(draft, question)
        # Optional suggestions live in their own phase so the UI can present
        # them as offers rather than as remaining work.
        target_state: ConversationState = (
            "optional_improvements"
            if candidate.kind == "optional" and not essential_work_remains(queue)
            else "waiting_for_recruiter"
        )
        await self._store(
            draft,
            {"conversation_state": target_state, "active_question": question},
        )
        return self._snapshot_of(draft, queue)

    async def _validate_provider_question(
        self,
        draft: JobImportDraft,
        proposal: ProposedQuestion,
        *,
        queue: list[QueueCandidate] | None = None,
    ):
        answers = self._stored_answers(draft)
        fields = await self.import_service.repository.list_fields(draft.id)
        resolved = frozenset(
            field.field_path
            for field in fields
            if field.review_status in {"confirmed", "edited"}
            and (field.confirmed_value is not None or field.edited_value is not None)
        )
        return validate_proposed_question(
            proposal,
            answered_fields=frozenset(answers),
            resolved_fields=resolved,
            suppressed_fields=suppressed_by_answers(answers),
            active_conditional_fields=await self._active_conditionals(draft),
            askable_questions=(
                frozenset((candidate.field_path, candidate.kind) for candidate in queue)
                if queue is not None
                else None
            ),
        )

    async def _ambiguous_fields(self, draft: JobImportDraft) -> frozenset[str]:
        """Fields where the source supports more than one supported answer.

        Only the creator craft, for now. A title reading "Video Editing, VFX &
        Animation" names several supported crafts and no dominant one; picking
        for the recruiter would mis-file the listing in search, and leaving it
        empty hands them a draft with no craft and no explanation. Both are worse
        than one short question with the plausible options on it.

        A single clear craft is never ambiguous and is applied without asking.
        """

        options = await self._title_role_options(draft)
        return frozenset({"primary_role_key"}) if len(options) >= 2 else frozenset()

    async def _queue_for(self, draft: JobImportDraft) -> list[QueueCandidate]:
        fields = await self.import_service.repository.list_fields(draft.id)
        answers = self._stored_answers(draft)

        conflicted = frozenset(
            field.field_path
            for field in fields
            if field.provenance_state == "conflicting_source_values"
            and field.review_status == "pending"
        )
        missing = {
            field.field_path: field.missing_requirement
            for field in fields
            if field.provenance_state == "missing" and field.review_status == "pending"
        }
        suggested = {
            field.field_path: field.missing_requirement
            for field in fields
            if field.provenance_state == "suggested_inference"
            and field.review_status == "pending"
            and field.proposed_value is not None
            and bool(field.evidence)
            and (
                not field.validation_errors
                or self._confirmable_essential_suggestion(field)
            )
        }
        required_confirmations: set[str] = set()
        # The source may explicitly say the hire needs account/analytics
        # access, while only the recruiter may consent to persisting that
        # requirement. Preserve the explicit fact as a pending confirmation
        # turn instead of discarding it as an invalid native row.
        for field in fields:
            confidence = field.provider_confidence
            if (
                field.field_path == "source_inputs"
                and field.review_status == "pending"
                and field.proposed_value is not None
                and bool(field.evidence)
                and not field.validation_errors
                and isinstance(confidence, dict)
                and confidence.get("sensitive_access_confirmation_required") is True
            ):
                suggested[field.field_path] = field.missing_requirement
                required_confirmations.add(field.field_path)
        return deterministic_question_queue(
            conflicted_fields=conflicted,
            missing_fields=missing,
            answered_fields=frozenset(answers),
            # An answer can make a question moot, and so can the page itself: a
            # stated ceiling settles pay well enough that asking what the role
            # pays would ignore what the listing printed.
            suppressed_fields=suppressed_by_answers(answers)
            | suppressed_by_stated_pay(await self._effective_values(draft)),
            active_conditional_fields=await self._active_conditionals(draft),
            ambiguous_fields=await self._ambiguous_fields(draft),
            suggested_fields=suggested,
            dismissed_fields=frozenset(self._dismissed(draft)),
            required_confirmation_fields=frozenset(required_confirmations),
        )

    @staticmethod
    def _confirmable_essential_suggestion(field: Any) -> bool:
        """Keep a valid consequential hint visible without auto-applying it.

        Some fields deliberately reject plausible inference as a stored fact.
        That policy error is not a malformed value: for an essential field such
        as currency, the safe outcome is a one-click confirmation. Optional
        guesses remain suppressed, and a value the recruiter-answer contract
        rejects can never use this path.
        """

        if field.field_path not in ESSENTIAL_CONVERSATION_FIELDS:
            return False
        if set(field.validation_errors or []) != {
            "This field may only be extracted from explicit source wording."
        }:
            return False
        choices, _maximum, is_list = native_schema_constraints(field.field_path)
        shape = answer_shape_for(field.field_path)
        if (
            choices is None
            and shape.choices
            and not shape.custom_values_allowed
        ):
            choices = tuple(shape.choices)
        if choices is not None:
            proposed = field.proposed_value
            if is_list:
                if not isinstance(proposed, list) or any(
                    item not in choices for item in proposed
                ):
                    return False
            elif proposed not in choices:
                return False
        return not conversation_answer_errors(
            field.field_path, field.proposed_value
        )

    async def _effective_values(self, draft: JobImportDraft) -> dict[str, object]:
        """What the draft currently holds, recruiter answers winning.

        Extracted so the question queue can ask about the draft itself and not
        only about what has been answered. A page that stated its pay has
        settled something no answer records.
        """

        fields = await self.import_service.repository.list_fields(draft.id)
        values: dict[str, object] = {}
        for field in fields:
            if field.review_status == "edited" and field.edited_value is not None:
                values[field.field_path] = field.edited_value
            elif field.review_status == "confirmed" and field.confirmed_value is not None:
                values[field.field_path] = field.confirmed_value
            elif field.proposed_value is not None:
                values[field.field_path] = field.proposed_value
        values.update(self._stored_answers(draft))
        return values

    async def _active_conditionals(self, draft: JobImportDraft) -> frozenset[str]:
        """Conditional fields whose controlling answer makes them relevant.

        Answers win over machine values, so a recruiter who says "no trial"
        deactivates every trial condition immediately.
        """

        fields = await self.import_service.repository.list_fields(draft.id)
        values: dict[str, object] = {}
        for field in fields:
            if field.review_status == "edited" and field.edited_value is not None:
                values[field.field_path] = field.edited_value
            elif field.review_status == "confirmed" and field.confirmed_value is not None:
                values[field.field_path] = field.confirmed_value
        values.update(self._stored_answers(draft))

        active: set[str] = set()
        if values.get("compensation_mode") in {"fixed", "range"}:
            active.add("budget_amount")
            active.add("budget_currency")
        if values.get("compensation_mode") == "range":
            active.add("budget_max")
        if values.get("work_mode") in {"hybrid", "onsite"}:
            active.add("location")
        if values.get("application_mode") == "external":
            active.add("external_apply_url")
        if values.get("trial_status") in {"paid", "unpaid"}:
            active.update({"trial_scope", "trial_work_usage", "trial_portfolio_permission"})
        if values.get("trial_status") == "paid":
            active.update({"trial_compensation_amount", "trial_compensation_currency"})
        if values.get("trial_status") == "unpaid":
            active.add("unpaid_trial_confirmed")
        if values.get("revision_policy") == "fixed":
            active.add("revision_rounds")
        if values.get("start_timing") == "specific_date":
            active.add("start_date")
        return frozenset(active)

    def _pending_suggestion(self, draft: JobImportDraft) -> AnswerSuggestion | None:
        """A confirmation-gated implication of something already answered."""

        answers = self._stored_answers(draft)
        canonical = dict(answers)
        for field_path, value in answers.items():
            effect = effects_for_answer(field_path, value, canonical_values=canonical)
            for suggestion in effect.suggestions:
                if suggestion.field_path not in answers:
                    return suggestion
        return None

    def _build_question(
        self,
        draft: JobImportDraft,
        candidate: QueueCandidate,
        suggestion: AnswerSuggestion | None,
        field_row: Any | None = None,
        role_choices: list[str] | None = None,
        role_labels: dict[str, str] | None = None,
        recommended_role_choices: list[str] | None = None,
        suggestions: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        """Shape the one active question. Presentation copy lives on the client."""

        # The shape travels with the question so the interface can render a
        # control that cannot produce an invalid answer, rather than validating
        # one after the recruiter has typed it.
        shape = answer_shape_for(candidate.field_path)
        if role_choices:
            shape = replace(
                shape,
                kind="choice",
                choices=role_choices,
                labels=role_labels or {},
            )
        question: dict[str, Any] = {
            "field_path": candidate.field_path,
            "kind": candidate.kind,
            "reason": self._question_reason(candidate, suggestion, field_row),
            "asked_at": datetime.now(UTC).isoformat(),
            "context_version": (draft.recruiter_context_version or 0),
            "answer": shape.as_payload(),
        }
        if candidate.field_path == "primary_role_key" and recommended_role_choices:
            question["recommended_choices"] = recommended_role_choices[:5]

        # A conflict already knows the candidate answers and where each came
        # from. Dropping them and rendering an empty text box asks the recruiter
        # to re-read their own job post — the assistant would be holding the
        # evidence and saying nothing.
        if field_row is not None and getattr(field_row, "conflicting_values", None):
            raw = [
                {
                    "value": item.get("value"),
                    "evidence": [
                        span.get("snippet")
                        for span in (item.get("evidence") or [])
                        if isinstance(span, dict) and span.get("snippet")
                    ][:1],
                }
                for item in field_row.conflicting_values
                if isinstance(item, dict)
            ][:6]

            # A catalog may be either a domain or a set of useful shortcuts.
            # Experience is the latter: its native field is an open 64-character
            # string and its policy explicitly permits an exact custom value.
            # Treating the four common bands as a closed enum dropped "1 to 2
            # yrs" while retaining "1–3 years", producing a one-button question
            # that claimed the source mentioned both.
            policy = JOB_IMPORT_FIELD_POLICIES.get(candidate.field_path)
            native_choices, native_cap, native_is_list = native_schema_constraints(
                candidate.field_path
            )
            open_catalog = bool(
                shape.choices
                and policy is not None
                and policy.custom_values_allowed
                and native_choices is None
            )
            if shape.choices and not open_catalog:
                allowed = matching_choices(
                    candidate.field_path, [item["value"] for item in raw]
                )
                by_choice = {
                    choice: next(
                        (
                            item["evidence"]
                            for item in raw
                            if isinstance(item["value"], str)
                            and choice.casefold() in item["value"].strip().casefold()
                        ),
                        [],
                    )
                    for choice in allowed
                }
                alternatives = [
                    {"value": choice, "evidence": evidence}
                    for choice, evidence in by_choice.items()
                ]
            elif open_catalog:
                alternatives = []
                for item in raw:
                    value = item.get("value")
                    if native_is_list:
                        if not isinstance(value, list) or not all(
                            isinstance(entry, str) for entry in value
                        ):
                            continue
                    else:
                        if not isinstance(value, str):
                            continue
                        if native_cap is not None and len(value) > native_cap:
                            continue
                    if conversation_answer_errors(candidate.field_path, value):
                        continue
                    if any(existing["value"] == value for existing in alternatives):
                        continue
                    # Exact source wording is valid here. Mapping it to the
                    # nearest suggestion would narrow the claim.
                    alternatives.append(item)
            else:
                alternatives = raw
            if candidate.field_path == "location":
                # Two stated locations usually describe one office at different
                # levels of detail — a renamed city, or a neighbourhood inside
                # the city the other named. Arbitrating between them is not the
                # recruiter's job; confirming a sensible answer in one click is.
                alternatives = self._location_alternatives(
                    draft, alternatives, question
                )
            # "Which of both?" needs both. If a strict enum could map only one
            # raw phrase, omit the conflict branch and let the ordinary bounded
            # choices render instead of presenting a one-option decision.
            alternatives = [
                item
                for index, item in enumerate(alternatives)
                if not any(
                    earlier.get("value") == item.get("value")
                    for earlier in alternatives[:index]
                )
            ]
            if len(alternatives) >= 2:
                question["alternatives"] = alternatives
                if "recommended_value" not in question:
                    recommended = self._recommended_alternative(draft, alternatives)
                    if recommended is not None:
                        question["recommended_value"] = recommended
        if "recommended_value" not in question:
            if (
                field_row is not None
                and (
                    field_row.provenance_state == "suggested_inference"
                    or (
                        candidate.field_path == "source_inputs"
                        and isinstance(field_row.provider_confidence, dict)
                        and field_row.provider_confidence.get(
                            "sensitive_access_confirmation_required"
                        )
                        is True
                    )
                )
                and field_row.review_status == "pending"
                and field_row.proposed_value is not None
            ):
                question["recommended_value"] = field_row.proposed_value
        if "recommended_value" not in question:
            hint = (suggestions or {}).get(candidate.field_path)
            if hint:
                # The source hinted at this. Recommended, never preselected —
                # the recruiter still confirms.
                question["recommended_value"] = hint
        if suggestion is not None and suggestion.field_path == candidate.field_path:
            # A proposed value the recruiter confirms rather than types.
            question["suggested_value"] = suggestion.value
            question["rationale_code"] = suggestion.rationale_code
            question["explanation"] = suggestion.explanation
            question["kind"] = "confirmation"
        return question

    @staticmethod
    def _question_reason(
        candidate: QueueCandidate,
        suggestion: AnswerSuggestion | None,
        field_row: Any | None,
    ) -> str:
        """Return the decision-worthy reason this turn exists.

        Null fields and parser failures are states, not reasons to interrupt a
        recruiter.  The queue has already established that the field is useful;
        this label makes its actual product reason explicit for audit, analytics,
        and checkpoint compatibility.
        """

        if field_row is not None and getattr(
            field_row, "provenance_state", None
        ) == "conflicting_source_values":
            confidence = getattr(field_row, "provider_confidence", None)
            if isinstance(confidence, dict) and confidence.get(
                "epistemic_state"
            ) == "ambiguous":
                return "GENUINE_AMBIGUITY"
            return "UNRESOLVED_SOURCE_CONFLICT"
        if candidate.kind == "optional":
            return "OPTIONAL_HIGH_VALUE_REFINEMENT"
        if suggestion is not None or (
            field_row is not None
            and getattr(field_row, "provenance_state", None) == "suggested_inference"
        ):
            return "GENUINE_AMBIGUITY"
        return "MISSING_IMPORTANT_BUSINESS_DECISION"

    async def _group_workplace_question(
        self, draft: JobImportDraft, question: dict[str, Any]
    ) -> None:
        """Ask about the workplace once, not twice.

        Work mode and location are one fact from a candidate's side: "remote
        within the United States" and "on-site in San Francisco" are single
        answers, and a page that is unclear about one is almost always unclear
        about the other. Asking them as separate turns made the recruiter take
        two decisions to describe one arrangement, and invited the pair to
        disagree.

        The grouped answer carries both values, so choosing once populates work
        mode and location together.
        """

        asked_path = question.get("field_path")
        if asked_path not in {"work_mode", "location"}:
            return

        fields = await self.import_service.repository.list_fields(draft.id)
        by_path = {item.field_path: item for item in fields}
        answers = self._stored_answers(draft)

        def unresolved(path: str) -> bool:
            row = by_path.get(path)
            return (
                path not in answers
                and row is not None
                and row.provenance_state in {"missing", "conflicting_source_values"}
            )

        work_mode_open = unresolved("work_mode")
        location_open = unresolved("location")
        work_mode_row = by_path.get("work_mode")
        location_row = by_path.get("location")
        settled_location: object | None = answers.get("location")
        if settled_location is None and location_row is not None:
            if location_row.review_status == "edited":
                settled_location = location_row.edited_value
            elif location_row.review_status == "confirmed":
                settled_location = location_row.confirmed_value
            if settled_location is None:
                settled_location = location_row.proposed_value

        # A settled place can still be part of the one decision the recruiter
        # sees. ``Remote, based around Toronto`` is materially clearer than a
        # bare ``Remote`` choice, and selecting it confirms both halves without
        # asking a second question. Conversely, if work mode is already known,
        # a remaining location question should stay an ordinary place control.
        if not work_mode_open or not (
            location_open
            or (isinstance(settled_location, str) and settled_location.strip())
        ):
            return

        places: list[str] = []
        if location_open and location_row is not None:
            for entry in self._conflicting_values(location_row):
                if isinstance(entry, str) and entry.strip() and entry not in places:
                    places.append(entry.strip())
            if isinstance(location_row.proposed_value, str) and location_row.proposed_value:
                if location_row.proposed_value not in places:
                    places.append(location_row.proposed_value)
        elif isinstance(settled_location, str) and settled_location.strip():
            places.append(settled_location.strip())

        source_modes: list[str] = []
        if (
            work_mode_row is not None
            and work_mode_row.provenance_state == "conflicting_source_values"
        ):
            source_modes = matching_choices(
                "work_mode", self._conflicting_values(work_mode_row)
            )
            source_modes = list(dict.fromkeys(source_modes))
            if len(source_modes) < 2:
                # A source conflict needs all real alternatives. If fewer than
                # two map to the native enum, keep the ordinary control instead
                # of pretending the one recognized value settles it.
                return

        paired_places: dict[str, str] | None = None
        city_places = [place for place in places if city_for_location(place)]
        scope_places = [place for place in places if city_for_location(place) is None]
        if (
            "remote" in source_modes
            and len(city_places) == 1
            and len(scope_places) == 1
            and any(mode != "remote" for mode in source_modes)
        ):
            # ``San Francisco or Remote, US`` is not two spellings of one
            # place. It is two complete arrangements. Pair the country scope
            # only with the stated remote mode and the city only with stated
            # non-remote modes; never add a third mode the source did not name.
            paired_places = {
                mode: (
                    self._remote_location_scope(scope_places[0])
                    if mode == "remote"
                    else city_places[0]
                )
                for mode in source_modes
            }

        resolution = (
            resolve_locations(places)
            if len(places) > 1 and paired_places is None
            else None
        )
        if resolution is not None and resolution.recommended is None:
            # Two genuinely different places cannot be compressed into a
            # workplace preset without silently choosing one. Keep the field
            # turns separate so every source alternative survives.
            return
        primary = (
            resolution.recommended
            if resolution is not None
            else (places[0] if places else None)
        )

        # Whichever half the queue reached first, the arrangement is the
        # decision being made, so that is what gets asked. This mutation must
        # happen only after proving the places can be grouped; otherwise a real
        # two-city conflict is relabelled as a work-mode question and loses its
        # open location answer.
        question["field_path"] = "work_mode"
        question["answer"] = answer_shape_for("work_mode").as_payload()
        question.pop("alternatives", None)
        question.pop("recommended_value", None)

        modes = source_modes or ["remote", "hybrid", "onsite"]
        options: list[dict[str, Any]] = []
        if paired_places is not None:
            for mode in modes:
                place = paired_places[mode]
                options.append(self._workplace_option(mode, place))
            question["location_audit"] = {
                "relation": "work_mode_scoped_alternatives",
                "recommended": None,
                "alternatives": places,
                "normalization_applied": ["remote_scope_preserved"],
                "alias_applied": None,
                "containment_rule": None,
                "confident": True,
            }
        elif primary:
            for mode in modes:
                options.append(self._workplace_option(mode, primary))
        else:
            options.append(
                {"value": "remote", "label": "Fully remote", "applies": {"work_mode": "remote"}}
            )
        if not options:
            return

        question["grouped_fields"] = ["work_mode", "location"]
        question["grouped_options"] = options
        question["heading"] = "How should candidates understand where this work happens?"
        if len(places) > 1:
            question["explanation"] = (
                "The post describes the arrangement in more than one way. "
                "Choosing here settles both the work setup and the place."
            )
        else:
            question["explanation"] = (
                "Choosing here settles both the work setup and the place."
            )

    @staticmethod
    def _remote_location_scope(value: str) -> str:
        """Keep the stated geography while removing a duplicated mode label."""

        scope = re.sub(
            r"^\s*(?:fully\s+)?remote(?:[-\s]+friendly)?\s*[,;:/-]?\s*",
            "",
            value,
            flags=re.IGNORECASE,
        ).strip()
        return scope or value.strip()

    @staticmethod
    def _workplace_option(mode: str, place: str) -> dict[str, Any]:
        labels = {
            "remote": f"Remote, based in {place}",
            "hybrid": f"Hybrid in {place}",
            "onsite": f"On-site in {place}",
        }
        return {
            "value": mode,
            "label": labels[mode],
            "applies": {"work_mode": mode, "location": place},
        }

    async def _group_money_question(
        self, draft: JobImportDraft, question: dict[str, Any]
    ) -> None:
        """Ask about pay once, in the terms a recruiter thinks in.

        A page that says nothing about money leaves two native fields unset —
        how the figure is expressed, and what period it covers — and the queue
        asked for each in turn. Across a live benchmark that was the single most
        repeated interruption: five of seven sources produced the same two
        questions back to back, both phrased in terms of fields rather than
        offers.

        Nobody hires by choosing a "compensation mode". They decide whether they
        are paying for a project, an hour, a month, or per piece — and that one
        decision settles both fields. So it is asked as one, and a page that
        already states its pay still reaches none of this.
        """

        asked_path = question.get("field_path")
        if asked_path not in {"compensation_mode", "budget_unit"}:
            return

        fields = await self.import_service.repository.list_fields(draft.id)
        by_path = {item.field_path: item for item in fields}
        answers = self._stored_answers(draft)

        def unresolved(path: str) -> bool:
            row = by_path.get(path)
            return (
                path not in answers
                and row is not None
                and row.provenance_state in {"missing", "conflicting_source_values"}
            )

        # Only group while both are genuinely open. If the source settled one,
        # the remaining question is already the smallest one worth asking.
        if not (unresolved("compensation_mode") and unresolved("budget_unit")):
            return

        options = [
            {
                "value": "per project",
                "label": "A fixed amount for the whole project",
                "applies": {"budget_unit": "per project", "compensation_mode": "fixed"},
            },
            {
                "value": "per hour",
                "label": "An hourly rate",
                "applies": {"budget_unit": "per hour", "compensation_mode": "range"},
            },
            {
                "value": "per month",
                "label": "A monthly amount",
                "applies": {"budget_unit": "per month", "compensation_mode": "range"},
            },
            {
                "value": "per video",
                "label": "A rate for each piece of work",
                "applies": {"budget_unit": "per video", "compensation_mode": "range"},
            },
            {
                # Every option must settle the field being asked, or the
                # question returns. "Open to discussion" is still a period-free
                # answer, so it carries the product's own catch-all unit and
                # marks the offer negotiable.
                "value": "custom",
                "label": "Open to discussion with the candidate",
                "applies": {"budget_unit": "custom", "compensation_mode": "negotiable"},
            },
        ]

        question["field_path"] = "budget_unit"
        # The answer shape has to be the grouped options, not budget_unit's
        # sixteen raw units — otherwise the recruiter is offered "per short" and
        # "commission" instead of the decision they are actually making, and the
        # negotiable option has nowhere to render at all.
        question["answer"] = {
            "kind": "choice",
            "choices": [option["value"] for option in options],
            "labels": {option["value"]: option["label"] for option in options},
        }
        question["grouped_fields"] = ["budget_unit", "compensation_mode"]
        question["grouped_options"] = options
        question["heading"] = "How is this role paid?"
        question["explanation"] = (
            "Candidates read pay before anything else. Choosing here settles how "
            "the figure is expressed, and you can add the amount in the editor."
        )

    def _grouped_side_effects(
        self, question: dict[str, Any] | None, value: object
    ) -> dict[str, object]:
        """Extra fields a grouped answer settles alongside the one asked."""

        if not isinstance(question, dict) or not question.get("grouped_options"):
            return {}
        for option in question["grouped_options"]:
            if option.get("value") != value:
                continue
            applies = option.get("applies") or {}
            return {
                path: applied
                for path, applied in applies.items()
                if path != question.get("field_path")
            }
        return {}

    def _location_alternatives(
        self,
        draft: JobImportDraft,
        alternatives: list[dict[str, Any]],
        question: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Offer a normalised location instead of two half-written ones.

        The evidence for each source reading is preserved: the recommendation is
        added alongside them, never in place of them, so the recruiter can still
        pick exactly what the page said. A location is consequential, so nothing
        is applied without them choosing it.
        """

        stated = [
            item["value"]
            for item in alternatives
            if isinstance(item.get("value"), str) and item["value"].strip()
        ]
        if len(stated) < 2:
            return alternatives

        answers = self._stored_answers(draft)
        work_mode = answers.get("work_mode")
        if not isinstance(work_mode, str):
            work_mode = None

        resolution = resolve_locations(stated, work_mode=work_mode)
        # Kept privately for support and development, never rendered.
        question["location_audit"] = resolution.audit()

        if resolution.recommended is None:
            return alternatives

        evidence: list[Any] = []
        for item in alternatives:
            for entry in item.get("evidence") or []:
                if entry not in evidence:
                    evidence.append(entry)

        offered: list[dict[str, Any]] = [
            {"value": resolution.recommended, "evidence": evidence[:5]}
        ]
        for value in resolution.alternatives:
            if value == resolution.recommended:
                continue
            match = next(
                (item for item in alternatives if item.get("value") == value), None
            )
            offered.append(match or {"value": value, "evidence": evidence[:5]})
        for item in alternatives:
            if all(item.get("value") != entry["value"] for entry in offered):
                offered.append(item)

        question["recommended_value"] = resolution.recommended
        if resolution.relation == "same_city_different_specificity":
            question["explanation"] = (
                "The post names this office at two levels of detail. "
                "What should candidates see?"
            )
        elif resolution.relation in {"alias_equivalent", "normalized_equivalent"}:
            question["explanation"] = (
                "The post writes this location two ways. They appear to be the "
                "same place."
            )
        return offered[:8]

    def _recommended_alternative(
        self, draft: JobImportDraft, alternatives: list[dict[str, Any]]
    ) -> Any | None:
        """Point at the alternative the job title already settles.

        A post titled "... - Fresher" that also mentions "1+ years" is not
        really undecided: the title is the role's own name for itself, and a
        body line welcoming applicants with some experience does not override
        it. Reading that is the difference between an assistant and a scraper.

        Only ever a recommendation — the recruiter still picks, because the
        title is strong evidence rather than proof.
        """

        title = ""
        for item in draft.recruiter_prefill.items() if isinstance(draft.recruiter_prefill, dict) else []:
            if item[0] == "title" and isinstance(item[1], str):
                title = item[1]
        if not title:
            title = str(self._machine_title(draft) or "")
        if not title:
            return None

        lowered = title.lower()
        entry_signals = ("fresher", "entry level", "entry-level", "beginner", "graduate")
        senior_signals = ("senior", "lead ", "principal", "head of")
        intern_signals = ("intern", "internship", "trainee")

        def matches(value: Any, words: tuple[str, ...]) -> bool:
            text = str(value or "").lower()
            return any(word in text for word in words)

        for words in (intern_signals, entry_signals, senior_signals):
            if not any(word in lowered for word in words):
                continue
            for alternative in alternatives:
                if matches(alternative.get("value"), words):
                    return alternative.get("value")
        return None

    @staticmethod
    def _machine_title(draft: JobImportDraft) -> str | None:
        machine = draft.machine_output
        if not isinstance(machine, dict):
            return None
        for item in machine.get("fields") or []:
            if isinstance(item, dict) and item.get("field_path") == "title":
                value = item.get("value")
                return value if isinstance(value, str) else None
        return None

    # ------------------------------------------------------------------
    # Provider gate
    # ------------------------------------------------------------------

    def may_call_provider(self, draft: JobImportDraft) -> bool:
        """The single gate. Every provider call in this flow passes through it."""

        return may_start_provider_stage(
            draft.conversation_state,  # type: ignore[arg-type]
            continuation_count=draft.continuation_count or 0,
        )

    def continuation_budget_exhausted(self, draft: JobImportDraft) -> bool:
        return (draft.continuation_count or 0) >= MAX_PROVIDER_CONTINUATIONS

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------

    @staticmethod
    def _stored_answers(draft: JobImportDraft) -> dict[str, object]:
        stored = draft.recruiter_prefill
        return dict(stored) if isinstance(stored, dict) else {}

    @staticmethod
    def _dismissed(draft: JobImportDraft) -> list[str]:
        stored = draft.dismissed_suggestions
        if not isinstance(stored, list):
            return []
        return [item for item in stored if isinstance(item, str)]

    async def _persist_answer(
        self, draft: JobImportDraft, field_path: str, value: object
    ) -> None:
        """Write an answer where native conversion will actually read it.

        Conversion builds the job from field rows, not from the prefill map, so
        an answer that only landed in the map was silently dropped on the way to
        Post Job — the recruiter typed a city and the editor opened without it.

        The row is marked ``edited`` because that is exactly what it is: a value
        the recruiter supplied. Any machine proposal underneath is preserved for
        audit, and only the effective value changes.
        """

        existing = await self.import_service.repository.get_field(draft.id, field_path)
        if existing is not None:
            await self.import_service.repository.update_field(
                existing,
                {
                    "review_status": "edited",
                    "edited_value": value,
                    "confirmed_value": None,
                    "requires_confirmation": False,
                    "validation_errors": [],
                    "reviewed_by_user_id": draft.owner_user_id,
                    "reviewed_at": datetime.now(UTC),
                    # A field the source never supplied is now directly supplied.
                    "provenance_state": (
                        "directly_supplied"
                        if existing.provenance_state == "missing"
                        else existing.provenance_state
                    ),
                },
            )
            return

        policy = JOB_IMPORT_FIELD_POLICIES[field_path]
        await self.import_service.repository.create_fields(
            [
                {
                    "draft_id": draft.id,
                    "field_path": field_path,
                    "proposed_value": None,
                    "provenance_state": "directly_supplied",
                    "evidence": [],
                    "conflicting_values": [],
                    "explanation": "You answered this while preparing the draft.",
                    "provider_confidence": None,
                    "review_status": "edited",
                    "edited_value": value,
                    "confirmed_value": None,
                    "missing_requirement": policy.missing_requirement,
                    "requires_confirmation": False,
                    "validation_errors": [],
                    "reviewed_by_user_id": draft.owner_user_id,
                    "reviewed_at": datetime.now(UTC),
                }
            ]
        )

    async def _store(self, draft: JobImportDraft, updates: dict[str, Any]) -> None:
        await self.import_service.repository.update_draft(draft, updates)
        await self.import_service.repository.session.commit()

    async def begin(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Enter the conversation for a draft whose extraction already landed."""

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
        self._require_successful_processing(draft)
        if draft.conversation_state is None:
            await self._store(draft, {"conversation_state": "validating"})
        return await self._advance(draft, owner_user_id=owner_user_id)

    async def record_provider_stage(
        self, draft: JobImportDraft, *, attempt_id: UUID | None = None
    ) -> None:
        """Note that one bounded provider stage was spent."""

        await self._store(
            draft,
            {
                "continuation_count": (draft.continuation_count or 0) + 1,
                "last_completed_stage": str(attempt_id or uuid4()),
            },
        )
