"use client";

import * as React from "react";

/**
 * "Bea" — the CreatorJobs draft assistant.
 *
 * An original mark: a rounded-square head with a single wide visor, two pill
 * eyes, and one antenna whose tip is the beacon the character is named for.
 * Deliberately not a circle-with-eyes and not a sparkle; deliberately not a
 * face that could read as a person.
 *
 * Every state below is driven by real application state. The component owns no
 * timers of its own, so it cannot perform work that is not happening. Motion
 * rules live in globals.css under "Draft assistant motion".
 *
 * The drawing is decorative and hidden from assistive technology. The assistant's
 * name and current state are published as text by the surrounding shell, which is
 * what a screen reader reads instead.
 */
import {
  DRAFT_ASSISTANT_HAPPY_STATES,
  DRAFT_ASSISTANT_SCANNING_STATES,
  DRAFT_ASSISTANT_WORKING_STATES,
  type DraftAssistantState,
} from "../../../lib/draftAssistantStates.ts";

export type { DraftAssistantState };
export {
  DRAFT_ASSISTANT_STATE_LABELS,
  DRAFT_ASSISTANT_STATES,
} from "../../../lib/draftAssistantStates.ts";

export type DraftAssistantRobotProps = {
  state: DraftAssistantState;
  /** Set briefly to true to nod once when an answer is accepted. */
  acknowledging?: boolean;
  size?: number;
  className?: string;
};

export function DraftAssistantRobot({
  state,
  acknowledging = false,
  size = 56,
  className = "",
}: DraftAssistantRobotProps) {
  const working = DRAFT_ASSISTANT_WORKING_STATES.has(state);
  const scanning = DRAFT_ASSISTANT_SCANNING_STATES.has(state);
  const happy = DRAFT_ASSISTANT_HAPPY_STATES.has(state);
  const failed = state === "failed";

  // Motion is opt-in per mount so the reduced-motion query is not the only
  // guard; the shell can also switch it off while the recruiter is typing.
  const prefersReducedMotion = usePrefersReducedMotion();
  const motion = prefersReducedMotion ? "off" : "on";

  const accent = failed ? "rgba(255,255,255,0.34)" : "var(--color-state-review, #8ec5ff)";

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      role="presentation"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      data-bea-state={state}
      data-bea-motion={motion}
      data-bea-working={working ? "true" : "false"}
      data-bea-scanning={scanning ? "true" : "false"}
      data-testid="draft-assistant-robot"
    >
      <defs>
        <linearGradient id="bea-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
        <clipPath id="bea-visor-clip">
          <rect x="16" y="26" width="32" height="15" rx="7.5" />
        </clipPath>
      </defs>

      <g className="bea-head" data-bea-ack={acknowledging ? "true" : "false"}>
        {/* Antenna: stem plus the beacon tip. */}
        <path
          d="M32 18.5 V13"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle className="bea-beacon" cx="32" cy="10.5" r="2.6" fill={accent} />

        {/* Head shell. */}
        <rect
          x="12"
          y="18"
          width="40"
          height="30"
          rx="11"
          fill="url(#bea-shell)"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1.5"
        />

        {/* Visor. */}
        <rect
          x="16"
          y="26"
          width="32"
          height="15"
          rx="7.5"
          fill="rgba(0,0,0,0.34)"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
        />

        {/* Scan light — clipped to the visor so it reads as motion behind glass. */}
        <g clipPath="url(#bea-visor-clip)">
          <rect
            className="bea-scan"
            x="30"
            y="26"
            width="4"
            height="15"
            fill={accent}
            opacity="0"
          />
        </g>

        {/* Eyes. Pills when attentive, arcs when pleased, dashes when stopped. */}
        {happy ? (
          <>
            <path
              d="M22 35.5 q3 -3.4 6 0"
              stroke={accent}
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M36 35.5 q3 -3.4 6 0"
              stroke={accent}
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
          </>
        ) : failed ? (
          <>
            <path
              d="M22.5 34 h5"
              stroke={accent}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M36.5 34 h5"
              stroke={accent}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <rect
              className="bea-eye bea-eye--left"
              x="23"
              y="30.5"
              width="4"
              height="6"
              rx="2"
              fill={accent}
            />
            <rect
              className="bea-eye bea-eye--right"
              x="37"
              y="30.5"
              width="4"
              height="6"
              rx="2"
              fill={accent}
            />
          </>
        )}

        {/* Ears/mounts — small anchors that keep the head from reading as a phone. */}
        <rect x="9" y="29" width="3.5" height="8" rx="1.75" fill="rgba(255,255,255,0.13)" />
        <rect x="51.5" y="29" width="3.5" height="8" rx="1.75" fill="rgba(255,255,255,0.13)" />
      </g>
    </svg>
  );
}

/** Live reduced-motion preference. Re-renders if the user changes it mid-session. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
