"""Where hiring-identity verification is allowed to send a request.

Verification reads a creator's own YouTube or Instagram profile page to look for
a code they placed in their bio. The set of pages it may read is product policy,
and it was previously re-checked by hand around an HTTP client that resolved DNS
itself, followed its own redirects, honoured environment proxies, and read the
whole body before slicing it. Two things were therefore true at once: the
allowlist was enforced, and the request was not.

The allowlist is now a predicate the shared outbound boundary evaluates — on the
URL that was entered, and again on every hop, immediately before a connection is
opened. These tests are about that word *every*: a rule applied only to the
first request is not a rule about the destination, because the first response
chooses the second one.
"""

from __future__ import annotations

import ipaddress

import httpx
import pytest

from app.models import HiringIdentity
from app.services.profile_service import ProfileService, ProfileValidationError
from app.services.safe_outbound_fetch import SafeOutboundFetcher

pytestmark = pytest.mark.anyio

YOUTUBE_PAGE = "https://www.youtube.com/@creator/about"
PUBLIC_ADDRESS = ipaddress.ip_address("93.184.216.34")
PRIVATE_ADDRESS = ipaddress.ip_address("169.254.169.254")


def _identity(**overrides) -> HiringIdentity:
    identity = HiringIdentity(
        display_name="A creator",
        platform=overrides.pop("platform", "YOUTUBE"),
        url=overrides.pop("url", "https://www.youtube.com/@creator"),
        proof_url=overrides.pop("proof_url", None),
    )
    for key, value in overrides.items():
        setattr(identity, key, value)
    return identity


def _fetcher(handler, *, resolver=None) -> SafeOutboundFetcher:
    async def public_resolver(_hostname: str, _port: int):
        return [PUBLIC_ADDRESS]

    return SafeOutboundFetcher(
        resolver=resolver or public_resolver,
        transport=httpx.MockTransport(handler),
    )


def _page(body: str = "Verification code ABC-DEF-GHI in the bio") -> httpx.Response:
    return httpx.Response(
        200,
        headers={"Content-Type": "text/html; charset=utf-8"},
        content=body.encode(),
    )


async def test_an_allowed_profile_page_is_read() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return _page("Bio says CJ1-234-567")

    text = await ProfileService._fetch_public_hiring_identity_text(
        _identity(), fetcher=_fetcher(handler)
    )

    assert "cj1" in text.lower()
    assert requests, "the allowed page must actually be requested"
    assert all(request.url.host == "www.youtube.com" for request in requests)
    # Verification is a public read. Nothing about the recruiter travels with it.
    assert all("authorization" not in request.headers for request in requests)
    assert all("cookie" not in request.headers for request in requests)


async def test_a_disallowed_platform_url_is_refused_before_any_request() -> None:
    fetcher = _fetcher(lambda request: pytest.fail(f"unexpected request to {request.url}"))

    with pytest.raises(ProfileValidationError):
        await ProfileService._fetch_public_hiring_identity_text(
            _identity(url="https://attacker.example/@creator"), fetcher=fetcher
        )


@pytest.mark.parametrize(
    "location",
    [
        # Somewhere else entirely.
        "https://attacker.example/@creator",
        # A lookalike host that ends with the allowed one.
        "https://notyoutube.com/@creator",
        # The allowed host as a prefix of an attacker domain.
        "https://youtube.com.attacker.example/@creator",
        # The right host, a path the policy does not permit.
        "https://www.youtube.com/watch?v=abc",
        # Credentials smuggled into the authority.
        "https://www.youtube.com@attacker.example/@creator",
        # A port outside the boundary's policy.
        "https://www.youtube.com:8443/@creator",
    ],
)
async def test_a_redirect_off_the_allowlist_is_refused(location: str) -> None:
    """The first response chooses the second request.

    Each of these is a redirect the *entered* URL was allowed to make. If the
    platform rule only guarded the first hop, every one of them would be
    followed with the recruiter's verification still in flight.
    """

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "www.youtube.com" and request.url.path.startswith("/@creator"):
            return httpx.Response(302, headers={"Location": location})
        return _page("this page should never be read")

    with pytest.raises(ProfileValidationError):
        await ProfileService._fetch_public_hiring_identity_text(
            _identity(), fetcher=_fetcher(handler)
        )

    followed = [
        request
        for request in seen
        if not (request.url.host == "www.youtube.com" and request.url.path.startswith("/@creator"))
    ]
    assert followed == [], f"the redirect was followed to {followed}"


async def test_a_redirect_to_a_private_address_is_refused() -> None:
    """An allowed hostname that resolves somewhere internal is still refused.

    The platform predicate and the network policy are separate answers to
    separate questions, and a destination has to satisfy both.
    """

    async def resolver(hostname: str, _port: int):
        return [PRIVATE_ADDRESS if hostname == "m.youtube.com" else PUBLIC_ADDRESS]

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "www.youtube.com":
            return httpx.Response(302, headers={"Location": "https://m.youtube.com/@creator"})
        return _page("internal")

    with pytest.raises(ProfileValidationError):
        await ProfileService._fetch_public_hiring_identity_text(
            _identity(), fetcher=_fetcher(handler, resolver=resolver)
        )

    assert all(request.url.host == "www.youtube.com" for request in seen)


async def test_a_redirect_within_the_allowlist_is_followed() -> None:
    """Real profile pages redirect between their own allowed hosts."""

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "www.youtube.com":
            return httpx.Response(302, headers={"Location": "https://m.youtube.com/@creator"})
        return _page("Bio says CJ7-654-321")

    text = await ProfileService._fetch_public_hiring_identity_text(
        _identity(), fetcher=_fetcher(handler)
    )

    assert "cj7" in text.lower()
    assert [request.url.host for request in seen][-1] == "m.youtube.com"


async def test_instagram_keeps_its_own_narrower_page_policy() -> None:
    """Each platform's allowlist is its own; one does not open the other."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.instagram.com" and request.url.path.startswith("/creator"):
            return httpx.Response(302, headers={"Location": "https://www.instagram.com/p/abc"})
        return _page("a post, not a profile")

    with pytest.raises(ProfileValidationError):
        await ProfileService._fetch_public_hiring_identity_text(
            _identity(platform="INSTAGRAM", url="https://www.instagram.com/creator"),
            fetcher=_fetcher(handler),
        )


async def test_an_unreadable_consent_wall_does_not_verify_anything() -> None:
    """A consent interstitial is a page, and it is not the creator's bio."""

    def handler(request: httpx.Request) -> httpx.Response:
        return _page("Before you continue to YouTube")

    with pytest.raises(ProfileValidationError):
        await ProfileService._fetch_public_hiring_identity_text(
            _identity(), fetcher=_fetcher(handler)
        )
