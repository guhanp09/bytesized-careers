import { NextResponse } from "next/server";

import { searchLocalLocations } from "../../../../lib/localLocations";
import type { LocationAutocompleteResponse, LocationAutocompleteSuggestion } from "../../../../lib/locationTypes";

export const runtime = "nodejs";

const GOOGLE_PLACES_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const MIN_QUERY_LENGTH = 2;
const FETCH_TIMEOUT_MS = 4000;

type GoogleAutocompletePrediction = {
  place_id?: string;
  description?: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type GoogleAutocompleteResponse = {
  status?: string;
  predictions?: GoogleAutocompletePrediction[];
};

const noStoreJson = (payload: LocationAutocompleteResponse, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

const normalizePrediction = (prediction: GoogleAutocompletePrediction): LocationAutocompleteSuggestion | null => {
  const placeId = prediction.place_id?.trim();
  const displayName = prediction.description?.replace(/\s+/g, " ").trim();
  if (!placeId || !displayName) return null;

  const primaryText = prediction.structured_formatting?.main_text?.trim() || displayName.split(",")[0]?.trim() || displayName;
  const secondaryText =
    prediction.structured_formatting?.secondary_text?.trim() ||
    displayName
      .split(",")
      .slice(1)
      .join(",")
      .trim();

  return {
    placeId,
    displayName,
    primaryText,
    secondaryText,
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").replace(/\s+/g, " ").trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return noStoreJson({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return noStoreJson({ suggestions: searchLocalLocations(query) });
  }

  const url = new URL(GOOGLE_PLACES_AUTOCOMPLETE_URL);
  url.searchParams.set("input", query);
  url.searchParams.set("types", "(cities)");
  url.searchParams.set("language", "en");
  url.searchParams.set("location", "20.5937,78.9629");
  url.searchParams.set("radius", "3000000");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return noStoreJson(
        {
          suggestions: [],
          error: "Location search is unavailable right now.",
          code: "provider_error",
        },
        502
      );
    }

    const data = (await response.json()) as GoogleAutocompleteResponse;
    if (data.status === "ZERO_RESULTS") {
      return noStoreJson({ suggestions: [] });
    }
    if (data.status && data.status !== "OK") {
      return noStoreJson(
        {
          suggestions: [],
          error: "Location search is unavailable right now.",
          code: "provider_error",
        },
        502
      );
    }

    const seen = new Set<string>();
    const suggestions = (data.predictions || [])
      .map(normalizePrediction)
      .filter((item): item is LocationAutocompleteSuggestion => Boolean(item))
      .filter((item) => {
        if (seen.has(item.placeId)) return false;
        seen.add(item.placeId);
        return true;
      })
      .slice(0, 6);

    return noStoreJson({ suggestions });
  } catch {
    return noStoreJson(
      {
        suggestions: [],
        error: "Location search is unavailable right now.",
        code: "network_error",
      },
      502
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
