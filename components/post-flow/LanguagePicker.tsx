"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LANGUAGE_OPTIONS,
  languageIdentityKey,
  normalizeLanguageSelections,
  searchLanguageOptions,
} from "../../lib/search/searchVocabulary";
import { Icon } from "../Icons";

type LanguagePickerProps = {
  value: string[];
  onChange: (next: string[]) => void;
  /** Used to build stable, unique element ids when more than one picker is on a page. */
  idPrefix?: string;
  enableGlobalPicker?: boolean;
};

function idSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Toggle-chip selector for the structured `languages` field shared by the
 * post-job and post-talent builders. The canonical option list comes from the
 * search vocabulary so chips and search stay in sync.
 */
export default function LanguagePicker({
  value,
  onChange,
  idPrefix = "lang",
  enableGlobalPicker = false,
}: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedLanguages = useMemo(() => normalizeLanguageSelections(value), [value]);
  const selectedKeys = useMemo(
    () => new Set(selectedLanguages.map((item) => languageIdentityKey(item))),
    [selectedLanguages],
  );
  const quickKeys = useMemo(() => new Set(LANGUAGE_OPTIONS.map((item) => languageIdentityKey(item))), []);
  const extraSelectedLanguages = selectedLanguages.filter((item) => !quickKeys.has(languageIdentityKey(item)));
  const searchResults = useMemo(() => searchLanguageOptions(query), [query]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const toggle = (lang: string) => {
    const key = languageIdentityKey(lang);
    const next = selectedKeys.has(key)
      ? value.filter((item) => languageIdentityKey(item) !== key)
      : [...value, lang];
    onChange(normalizeLanguageSelections(next));
  };

  return (
    <div
      ref={rootRef}
      className="relative space-y-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-white/55">
        <Icon name="languages" className="h-4 w-4 text-white/55" />
        Languages
      </span>
      <div className="flex flex-wrap gap-2">
        {extraSelectedLanguages.map((lang) => (
          <button
            key={lang}
            type="button"
            id={`${idPrefix}-language-${idSafe(lang)}`}
            onClick={() => toggle(lang)}
            aria-pressed="true"
            className="rounded-full border border-white bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-white/90"
          >
            {lang}
          </button>
        ))}
        {LANGUAGE_OPTIONS.map((lang) => {
          const active = selectedKeys.has(languageIdentityKey(lang));
          return (
            <button
              key={lang}
              type="button"
              id={`${idPrefix}-language-${idSafe(lang)}`}
              onClick={() => toggle(lang)}
              aria-pressed={active}
              className={[
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-white bg-white text-black"
                  : "border-white/15 bg-white/[0.03] text-white/70 hover:border-white/30 hover:text-white",
              ].join(" ")}
            >
              {lang}
            </button>
          );
        })}
        {enableGlobalPicker ? (
          <button
            type="button"
            id={`${idPrefix}-language-other`}
            onClick={() => setOpen((next) => !next)}
            aria-expanded={open}
            aria-controls={`${idPrefix}-language-picker`}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              open
                ? "border-white/45 bg-white/[0.08] text-white"
                : "border-white/15 bg-white/[0.03] text-white/70 hover:border-white/30 hover:text-white",
            ].join(" ")}
          >
            Other
          </button>
        ) : null}
      </div>
      {enableGlobalPicker && open ? (
        <div
          id={`${idPrefix}-language-picker`}
          role="dialog"
          aria-label="Choose another language"
          className="absolute left-0 top-full z-50 mt-3 w-full max-w-lg overflow-hidden rounded-2xl border border-white/12 bg-[#17181b]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <div className="border-b border-white/10 p-3">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search languages"
              aria-label="Search languages"
              className="h-10 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3 text-sm text-white outline-none transition placeholder:text-subtle focus:border-white/35 focus:bg-white/[0.08]"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-2" role="listbox" aria-multiselectable="true">
            {searchResults.length > 0 ? (
              searchResults.map((lang) => {
                const active = selectedKeys.has(languageIdentityKey(lang));
                return (
                  <button
                    key={lang}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => toggle(lang)}
                    className={[
                      "flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left text-sm transition",
                      active
                        ? "bg-white text-black"
                        : "text-white/75 hover:bg-white/[0.07] hover:text-white",
                    ].join(" ")}
                  >
                    <span>{lang}</span>
                    {active ? <span className="text-xs font-semibold uppercase tracking-[0.18em]">Selected</span> : null}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-6 text-sm text-muted">No languages found.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
