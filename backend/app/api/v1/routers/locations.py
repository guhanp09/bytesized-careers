from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import authenticated_rate_limit, get_google_places_service
from app.core.rate_limit import LOCATION_LOOKUP_LIMIT
from app.schemas.location import (
    LocationAutocompleteRead,
    LocationDetailsRead,
    LocationDetailsResponse,
    LocationSuggestionRead,
)
from app.services.google_places_service import (
    MAX_PLACE_ID_CHARS,
    MAX_QUERY_CHARS,
    GooglePlacesInvalidPlaceError,
    GooglePlacesInvalidQueryError,
    GooglePlacesNotConfiguredError,
    GooglePlacesService,
    GooglePlacesUnavailableError,
)

router = APIRouter(prefix="/me/location", tags=["location"])


def _error(status_code: int, *, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


@router.get("/autocomplete", response_model=LocationAutocompleteRead)
async def autocomplete_location(
    q: Annotated[str, Query(min_length=1, max_length=MAX_QUERY_CHARS)],
    _limit: None = authenticated_rate_limit(LOCATION_LOOKUP_LIMIT),
    service: GooglePlacesService = Depends(get_google_places_service),
) -> LocationAutocompleteRead:
    try:
        suggestions = await service.autocomplete(q)
    except GooglePlacesInvalidQueryError as exc:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            code="invalid_query",
            message="Enter at least two characters to search for a city.",
        ) from exc
    except GooglePlacesNotConfiguredError as exc:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            code="missing_api_key",
            message="Provider-backed location search is not configured.",
        ) from exc
    except GooglePlacesUnavailableError as exc:
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            code="provider_error",
            message="Location search is unavailable right now.",
        ) from exc

    return LocationAutocompleteRead(
        suggestions=[
            LocationSuggestionRead(
                place_id=item.place_id,
                display_name=item.display_name,
                primary_text=item.primary_text,
                secondary_text=item.secondary_text,
            )
            for item in suggestions
        ],
        attribution="google_maps" if suggestions else None,
    )


@router.get("/details", response_model=LocationDetailsResponse)
async def location_details(
    place_id: Annotated[str, Query(min_length=1, max_length=MAX_PLACE_ID_CHARS)],
    _limit: None = authenticated_rate_limit(LOCATION_LOOKUP_LIMIT),
    service: GooglePlacesService = Depends(get_google_places_service),
) -> LocationDetailsResponse:
    try:
        item = await service.details(place_id)
    except GooglePlacesInvalidPlaceError as exc:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            code="invalid_place",
            message="Choose a city from the suggestions.",
        ) from exc
    except GooglePlacesNotConfiguredError as exc:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            code="missing_api_key",
            message="Provider-backed location search is not configured.",
        ) from exc
    except GooglePlacesUnavailableError as exc:
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            code="provider_error",
            message="Could not verify this location right now.",
        ) from exc

    return LocationDetailsResponse(
        location=LocationDetailsRead(
            place_id=item.place_id,
            display_name=item.display_name,
            city=item.city,
            region=item.region,
            country=item.country,
            country_code=item.country_code,
            latitude=item.latitude,
            longitude=item.longitude,
        )
    )
