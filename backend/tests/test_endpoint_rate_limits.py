from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from starlette.requests import Request

from app.api.deps import authenticated_rate_limit
from app.api.v1.routers import (
    admin,
    auth,
    job_imports,
    jobs,
    locations,
    marketplace,
    me,
    messaging,
    portfolio,
    reviews,
    search,
    support,
)
from app.core import rate_limit as rate_limit_module
from app.core.admin_permissions import require_permission
from app.core.rate_limit import (
    ADMIN_REQUEST_LIMIT,
    AUTH_EMAIL_LIMIT,
    AUTH_LOGIN_LIMIT,
    AUTH_REFRESH_LIMIT,
    AUTH_REGISTER_LIMIT,
    AUTH_VERIFY_LIMIT,
    LOCATION_LOOKUP_LIMIT,
    MARKETPLACE_ACTION_LIMIT,
    MEDIA_UPLOAD_LIMIT,
    OUTBOUND_FETCH_LIMIT,
    PUBLIC_SEARCH_LIMIT,
    REPORT_LIMIT,
    InMemoryRateLimitBackend,
    RateLimitPolicy,
    RateLimitRule,
    rate_limit,
    rate_limit_policy_for,
)


def _routes(router) -> list[APIRoute]:  # noqa: ANN001 - FastAPI router protocol
    return [route for route in router.routes if isinstance(route, APIRoute)]


def _route(router, method: str, path: str) -> APIRoute:  # noqa: ANN001
    matches = [
        route
        for route in _routes(router)
        if path == route.path and method in route.methods
    ]
    assert len(matches) == 1, (method, path, matches)
    return matches[0]


def _policies(route: APIRoute) -> list[RateLimitPolicy]:
    return [
        policy
        for dependency in route.dependant.dependencies
        if (policy := rate_limit_policy_for(dependency.call)) is not None
    ]


def _assert_policy(
    router,  # noqa: ANN001
    method: str,
    path: str,
    rule: RateLimitRule,
    identity_scope: str,
) -> None:
    assert RateLimitPolicy(
        rule=rule,
        identity_scope=identity_scope,
    ) in _policies(_route(router, method, path))


def _request(*, peer: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/protected",
            "headers": [],
            "query_string": b"",
            "server": ("test", 80),
            "client": (peer, 12345),
            "scheme": "http",
        }
    )


async def test_authenticated_buckets_follow_verified_user_not_network_location(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = InMemoryRateLimitBackend()
    monkeypatch.setattr(rate_limit_module.settings, "app_env", "development")
    monkeypatch.setattr(rate_limit_module, "_limiter", backend)
    rule = RateLimitRule("user_identity_test", limit=1, window_seconds=60)
    dependency = authenticated_rate_limit(rule).dependency
    user_a = SimpleNamespace(id=UUID("11111111-1111-1111-1111-111111111111"))
    user_b = SimpleNamespace(id=UUID("22222222-2222-2222-2222-222222222222"))

    # There is deliberately no Request parameter: the independently verified
    # account, not a changing device/IP, owns this allowance.
    await dependency(user_a)
    with pytest.raises(HTTPException) as captured:
        await dependency(user_a)
    assert captured.value.status_code == 429
    assert int(captured.value.headers["Retry-After"]) >= 1

    await dependency(user_b)
    assert set(backend._buckets) == {
        "user_identity_test:user:11111111-1111-1111-1111-111111111111",
        "user_identity_test:user:22222222-2222-2222-2222-222222222222",
    }


async def test_ip_and_user_namespaces_cannot_consume_each_others_allowance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = InMemoryRateLimitBackend()
    monkeypatch.setattr(rate_limit_module.settings, "app_env", "development")
    monkeypatch.setattr(rate_limit_module, "_limiter", backend)
    rule = RateLimitRule("namespace_test", limit=1, window_seconds=60)

    await rate_limit(rule).dependency(_request(peer="203.0.113.5"))
    await authenticated_rate_limit(rule).dependency(SimpleNamespace(id="203.0.113.5"))

    assert set(backend._buckets) == {
        "namespace_test:ip:203.0.113.5",
        "namespace_test:user:203.0.113.5",
    }


def test_auth_entry_points_have_ip_limits_and_recovery_exemptions_are_explicit() -> None:
    expected = {
        ("POST", "/auth/register"): AUTH_REGISTER_LIMIT,
        ("POST", "/auth/verify-email"): AUTH_VERIFY_LIMIT,
        ("POST", "/auth/resend-verification"): AUTH_EMAIL_LIMIT,
        ("POST", "/auth/password-reset/request"): AUTH_EMAIL_LIMIT,
        ("POST", "/auth/password-reset/confirm"): AUTH_EMAIL_LIMIT,
        ("POST", "/auth/login"): AUTH_LOGIN_LIMIT,
        ("POST", "/auth/refresh"): AUTH_REFRESH_LIMIT,
        ("POST", "/auth/strong-auth/totp/enroll"): rate_limit_module.STRONG_AUTH_ENROLL_LIMIT,
        ("POST", "/auth/strong-auth/totp/confirm"): rate_limit_module.STRONG_AUTH_CHALLENGE_LIMIT,
        ("POST", "/auth/strong-auth/challenge"): rate_limit_module.STRONG_AUTH_CHALLENGE_LIMIT,
        (
            "POST",
            "/auth/strong-auth/recovery-codes/regenerate",
        ): rate_limit_module.STRONG_AUTH_FACTOR_CHANGE_LIMIT,
        ("POST", "/auth/strong-auth/disable"): rate_limit_module.STRONG_AUTH_FACTOR_CHANGE_LIMIT,
        ("POST", "/auth/oauth/google"): AUTH_LOGIN_LIMIT,
    }
    for (method, path), rule in expected.items():
        _assert_policy(auth.router, method, path, rule, "ip")

    uncovered = {
        (method, route.path)
        for route in _routes(auth.router)
        if not _policies(route)
        for method in route.methods
    }
    # Logout must remain reachable during account compromise. logout-all is
    # authenticated and the status read is non-mutating; neither should be able
    # to strand an operator behind the abuse-control system.
    assert uncovered == {
        ("POST", "/auth/logout"),
        ("POST", "/auth/logout-all"),
        ("GET", "/auth/strong-auth/status"),
    }


def test_expensive_fetch_upload_and_search_routes_have_category_limits() -> None:
    outbound_routes = (
        (portfolio.router, "POST", "/portfolio/link-preview"),
        (portfolio.router, "POST", "/portfolio/youtube/preview"),
        (portfolio.router, "POST", "/portfolio/youtube"),
        (me.router, "POST", "/me/youtube/refresh"),
        (
            me.router,
            "POST",
            "/me/hiring-identities/{identity_id}/request-verification",
        ),
        (
            me.router,
            "POST",
            "/me/hiring-identities/{identity_id}/check-verification",
        ),
        (me.router, "POST", "/me/organization-page"),
        (me.router, "POST", "/me/youtube-identity"),
        (jobs.router, "POST", "/jobs/{job_id}/brand-about/enrich"),
        (job_imports.router, "POST", "/job-imports/url-sources"),
    )
    for router, method, path in outbound_routes:
        _assert_policy(router, method, path, OUTBOUND_FETCH_LIMIT, "user")

    _assert_policy(
        locations.router,
        "GET",
        "/me/location/autocomplete",
        LOCATION_LOOKUP_LIMIT,
        "user",
    )
    _assert_policy(
        locations.router,
        "GET",
        "/me/location/details",
        LOCATION_LOOKUP_LIMIT,
        "user",
    )

    _assert_policy(me.router, "POST", "/me/avatar", MEDIA_UPLOAD_LIMIT, "user")
    _assert_policy(me.router, "POST", "/me/banner", MEDIA_UPLOAD_LIMIT, "user")
    _assert_policy(search.router, "GET", "/search/jobs", PUBLIC_SEARCH_LIMIT, "ip")
    _assert_policy(search.router, "GET", "/search/talent", PUBLIC_SEARCH_LIMIT, "ip")


def test_every_messaging_mutation_has_one_shared_user_action_policy() -> None:
    unsafe_routes = [
        route
        for route in _routes(messaging.router)
        if route.methods & {"POST", "PUT", "PATCH", "DELETE"}
    ]
    assert len(unsafe_routes) == 14
    assert all(
        _policies(route)
        == [RateLimitPolicy(MARKETPLACE_ACTION_LIMIT, identity_scope="user")]
        for route in unsafe_routes
    )


def test_every_admin_and_support_route_has_one_post_authorization_user_policy() -> None:
    privileged_routes = _routes(admin.router) + _routes(support.router)
    assert len(privileged_routes) == 33
    assert all(
        _policies(route)
        == [RateLimitPolicy(ADMIN_REQUEST_LIMIT, identity_scope="user")]
        for route in privileged_routes
    )


async def test_admin_quota_is_not_consumed_before_permission_is_proven(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = InMemoryRateLimitBackend()
    monkeypatch.setattr(rate_limit_module.settings, "app_env", "development")
    monkeypatch.setattr(rate_limit_module, "_limiter", backend)
    dependency = require_permission("view.overview")

    with pytest.raises(HTTPException) as captured:
        await dependency(SimpleNamespace(id="ordinary", account_type="TALENT"))
    assert captured.value.status_code == 403
    assert backend._buckets == {}

    await dependency(SimpleNamespace(id="operator", account_type="ADMIN"))
    assert set(backend._buckets) == {"admin_request:user:operator"}


def test_existing_authenticated_marketplace_policies_no_longer_share_ip_buckets() -> None:
    routers = (job_imports.router, jobs.router, marketplace.router, reviews.router)
    policies = [
        policy
        for router in routers
        for route in _routes(router)
        for policy in _policies(route)
        if policy.rule == MARKETPLACE_ACTION_LIMIT
    ]
    assert len(policies) == 40
    assert all(policy.identity_scope == "user" for policy in policies)

    _assert_policy(marketplace.router, "POST", "/reports", REPORT_LIMIT, "ip")
