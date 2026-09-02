import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../lib/auth";
import { BackendRequestError, readMyLocationDetails } from "../../../../lib/backendClient";
import { getLocalLocationByPlaceId, isLocalLocationPlaceId } from "../../../../lib/localLocations";
import type { LocationDetailsResponse } from "../../../../lib/locationTypes";

export const runtime = "nodejs";

const MAX_PLACE_ID_LENGTH = 2048;

const sameOrigin = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
};

const noStoreJson = (
  payload: LocationDetailsResponse,
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
      { error: "Request origin was not accepted.", code: "origin_rejected" },
      403
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError) {
    return noStoreJson(
      { error: "Sign in to verify a location.", code: "authentication_required" },
      401
    );
  }

  const placeId = (request.nextUrl.searchParams.get("placeId") || "").trim();
  if (!placeId || placeId.length > MAX_PLACE_ID_LENGTH) {
    return noStoreJson({ error: "Choose a suggested location.", code: "invalid_place" }, 400);
  }

  if (isLocalLocationPlaceId(placeId)) {
    const location = getLocalLocationByPlaceId(placeId);
    if (!location) {
      return noStoreJson({ error: "Choose a suggested location.", code: "invalid_place" }, 400);
    }
    return noStoreJson({ location });
  }

  try {
    const result = await readMyLocationDetails(session.backendAccessToken, placeId);
    return noStoreJson({
      location: {
        placeId: result.location.place_id,
        displayName: result.location.display_name,
        city: result.location.city,
        region: result.location.region,
        country: result.location.country,
        countryCode: result.location.country_code,
        ...(typeof result.location.latitude === "number"
          ? { latitude: result.location.latitude }
          : {}),
        ...(typeof result.location.longitude === "number"
          ? { longitude: result.location.longitude }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof BackendRequestError) {
      if (error.status === 401 || error.status === 403) {
        return noStoreJson(
          { error: "Sign in to verify a location.", code: "authentication_required" },
          401
        );
      }
      if (error.status === 429) {
        return noStoreJson(
          {
            error: "Too many location searches. Wait a moment and try again.",
            code: "rate_limited",
          },
          429,
          error.retryAfterSeconds
        );
      }
      if (
        error.code === "missing_api_key" ||
        error.code === "invalid_place" ||
        error.status === 422
      ) {
        return noStoreJson(
          { error: "Choose a city from the suggestions.", code: "invalid_place" },
          400
        );
      }
    }
    return noStoreJson(
      { error: "Could not verify this location right now.", code: "provider_error" },
      502
    );
  }
}
