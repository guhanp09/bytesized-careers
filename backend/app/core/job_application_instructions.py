"""Separating what a candidate must send from where a source told them to send it.

An imported listing said:

    Please share the requested portfolio, samples, personal details, and
    AI-video confirmation on WhatsApp only.

and CreatorJobs published that sentence verbatim, WhatsApp and all. Two different
facts were tangled in one line and the import layer kept both, when it should
have kept one. The materials — portfolio, samples, personal details, an AI-video
confirmation — are exactly what a candidate needs to know. The destination is a
routing instruction for a hiring process that is not the one the candidate is
standing in, and repeating it sends them somewhere the platform cannot follow.

So this module answers two questions separately:

    What should the candidate include?    → kept, and published
    Where should the candidate send it?   → removed from anything public

The hard part is that both usually live in the same sentence, and the words that
signal a destination are often the same words that describe legitimate work. A
listing asking for "links to your YouTube and Instagram work" names two
platforms and neither is a destination; "DM us on Instagram" names one that is.
A blanket ban on platform names would strip real portfolio requirements, so the
decision is made on the *phrasing around* the name — the verb, the preposition,
the presence of a handle or address — rather than on the name itself.

Nothing here guesses. A sentence whose destination cannot be removed cleanly is
dropped whole rather than published half-sanitised, because a mangled instruction
is worse than a missing one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final

#: Contact details that are always a routing instruction, never a requirement.
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
_URL = re.compile(r"\b(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|in|io|co|org|net)/\S*", re.I)
_PHONE = re.compile(r"(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){7,14}\d")

#: Messaging and social channels a source might route an application through.
#:
#: Presence alone proves nothing. "Instagram" appears in both "DM us on
#: Instagram" and "include your Instagram work", and only the first is routing.
_CHANNELS: Final[tuple[str, ...]] = (
    "whatsapp",
    "whats app",
    "telegram",
    "signal",
    "wechat",
    "viber",
    "messenger",
    "instagram",
    "linkedin",
    "facebook",
    "twitter",
    "x",
    "discord",
    "slack",
    "sms",
    "email",
    "e-mail",
    "mail",
    "google form",
    "google forms",
    "typeform",
    "indeed",
    "naukri",
    "linkedin easy apply",
    "careers page",
    "career page",
    "our website",
    "the link below",
    "the form below",
    "this link",
    "this form",
)

#: Verbs that turn a channel into a destination.
_ROUTING_VERBS: Final[tuple[str, ...]] = (
    "send",
    "share",
    "submit",
    "apply",
    "email",
    "mail",
    "message",
    "dm",
    "ping",
    "text",
    "call",
    "whatsapp",
    "reach",
    "contact",
    "forward",
    "drop",
    "post",
    "upload",
    "fill",
    "register",
)

#: "on WhatsApp", "via email", "through Telegram", "to careers@…", "at +91…".
#:
#: The preposition is what makes it a destination. "Your Instagram work" has no
#: preposition in front of the platform and survives; "on Instagram" does not.
_DESTINATION_PHRASE = re.compile(
    r"""
    \s*
    (?:,\s*)?
    \b(?:on|via|through|thru|to|at|using|by|over|in)\b
    \s+
    (?:our\s+|the\s+|this\s+|his\s+|her\s+|their\s+|my\s+)?
    (?P<channel>[\w .+-]{2,40}?)
    (?:\s+(?:only|directly|please|below|above|link|form|page|group|channel|number|id))*
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)

#: Wording that describes work a candidate has made, so a platform name inside it
#: is portfolio context and must survive.
_PORTFOLIO_CONTEXT: Final[tuple[str, ...]] = (
    "work",
    "works",
    "portfolio",
    "channel",
    "channels",
    "sample",
    "samples",
    "reel",
    "reels",
    "showreel",
    "video",
    "videos",
    "edit",
    "edits",
    "link",
    "links",
    "profile",
    "page",
    "account",
    "handle",
    "content",
    "post",
    "posts",
    "experience",
    "following",
    "audience",
    "analytics",
)

#: Sentences that are pure routing and carry no requirement at all.
_PURE_ROUTING = re.compile(
    r"^\s*(?:please\s+)?(?:"
    r"apply\s+(?:now|here|online|at|via|through|using|on)|"
    r"use\s+(?:the|our|this)\s+(?:link|form|button|careers?\s+page|website|portal)|"
    r"fill\s+(?:out|in)\s+(?:the|this)|"
    r"click\s+(?:the|here)|"
    r"visit\s+(?:our|the|this)|"
    r"register\s+(?:at|on|via)|"
    r"send\s+(?:it|them|these)\s+(?:on|to|via)|"
    r"contact\s+us|"
    r"call\s+us|"
    r"dm\s+us|"
    r"message\s+us"
    r")\b",
    re.IGNORECASE,
)


#: A clause that asks the candidate to provide something, after the directions.
#:
#: Deliberately about the *ask*, not about the thing asked for: a list of nouns
#: would need to anticipate every material a source can name, and the ones it
#: missed would be exactly the ones silently dropped.
_ASKS_FOR_SOMETHING = re.compile(
    r"\b(?:and\s+|also\s+|then\s+|,\s*)?"
    r"(?:"
    r"(?:include|attach|add|send|share|provide|submit|upload|bring|enclose)\b"
    r"\s+(?:us\s+|me\s+)?(?:your|two|three|a|an|the|some|any|\d)"
    # "Apply at <url> with two samples" names the ask with a preposition rather
    # than a verb, and dropping it lost the samples just as completely.
    r"|with\s+(?:your|two|three|a|an|some|\d)"
    r")",
    re.IGNORECASE,
)


def _also_asks_for_something(sentence: str) -> bool:
    """Whether a routing sentence goes on to name what the candidate must send."""

    return bool(_ASKS_FOR_SOMETHING.search(sentence))


@dataclass(frozen=True)
class ApplicationInstructions:
    """One source's application paragraph, taken apart.

    ``destination`` is kept for import diagnostics and evidence only. It must
    never reach a candidate-facing field; that is the whole point of separating
    it out rather than editing it in place.
    """

    #: What the candidate must include, as the source described it.
    materials: list[str] = field(default_factory=list)
    #: Where the source told them to send it. Private.
    destination: list[str] = field(default_factory=list)
    #: Sentences kept whole because they state a requirement and no destination.
    safe_sentences: list[str] = field(default_factory=list)
    #: True when routing wording was found and removed.
    sanitized: bool = False


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    return [part.strip() for part in parts if part.strip()]


def _names_a_channel(fragment: str) -> str | None:
    lowered = fragment.strip().lower().strip(".,;:!? ")
    for channel in _CHANNELS:
        if lowered == channel or lowered.startswith(f"{channel} ") or lowered.endswith(f" {channel}"):
            return channel
    return None


def _is_portfolio_reference(sentence: str, channel_span: tuple[int, int]) -> bool:
    """Whether the words around a channel name describe work rather than routing.

    "links to your YouTube and Instagram work" names platforms as the subject of
    a requirement. "DM us on Instagram" names one as a destination. The
    difference is the company the word keeps.
    """

    tail = sentence[channel_span[1] : channel_span[1] + 40].lower()
    head = sentence[max(0, channel_span[0] - 40) : channel_span[0]].lower()
    for marker in _PORTFOLIO_CONTEXT:
        if re.search(rf"\b{re.escape(marker)}\b", tail):
            return True
    # "your YouTube", "their Instagram" — possessive framing describes the
    # candidate's own presence, not somewhere to send an application.
    return bool(re.search(r"\b(?:your|their|his|her|candidate'?s)\s*$", head))


#: A channel named without a preposition in front of it.
#:
#: "or WhatsApp +91 90000 00000" loses its number to the phone pattern above,
#: and what is left is the bare word — which `_DESTINATION_PHRASE` never matches
#: because there is no "on"/"via"/"to" to anchor it. The published note then read
#: "please include it to or whatsapp with your CreatorJobs application": broken
#: English that still names the platform a candidate was being routed to.
_BARE_CHANNEL = re.compile(
    r"\b(?:whats\s?app|telegram|signal|wechat|viber|messenger|discord|sms|"
    r"e-?mail|mail|google\s+forms?|typeform)\b",
    re.IGNORECASE,
)


def _strip_stranded_channels(sentence: str, working: str) -> tuple[str, list[str]]:
    """Remove a channel name left behind once its address was taken away.

    Called only for a sentence that already lost an address, a URL or a phone
    number, because that is what makes a leftover channel name a destination
    rather than vocabulary. Within such a sentence the portfolio test still
    applies: "email your Instagram work to x@y" keeps Instagram.
    """

    found: list[str] = []

    def replace(match: re.Match[str]) -> str:
        if _is_portfolio_reference(sentence, match.span()):
            return match.group(0)
        found.append(match.group(0).strip())
        return ""

    return _BARE_CHANNEL.sub(replace, working), found


def _strip_destinations(sentence: str) -> tuple[str, list[str]]:
    """Remove routing phrases from one sentence, keeping everything else."""

    found: list[str] = []
    working = sentence

    for pattern in (_EMAIL, _URL, _PHONE):
        for match in pattern.findall(working):
            found.append(match if isinstance(match, str) else str(match))
        working = pattern.sub("", working)

    def replace(match: re.Match[str]) -> str:
        # The optional suffix group ("… page", "… form", "… link") swallows the
        # second word of a two-word channel, so "to our careers page" arrives
        # here with the channel "careers" — which names nothing. Read the whole
        # phrase after the preposition first.
        whole = _names_a_channel(
            re.sub(
                r"^\s*,?\s*\b(?:on|via|through|thru|to|at|using|by|over|in)\b\s+"
                r"(?:our\s+|the\s+|this\s+|his\s+|her\s+|their\s+|my\s+)?",
                "",
                match.group(0),
                flags=re.IGNORECASE,
            )
        )
        if whole is not None:
            # A phrase that names a destination outright is not ambiguous, and
            # the portfolio heuristic must not get a vote on it. "page" is a
            # portfolio marker — "your Instagram page" — and it is also the
            # second half of "careers page", so the heuristic read a destination
            # as a description of the candidate's own work and published it.
            found.append(match.group(0).strip())
            return ""

        channel = _names_a_channel(match.group("channel"))
        if channel is None:
            return match.group(0)
        # A bare platform name is the genuinely ambiguous case this exists for:
        # "DM us on Instagram" routes, "links to your Instagram work" describes.
        if _is_portfolio_reference(sentence, match.span("channel")):
            return match.group(0)
        found.append(match.group(0).strip())
        return ""

    working = _DESTINATION_PHRASE.sub(replace, working)
    if found:
        # Only when this sentence demonstrably carried routing that was just
        # removed. A bare channel name is otherwise ordinary vocabulary —
        # "Familiarity with WhatsApp marketing helps" names a skill, and
        # stripping it would cost the recruiter the requirement they wrote.
        working, stranded = _strip_stranded_channels(sentence, working)
        found.extend(stranded)
    return working, found


#: A sentence that opens by telling the candidate to transmit something.
#:
#: Once the destination is removed, "Email your CV and showreel" is left giving
#: an instruction it can no longer complete. The objects of the verb are still
#: exactly what the candidate must provide, so the verb is replaced rather than
#: the sentence discarded.
_LEADING_ROUTING_VERB = re.compile(
    r"^\s*(?:please\s+)?"
    r"(?:e-?mail|send|share|submit|forward|drop|upload|post|attach|provide|include"
    r"|dm|whats-?app|message|text|ping)"
    r"\s+(?:us\s+|me\s+)?(?:with\s+)?",
    re.IGNORECASE,
)


def requirement_object(sentence: str) -> str | None:
    """What a transmit-shaped sentence was asking for, without the transmitting."""

    if not _LEADING_ROUTING_VERB.match(sentence):
        return None
    remainder = _LEADING_ROUTING_VERB.sub("", sentence, count=1).strip()
    remainder = re.sub(r"[.!?]+$", "", remainder).strip()
    remainder = re.sub(r"^(?:the\s+requested\s+)", "", remainder, flags=re.IGNORECASE).strip()
    return remainder or None


def _tidy(sentence: str) -> str:
    """Close the gaps removal leaves behind, without inventing words."""

    cleaned = re.sub(r"\s{2,}", " ", sentence)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"[,;:]\s*(?=[.!?])", "", cleaned)
    cleaned = re.sub(r"\b(?:and|or|with|to|on|via|at|by)\s*([.!?])", r"\1", cleaned, flags=re.I)
    # Removal can leave connectives stranded mid-sentence too — "include it to
    # or with your application" — not only immediately before punctuation.
    cleaned = re.sub(
        r"\b(?:to|on|via|at|by|through)\s+(?=(?:or|and)\b)", "", cleaned, flags=re.I
    )
    cleaned = re.sub(r"\b(?:or|and)\s+(?=with\b)", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:to|on|via|at|by)\s+(?=with\b)", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"^[\s,;:.]+", "", cleaned)
    cleaned = cleaned.strip()
    if cleaned and cleaned[-1] not in ".!?":
        cleaned = f"{cleaned}."
    return cleaned


def separate_application_instructions(text: str | None) -> ApplicationInstructions:
    """Take a source's application wording apart into its two different facts."""

    if not text or not text.strip():
        return ApplicationInstructions()

    safe: list[str] = []
    destinations: list[str] = []
    sanitized = False

    for sentence in _split_sentences(text):
        stripped, found = _strip_destinations(sentence)
        if found:
            sanitized = True
            destinations.extend(found)

        if _PURE_ROUTING.match(sentence) and not _also_asks_for_something(sentence):
            # Nothing here but directions. Dropping the sentence loses no
            # requirement, and keeping a hollowed-out version would read as
            # broken English on a public page.
            #
            # The second test is what makes that true. `_PURE_ROUTING` only
            # inspects how a sentence *opens*, and sources routinely open with
            # directions and then say what to send: "Apply through the form and
            # include your showreel." Discarding on the opening alone threw away
            # the showreel, the two samples, the reel — a requirement the
            # recruiter asked for, silently, with the candidate never asked.
            continue

        reduced = False
        if _PURE_ROUTING.match(stripped):
            # Directions first, the ask second. Keeping the whole sentence
            # published the directions — "Please include Apply through the form
            # with your CreatorJobs application" — which is both broken English
            # and the destination this module exists to remove. Keep the ask.
            ask = _ASKS_FOR_SOMETHING.search(stripped)
            if ask:
                stripped = stripped[ask.start() :].lstrip(" ,")
                stripped = re.sub(r"^(?:and|also|then)\s+", "", stripped, flags=re.IGNORECASE)
                # "with two samples" is the ask, but it is not a sentence. Left
                # as a preposition it reads as a fragment on a public page, so
                # it is given back the verb the directions took away.
                stripped = re.sub(
                    r"^with\s+", "Include ", stripped, flags=re.IGNORECASE
                )
                reduced = True

        tidied = _tidy(stripped)
        # A sentence reduced to a fragment has lost whatever it was saying.
        # Two letters counts as a word here because "CV" is a real requirement.
        #
        # A clause that survived a routing reduction is held to a lower bar: it
        # is already known to be the ask, and "two samples" is a complete answer
        # to what the candidate must send even though it is only two words.
        if len(re.findall(r"[A-Za-z]{2,}", tidied)) < (2 if reduced else 3):
            continue
        safe.append(tidied)

    return ApplicationInstructions(
        materials=[],
        destination=list(dict.fromkeys(destinations)),
        safe_sentences=safe,
        sanitized=sanitized,
    )


def contains_external_routing(text: str | None) -> str | None:
    """The first routing instruction found in recruiter-authored prose, if any.

    Used to warn rather than rewrite. A recruiter's own words are theirs, so the
    editor points at the problem and refuses publication instead of silently
    editing what they typed.
    """

    if not text or not text.strip():
        return None
    for sentence in _split_sentences(text):
        _stripped, found = _strip_destinations(sentence)
        if found:
            return found[0]
        if _PURE_ROUTING.match(sentence):
            return sentence.strip()
    return None
