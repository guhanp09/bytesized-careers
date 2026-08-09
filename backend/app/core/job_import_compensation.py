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
from dataclasses import dataclass
from typing import Final

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
    (?:(?P<currency>INR|US\$|USD|EUR|GBP|AED|SGD|Rs\.?|rupees?|dollars?|euros?|pounds?)\s*)?
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
        "inr", "rs", "usd", "eur", "gbp", "aed", "sgd", "rupees", "dollars",
        "per", "an", "month", "monthly", "months", "year", "yearly", "years",
        "annum", "annually", "annual", "hour", "hourly", "hours", "week",
        "weekly", "day", "daily", "project", "video", "post", "episode",
        "piece", "pm", "pa", "mo", "hr", "yr",
    }
)


@dataclass(frozen=True)
class StatedPay:
    """Pay as a page stated it, before the product's own vocabulary applies.

    ``minimum`` and ``maximum`` are both optional because a page is allowed to
    state only one end. Collapsing "up to ₹20,000" into a flat ₹20,000 would
    turn a ceiling into a promise, which is the same class of error as reading a
    monthly rate as an annual one.
    """

    currency: str
    unit: str | None
    minimum: int | None = None
    maximum: int | None = None
    #: exact | range | at_most | at_least
    kind: str = "exact"
    #: The slice of text this came from, for evidence.
    text: str = ""


def owns_its_line(line: str, stated: StatedPay | None = None) -> bool:
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


def _value(number: str, magnitude: str | None) -> int | None:
    digits = number.replace(",", "")
    try:
        amount = float(digits)
    except ValueError:  # pragma: no cover - the pattern already requires digits
        return None
    if magnitude:
        amount *= _MAGNITUDES[magnitude.casefold()]
    if amount <= 0:
        return None
    return int(round(amount))


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
        second: int | None = None
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

        unit, after_period = _period_after(text, end)
        if unit is None:
            # An amount with no period is not a rate, and supplying one would
            # understate an annual salary twelvefold.
            continue
        end = after_period

        excerpt = text[start:end].strip()

        if second is not None:
            low, high = sorted((first, second))
            if _BETWEEN.search(before):
                start = _BETWEEN.search(before).start()  # type: ignore[union-attr]
            return StatedPay(
                currency=currency,
                unit=unit,
                minimum=low,
                maximum=high,
                kind="range",
                text=text[start:end].strip(),
            )

        if _AT_MOST.search(before):
            # A ceiling is not a rate. The product has no open-ended range, so
            # the floor stays unknown and the recruiter is asked for that alone.
            return StatedPay(
                currency=currency,
                unit=unit,
                maximum=first,
                kind="at_most",
                text=excerpt,
            )
        if _AT_LEAST.search(before):
            return StatedPay(
                currency=currency,
                unit=unit,
                minimum=first,
                kind="at_least",
                text=excerpt,
            )

        return StatedPay(
            currency=currency,
            unit=unit,
            minimum=first,
            kind="exact",
            text=excerpt,
        )

    return None
