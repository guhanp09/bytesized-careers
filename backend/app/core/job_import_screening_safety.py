"""Candidate-safe normalization for imported screening questions.

Screening is private, but it is still candidate-facing: the marketplace sends
these rows into the applicant's Inbox after they apply. Provider output must not
be able to smuggle an old job board, email address, or messaging destination
through that less-visible route.

The boundary also restores the product distinction between a question and an
application input. "What is your expected rate?" activates the existing rate
field; "Why does this role interest you?" remains a prose question.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.job_application_classification import (
    classify_application_instructions,
    sanitize_application_requirement_keys,
)
from app.core.job_application_instructions import separate_application_instructions

_MAX_QUESTIONS = 20

_MATERIAL_DIRECTIVE = re.compile(
    r"^\s*(?:please\s+)?(?:attach|e-?mail|email|forward|include|list|mail|"
    r"provide|send|share|submit|upload)\b",
    re.IGNORECASE,
)

# If a mixed question also tells the person where to send the answer, keep the
# question and remove the delivery clause as a unit. Sanitizing only the final
# destination otherwise leaves prose such as "and submit it" behind.
_DELIVERY_SUFFIX = re.compile(
    r"\s*[,;]?\s+\b(?:and|or|then)\b\s+(?:please\s+)?"
    r"(?:apply|contact|dm|e-?mail|email|forward|mail|message|post|reply|"
    r"respond|send|share|submit|upload)\b.*$",
    re.IGNORECASE,
)

_ANSWER_DELIVERY = re.compile(
    r"^\s*(?:please\s+)?(?:answer|reply|respond)\b.{0,180}"
    r"\b(?:at|in|inside|on|through|to|via)\b",
    re.IGNORECASE,
)

# A final "on/via/through Brand" is usually a delivery destination in a
# screening row. Work vocabulary immediately before it keeps legitimate prompts
# such as "How do you optimize content on Instagram?" intact.
_TRAILING_CHANNEL = re.compile(
    r"\b(?:at|in|inside|on|through|via)\s+[A-Za-z][\w.+-]*(?:\s+[A-Za-z][\w.+-]*){0,3}"
    r"(?:\s+only)?[.!?]?\s*$",
    re.IGNORECASE,
)
_WORK_CONTEXT = re.compile(
    r"\b(?:analytics|audience|campaign|channel|clip|content|edit|editing|"
    r"engagement|platform|portfolio|reel|social|story|thumbnail|video|work)\b",
    re.IGNORECASE,
)

_PERSONAL_CONTACT_DETAIL = re.compile(
    r"\b(?:your\s+)?(?:e-?mail(?:\s+address)?|phone(?:\s+number)?|"
    r"mobile(?:\s+number)?|telephone(?:\s+number)?|contact\s+details?|"
    r"home\s+address|mailing\s+address|residential\s+address|"
    r"social(?:\s+media)?\s+handle|user(?:name)?|whats\s*app|telegram|"
    r"signal|discord|skype)\b",
    re.IGNORECASE,
)
_CONTACT_REQUEST = re.compile(
    r"\b(?:contact|reach|message|call|text)\s+(?:you|the\s+applicant|the\s+candidate)\b|"
    r"\b(?:provide|share|enter|list|submit|send|tell\s+us)\b.{0,60}"
    r"\b(?:contact|e-?mail|phone|mobile|telephone|address|handle|user(?:name)?)\b",
    re.IGNORECASE,
)

_EVALUATIVE_PROMPT = re.compile(
    r"^\s*(?:why|how|what|which|where|when|who|describe|explain|outline|"
    r"discuss|summari[sz]e|compare|assess|tell\s+(?:us|me)|walk\s+(?:us|me)|"
    r"share\s+your\s+thoughts)\b",
    re.IGNORECASE,
)


def _is_personal_contact_request(text: str) -> bool:
    """Contact/identity collection is not a role-evaluation question."""

    if _CONTACT_REQUEST.search(text):
        return True
    detail = _PERSONAL_CONTACT_DETAIL.search(text)
    if detail is None:
        return False
    prefix = text[max(0, detail.start() - 45) : detail.start()]
    return bool(
        re.search(
            r"\b(?:what|which)\s+is\s+$|\b(?:what|which)\s+are\s+$|\byour\s*$",
            prefix,
            re.IGNORECASE,
        )
        or re.search(r"\byour\b", detail.group(0), re.IGNORECASE)
    )


@dataclass(frozen=True)
class SafeScreeningQuestions:
    questions: list[dict[str, object]]
    requirement_keys: list[str]
    unstructured_materials: list[str]


def _normalized_text(value: object, *, maximum: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    if not normalized:
        return None
    return normalized[:maximum].rstrip()


def _should_assume_delivery(text: str) -> bool:
    if _ANSWER_DELIVERY.search(text):
        return True
    trailing = _TRAILING_CHANNEL.search(text)
    if trailing is None:
        return False
    context = text[max(0, trailing.start() - 90) : trailing.start()]
    return _WORK_CONTEXT.search(context) is None


def _safe_sentences(text: str) -> tuple[list[str], bool]:
    separated = separate_application_instructions(text)
    if not separated.sanitized and _should_assume_delivery(text):
        separated = separate_application_instructions(text, assume_routing=True)
    if not separated.sanitized:
        return separated.safe_sentences or [text], False

    without_delivery = _DELIVERY_SUFFIX.sub("", text).strip()
    if without_delivery and without_delivery != text:
        reduced = separate_application_instructions(without_delivery)
        return reduced.safe_sentences or [without_delivery], True
    return separated.safe_sentences, True


def _safe_guidance(value: object) -> str | None:
    guidance = _normalized_text(value, maximum=255)
    if guidance is None:
        return None
    sentences, sanitized = _safe_sentences(guidance)
    if not sanitized:
        return guidance
    cleaned = " ".join(sentences).strip()
    # Routing removal can leave a pronoun-only fragment ("then it"). That is
    # neither useful guidance nor polished copy, so omit it rather than showing
    # the applicant a broken instruction.
    cleaned = re.sub(
        r"(?:[,;]?\s+\b(?:and|or|then)\b\s+)?(?:it|them|there)[.!?]?\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned if len(re.findall(r"[A-Za-z]{2,}", cleaned)) >= 2 else None


def _safe_material(value: str) -> str | None:
    cleaned = " ".join(value.split()).strip().strip(".,;:")
    cleaned = re.sub(
        r"\s+\b(?:at|on|through|to|via)\b$", "", cleaned, flags=re.IGNORECASE
    ).strip()
    return cleaned if len(re.findall(r"[A-Za-z]{2,}", cleaned)) >= 2 else None


def safe_imported_screening_questions(value: object) -> SafeScreeningQuestions:
    """Return rows safe for a native job plus any reclassified materials."""

    if not isinstance(value, list):
        return SafeScreeningQuestions([], [], [])

    questions: list[dict[str, object]] = []
    requirement_keys: list[str] = []
    materials: list[str] = []
    seen_prompts: set[str] = set()

    for item in value[:_MAX_QUESTIONS]:
        if not isinstance(item, dict):
            continue
        prompt = _normalized_text(item.get("prompt"), maximum=500)
        if prompt is None:
            continue
        safe_sentences, routing_removed = _safe_sentences(prompt)
        guidance = _safe_guidance(item.get("response_guidance"))

        for sentence in safe_sentences:
            candidate = _normalized_text(sentence, maximum=500)
            if candidate is None:
                continue
            if _is_personal_contact_request(candidate):
                continue
            classified = classify_application_instructions(candidate)
            for key in classified.requirement_keys:
                if key not in requirement_keys:
                    requirement_keys.append(key)

            is_material = bool(classified.requirement_keys) or bool(
                _MATERIAL_DIRECTIVE.match(candidate)
            )
            if is_material:
                for material in classified.unstructured_materials:
                    cleaned_material = _safe_material(material)
                    if cleaned_material and cleaned_material not in materials:
                        materials.append(cleaned_material)

            proposed_questions: list[str]
            if classified.screening_questions:
                # Classification may split a compound material + judgement
                # sentence. Use that split only when it actually found a
                # material; otherwise preserve the provider's legitimate
                # wording (including work platforms such as Instagram).
                proposed_questions = (
                    classified.screening_questions
                    if is_material
                    else [candidate]
                )
            elif is_material:
                proposed_questions = []
            else:
                # A provider typing arbitrary prose as ``screening`` does not
                # make it a candidate question. Keep open-vocabulary evaluation
                # (including uncommon verbs such as "Outline") and ordinary
                # question grammar, but fail closed on imperative routing copy.
                proposed_questions = (
                    [candidate]
                    if candidate.rstrip().endswith("?")
                    or _EVALUATIVE_PROMPT.match(candidate)
                    else []
                )

            for proposed in proposed_questions:
                cleaned = _DELIVERY_SUFFIX.sub("", proposed).strip()
                if routing_removed:
                    cleaned = re.sub(
                        r"\s+\b(?:and|or|then)\b\s+(?:it|them|there)[.!?]?$",
                        "",
                        cleaned,
                        flags=re.IGNORECASE,
                    ).strip()
                if _is_personal_contact_request(cleaned):
                    continue
                if len(cleaned) < 3:
                    continue
                fingerprint = cleaned.casefold()
                if fingerprint in seen_prompts:
                    continue
                seen_prompts.add(fingerprint)
                row: dict[str, object] = {
                    "prompt": cleaned,
                    "required": bool(item.get("required")),
                }
                if guidance:
                    row["response_guidance"] = guidance
                questions.append(row)
                if len(questions) >= _MAX_QUESTIONS:
                    break
            if len(questions) >= _MAX_QUESTIONS:
                break
        if len(questions) >= _MAX_QUESTIONS:
            break

    return SafeScreeningQuestions(
        questions=questions,
        requirement_keys=sanitize_application_requirement_keys(requirement_keys),
        unstructured_materials=materials,
    )
