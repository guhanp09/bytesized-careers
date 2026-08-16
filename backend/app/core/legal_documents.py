"""Which legal documents exist, and which version of each is current.

The point of versioning is that "the user accepted the terms" is not a fact
worth recording. The fact worth recording is *which* terms, on what date —
because when the terms change, an acceptance of the old ones stops answering
the question anyone will actually ask.

So a version is part of the identity of an acceptance, not an attribute of the
user. Nothing here flips a boolean.

The versions themselves are code rather than data on purpose. A document's text
ships with the release that references it, so the version a running server asks
for is always one whose wording exists. Storing the current version in the
database would allow a row to name a document this build cannot render.

This module deliberately contains NO legal text. Writing the wording, and having
it reviewed, is external work (LEGAL-001/002); what is built here is the
machinery that will carry whatever the wording turns out to be.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

#: The documents a person must accept to use the platform. Adding one here makes
#: it required at the next acceptance check, which is the intended way to
#: introduce a new agreement.
TERMS = "terms_of_service"
PRIVACY = "privacy_policy"


@dataclass(frozen=True)
class LegalDocument:
    key: str
    version: str
    effective_on: date


#: Versions are dates rather than counters: an acceptance record is read by
#: people asking "what were they shown in June", and `2026-06-01` answers that
#: without a lookup table. Bumping one requires the new wording to ship in the
#: same release, which is why these live in code.
CURRENT_DOCUMENTS: dict[str, LegalDocument] = {
    TERMS: LegalDocument(key=TERMS, version="2026-06-01", effective_on=date(2026, 6, 1)),
    PRIVACY: LegalDocument(key=PRIVACY, version="2026-06-01", effective_on=date(2026, 6, 1)),
}

REQUIRED_DOCUMENTS: tuple[str, ...] = (TERMS, PRIVACY)


def current_version(document_key: str) -> str:
    """The version a new acceptance would be recorded against.

    Raises for an unknown key rather than inventing one: a typo would otherwise
    create acceptances for a document that does not exist, and they would look
    exactly like real ones.
    """

    document = CURRENT_DOCUMENTS.get(document_key)
    if document is None:
        raise KeyError(f"Unknown legal document: {document_key!r}")
    return document.version


def outstanding_documents(accepted: dict[str, str]) -> tuple[str, ...]:
    """Which required documents this person has not accepted at the current version.

    Pure, and takes what was accepted rather than a user, so the rule can be read
    and tested without a database. `accepted` maps document key to the highest
    version that person has accepted.

    A person who accepted an older version is treated exactly like one who never
    accepted at all. That is the whole reason versions exist — anything else
    would let a change to the terms take effect without anyone agreeing to it.
    """

    return tuple(
        key
        for key in REQUIRED_DOCUMENTS
        if accepted.get(key) != current_version(key)
    )
