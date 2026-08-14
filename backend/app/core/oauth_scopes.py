from __future__ import annotations

GOOGLE_YOUTUBE_READONLY_SCOPE = (
    "https://www.googleapis.com/auth/youtube.readonly"
)


def parse_oauth_scopes(value: str | None) -> frozenset[str]:
    """Parse a provider's space-delimited scope response exactly.

    Exact tokens matter here: substring checks can mistake an attacker-chosen
    lookalike such as ``example/youtube.readonly.evil`` for a real grant.
    """

    if not value:
        return frozenset()
    return frozenset(part for part in value.split() if part)


def has_google_youtube_read_scope(value: str | None) -> bool:
    return GOOGLE_YOUTUBE_READONLY_SCOPE in parse_oauth_scopes(value)


__all__ = [
    "GOOGLE_YOUTUBE_READONLY_SCOPE",
    "has_google_youtube_read_scope",
    "parse_oauth_scopes",
]
