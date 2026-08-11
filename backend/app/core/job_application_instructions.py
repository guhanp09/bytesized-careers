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
_EXPLICIT_URL = re.compile(r"\b(?:https?://|www\.)[^\s<>()]+", re.IGNORECASE)
_BARE_DOMAIN = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+"
    r"[a-z]{2,24}(?:/[^\s<>()]*)?",
    re.IGNORECASE,
)
# Addresses are often deliberately written so a board does not hyperlink them.
# They are still destinations, not candidate material.  Keep the pattern
# bounded to address-shaped tokens and let the same route-grammar checks below
# decide whether a dot-spelled token is actually a destination.
_OBFUSCATED_EMAIL = re.compile(
    r"\b[a-z0-9._%+-]+\s*(?:\(|\[)?at(?:\)|\])?\s*"
    r"[a-z0-9-]+(?:\s*(?:\(|\[)?dot(?:\)|\])?\s*[a-z0-9-]+)+\b",
    re.IGNORECASE,
)
_OBFUSCATED_DOMAIN = re.compile(
    r"\b[a-z0-9-]+(?:\s+(?:\(|\[)?dot(?:\)|\])?\s+[a-z0-9-]+)+"
    r"(?:\s+(?:slash|/)\s*[a-z0-9_./-]+)?\b",
    re.IGNORECASE,
)
_PHONE = re.compile(r"(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){7,14}\d")
_HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\b")

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
    # No "in": it locates the work, not the application. "confirmation that
    # you can work locally in Lisbon" was read as routing to Lisbon.
    \b(?:on|via|through|thru|to|at|using|by|over)\b
    \s+
    (?:our\s+|the\s+|this\s+|his\s+|her\s+|their\s+|my\s+|an\s+|a\s+)?
    # A lone capital is allowed because "X" is a platform, but only as a whole
    # word — a general one-character minimum let the channel match "31" in
    # "close on 31 August 2026" and swallow the deadline.
    (?P<channel>[A-Z](?![\w])|[\w .+-]{2,40}?)
    # The trailing nouns a destination phrase can end with. Missing "portal"
    # and "site" meant "through our application portal" matched only as far as
    # "application", so the word that made it a destination was never read.
    (?:\s+(?:only|directly|please|below|above|link|form|page|group|channel|
            number|id|portal|site|website|board|inbox|account|handle|profile|
            careers|application|applications|jobs|hiring))*
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
    r"use\s+(?:the|our|this|a)\s+(?:link|form|button|qr\s+code|code|careers?\s+page|website|portal)|"
    r"use\s+(?:the\s+|our\s+|this\s+|an?\s+)?application\s+(?:link|form|portal|page)|"
    r"scan\s+(?:the|our|this|a)\s+(?:qr\s+)?code|"
    r"complete\s+(?:the|our|this|a)?\s*(?:typeform|application\s+form|form)|"
    r"fill\s+(?:out|in)\s+(?:the|this|our|an?)\s+"
    r"(?:(?:google|application)\s+)?form|"
    r"click\s+(?:the\s+)?(?:apply(?:\s+now)?|here|button|link)|"
    r"visit\s+(?:our|the|this)|"
    r"follow\s+(?:our|the|these|this)\s+(?:instructions?|steps?|link)|"
    r"reply\s+to\s+(?:our|this|the\s+)?(?:original\s+)?(?:post|listing|ad|message|thread)|"
    r"leave\s+(?:us\s+)?a\s+comment|"
    r"connect\s+with\s+(?:us|me|the\s+(?:recruiter|hiring\s+manager|team))|"
    r"put\s+(?:your\s+answer|the\s+answer|it)\s+(?:in|on|through|via)|"
    r"register\s+(?:at|on|via)|"
    r"apply\s+in\s+person|"
    r"walk\s+in\s+for\s+(?:an?\s+|the\s+)?interview|"
    r"send\s+(?:it|them|these)\s+(?:on|to|via)|"
    r"(?:contact|call|text)\s+(?:us|me|the\s+(?:recruiter|hiring\s+manager|team))|"
    r"reach\s+out\s+to\s+(?:us|me|the\s+(?:recruiter|hiring\s+manager|team))|"
    r"reach\s+(?:out\s+to\s+)?(?:hr|human\s+resources?)|"
    r"write\s+to\s+(?:hr|careers?|recruit(?:er|ing)|hiring)\b|"
    r"dm\s+us|"
    r"message\s+us"
    r")\b",
    re.IGNORECASE,
)

_NAMED_CONTACT_ROUTE = re.compile(
    r"^\s*(?:Please\s+)?(?:Contact|Call|Text|Message|DM)\s+"
    r"[A-Z][A-Za-z'’-]{1,40}(?:\s+(?:directly|for\s+details|to\s+apply))?[.!?]?\s*$"
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

    # The work noun has to belong to *this* platform. "Reach out on YouTube
    # with your portfolio" has a work noun fifteen characters later, and it
    # belongs to "with your", not to "on YouTube" — reading it as portfolio
    # context protected a routing destination on sixty-one generated cases.
    #
    # So the tail is cut at the next preposition: whatever follows starts a
    # different phrase and says nothing about this one.
    raw_tail = sentence[channel_span[1] : channel_span[1] + 60]
    tail = re.split(
        r"\b(?:with|to|via|through|on|at|using|by|over|and|or)\b",
        raw_tail,
        maxsplit=1,
    )[0].lower()
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
        # A sentence-initial channel word can be either. "Email your CV and
        # showreel to x@y" uses it as a verb governing material, and the
        # composer already turns that into "Please include your CV and
        # showreel …" — stripping it here left "your CV and showreel ."
        # carried verbatim, the right words as broken English. But "WhatsApp us
        # at +91…" uses the same word as the destination itself.
        #
        # What follows it decides: material belongs to a verb, "us" belongs to a
        # channel.
        if match.start() == 0 or not sentence[: match.start()].strip():
            following = working[match.end() : match.end() + 24].strip().lower()
            addressed_to_them = re.match(
                r"^(?:us|me|the\s+team|our\s+team|him|her|them)\b", following
            )
            if not addressed_to_them:
                return match.group(0)
        if _is_portfolio_reference(sentence, match.span()):
            return match.group(0)
        found.append(match.group(0).strip())
        return ""

    return _BARE_CHANNEL.sub(replace, working), found


#: Routing actions whose destination has already been removed.
#:
#: A compound source often repeats the route as a second clause: "Submit your
#: resume to email or apply through Indeed."  Destination removal correctly
#: takes out both places, but used to leave "or apply" behind.  That fragment
#: then looked like an unstructured application material and was published as
#: "Please include ... and apply", even though it names nothing a candidate
#: should provide.
#:
#: These patterns are deliberately grammatical rather than a blanket ban on
#: the verbs.  They match only a *bare* routing action next to a conjunction;
#: "apply creative judgement" and "submit polished edits" both have objects
#: and therefore survive.  The helper is also called only after this sentence
#: demonstrably lost a destination.
_STRANDED_LEADING_ROUTE = re.compile(
    r"^\s*(?:please\s+)?"
    r"(?:e-?mail|send|submit|share|forward|upload|post|apply|message|dm|"
    r"contact|reach\s+out|ping|drop|fill|register|visit|click|use)\b"
    r"\s*,?\s*(?:and|or|then)\s+",
    re.IGNORECASE,
)

_STRANDED_COORDINATED_ROUTE = re.compile(
    r"\s*,?\s*\b(?:and|or|then)\b\s+(?:please\s+)?"
    r"(?:e-?mail|send|submit|share|forward|upload|post|apply|message|dm|"
    r"contact|reach\s+out|ping|drop|fill|register|visit|click|use)\b"
    r"(?:\s+(?:now|here|online|directly|instead))?"
    r"(?=\s*(?:[,;:.!?]|$|\b(?:and|or|then)\b))",
    re.IGNORECASE,
)


def _strip_stranded_routing_actions(working: str) -> str:
    """Remove route verbs made objectless by destination sanitisation."""

    leading_removed = bool(_STRANDED_LEADING_ROUTE.match(working))
    cleaned = _STRANDED_LEADING_ROUTE.sub("", working, count=1)
    if leading_removed:
        cleaned = re.sub(
            r"^([a-z])", lambda match: match.group(1).upper(), cleaned, count=1
        )
    return _STRANDED_COORDINATED_ROUTE.sub("", cleaned)


#: A sentence that is telling the candidate to send something somewhere.
#:
#: This is the open-vocabulary half of the decision, and it is why the channel
#: list is no longer the thing that decides. Generated route-vs-skill pairs made
#: the cost of membership-only reasoning exact: 144 of 616 genuine routing
#: sentences leaked because the platform was one nobody had typed in — Skype,
#: Teams, Jotform, Insta — and 63 legitimate sentences lost their platform
#: because it happened to be one somebody had.
#:
#: Grammar separates them where a dictionary cannot. "Send your portfolio on
#: WhatsApp" is governed by a routing verb; "Run paid campaigns on WhatsApp" is
#: governed by a verb that sends nothing. The platform is identical and only one
#: of them is a destination.
_ROUTE_GOVERNED = re.compile(
    r"""^\s*(?:please\s+)?(?:
        (?:e-?mail|send|submit|share|forward|upload|post|apply|message|dm|
           contact|reach\s+out|ping|drop|get\s+in\s+touch|fill|register|
           visit|click|use|write\s+to|address)\b
      | (?:applications?|submissions?|entries|cvs?|r[eé]sum[eé]s?|portfolios?)
        # "to/via/through/using" only. "on" and "at" also introduce dates —
        # "Applications close on 31 August" is a deadline, and reading it as a
        # routing instruction ate the date out of the published note.
        \b[^.]{0,40}?\b(?:to|via|through|using)\b
    )""",
    re.IGNORECASE | re.VERBOSE,
)

#: The same instruction arriving after a conjunction: "…, and send it to X".
_ROUTE_GOVERNED_CLAUSE = re.compile(
    r"\b(?:and|then|or)\s+(?:please\s+)?"
    r"(?:e-?mail|send|submit|share|forward|upload|apply|message|dm|contact|"
    r"reach\s+out|ping|drop)\b",
    re.IGNORECASE,
)

# ``in`` is intentionally absent from the generic destination grammar because
# it commonly describes the work ("edit in Premiere") or location ("work in
# Chennai").  Inside an application/screening instruction, however, these
# bounded channel containers are unambiguously delivery routes.
_IN_CHANNEL_DESTINATION = re.compile(
    r"\s*\b(?:in|inside)\b\s+"
    r"(?:our\s+|the\s+|this\s+|a\s+)?"
    r"(?:slack|discord|microsoft\s+teams|teams|telegram|whats\s*app|"
    r"google\s+forms?|typeform|direct\s+message|private\s+message|dm|inbox)"
    r"(?:\s+(?:workspace|server|channel|group|form|thread|room|message))?\b",
    re.IGNORECASE,
)


def _is_route_governed(sentence: str, *, address_found: bool) -> bool:
    """Whether this sentence is an instruction to send something somewhere.

    An address, a URL or a phone number settles it on its own: nothing puts one
    of those in a job description except to be written to. Otherwise the verb
    decides, because a destination needs something to send.
    """

    if address_found:
        return True
    return bool(
        _ROUTE_GOVERNED.match(sentence) or _ROUTE_GOVERNED_CLAUSE.search(sentence)
    )


def _strip_destinations(
    sentence: str, *, assume_routing: bool = False
) -> tuple[str, list[str]]:
    """Remove routing phrases from one sentence, keeping everything else.

    ``assume_routing`` is for callers that already know the sentence is an
    instruction about *how to apply* — a screening question, for instance,
    never legitimately ends with a delivery channel, so "tell us why you want
    the job on WhatsApp" has a destination even though "tell" sends nothing.
    """

    found: list[str] = []
    working = sentence

    # Schemed URLs, actual email addresses, phones and handles identify
    # contact routes on their own. A bare dotted token does not: Node.js,
    # Three.js and Frame.io are ordinary work vocabulary. Bare/obfuscated
    # domains are removed only when application-routing grammar supplies the
    # missing destination semantics.
    for pattern in (_EMAIL, _EXPLICIT_URL, _PHONE, _HANDLE, _OBFUSCATED_EMAIL):
        for match in pattern.findall(working):
            found.append(match if isinstance(match, str) else str(match))
        working = pattern.sub("", working)

    route_shaped = bool(
        _ROUTE_GOVERNED.match(sentence)
        or _ROUTE_GOVERNED_CLAUSE.search(sentence)
        or _PURE_ROUTING.match(sentence)
    )

    def _bare_domain_is_destination(match: re.Match[str]) -> bool:
        token = match.group(0)
        head = sentence[max(0, match.start() - 36) : match.start()]
        # A path is a route even when the source omitted its scheme. Otherwise
        # require an actual delivery preposition or a direct address after a
        # contact verb. This preserves "Share two Node.js samples" and
        # "review work in Frame.io" while still removing
        # "send it to jobs.example.com" and "email careers.example.com".
        if "/" in token:
            return route_shaped
        if re.search(r"\b(?:to|at|via|through|on|using|over)\s+$", head, re.I):
            return route_shaped
        return bool(
            re.search(
                r"(?:^|\b)(?:e-?mail|dm|message|contact|write\s+to)\s+$",
                head,
                re.IGNORECASE,
            )
        )

    if route_shaped:
        for match in list(_BARE_DOMAIN.finditer(working)):
            if _bare_domain_is_destination(match):
                found.append(match.group(0))
        working = _BARE_DOMAIN.sub(
            lambda match: "" if _bare_domain_is_destination(match) else match.group(0),
            working,
        )
        for match in _OBFUSCATED_DOMAIN.findall(working):
            found.append(match if isinstance(match, str) else str(match))
        working = _OBFUSCATED_DOMAIN.sub("", working)

    route_governed = assume_routing or _is_route_governed(
        sentence, address_found=bool(found)
    )

    #: Words that are capitalised without naming a place.
    #:
    #: "INR 29167 per MONTH" put MONTH after a preposition in a sentence that
    #: read as routing, and an all-caps unit became a destination. And routing
    #: *to CreatorJobs* is not external routing at all — "Apply through
    #: CreatorJobs" is the product describing itself, and flagging it made the
    #: seed data unpublishable.
    _NOT_A_DESTINATION = {
        "creatorjobs",
        "creator jobs",
        "month",
        "months",
        "week",
        "weeks",
        "day",
        "days",
        "year",
        "years",
        "hour",
        "hours",
        "mo",
        "hr",
        "yr",
        "usd",
        "inr",
        "eur",
        "gbp",
    }

    def _looks_like_a_place(text: str) -> bool:
        """Whether a prepositional object actually names somewhere to send to.

        Being inside a routing instruction is not enough on its own. "Send us
        your portfolio and a note on your approach" is governed by "Send", and
        treating every prepositional object as a destination turned it into
        "a note approach" — the recruiter's own wording, mangled, on a public
        page.

        A destination is a named place: a proper noun, or one of the words that
        means "somewhere applications go". A lowercase common noun after a
        possessive is the candidate's work or the recruiter's meaning.
        """

        cleaned = text.strip().strip(".,;:")
        if not cleaned:
            return False
        if cleaned.casefold() in _NOT_A_DESTINATION:
            return False
        if re.search(
            # No "platform" or "app": "decide what to adapt by platform" means
            # per social network, and reading it as a destination stripped a
            # recruiter's own responsibility out of their listing.
            r"\b(?:form|portal|site|website|page|link|board|inbox|"
            r"address|number|group|channel|handle|profile)\b",
            cleaned,
            re.IGNORECASE,
        ):
            return True
        # A proper noun: a capitalised word that is not the sentence's first.
        return bool(re.match(r"[A-Z]", cleaned)) and not sentence.strip().startswith(
            cleaned
        )

    def _is_a_date_or_time(text: str) -> bool:
        """Whether a prepositional object is a moment rather than a place.

        "Please apply by 5:00 PM on 31 August 2026" is route-governed — it opens
        with "apply" — and without this the date became the destination and the
        whole deadline sentence was refused as unsafe. A place is never a bare
        number.
        """

        cleaned = text.strip().strip(".,;:")
        if not cleaned:
            return True
        if re.fullmatch(r"[\d\s:.,/+-]+", cleaned):
            return True
        return bool(
            re.match(
                r"^\d{1,4}\b|^(?:january|february|march|april|may|june|july|"
                r"august|september|october|november|december|mon|tue|wed|thu|"
                r"fri|sat|sun)\b",
                cleaned,
                re.IGNORECASE,
            )
        )

    def _object_of(match: re.Match[str]) -> str:
        """Everything the phrase matched after its preposition and determiner.

        Judging `match.group("channel")` alone repeats the bug that let "to our
        careers page" through: the optional suffix group swallows the portal
        noun, so the channel is "careers" or "external" and the word that made
        it a destination is no longer being looked at.
        """

        return re.sub(
            r"^\s*,?\s*\b(?:on|via|through|thru|to|at|using|by|over)\b\s+"
            r"(?:our\s+|the\s+|this\s+|his\s+|her\s+|their\s+|my\s+|an\s+|a\s+)?",
            "",
            match.group(0),
            flags=re.IGNORECASE,
        )

    def replace(match: re.Match[str]) -> str:
        # Inside a routing instruction the prepositional object is the
        # destination, whatever it is called. That is what makes an unseen
        # platform safe: the sentence, not the word, is the evidence.
        phrase = _object_of(match)
        if (
            route_governed
            and _looks_like_a_place(phrase)
            and not _is_a_date_or_time(phrase)
            and not _is_portfolio_reference(sentence, match.span("channel"))
        ):
            found.append(match.group(0).strip())
            return ""

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
        if whole is not None and route_governed:
            # A phrase that names a destination outright is not ambiguous, and
            # the portfolio heuristic must not get a vote on it. "page" is a
            # portfolio marker — "your Instagram page" — and it is also the
            # second half of "careers page", so the heuristic read a destination
            # as a description of the candidate's own work and published it.
            #
            # Still gated on the sentence being a routing instruction, because
            # naming a channel is not the same as routing to one: "Report on
            # Instagram engagement weekly" names one and sends nothing.
            found.append(match.group(0).strip())
            return ""

        # Outside a routing instruction, a platform name is job content.
        #
        # Membership used to be enough on its own, and it cost 37 legitimate
        # responsibilities their platform: "Run paid campaigns on WhatsApp"
        # became "Run paid campaigns", because WhatsApp was on a list and the
        # sentence was never asked what it was doing. A recruiter who wrote
        # that lost the only detail that made the task specific.
        return match.group(0)

    working = _DESTINATION_PHRASE.sub(replace, working)
    if route_governed:
        for match in _IN_CHANNEL_DESTINATION.findall(working):
            found.append(match.strip())
        working = _IN_CHANNEL_DESTINATION.sub("", working)
    if found:
        # Only when this sentence demonstrably carried routing that was just
        # removed. A bare channel name is otherwise ordinary vocabulary —
        # "Familiarity with WhatsApp marketing helps" names a skill, and
        # stripping it would cost the recruiter the requirement they wrote.
        working, stranded = _strip_stranded_channels(sentence, working)
        found.extend(stranded)
        working = _strip_stranded_routing_actions(working)
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


#: Words that stand in for the materials instead of naming one.
_STAND_INS: Final[frozenset[str]] = frozenset(
    {"everything", "it", "them", "these", "those", "all", "anything", "this", "that"}
)


def _names_nothing(fragment: str) -> bool:
    """Whether a reduced fragment asks for nothing in particular."""

    words = [word.casefold() for word in re.findall(r"[A-Za-z]{2,}", fragment)]
    meaningful = [
        word
        for word in words
        if word not in _STAND_INS
        and word
        not in {
            # Connectives left behind by removal carry no request of their own.
            "to",
            "at",
            "on",
            "via",
            "send",
            "share",
            "submit",
            "include",
            "attach",
            "upload",
            "provide",
            "forward",
            "email",
            "please",
            "us",
            "me",
            "your",
            "our",
            "the",
            "with",
        }
    ]
    return not meaningful


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
    # Removing a final connective or preposition can create a new whitespace
    # gap before punctuation after the first punctuation pass has already run.
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"^[\s,;:.]+", "", cleaned)
    cleaned = re.sub(
        r"\b(?:at|by|in|inside|on|through|to|via)\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).rstrip(" ,;:")
    cleaned = cleaned.strip()
    if cleaned and cleaned[-1] not in ".!?":
        cleaned = f"{cleaned}."
    return cleaned


def separate_application_instructions(
    text: str | None, *, assume_routing: bool = False
) -> ApplicationInstructions:
    """Take a source's application wording apart into its two different facts."""

    if not text or not text.strip():
        return ApplicationInstructions()

    safe: list[str] = []
    destinations: list[str] = []
    sanitized = False

    for sentence in _split_sentences(text):
        stripped, found = _strip_destinations(sentence, assume_routing=assume_routing)
        if found:
            sanitized = True
            destinations.extend(found)

        if (
            _PURE_ROUTING.match(sentence) or _NAMED_CONTACT_ROUTE.match(sentence)
        ) and not _also_asks_for_something(sentence):
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

        # A sentence that just lost a destination is known to be an ask, the
        # same way a routing reduction is. "Email your availability on
        # WhatsApp" reduces to "your availability" — two words, and the
        # fragment filter threw away nineteen generated requirements that way.
        reduced = bool(found)
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
        # A fragment whose only object stands in for the materials names none
        # of them. "Send everything to our careers page" reduces to "Send
        # everything", and publishing "Please include everything with your
        # CreatorJobs application" reads as an instruction while carrying no
        # instruction at all.
        if reduced and _names_nothing(tidied):
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
        if _PURE_ROUTING.match(sentence) or _NAMED_CONTACT_ROUTE.match(sentence):
            return sentence.strip()
    return None
