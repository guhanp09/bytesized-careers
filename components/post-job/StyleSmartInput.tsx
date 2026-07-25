"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ENABLE_STYLE_SMART_COMPOSE } from "../../lib/styleSmartConfig";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
  placeholder?: string;
};

const chipClass =
  "inline-flex items-center gap-2 rounded-lg bg-white/8 border border-white/10 px-2 py-1 text-[11px] text-white/80";

const chipRemoveClass =
  "h-5 w-5 rounded-md hover:bg-white/10 inline-flex items-center justify-center text-white/70";

const suggestionPill =
  "rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10";

const tabPill =
  "ml-2 inline-flex items-center rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70";

const normalize = (text: string) => text.trim().toLowerCase();
type StyleSuggestApi = {
  getGhostContinuation: (inputText: string, selected: string[]) => string | null;
  getRelatedSuggestions: (inputText: string, selected: string[], limit?: number) => string[];
};

export default function StyleSmartInput({
  value,
  onChange,
  className,
  placeholder = "e.g. cinematic suspense pacing",
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [related, setRelated] = useState<string[]>([]);
  const [suggestApi, setSuggestApi] = useState<StyleSuggestApi | null>(null);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedSet = useMemo(() => new Set(value.map(normalize)), [value]);

  useEffect(() => {
    if (!ENABLE_STYLE_SMART_COMPOSE) return;
    let alive = true;
    import("../../lib/styleSuggest")
      .then((mod) => {
        if (!alive) return;
        setSuggestApi({
          getGhostContinuation: mod.getGhostContinuation,
          getRelatedSuggestions: mod.getRelatedSuggestions,
        });
      })
      .catch(() => {
        if (!alive) return;
        setSuggestApi(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const ghost = useMemo(() => {
    if (!ENABLE_STYLE_SMART_COMPOSE || !suggestApi) return null;
    return suggestApi.getGhostContinuation(inputValue, value);
  }, [inputValue, value, suggestApi]);

  useEffect(() => {
    if (!ENABLE_STYLE_SMART_COMPOSE || !suggestApi) {
      setRelated([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setRelated(suggestApi.getRelatedSuggestions(inputValue, value, 8));
    }, 80);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [inputValue, value, suggestApi]);

  const commitChip = (raw: string) => {
    const next = raw.trim();
    if (!next) return;
    const norm = normalize(next);
    if (selectedSet.has(norm)) {
      setInputValue("");
      return;
    }
    onChange([...value, next]);
    setInputValue("");
  };

  const removeChip = (chip: string) => {
    onChange(value.filter((v) => normalize(v) !== normalize(chip)));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((chip) => (
          <span key={chip} className={chipClass}>
            {chip}
            <button
              type="button"
              onClick={() => removeChip(chip)}
              className={chipRemoveClass}
              aria-label="Remove"
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          className={
            ENABLE_STYLE_SMART_COMPOSE
              ? [className || "", "text-transparent caret-white"].join(" ")
              : className
          }
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && ghost) {
              e.preventDefault();
              setInputValue(inputValue + ghost);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              commitChip(inputValue);
            }
          }}
        />
        {ENABLE_STYLE_SMART_COMPOSE ? (
          <div className="pointer-events-none absolute inset-0 flex items-center px-3 text-sm">
            {inputValue.length ? (
              <span className="text-white/90">{inputValue}</span>
            ) : (
              <span className="text-subtle">{placeholder}</span>
            )}
            {ghost ? <span className="text-subtle">{ghost}</span> : null}
            {ghost ? <span className={tabPill}>Tab</span> : null}
          </div>
        ) : null}
      </div>

      {ENABLE_STYLE_SMART_COMPOSE ? (
        <div className="flex flex-wrap gap-2">
          {related
            .filter((s) => !selectedSet.has(normalize(s)))
            .slice(0, 8)
            .map((s) => (
              <button
                key={s}
                type="button"
                className={suggestionPill}
                onClick={() => commitChip(s)}
              >
                {s}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
