from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.google_places_service import (
    MAX_DISPLAY_NAME_CHARS,
    MAX_LOCATION_PART_CHARS,
    MAX_PLACE_ID_CHARS,
    MAX_SUGGESTIONS,
)


class LocationSuggestionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    place_id: str = Field(min_length=1, max_length=MAX_PLACE_ID_CHARS)
    display_name: str = Field(min_length=1, max_length=MAX_DISPLAY_NAME_CHARS)
    primary_text: str = Field(min_length=1, max_length=MAX_LOCATION_PART_CHARS)
    secondary_text: str = Field(default="", max_length=MAX_DISPLAY_NAME_CHARS)


class LocationAutocompleteRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggestions: list[LocationSuggestionRead] = Field(max_length=MAX_SUGGESTIONS)
    attribution: Literal["google_maps"] | None = None


class LocationDetailsRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    place_id: str = Field(min_length=1, max_length=MAX_PLACE_ID_CHARS)
    display_name: str = Field(min_length=1, max_length=MAX_DISPLAY_NAME_CHARS)
    city: str = Field(min_length=1, max_length=MAX_LOCATION_PART_CHARS)
    region: str = Field(default="", max_length=MAX_LOCATION_PART_CHARS)
    country: str = Field(min_length=1, max_length=MAX_LOCATION_PART_CHARS)
    country_code: str = Field(default="", max_length=8)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class LocationDetailsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: LocationDetailsRead
