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
  error?: string;
  code?: "missing_api_key" | "invalid_query" | "provider_error" | "network_error";
};

export type LocationDetailsResponse = {
  location?: LocationDetails;
  error?: string;
  code?: "missing_api_key" | "invalid_place" | "provider_error" | "network_error";
};
