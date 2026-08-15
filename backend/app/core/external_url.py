"""What a user-supplied link is allowed to be before it is stored.

Three different questions get asked about a URL in this product and they have
three different answers:

* **May it be stored?** — this module. A person is describing where their work
  lives, so the value is theirs and mostly untrusted text; the rule is about
  what could later be executed or navigated to.
* **May it be rendered as a link or an image?** — the render layer's contract.
  A stored value is not automatically safe to put in an `href`, and legacy rows
  written before this module existed must still fail closed there.
* **May the server fetch it?** — `SafeOutboundFetcher`, and only that. Its
  policy is about networks: private addresses, DNS pinning, redirects. Reusing
  it here would be wrong in both directions — it would reject a perfectly good
  link whose host happens to be unreachable right now, and it would accept
  scheme tricks that never reach the network layer at all.

The dangerous part of a stored URL is its scheme. `javascript:` in an `href`
executes; `data:text/html` navigates to attacker-authored markup with the
victim's origin in the address bar; `file:` and `blob:` are neither the person's
portfolio nor anything a browser should be pointed at from a profile page. Those
are refused on write.

Refusal is deliberately narrow otherwise. A creator pasting an unusual but real
link should not be told their portfolio is invalid because a validator was
strict about a hostname it had not seen; the rule is "a browser could safely be
pointed at this", not "this looks like a URL I recognise".
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

#: Schemes a stored link may use. Everything else is refused rather than
#: sanitised, because a link the product cannot safely offer is not a link.
ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})

#: Control characters, including the ones that survive a copy-paste out of a
#: document and would otherwise be smuggled into an attribute.
_CONTROL = frozenset(chr(code) for code in range(0x20)) | {chr(0x7F)}


class ExternalUrlError(ValueError):
    """A stored link the product will not accept."""


def canonicalize_external_url(value: str | None, *, max_length: int = 2048) -> str | None:
    """Normalize one user-supplied link, or refuse it.

    Returns ``None`` for an empty value, because "no link" is a legitimate
    answer everywhere this is used. Anything present must survive every check;
    there is no partial acceptance, since a half-trusted URL still ends up in an
    attribute somewhere.
    """

    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if len(candidate) > max_length:
        raise ExternalUrlError("This link is too long.")
    if any(character in _CONTROL for character in candidate):
        raise ExternalUrlError("This link contains characters that are not allowed.")

    # A bare domain is what people actually type. Assuming https is a product
    # decision, not a security one: the value is re-checked below either way.
    if "://" not in candidate and not candidate.lower().startswith(("javascript:", "data:", "vbscript:", "file:", "blob:", "mailto:", "tel:")):
        candidate = f"https://{candidate}"

    try:
        parts = urlsplit(candidate)
    except ValueError as exc:
        raise ExternalUrlError("Enter a valid link.") from exc

    scheme = parts.scheme.casefold()
    if scheme not in ALLOWED_SCHEMES:
        raise ExternalUrlError("Links must start with http:// or https://.")
    if parts.username is not None or parts.password is not None:
        raise ExternalUrlError("Links cannot contain a username or password.")
    if not parts.hostname:
        raise ExternalUrlError("Enter a valid link.")

    hostname = parts.hostname.casefold()
    if "." not in hostname.strip(".") or hostname.startswith(".") or hostname.endswith("."):
        # A single label is either an internal name or a typo. Neither is a
        # public link somebody meant to share.
        raise ExternalUrlError("Enter a valid link, like example.com/your-work.")

    try:
        # Raises for an impossible port; leaves an ordinary one intact.
        port = parts.port
    except ValueError as exc:
        raise ExternalUrlError("Enter a valid link.") from exc

    netloc = hostname if port is None else f"{hostname}:{port}"
    normalized = urlunsplit((scheme, netloc, parts.path, parts.query, parts.fragment))
    if len(normalized) > max_length:
        raise ExternalUrlError("This link is too long.")
    return normalized


def stored_external_url(max_length: int = 2048):
    """A Pydantic validator for one stored-link field.

    Written as a factory so each field keeps its own length bound: a portfolio
    source URL and a profile avatar URL are different columns with different
    limits, and silently widening one to match the other would be a schema
    change wearing a validator's clothes.
    """

    def _validate(value: str | None) -> str | None:
        return canonicalize_external_url(value, max_length=max_length)

    return _validate
