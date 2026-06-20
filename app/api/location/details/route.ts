import { NextResponse } from "next/server";

import { getLocalLocationByPlaceId, isLocalLocationPlaceId } from "../../../../lib/localLocations";
import type { LocationDetails, LocationDetailsResponse } from "../../../../lib/locationTypes";

export const runtime = "nodejs";

const GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";
const FETCH_TIMEOUT_MS = 4000;

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GooglePlaceDetailsResponse = {
  status?: string;
  result?: {
    place_id?: string;
    name?: string;
    address_components?: GoogleAddressComponent[];
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
};

const noStoreJson = (payload: LocationDetailsResponse, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

const findComponent = (components: GoogleAddressComponent[], type: string) =>
  components.find((component) => component.types?.includes(type));

const firstComponent = (components: GoogleAddressComponent[], types: string[]) => {
  for (const type of types) {
    const match = findComponent(components, type);
    if (match?.long_name?.trim()) return match;
  }
  return null;
};

const uniqueParts = (parts: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizePlaceDetails = (placeId: string, data: GooglePlaceDetailsResponse): LocationDetails | null => {
  const result = data.result;
  const components = result?.address_components || [];
  const cityComponent = firstComponent(components, [
    "locality",
    "postal_town",
    "administrative_area_level_3",
    "sublocality_level_1",
    "administrative_area_level_2",
  ]);
  const regionComponent =
    findComponent(components, "administrative_area_level_1") ||
    findComponent(components, "administrative_area_level_2");
  const countryComponent = findComponent(components, "country");

  const city = cityComponent?.long_name?.trim() || result?.name?.trim() || "";
  const region = regionComponent?.long_name?.trim() || "";
  const country = countryComponent?.long_name?.trim() || "";
  const countryCode = countryComponent?.short_name?.trim() || "";

  if (!city || !country) return null;

  const displayName = uniqueParts([city, region, country]).join(", ");
  const latitude = result?.geometry?.location?.lat;
  const longitude = result?.geometry?.location?.lng;

  return {
    placeId: result?.place_id?.trim() || placeId,
    displayName,
    city,
    region,
    country,
    countryCode,
    ...(typeof latitude === "number" ? { latitude } : {}),
    ...(typeof longitude === "number" ? { longitude } : {}),
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const placeId = (searchParams.get("placeId") || "").trim();

  if (!placeId) {
    return noStoreJson({ error: "Choose a suggested location.", code: "invalid_place" }, 400);
  }

  if (isLocalLocationPlaceId(placeId)) {
    const location = getLocalLocationByPlaceId(placeId);
    if (!location) {
      return noStoreJson({ error: "Choose a suggested location.", code: "invalid_place" }, 400);
    }
    return noStoreJson({ location });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) {
    return noStoreJson({ error: "Choose a suggested location.", code: "invalid_place" }, 400);
  }

  const url = new URL(GOOGLE_PLACE_DETAILS_URL);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "place_id,name,address_components,geometry");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return noStoreJson({ error: "Could not verify this location.", code: "provider_error" }, 502);
    }

    const data = (await response.json()) as GooglePlaceDetailsResponse;
    if (data.status && data.status !== "OK") {
      return noStoreJson({ error: "Could not verify this location.", code: "provider_error" }, 502);
    }

    const location = normalizePlaceDetails(placeId, data);
    if (!location) {
      return noStoreJson({ error: "Choose a city from the suggestions.", code: "invalid_place" }, 400);
    }

    return noStoreJson({ location });
  } catch {
    return noStoreJson({ error: "Could not verify this location.", code: "network_error" }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}
