"""Security and product contracts for the fixed Google Places boundary."""

from __future__ import annotations

import asyncio
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
import pytest
from httpx import AsyncClient

from app.api.deps import get_google_places_service
from app.main import app
from app.services.google_places_service import (
    GOOGLE_PLACE_DETAILS_URL,
    GOOGLE_PLACES_AUTOCOMPLETE_URL,
    MAX_PLACE_ID_CHARS,
    MAX_PROVIDER_RESPONSE_BYTES,
    MAX_QUERY_CHARS,
    GooglePlaceDetails,
    GooglePlacesInvalidPlaceError,
    GooglePlacesInvalidQueryError,
    GooglePlacesNotConfiguredError,
    GooglePlacesService,
    GooglePlaceSuggestion,
    GooglePlacesUnavailableError,
)

pytestmark = pytest.mark.anyio


def _json_response(payload: object, *, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json=payload,
        headers={"Content-Type": "application/json; charset=UTF-8"},
    )


def _details_payload(
    *,
    latitude: object = 13.0827,
    longitude: object = 80.2707,
) -> dict[str, object]:
    return {
        "status": "OK",
        "result": {
            "place_id": "provider-place-id",
            "name": "Chennai",
            "address_components": [
                {"long_name": "Chennai", "short_name": "Chennai", "types": ["locality"]},
                {
                    "long_name": "Tamil Nadu",
                    "short_name": "TN",
                    "types": ["administrative_area_level_1"],
                },
                {"long_name": "India", "short_name": "in", "types": ["country"]},
            ],
            "geometry": {"location": {"lat": latitude, "lng": longitude}},
        },
    }


async def test_autocomplete_uses_one_fixed_redirect_free_server_owned_request() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return _json_response(
            {
                "status": "OK",
                "predictions": [
                    {
                        "place_id": "place-1",
                        "description": "New Delhi, Delhi, India",
                        "structured_formatting": {
                            "main_text": "New Delhi",
                            "secondary_text": "Delhi, India",
                        },
                    }
                ],
            }
        )

    service = GooglePlacesService(
        "provider-api-secret", transport=httpx.MockTransport(handler)
    )
    suggestions = await service.autocomplete("  New   Delhi  ")

    assert suggestions == (
        GooglePlaceSuggestion(
            place_id="place-1",
            display_name="New Delhi, Delhi, India",
            primary_text="New Delhi",
            secondary_text="Delhi, India",
        ),
    )
    assert len(observed) == 1
    request = observed[0]
    assert request.method == "GET"
    assert f"{request.url.scheme}://{request.url.host}{request.url.path}" == (
        GOOGLE_PLACES_AUTOCOMPLETE_URL
    )
    assert parse_qs(request.url.query.decode()) == {
        "input": ["New Delhi"],
        "types": ["(cities)"],
        "language": ["en"],
        "location": ["20.5937,78.9629"],
        "radius": ["3000000"],
        "key": ["provider-api-secret"],
    }
    assert request.headers["accept"] == "application/json"
    assert "authorization" not in request.headers
    assert "cookie" not in request.headers
    assert "provider-api-secret" not in repr(service)


async def test_autocomplete_bounds_deduplicates_and_sanitizes_provider_fields() -> None:
    predictions: list[object] = [
        {
            "place_id": "duplicate",
            "description": "  Chennai,   Tamil Nadu, India ",
            "structured_formatting": {
                "main_text": " Chennai ",
                "secondary_text": " Tamil Nadu, India ",
            },
        },
        {"place_id": "duplicate", "description": "Duplicate"},
        {"place_id": "control", "description": "Unsafe\u0000City"},
        {"place_id": "too-long", "description": "x" * 769},
    ]
    predictions.extend(
        {
            "place_id": f"place-{index}",
            "description": f"City {index}, India",
        }
        for index in range(10)
    )

    service = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(
            lambda _request: _json_response(
                {"status": "OK", "predictions": predictions}
            )
        ),
    )
    suggestions = await service.autocomplete("Chennai")

    assert len(suggestions) == 6
    assert suggestions[0].display_name == "Chennai, Tamil Nadu, India"
    assert suggestions[0].secondary_text == "Tamil Nadu, India"
    assert len({item.place_id for item in suggestions}) == len(suggestions)
    assert all("\u0000" not in item.display_name for item in suggestions)


async def test_zero_results_is_an_empty_success_but_other_statuses_fail_closed() -> None:
    zero = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(
            lambda _request: _json_response(
                {"status": "ZERO_RESULTS", "predictions": []}
            )
        ),
    )
    assert await zero.autocomplete("Atlantis") == ()

    for provider_status in (
        None,
        "INVALID_REQUEST",
        "OVER_QUERY_LIMIT",
        "REQUEST_DENIED",
        "UNKNOWN_ERROR",
    ):
        service = GooglePlacesService(
            "secret",
            transport=httpx.MockTransport(
                lambda _request, value=provider_status: _json_response(
                    {"status": value, "predictions": []}
                )
            ),
        )
        with pytest.raises(GooglePlacesUnavailableError):
            await service.autocomplete("Chennai")


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not-json", headers={"Content-Type": "application/json"}),
        httpx.Response(
            200,
            content=b'{"status":"OK","predictions":[],"coordinate":Infinity}',
            headers={"Content-Type": "application/json"},
        ),
        httpx.Response(200, json=[], headers={"Content-Type": "application/json"}),
        httpx.Response(200, content=b"<html></html>", headers={"Content-Type": "text/html"}),
        httpx.Response(
            200,
            content=b'{}',
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(MAX_PROVIDER_RESPONSE_BYTES + 1),
            },
        ),
        httpx.Response(
            200,
            content=b"x" * (MAX_PROVIDER_RESPONSE_BYTES + 1),
            headers={"Content-Type": "application/json"},
        ),
    ],
)
async def test_provider_type_json_shape_and_decoded_body_are_bounded(
    response: httpx.Response,
) -> None:
    service = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(lambda _request: response),
    )
    with pytest.raises(GooglePlacesUnavailableError):
        await service.autocomplete("Chennai")


async def test_redirect_is_not_followed_and_cannot_receive_the_api_key() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return httpx.Response(
            302,
            headers={"Location": "https://attacker.example/collect"},
        )

    service = GooglePlacesService(
        "provider-api-secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(GooglePlacesUnavailableError) as captured:
        await service.autocomplete("Chennai")

    assert len(observed) == 1
    assert observed[0].url.host == "maps.googleapis.com"
    assert "provider-api-secret" not in str(captured.value)


async def test_network_and_whole_operation_timeout_are_generic_and_redacted() -> None:
    def network_failure(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("provider-api-secret", request=request)

    async def slow_response(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.05)
        return _json_response({"status": "ZERO_RESULTS", "predictions": []})

    services = (
        GooglePlacesService(
            "provider-api-secret",
            transport=httpx.MockTransport(network_failure),
        ),
        GooglePlacesService(
            "provider-api-secret",
            transport=httpx.MockTransport(slow_response),
            total_timeout_seconds=0.005,
        ),
    )
    for service in services:
        with pytest.raises(GooglePlacesUnavailableError) as captured:
            await service.autocomplete("Chennai")
        assert "provider-api-secret" not in str(captured.value)
        assert captured.value.__cause__ is None


async def test_details_uses_fixed_fields_and_returns_one_bounded_city() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return _json_response(_details_payload())

    service = GooglePlacesService("secret", transport=httpx.MockTransport(handler))
    details = await service.details("requested-place-id")

    assert details == GooglePlaceDetails(
        place_id="provider-place-id",
        display_name="Chennai, Tamil Nadu, India",
        city="Chennai",
        region="Tamil Nadu",
        country="India",
        country_code="IN",
        latitude=13.0827,
        longitude=80.2707,
    )
    request = observed[0]
    assert f"{request.url.scheme}://{request.url.host}{request.url.path}" == (
        GOOGLE_PLACE_DETAILS_URL
    )
    assert parse_qs(request.url.query.decode()) == {
        "place_id": ["requested-place-id"],
        "fields": ["place_id,name,address_components,geometry"],
        "language": ["en"],
        "key": ["secret"],
    }


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (91, 80),
        (13, 181),
        (True, 80),
        (13, "80"),
    ],
)
async def test_details_never_returns_a_partial_or_invalid_coordinate_pair(
    latitude: object,
    longitude: object,
) -> None:
    service = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(
            lambda _request: _json_response(
                _details_payload(latitude=latitude, longitude=longitude)
            )
        ),
    )
    details = await service.details("place-id")
    assert details.latitude is None
    assert details.longitude is None


async def test_details_distinguishes_invalid_selection_from_provider_failure() -> None:
    for provider_status in ("ZERO_RESULTS", "NOT_FOUND", "INVALID_REQUEST"):
        service = GooglePlacesService(
            "secret",
            transport=httpx.MockTransport(
                lambda _request, value=provider_status: _json_response(
                    {"status": value}
                )
            ),
        )
        with pytest.raises(GooglePlacesInvalidPlaceError):
            await service.details("place-id")

    malformed = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(
            lambda _request: _json_response({"status": "OK", "result": {}})
        ),
    )
    with pytest.raises(GooglePlacesUnavailableError):
        await malformed.details("place-id")


async def test_city_and_country_are_required_without_echoing_provider_payload() -> None:
    payload = _details_payload()
    result = payload["result"]
    assert isinstance(result, dict)
    result["name"] = "provider-api-secret"
    result["address_components"] = []
    service = GooglePlacesService(
        "secret", transport=httpx.MockTransport(lambda _request: _json_response(payload))
    )
    with pytest.raises(GooglePlacesInvalidPlaceError) as captured:
        await service.details("place-id")
    assert "provider-api-secret" not in str(captured.value)


@pytest.mark.parametrize(
    "query",
    ["", "a", "x" * (MAX_QUERY_CHARS + 1), "safe\u0000unsafe"],
)
async def test_invalid_queries_are_rejected_before_any_provider_request(query: str) -> None:
    service = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(
            lambda request: pytest.fail(f"unexpected provider request: {request.url}")
        ),
    )
    with pytest.raises(GooglePlacesInvalidQueryError):
        await service.autocomplete(query)


@pytest.mark.parametrize(
    "place_id",
    ["", "x" * (MAX_PLACE_ID_CHARS + 1), "safe\u0000unsafe"],
)
async def test_invalid_place_ids_are_rejected_before_any_provider_request(
    place_id: str,
) -> None:
    service = GooglePlacesService(
        "secret",
        transport=httpx.MockTransport(
            lambda request: pytest.fail(f"unexpected provider request: {request.url}")
        ),
    )
    with pytest.raises(GooglePlacesInvalidPlaceError):
        await service.details(place_id)


async def test_unconfigured_provider_fails_closed_without_a_network_attempt() -> None:
    service = GooglePlacesService(
        None,
        transport=httpx.MockTransport(
            lambda request: pytest.fail(f"unexpected provider request: {request.url}")
        ),
    )
    with pytest.raises(GooglePlacesNotConfiguredError):
        await service.autocomplete("Chennai")


class _StubPlacesService:
    async def autocomplete(self, query: str) -> tuple[GooglePlaceSuggestion, ...]:
        assert query == "Chennai"
        return (
            GooglePlaceSuggestion(
                place_id="place-1",
                display_name="Chennai, Tamil Nadu, India",
                primary_text="Chennai",
                secondary_text="Tamil Nadu, India",
            ),
        )

    async def details(self, place_id: str) -> GooglePlaceDetails:
        assert place_id == "place-1"
        return GooglePlaceDetails(
            place_id=place_id,
            display_name="Chennai, Tamil Nadu, India",
            city="Chennai",
            region="Tamil Nadu",
            country="India",
            country_code="IN",
            latitude=13.0827,
            longitude=80.2707,
        )


async def _bearer(client: AsyncClient) -> str:
    from test_link_preview import _register_verify_login

    return await _register_verify_login(
        client,
        email=f"places-{uuid4().hex[:8]}@example.com",
        username=f"places{uuid4().hex[:6]}",
    )


async def test_location_endpoints_require_auth_and_return_only_normalized_fields(
    client: AsyncClient,
) -> None:
    anonymous = await client.get("/api/v1/me/location/autocomplete?q=Chennai")
    assert anonymous.status_code in {401, 403}

    bearer = await _bearer(client)
    app.dependency_overrides[get_google_places_service] = _StubPlacesService
    try:
        autocomplete = await client.get(
            "/api/v1/me/location/autocomplete?q=Chennai",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        details = await client.get(
            "/api/v1/me/location/details?place_id=place-1",
            headers={"Authorization": f"Bearer {bearer}"},
        )
    finally:
        app.dependency_overrides.pop(get_google_places_service, None)

    assert autocomplete.status_code == 200
    assert autocomplete.json() == {
        "suggestions": [
            {
                "place_id": "place-1",
                "display_name": "Chennai, Tamil Nadu, India",
                "primary_text": "Chennai",
                "secondary_text": "Tamil Nadu, India",
            }
        ],
        "attribution": "google_maps",
    }
    assert details.status_code == 200
    assert details.json() == {
        "location": {
            "place_id": "place-1",
            "display_name": "Chennai, Tamil Nadu, India",
            "city": "Chennai",
            "region": "Tamil Nadu",
            "country": "India",
            "country_code": "IN",
            "latitude": 13.0827,
            "longitude": 80.2707,
        }
    }


async def test_unconfigured_endpoint_is_explicit_and_does_not_claim_success(
    client: AsyncClient,
) -> None:
    bearer = await _bearer(client)
    app.dependency_overrides[get_google_places_service] = lambda: GooglePlacesService(None)
    try:
        response = await client.get(
            "/api/v1/me/location/autocomplete?q=Chennai",
            headers={"Authorization": f"Bearer {bearer}"},
        )
    finally:
        app.dependency_overrides.pop(get_google_places_service, None)

    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["code"] == "missing_api_key"
    assert payload["error"]["message"] == (
        "Provider-backed location search is not configured."
    )
    assert payload["error"]["details"] == {
        "code": "missing_api_key",
        "message": "Provider-backed location search is not configured.",
    }


async def test_endpoint_input_ceilings_run_before_provider_work(client: AsyncClient) -> None:
    bearer = await _bearer(client)

    class CountingProvider:
        calls = 0

        async def autocomplete(self, _query: str) -> tuple[GooglePlaceSuggestion, ...]:
            self.calls += 1
            return ()

        async def details(self, _place_id: str) -> GooglePlaceDetails:
            self.calls += 1
            raise AssertionError("invalid input reached provider work")

    provider = CountingProvider()
    app.dependency_overrides[get_google_places_service] = lambda: provider
    try:
        query_response = await client.get(
            f"/api/v1/me/location/autocomplete?q={'x' * (MAX_QUERY_CHARS + 1)}",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        place_response = await client.get(
            f"/api/v1/me/location/details?place_id={'x' * (MAX_PLACE_ID_CHARS + 1)}",
            headers={"Authorization": f"Bearer {bearer}"},
        )
    finally:
        app.dependency_overrides.pop(get_google_places_service, None)

    assert query_response.status_code == 422
    assert place_response.status_code == 422
    assert provider.calls == 0
