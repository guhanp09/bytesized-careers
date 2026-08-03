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

from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from app.core.job_import_answer_effects import (
    AnswerSuggestion,
    effects_for_answer,
    pay_range_from_conflict,
    suppressed_by_answers,
)
from app.core.job_import_answer_shapes import answer_shape_for, matching_choices
from app.core.job_import_conversation import (
    MAX_PROVIDER_CONTINUATIONS,
    ConversationState,
    assert_transition,
    is_waiting,
    may_start_provider_stage,
    resume_state_for,
)
from app.core.job_import_policy import JOB_IMPORT_FIELD_POLICIES
from app.core.job_import_questions import (
    ProposedQuestion,
    QueueCandidate,
    assistant_preparation_complete,
    deterministic_question_queue,
    essential_work_remains,
    validate_proposed_question,
)
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
    def _snapshot_of(
        draft: JobImportDraft, queue: list[QueueCandidate] | None = None
    ) -> ConversationSnapshot:
        state: ConversationState = (
            draft.conversation_state or "source_received"
        )  # type: ignore[assignment]
        question = (
            draft.active_question if isinstance(draft.active_question, dict) else None
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
        snapshot = self._snapshot_of(draft)

        if not snapshot.waiting or snapshot.active_question is None:
            raise JobImportError(
                "JOB_IMPORT_NO_ACTIVE_QUESTION",
                "There is no question waiting for an answer right now.",
                status_code=409,
            )

        active_path = snapshot.active_question.get("field_path")
        if active_path != field_path:
            raise JobImportError(
                "JOB_IMPORT_QUESTION_MISMATCH",
                "That answer does not match the question currently being asked.",
                status_code=409,
                details={"expected_field_path": active_path},
            )

        if (
            expected_context_version is not None
            and expected_context_version != snapshot.recruiter_context_version
        ):
            # A duplicate or late submission. The answer already landed; saying
            # so is honest and, critically, starts no new work.
            return snapshot

        policy = JOB_IMPORT_FIELD_POLICIES.get(field_path)
        if policy is None:
            raise JobImportError(
                "JOB_IMPORT_UNSUPPORTED_FIELD",
                "That detail cannot be answered here.",
                status_code=422,
            )
        normalized, errors = await self.import_service._validate_field_value(policy, value)
        if errors:
            raise JobImportError(
                "JOB_IMPORT_FIELD_INVALID",
                "That answer is not valid for this detail.",
                details={"errors": errors},
            )

        answers = self._stored_answers(draft)
        answers[field_path] = normalized

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

        await self._store(
            draft,
            {
                "recruiter_prefill": {**answers, **resolved},
                "recruiter_prefill_updated_at": datetime.now(UTC),
            },
        )
        return True

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

        if await self._resolve_pay_range(draft):
            # The pay question no longer exists; rebuild without it.
            pass
        queue = await self._queue_for(draft)
        candidate = queue[0] if queue else None

        # A provider proposal is only preferred when the server agrees it is
        # askable; otherwise the deterministic queue takes over silently.
        if provider_question is not None:
            validation = await self._validate_provider_question(draft, provider_question)
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
        if candidate.field_path == "primary_role_key":
            role_choices = [
                role.slug
                for role in await self.import_service.repository.list_active_roles()
            ][:40]
        question = self._build_question(
            draft, candidate, pending_suggestion, field_row, role_choices
        )
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
        self, draft: JobImportDraft, proposal: ProposedQuestion
    ):
        answers = self._stored_answers(draft)
        return validate_proposed_question(
            proposal,
            answered_fields=frozenset(answers),
            suppressed_fields=suppressed_by_answers(answers),
            active_conditional_fields=await self._active_conditionals(draft),
        )

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
        return deterministic_question_queue(
            conflicted_fields=conflicted,
            missing_fields=missing,
            answered_fields=frozenset(answers),
            suppressed_fields=suppressed_by_answers(answers),
            active_conditional_fields=await self._active_conditionals(draft),
            dismissed_fields=frozenset(self._dismissed(draft)),
        )

    async def _active_conditionals(self, draft: JobImportDraft) -> frozenset[str]:
        """Conditional fields whose controlling answer makes them relevant.

        Answers win over machine values, so a recruiter who says "no trial"
        deactivates every trial condition immediately.
        """

        fields = await self.import_service.repository.list_fields(draft.id)
        values: dict[str, object] = {
            field.field_path: field.proposed_value for field in fields
        }
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
    ) -> dict[str, Any]:
        """Shape the one active question. Presentation copy lives on the client."""

        # The shape travels with the question so the interface can render a
        # control that cannot produce an invalid answer, rather than validating
        # one after the recruiter has typed it.
        shape = answer_shape_for(candidate.field_path)
        if role_choices:
            shape = replace(shape, kind="choice", choices=role_choices)
        question: dict[str, Any] = {
            "field_path": candidate.field_path,
            "kind": candidate.kind,
            "asked_at": datetime.now(UTC).isoformat(),
            "context_version": (draft.recruiter_context_version or 0),
            "answer": shape.as_payload(),
        }

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

            # For a field with a fixed set of answers, the source's wording is
            # mapped onto real values — offering the raw phrase back would hand
            # the recruiter something the field then refuses.
            if shape.choices:
                allowed = matching_choices(
                    candidate.field_path, [item["value"] for item in raw]
                )
                by_choice = {
                    choice: next(
                        (
                            item["evidence"]
                            for item in raw
                            if isinstance(item["value"], str)
                            and choice in item["value"].strip().lower()
                        ),
                        [],
                    )
                    for choice in allowed
                }
                alternatives = [
                    {"value": choice, "evidence": evidence}
                    for choice, evidence in by_choice.items()
                ]
            else:
                alternatives = raw
            if alternatives:
                question["alternatives"] = alternatives
                recommended = self._recommended_alternative(draft, alternatives)
                if recommended is not None:
                    question["recommended_value"] = recommended
        if suggestion is not None and suggestion.field_path == candidate.field_path:
            # A proposed value the recruiter confirms rather than types.
            question["suggested_value"] = suggestion.value
            question["rationale_code"] = suggestion.rationale_code
            question["explanation"] = suggestion.explanation
            question["kind"] = "confirmation"
        return question

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

    async def _store(self, draft: JobImportDraft, updates: dict[str, Any]) -> None:
        await self.import_service.repository.update_draft(draft, updates)
        await self.import_service.repository.session.commit()

    async def begin(
        self, draft_id: UUID, *, owner_user_id: UUID
    ) -> ConversationSnapshot:
        """Enter the conversation for a draft whose extraction already landed."""

        draft = await self.import_service.get_draft(draft_id, owner_user_id=owner_user_id)
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
