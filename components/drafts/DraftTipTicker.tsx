"use client";

import Link from "next/link";
import React from "react";
import { Icon } from "../Icons";

// Subtle, premium cadence — within the requested ranges.
const TYPING_SPEED_MS = 26; // per character
const HOLD_MS = 4200; // pause after a tip finishes typing before the next one

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * A calm, rotating tip strip with a subtle character-by-character typing effect.
 * The strip height is reserved by an invisible copy of the full current tip, so
 * typing never causes layout shift. Reduced-motion users get the full text at once.
 */
export default function DraftTipTicker({
  tips,
  learnMoreHref,
}: {
  tips: string[];
  learnMoreHref?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const safeTips = tips.length > 0 ? tips : [""];
  const [index, setIndex] = React.useState(0);
  const [typed, setTyped] = React.useState("");
  const current = safeTips[index % safeTips.length];

  React.useEffect(() => {
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => setIndex((i) => (i + 1) % safeTips.length);

    // Reduced motion: show the whole tip immediately; rotate gently without typing.
    if (reducedMotion) {
      setTyped(current);
      if (safeTips.length > 1) holdTimer = setTimeout(advance, HOLD_MS + 800);
      return () => clearTimeout(holdTimer);
    }

    setTyped("");
    let charIndex = 0;
    const typeTimer = setInterval(() => {
      charIndex += 1;
      setTyped(current.slice(0, charIndex));
      if (charIndex >= current.length) {
        clearInterval(typeTimer);
        if (safeTips.length > 1) holdTimer = setTimeout(advance, HOLD_MS);
      }
    }, TYPING_SPEED_MS);

    return () => {
      clearInterval(typeTimer);
      clearTimeout(holdTimer);
    };
  }, [index, reducedMotion, current, safeTips.length]);

  const isTyping = !reducedMotion && typed.length < current.length;

  return (
    <div
      data-testid="draft-tip"
      className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-xs text-muted"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Icon name="bolt" className="h-3.5 w-3.5 shrink-0 text-amber-200/65" />
        {/* The invisible full tip reserves height so the strip never shifts mid-typing. */}
        <p className="relative min-w-0 flex-1 leading-5">
          <span aria-hidden="true" className="invisible block">
            <span className="font-semibold">Tip:</span> {current}
          </span>
          <span aria-hidden="true" className="absolute inset-0 block">
            <span className="font-semibold text-white/60">Tip:</span>{" "}
            <span className="text-white/55">{typed}</span>
            {isTyping ? (
              <span className="ml-0.5 inline-block h-3 w-[2px] translate-y-[1px] animate-pulse rounded-sm bg-white/45 align-middle" />
            ) : null}
          </span>
        </p>
        {/* Polite, one-announcement-per-tip live region — never per character. */}
        <span aria-live="polite" className="sr-only">
          Tip: {current}
        </span>
      </div>
      {learnMoreHref ? (
        <Link
          href={learnMoreHref}
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
        >
          Learn more
          <Icon name="external-link" className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}
