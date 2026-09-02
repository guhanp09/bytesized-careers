import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../lib/auth";
import {
  BackendRequestError,
  searchMyLocationSuggestions,
} from "../../../../lib/backendClient";
import { searchLocalLocations } from "../../../../lib/localLocations";
import type { LocationAutocompleteResponse } from "../../../../lib/locationTypes";
import { normalizeCustomLocationInput } from "../../../../lib/locationValidation";

export const runtime = "nodejs";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 255;

const sameOrigin = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
};

const noStoreJson = (
  payload: LocationAutocompleteResponse,
  status = 200,
  retryAfterSeconds?: number
) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  if (retryAfterSeconds) response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
};

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return noStoreJson(
      { suggestions: [], error: "Request origin was not accepted.", code: "origin_rejected" },
      403
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError) {
    return noStoreJson(
      {
        suggestions: [],
        error: "Sign in to search for a location.",
        code: "authentication_required",
      },
      401
    );
  }

  const query = normalizeCustomLocationInput(request.nextUrl.searchParams.get("q") || "");
  if (query.length < MIN_QUERY_LENGTH) {
    return noStoreJson({ suggestions: [] });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return noStoreJson(
      { suggestions: [], error: "Enter a shorter location.", code: "invalid_query" },
      400
    );
  }

  try {
    const result = await searchMyLocationSuggestions(session.backendAccessToken, query);
    return noStoreJson({
      suggestions: result.suggestions.map((item) => ({
        placeId: item.place_id,
        displayName: item.display_name,
        primaryText: item.primary_text,
        secondaryText: item.secondary_text,
      })),
      ...(result.attribution === "google_maps" ? { attribution: "google_maps" as const } : {}),
    });
  } catch (error) {
    if (error instanceof BackendRequestError) {
      if (error.code === "missing_api_key") {
        return noStoreJson({ suggestions: searchLocalLocations(query) });
      }
      if (error.status === 401 || error.status === 403) {
        return noStoreJson(
          {
            suggestions: [],
            error: "Sign in to search for a location.",
            code: "authentication_required",
          },
          401
        );
      }
      if (error.status === 429) {
        return noStoreJson(
          {
            suggestions: [],
            error: "Too many location searches. Wait a moment and try again.",
            code: "rate_limited",
          },
          429,
          error.retryAfterSeconds
        );
      }
      if (error.code === "invalid_query" || error.status === 422) {
        return noStoreJson(
          { suggestions: [], error: "Enter a valid location.", code: "invalid_query" },
          400
        );
      }
    }
    return noStoreJson(
      {
        suggestions: [],
        error: "Location search is unavailable right now.",
        code: "provider_error",
      },
      502
    );
  }
}
