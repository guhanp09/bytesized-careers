export type LocationAutocompleteSuggestion = {
  placeId: string;
  displayName: string;
  primaryText: string;
  secondaryText: string;
};

export type LocationDetails = {
  placeId: string;
  displayName: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  latitude?: number;
  longitude?: number;
};

export type LocationAutocompleteResponse = {
  suggestions: LocationAutocompleteSuggestion[];
  attribution?: "google_maps";
  error?: string;
  code?:
    | "authentication_required"
    | "origin_rejected"
    | "missing_api_key"
    | "invalid_query"
    | "provider_error"
    | "network_error"
    | "rate_limited";
};

export type LocationDetailsResponse = {
  location?: LocationDetails;
  error?: string;
  code?:
    | "authentication_required"
    | "origin_rejected"
    | "missing_api_key"
    | "invalid_place"
    | "provider_error"
    | "network_error"
    | "rate_limited";
};
