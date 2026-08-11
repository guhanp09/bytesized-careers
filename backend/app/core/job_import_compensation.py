"""Money, in the shapes job pages actually write it.

Asking a recruiter what a role pays, about a page that says what it pays, is the
worst question this assistant can ask. It proves it did not read. The reported
case was a listing headed ``Up to ₹20,000 a month`` — the figure is in the first
screenful, and the draft arrived with no pay at all and a question about it.

Three separate gaps produced that, and each one is a family rather than an
example:

* **No magnitude.** ``20k`` parsed as twenty. A grammar that reads ``₹20k`` as
  ₹20 is worse than one that reads nothing, because twenty rupees a month is a
  number the rest of the pipeline will happily carry to a candidate.
* **No qualifiers or ranges.** ``Up to X``, ``From X``, ``X – Y`` and
  ``between X and Y`` are how pay is normally written; only a bare single figure
  was understood.
* **Labels only.** Pay was read solely when it sat under a ``Compensation:``
  label at the start of a line. Most boards render it as a bare line or inside a
  sentence, so the commonest rendering of all was invisible.

Two rules keep this from inventing pay, and both are deliberate:

*A figure is only money if a currency says so.* "8 videos per month" is a
quantity, and no amount of context makes it a rate. Requiring a currency symbol
or word is what separates the two, and it is why this module never guesses.

*A rate needs all three parts, and a missing one is never supplied.* ``₹5,000``
with no period is not a monthly rate waiting to be assumed — defaulting the
period would understate an annual salary twelvefold, and defaulting the currency
on a dollar page would understate it eightyfold. Reading nothing is better than
either, so an incomplete figure returns ``None``.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Final

from app.core.job_import_facts import Quantity

#: Multipliers a page can attach to a figure. Indian pages use lakh and crore
#: as freely as Western ones use k and m.
_MAGNITUDES: Final[dict[str, int]] = {
    "k": 1_000,
    "thousand": 1_000,
    "l": 100_000,
    "lac": 100_000,
    "lacs": 100_000,
    "lakh": 100_000,
    "lakhs": 100_000,
    "m": 1_000_000,
    "mn": 1_000_000,
    "million": 1_000_000,
    "millions": 1_000_000,
    "cr": 10_000_000,
    "crore": 10_000_000,
    "crores": 10_000_000,
}

_SYMBOL_CURRENCY: Final[dict[str, str]] = {
    "₹": "INR",
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
}

_WORD_CURRENCY: Final[dict[str, str]] = {
    "inr": "INR",
    "rs": "INR",
    "rs.": "INR",
    "rupee": "INR",
    "rupees": "INR",
    "usd": "USD",
    "us$": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "eur": "EUR",
    "euro": "EUR",
    "euros": "EUR",
    "gbp": "GBP",
    "pound": "GBP",
    "pounds": "GBP",
    "aed": "AED",
    "sgd": "SGD",
    "cad": "CAD",
    "aud": "AUD",
}

#: How a stated period maps onto the product's own units. ``pm`` and ``pa`` are
#: here because Indian listings use them constantly and they are not obviously
#: derivable from the longer spellings.
_UNITS: Final[dict[str, str]] = {
    "mo": "per month",
    "month": "per month",
    "months": "per month",
    "monthly": "per month",
    "pm": "per month",
    "p.m.": "per month",
    "hr": "per hour",
    "hrs": "per hour",
    "hour": "per hour",
    "hours": "per hour",
    "hourly": "per hour",
    "yr": "per year",
    "year": "per year",
    "years": "per year",
    "yearly": "per year",
    "annual": "per year",
    "annually": "per year",
    "annum": "per year",
    "pa": "per year",
    "p.a.": "per year",
    "week": "per week",
    "weekly": "per week",
    "day": "per day",
    "daily": "per day",
    "project": "per project",
    "video": "per video",
    "piece": "per deliverable",
    "post": "per post",
    "episode": "per episode",
}

#: One figure: an optional currency, the number, an optional magnitude.
#:
#: The magnitude carries its own boundary *inside* the optional group. Attaching
#: it outside meant "₹5000 monthly" failed the lookahead after matching no
#: magnitude at all, which is the same class of bug as the ``a``/``annually``
#: collision this grammar was already carrying.
_FIGURE = re.compile(
    r"""
    (?:(?P<symbol>[₹$€£])\s*)?
    (?:(?P<currency>INR|US\$|USD|EUR|GBP|AED|SGD|CAD|AUD|Rs\.?|rupees?|dollars?|euros?|pounds?)\s*)?
    (?P<number>\d[\d,]*(?:\.\d+)?)
    (?:\s*(?P<magnitude>k|thousand|lakhs?|lacs?|L|crores?|cr|millions?|mn|m)(?![A-Za-z\d]))?
    """,
    re.IGNORECASE | re.VERBOSE,
)

#: A period, immediately after a figure. ``/-`` is an Indian rupee terminator
#: and means nothing about the period, so it is stepped over rather than read.
#: ``match(text, index)`` already anchors at ``index``; a leading ``^`` would
#: still mean the start of the whole string and never match at all.
_PERIOD = re.compile(
    r"""
    \s*(?:/-)?\s*
    (?:(?P<separator>/|per|an\b|a\b|p)\s*)?
    (?P<unit>p\.m\.|p\.a\.|pm|pa|mo|months?|monthly|hrs?|hours?|hourly|yr|years?|yearly|
       annually|annual|annum|weekly|week|daily|day|project|video|piece|post|episode)
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)

#: Wording that makes a figure a ceiling rather than the rate.
_AT_MOST = re.compile(
    r"(?:up\s*to|upto|maximum(?:\s+of)?|max(?:\s+of)?|no\s+more\s+than|"
    r"not\s+exceeding|under)\s*$",
    re.IGNORECASE,
)

#: Wording that makes a figure a floor.
_AT_LEAST = re.compile(
    r"(?:starting(?:\s+(?:at|from))?|from|minimum(?:\s+of)?|min(?:\s+of)?|"
    r"at\s+least|upwards\s+of|above|over)\s*$",
    re.IGNORECASE,
)

#: Wording that makes a figure approximate rather than stated.
_APPROXIMATE = re.compile(
    r"(?:around|approx(?:\.|imately)?|about|roughly|circa|c\.|~)\s*$",
    re.IGNORECASE,
)

#: Pay a page declines to put a number on at all. Not a figure, and not a gap
#: either — the page answered, and the answer was "we will discuss it".
_NEGOTIABLE = re.compile(
    r"\b(?:negotiable|competitive|commensurate\s+with\s+experience|"
    r"depending\s+on\s+experience|as\s+per\s+(?:industry\s+)?standards?|"
    r"open\s+to\s+discussion|doe|best\s+in\s+industry)\b",
    re.IGNORECASE,
)

#: What joins the two ends of a range. Anchored by ``match(text, index)``, so no
#: leading ``^`` — see the note on ``_PERIOD``.
_RANGE_JOIN = re.compile(r"\s*(?:-|–|—|to|and|~)\s*", re.IGNORECASE)

#: "between X and Y" — the qualifier sits before the first figure.
_BETWEEN = re.compile(r"between\s*$", re.IGNORECASE)


#: Any run of two or more letters — a "word" for the purpose of asking what else
#: is on the line besides the money.
_WORD = re.compile(r"[^\W\d_]{2,}", re.UNICODE)

#: Words that may keep a money expression company and still leave the line about
#: pay. Anything else means the figure is a clause inside a sentence about
#: something else — a reimbursement, a client budget, a previous salary — and
#: those are figures the page states without offering them.
#:
#: Deliberately a closed set of *function* words and pay vocabulary rather than
#: a blocklist of disqualifying nouns. A blocklist has to anticipate every way a
#: page can mention money it is not offering; this only has to describe how pay
#: itself is written.
_PAY_LINE_COMPANY: Final[frozenset[str]] = frozenset(
    {
        # qualifiers and connectives
        "up", "to", "upto", "from", "starting", "at", "between", "and", "or",
        "of", "maximum", "max", "minimum", "min", "upwards", "above", "over",
        "no", "more", "than", "not", "exceeding", "under", "around", "about",
        "approx", "approximately", "est", "estimated", "roughly", "circa",
        # what the line is calling itself
        "salary", "pay", "paid", "compensation", "stipend", "budget", "rate",
        "remuneration", "ctc", "fee", "fees", "payout", "earnings", "income",
        # currencies and periods, which the grammar has already consumed once
        "inr", "rs", "usd", "eur", "gbp", "aed", "sgd", "cad", "aud", "rupees", "dollars",
        "per", "an", "month", "monthly", "months", "year", "yearly", "years",
        "annum", "annually", "annual", "hour", "hourly", "hours", "week",
        "weekly", "day", "daily", "project", "video", "post", "episode",
        "piece", "pm", "pa", "mo", "hr", "yr",
    }
)


#: Kept as the module's own name for the fact it produces. The shape is the
#: shared :class:`~app.core.job_import_facts.Quantity`, so pay is not a special
#: case of anything — it is the first field to use the general representation.
StatedPay = Quantity


def owns_its_line(line: str, stated: Quantity | None = None) -> bool:
    """Whether a line is *about* pay, rather than mentioning a figure.

    Job boards print pay as its own line — "Up to ₹20,000 a month". Prose that
    happens to contain money reads differently: "Previous salary of ₹30,000 per
    month will be verified" carries a currency and a period and is still not
    what the job offers.

    Asking what else is on the line separates the two structurally, without a
    list of the ways a page can mention money it is not paying.
    """

    if stated is None:
        return False
    residue = line.replace(stated.text, " ")
    return all(word.casefold() in _PAY_LINE_COMPANY for word in _WORD.findall(residue))


def _value(number: str, magnitude: str | None) -> int | float | None:
    digits = number.replace(",", "")
    try:
        amount = Decimal(digits)
    except InvalidOperation:  # pragma: no cover - the pattern already requires digits
        return None
    if magnitude:
        amount *= _MAGNITUDES[magnitude.casefold()]
    if amount <= 0:
        return None
    # Preserve a page's exact fractional rate.  The previous round-to-int path
    # turned ``$25.50/hour`` into $26 and ``$0.50/hour`` into nothing, which is
    # a materially different offer.  Native Decimal fields accept either this
    # integral representation or the finite decimal float unchanged.
    return int(amount) if amount == amount.to_integral_value() else float(amount)


def _currency_of(match: re.Match[str]) -> str | None:
    word = match.group("currency")
    if word:
        return _WORD_CURRENCY.get(word.casefold())
    return _SYMBOL_CURRENCY.get(match.group("symbol") or "")


def _period_after(text: str, index: int) -> tuple[str | None, int]:
    """The unit stated straight after a figure, and where it ends."""

    match = _PERIOD.match(text, index)
    if not match:
        return None, index
    return _UNITS.get(match.group("unit").casefold()), match.end()


def read_pay(text: str) -> StatedPay | None:
    """The pay a piece of text states, or nothing."""

    if not text:
        return None

    for anchor in _FIGURE.finditer(text):
        currency = _currency_of(anchor)
        if not currency:
            # A number with no currency is a quantity. "8 videos per month" is
            # the case this rule exists for, and it is extremely common.
            continue

        first = _value(anchor.group("number"), anchor.group("magnitude"))
        if first is None:
            continue

        before = text[: anchor.start()]
        start, end = anchor.start(), anchor.end()

        # A range: the second end may drop the currency, the magnitude, or both.
        # "₹15,000 - 20,000 a month" and "₹15-20k a month" are both ordinary.
        second: int | float | None = None
        joined = _RANGE_JOIN.match(text, end)
        if joined:
            follower = _FIGURE.match(text, joined.end())
            if follower:
                follower_currency = _currency_of(follower)
                if follower_currency in (None, currency):
                    magnitude = follower.group("magnitude") or anchor.group("magnitude")
                    second = _value(follower.group("number"), magnitude)
                    if second is not None:
                        # "₹15-20k" states one magnitude for both ends. Reading
                        # the first as fifteen rupees against twenty thousand is
                        # a thousandfold spread nobody wrote.
                        if not anchor.group("magnitude") and follower.group("magnitude"):
                            inherited = _value(
                                anchor.group("number"), follower.group("magnitude")
                            )
                            if inherited is not None and inherited <= second:
                                first = inherited
                        end = follower.end()

        trailing_plus = bool(re.match(r"\s*\+", text[end:]))
        if trailing_plus:
            end = re.match(r"\s*\+", text[end:]).end() + end  # type: ignore[union-attr]

        unit, after_period = _period_after(text, end)
        if unit is None:
            # An amount with no period is not a rate, and supplying one would
            # understate an annual salary twelvefold.
            continue
        end = after_period

        excerpt = text[start:end].strip()

        if second is not None:
            if _BETWEEN.search(before):
                start = _BETWEEN.search(before).start()  # type: ignore[union-attr]
            return Quantity(
                qualifier="range",
                # Source order is semantic: the first number is the stated
                # floor and the second the stated ceiling.  Sorting an invalid
                # ``50,000–30,000`` silently rewrote the employer's text into a
                # plausible offer.  Preserve it so merged validation can flag
                # the contradiction for review.
                minimum=first,
                maximum=second,
                unit=unit,
                currency=currency,
                text=text[start:end].strip(),
            )

        if trailing_plus:
            # "₹20,000+/month" is a floor written after the number rather than
            # before it. Reading it as exact drops the "+", which is the whole
            # of what the employer promised.
            return Quantity(
                qualifier="minimum_only",
                minimum=first,
                unit=unit,
                currency=currency,
                text=excerpt,
            )

        if _AT_MOST.search(before):
            # A ceiling is not a rate. The product has no open-ended range, so
            # the floor stays unknown and the recruiter is asked for that alone.
            return Quantity(
                qualifier="maximum_only",
                maximum=first,
                unit=unit,
                currency=currency,
                text=excerpt,
            )
        if _AT_LEAST.search(before):
            return Quantity(
                qualifier="minimum_only",
                minimum=first,
                unit=unit,
                currency=currency,
                text=excerpt,
            )

        if _APPROXIMATE.search(before):
            # "around ₹20,000 a month" states a figure and declines to stand by
            # it exactly. Recording it as exact would make the page more precise
            # than its author was willing to be.
            return Quantity(
                qualifier="approximate",
                minimum=first,
                maximum=first,
                unit=unit,
                currency=currency,
                text=excerpt,
            )

        return Quantity(
            qualifier="exact",
            minimum=first,
            unit=unit,
            currency=currency,
            text=excerpt,
        )

    if _NEGOTIABLE.search(text):
        # No figure, and not a gap either: the page was asked what it pays and
        # said "we will discuss it". Recording that stops the assistant asking
        # the same question back.
        return Quantity(qualifier="negotiable", text=_NEGOTIABLE.search(text).group(0))  # type: ignore[union-attr]

    return None
