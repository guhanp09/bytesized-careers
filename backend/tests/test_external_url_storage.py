"""What may be stored when someone tells us where their work lives.

Three questions get asked about a URL in this product and only one of them is
this file's: may it be *stored*. Whether it may be rendered as a link is the
render layer's contract, and whether the server may fetch it belongs to
`SafeOutboundFetcher` — whose policy is about networks, and would be wrong here
in both directions. It would reject a real portfolio link whose host happens to
be unreachable, and it would never see a `javascript:` value at all, because
that one never reaches a socket.

The dangerous part of a stored URL is its scheme, because the value ends up in
an `href` eventually. These cases are the ones that look like links until a
browser executes them.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.external_url import (
    ExternalUrlError,
    canonicalize_external_url,
)
from app.schemas.profile import PortfolioItemCreate, ProfileUpdateRequest


class TestWhatMayBeStored:
    @pytest.mark.parametrize(
        ("entered", "stored"),
        [
            ("https://example.com/work", "https://example.com/work"),
            ("http://example.com/work", "http://example.com/work"),
            # A bare domain is what people type. Assuming https is a product
            # decision; the result is re-checked like any other value.
            ("example.com/work", "https://example.com/work"),
            ("  https://example.com/work  ", "https://example.com/work"),
            ("https://EXAMPLE.com/Work", "https://example.com/Work"),
            ("https://example.com/a?b=c#d", "https://example.com/a?b=c#d"),
            ("https://sub.example.co.uk:8443/path", "https://sub.example.co.uk:8443/path"),
        ],
    )
    def test_a_real_link_survives_and_is_normalized(self, entered: str, stored: str) -> None:
        assert canonicalize_external_url(entered) == stored

    def test_no_link_is_a_legitimate_answer(self) -> None:
        assert canonicalize_external_url(None) is None
        assert canonicalize_external_url("") is None
        assert canonicalize_external_url("   ") is None

    @pytest.mark.parametrize(
        "entered",
        [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "  javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "file:///etc/passwd",
            "blob:https://example.com/uuid",
        ],
    )
    def test_a_scheme_a_browser_would_execute_is_refused(self, entered: str) -> None:
        # Stored today, rendered in an href tomorrow. There is no product
        # meaning for any of these as "where my work lives".
        with pytest.raises(ExternalUrlError):
            canonicalize_external_url(entered)

    @pytest.mark.parametrize(
        "entered",
        [
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "//evil.example/work",
            "https://exa\u0000mple.com",
            "https://example.com/\nSet-Cookie: a=b",
            "https://localhost/work",
            "https://internal/work",
            "https://.example.com/",
            "https://example.com./",
            "https://",
            "not a url at all",
        ],
    )
    def test_values_that_are_not_a_shareable_link_are_refused(self, entered: str) -> None:
        with pytest.raises(ExternalUrlError):
            canonicalize_external_url(entered)

    def test_trailing_whitespace_is_stripped_rather_than_smuggled(self) -> None:
        # A trailing CRLF is what a copy-paste out of a document leaves behind.
        # Stripping it is normalization: the stored value carries no control
        # character, which is the property that matters. A control character in
        # the *middle* cannot be stripped and is refused above.
        assert canonicalize_external_url("https://example.com/work\r\n") == (
            "https://example.com/work"
        )

    def test_length_is_bounded_to_the_column(self) -> None:
        long_url = "https://example.com/" + "a" * 3000
        with pytest.raises(ExternalUrlError):
            canonicalize_external_url(long_url, max_length=2048)


class TestTheWriteSchemasEnforceIt:
    """The fields with no service-level check use the schema as their chokepoint."""

    @pytest.mark.parametrize(
        "field",
        ["source_url", "media_url", "youtube_url", "thumbnail_url"],
    )
    def test_a_portfolio_item_cannot_store_an_executable_scheme(self, field: str) -> None:
        with pytest.raises(ValidationError):
            PortfolioItemCreate(title="A project", **{field: "javascript:alert(1)"})

    def test_a_portfolio_item_normalizes_a_real_link(self) -> None:
        item = PortfolioItemCreate(title="A project", source_url="example.com/work")

        assert item.source_url == "https://example.com/work"

    @pytest.mark.parametrize("field", ["avatar_url", "instagram_url"])
    def test_a_profile_cannot_store_an_executable_scheme(self, field: str) -> None:
        with pytest.raises(ValidationError):
            ProfileUpdateRequest(**{field: "data:text/html,<script>alert(1)</script>"})

    def test_an_absent_link_is_still_allowed(self) -> None:
        assert PortfolioItemCreate(title="A project").source_url is None
        assert ProfileUpdateRequest().avatar_url is None
