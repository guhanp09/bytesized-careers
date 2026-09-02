"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type {
  LocationAutocompleteResponse,
  LocationAutocompleteSuggestion,
  LocationDetails,
  LocationDetailsResponse,
} from "../../lib/locationTypes";
import { canUseCustomLocation, normalizeCustomLocationInput } from "../../lib/locationValidation";

type LocationAutocompleteFieldProps = {
  id?: string;
  label?: string;
  value: string;
  selectedLocation: LocationDetails | null;
  onValueChange: (value: string) => void;
  onSelectionChange: (location: LocationDetails | null) => void;
  error?: string | null;
  onErrorChange?: (message: string | null) => void;
  disabled?: boolean;
  size?: "compact" | "spacious";
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

type LocationDropdownOption =
  | { kind: "suggestion"; suggestion: LocationAutocompleteSuggestion }
  | { kind: "custom"; value: string };

export default function LocationAutocompleteField({
  id,
  label = "Location",
  value,
  selectedLocation,
  onValueChange,
  onSelectionChange,
  error,
  onErrorChange,
  disabled = false,
  size = "spacious",
}: LocationAutocompleteFieldProps) {
  const generatedId = useId();
  const inputId = id || `location-autocomplete-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const [suggestions, setSuggestions] = useState<LocationAutocompleteSuggestion[]>([]);
  const [attribution, setAttribution] = useState<"google_maps" | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasUserEdited || disabled) {
      return;
    }

    const query = normalizeCustomLocationInput(value);
    if (!query || query.length < MIN_QUERY_LENGTH || query === selectedLocation?.displayName) {
      setSuggestions([]);
      setAttribution(null);
      setActiveIndex(-1);
      setLoading(false);
      setStatusMessage(null);
      return;
    }

    const controller = new AbortController();
    const debounceId = setTimeout(() => {
      setLoading(true);
      setStatusMessage(null);
      void (async () => {
        try {
          const response = await fetch(`/api/location/autocomplete?q=${encodeURIComponent(query)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const data = (await response.json()) as LocationAutocompleteResponse;
          if (controller.signal.aborted) return;

          if (!response.ok) {
            setSuggestions([]);
            setAttribution(null);
            setActiveIndex(-1);
            setOpen(false);
            setStatusMessage(data.error || "Location search is unavailable right now.");
            return;
          }

          setSuggestions(data.suggestions);
          setAttribution(
            data.attribution === "google_maps" && data.suggestions.length ? "google_maps" : null
          );
          setActiveIndex(data.suggestions.length || canUseCustomLocation(query) ? 0 : -1);
          setOpen(true);
          setStatusMessage(null);
        } catch {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setAttribution(null);
          setActiveIndex(-1);
          setOpen(false);
          setStatusMessage("Location search is unavailable right now.");
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceId);
      controller.abort();
    };
  }, [disabled, hasUserEdited, selectedLocation?.displayName, value]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleValueChange = (nextValue: string) => {
    setHasUserEdited(true);
    onValueChange(nextValue);
    onErrorChange?.(null);
    setStatusMessage(null);

    if (selectedLocation && nextValue.trim() !== selectedLocation.displayName) {
      onSelectionChange(null);
    }
  };

  const selectCustomLocation = (customValue: string) => {
    const normalized = normalizeCustomLocationInput(customValue);
    if (!normalized || !canUseCustomLocation(normalized)) return;
    onValueChange(normalized);
    onSelectionChange(null);
    setSuggestions([]);
    setAttribution(null);
    setActiveIndex(-1);
    setOpen(false);
    setStatusMessage(null);
    setHasUserEdited(false);
    onErrorChange?.(null);
  };

  const selectSuggestion = async (suggestion: LocationAutocompleteSuggestion) => {
    setLoading(true);
    setStatusMessage("Verifying location...");
    onErrorChange?.(null);

    try {
      const response = await fetch(`/api/location/details?placeId=${encodeURIComponent(suggestion.placeId)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as LocationDetailsResponse;
      if (!response.ok || !data.location) {
        setStatusMessage(null);
        onErrorChange?.(data.error || "Could not verify this location. Try another suggestion.");
        return;
      }

      onValueChange(data.location.displayName);
      onSelectionChange(data.location);
      setSuggestions([]);
      setAttribution(null);
      setActiveIndex(-1);
      setOpen(false);
      setStatusMessage(null);
      setHasUserEdited(false);
    } catch {
      setStatusMessage(null);
      onErrorChange?.("Could not verify this location. Try another suggestion.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (!dropdownOptions.length) return -1;
        return current < dropdownOptions.length - 1 ? current + 1 : 0;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (!dropdownOptions.length) return -1;
        return current > 0 ? current - 1 : dropdownOptions.length - 1;
      });
      return;
    }

    if (event.key === "Enter" && open && activeIndex >= 0 && dropdownOptions[activeIndex]) {
      event.preventDefault();
      const option = dropdownOptions[activeIndex];
      if (option.kind === "suggestion") {
        void selectSuggestion(option.suggestion);
      } else {
        selectCustomLocation(option.value);
      }
    }
  };

  const inputClassName =
    size === "compact"
      ? "h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/24"
      : "h-11 w-full rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/24";
  const labelClassName =
    size === "compact" ? "text-xs text-white/55" : "text-xs font-semibold text-white/55";
  const message = error || statusMessage;
  const normalizedValue = normalizeCustomLocationInput(value);
  const hasExactSuggestion = suggestions.some(
    (suggestion) => suggestion.displayName.toLowerCase() === normalizedValue.toLowerCase()
  );
  const showCustomOption =
    normalizedValue.length >= MIN_QUERY_LENGTH &&
    normalizedValue !== selectedLocation?.displayName &&
    !hasExactSuggestion &&
    canUseCustomLocation(normalizedValue);
  const dropdownOptions: LocationDropdownOption[] = [
    ...suggestions.map((suggestion) => ({ kind: "suggestion" as const, suggestion })),
    ...(showCustomOption ? [{ kind: "custom" as const, value: normalizedValue }] : []),
  ];
  const showSuggestions = open && dropdownOptions.length > 0;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className={labelClassName}>
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          value={value}
          onChange={(event) => handleValueChange(event.target.value)}
          onFocus={() => {
            if (suggestions.length) {
              setOpen(true);
            }
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-invalid={Boolean(error)}
          className={inputClassName}
          placeholder="Search city, state, country"
          autoComplete="off"
        />
        {loading ? (
          <span className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-white/18 border-t-white/70 animate-spin" />
        ) : null}
        {showSuggestions ? (
          <div
            className="absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-hidden rounded-xl border border-white/12 bg-[#141519] shadow-[0_24px_70px_-38px_rgba(0,0,0,1)]"
          >
            <div id={listboxId} role="listbox" className="max-h-56 overflow-y-auto p-1.5">
              {dropdownOptions.map((option, index) => {
                const isActive = index === activeIndex;
                if (option.kind === "custom") {
                  return (
                    <button
                      key={`custom-${option.value}`}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCustomLocation(option.value)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={[
                        "flex w-full cursor-pointer flex-col rounded-lg border-t border-white/[0.06] px-3 py-2 text-left transition-colors first:border-t-0",
                        isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.06]",
                      ].join(" ")}
                    >
                      <span className="text-sm font-semibold text-white">Use &quot;{option.value}&quot;</span>
                      <span className="mt-0.5 text-xs text-muted">Custom location</span>
                    </button>
                  );
                }

                return (
                  <button
                    key={option.suggestion.placeId}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void selectSuggestion(option.suggestion)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={[
                      "flex w-full cursor-pointer flex-col rounded-lg px-3 py-2 text-left transition-colors",
                      isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <span className="text-sm font-semibold text-white">{option.suggestion.primaryText}</span>
                    {option.suggestion.secondaryText ? (
                      <span className="mt-0.5 text-xs text-muted">{option.suggestion.secondaryText}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {attribution === "google_maps" && suggestions.length ? (
              <div
                aria-label="Google Maps attribution"
                className="border-t border-white/[0.08] bg-black/20 px-3 py-1.5 text-right text-xs text-white/60"
              >
                <span translate="no">Google Maps</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {message ? (
        <p className={error ? "text-xs text-amber-100" : "text-xs text-muted"}>{message}</p>
      ) : null}
    </div>
  );
}
