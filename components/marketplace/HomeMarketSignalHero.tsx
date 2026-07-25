"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

const homepageHeadlines = [
  "Behind every content creator business is a growing team.",
  "Creator-led media is becoming a real industry.",
  "The next generation of media is built by teams.",
  "Content creator businesses are scaling. Their teams should too.",
  "The teams behind content creators are getting built.",
] as const;

const HEADLINE_STORAGE_KEYS = {
  headline: "selectedHomepageHeadline",
  index: "selectedHomepageHeadlineIndex",
  timestamp: "selectedHomepageHeadlineTimestamp",
} as const;

const HEADLINE_FRESHNESS_MS = 6 * 60 * 60 * 1000;

const heroStats = [
  {
    value: "2-2.5M",
    label: "monetized content creators in India",
    caption: "A professional layer is forming around creator-led media.",
    sourceNote: "BCG, From Content to Commerce: Mapping India's Creator Economy, 2025",
  },
  {
    value: "₹5,000 Cr",
    label: "Indian influencer marketing market",
    caption: "Projected by 2027.",
    sourceNote: "IBEF citing WPP/Kantar India Influencer Marketing Report, 2025",
  },
  {
    value: "25%",
    label: "projected influencer marketing growth in 2025",
    caption: "Brands are moving from experiments to content creator teams.",
    sourceNote: "IBEF citing WPP/Kantar India Influencer Marketing Report, 2025",
  },
  {
    value: "2-sided",
    label: "jobs and talent in one market",
    caption: "Creator-led teams need hiring and discovery to live together.",
    sourceNote: "Conceptual CreatorJobs market scene",
  },
  {
    value: "5 core roles",
    label: "editors · designers · writers · strategists · operators",
    caption: "Content creator teams are becoming multidisciplinary.",
    sourceNote: "Conceptual CreatorJobs market scene",
  },
  {
    value: "1M+",
    label: "content creators entering structured programs",
    caption: "The ecosystem is getting organized.",
    sourceNote: "Conceptual CreatorJobs market scene",
  },
  {
    value: "24/7",
    label: "global content operations",
    caption: "Distributed teams now run channels across time zones.",
    sourceNote: "Conceptual CreatorJobs market scene",
  },
] as const;

// Steady cadence for the bottom-right stat carousel (within the 4–6s target). A fixed
// interval keeps cycling continuous and keeps the progress bar in sync with each change.
const STAT_ROTATION_MS = 5000;

function resolveStoredHeadline() {
  if (typeof window === "undefined") return homepageHeadlines[0];

  try {
    const storedHeadline = window.localStorage.getItem(HEADLINE_STORAGE_KEYS.headline);
    const storedIndex = Number(window.localStorage.getItem(HEADLINE_STORAGE_KEYS.index));
    const storedTimestamp = Number(window.localStorage.getItem(HEADLINE_STORAGE_KEYS.timestamp));
    const now = Date.now();
    const indexFromHeadline = storedHeadline
      ? homepageHeadlines.findIndex((headline) => headline === storedHeadline)
      : -1;
    const validIndex = Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < homepageHeadlines.length
      ? storedIndex
      : indexFromHeadline;
    const hasFreshHeadline =
      validIndex >= 0 && Number.isFinite(storedTimestamp) && now - storedTimestamp < HEADLINE_FRESHNESS_MS;
    const nextIndex = hasFreshHeadline ? validIndex : validIndex >= 0 ? (validIndex + 1) % homepageHeadlines.length : 0;
    const nextHeadline = homepageHeadlines[nextIndex];

    window.localStorage.setItem(HEADLINE_STORAGE_KEYS.headline, nextHeadline);
    window.localStorage.setItem(HEADLINE_STORAGE_KEYS.index, String(nextIndex));
    window.localStorage.setItem(HEADLINE_STORAGE_KEYS.timestamp, String(hasFreshHeadline ? storedTimestamp : now));

    return nextHeadline;
  } catch {
    return homepageHeadlines[0];
  }
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  return reducedMotion;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

const NUMERIC_SEGMENT = /^[\d,]+(?:\.\d+)?$/;

function StatValue({ value, animate }: { value: string; animate: boolean }) {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!animate) return;
    const container = containerRef.current;
    if (!container) return;
    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-count-target]"));
    if (targets.length === 0) return;

    const parsed = targets
      .map((el) => {
        const raw = el.dataset.countTarget || "";
        const numeric = Number(raw.replace(/,/g, ""));
        const decimals = raw.includes(".") ? (raw.split(".")[1] || "").length : 0;
        return { el, raw, numeric, decimals, grouped: raw.includes(",") };
      })
      .filter((target) => Number.isFinite(target.numeric));
    if (parsed.length === 0) return;

    const duration = 900;
    const formatter = new Intl.NumberFormat("en-IN");
    const start = performance.now();
    let rafId = 0;

    const frame = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = easeOutCubic(progress);
      for (const target of parsed) {
        if (progress >= 1) {
          target.el.textContent = target.raw;
        } else {
          const current = target.numeric * eased;
          target.el.textContent = target.grouped
            ? formatter.format(Math.round(current))
            : current.toFixed(target.decimals);
        }
      }
      if (progress < 1) {
        rafId = requestAnimationFrame(frame);
      }
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [animate, value]);

  return (
    <span ref={containerRef}>
      {value.split(/([\d,]+(?:\.\d+)?)/).map((segment, index) =>
        NUMERIC_SEGMENT.test(segment) ? (
          <span key={`${value}-${index}`} data-count-target={segment}>
            {segment}
          </span>
        ) : (
          <span key={`${value}-${index}`}>{segment}</span>
        )
      )}
    </span>
  );
}

export function HomeMarketSignalHero() {
  const [headline, setHeadline] = useState<(typeof homepageHeadlines)[number]>(homepageHeadlines[0]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionCount, setTransitionCount] = useState(0);
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const orbitOneRef = useRef<HTMLDivElement | null>(null);
  const orbitTwoRef = useRef<HTMLDivElement | null>(null);
  const activeSceneIndex = reducedMotion ? 0 : activeIndex;
  const activeStat = heroStats[activeSceneIndex];

  useEffect(() => {
    const applyStoredHeadline = () => setHeadline(resolveStoredHeadline());
    applyStoredHeadline();
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    // Continuous, steady rotation. A fixed-delay interval (deps: reducedMotion only)
    // means cycling never stalls — unlike a self-rescheduling timeout whose delay can
    // settle to a constant and stop re-triggering its effect.
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % heroStats.length);
      setTransitionCount((current) => current + 1);
    }, STAT_ROTATION_MS);

    return () => window.clearInterval(interval);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return;
    const section = sectionRef.current;
    if (!section) return;

    const state = {
      targetX: 0,
      targetY: 0,
      currentX: 0,
      currentY: 0,
      normTargetX: 0,
      normTargetY: 0,
      normCurrentX: 0,
      normCurrentY: 0,
      pointerInside: false,
      rafId: 0,
    };

    const step = () => {
      state.currentX += (state.targetX - state.currentX) * 0.08;
      state.currentY += (state.targetY - state.currentY) * 0.08;
      state.normCurrentX += (state.normTargetX - state.normCurrentX) * 0.08;
      state.normCurrentY += (state.normTargetY - state.normCurrentY) * 0.08;

      const spotlight = spotlightRef.current;
      if (spotlight) {
        spotlight.style.transform = `translate3d(${state.currentX - 280}px, ${state.currentY - 280}px, 0)`;
      }
      const orbitOne = orbitOneRef.current;
      if (orbitOne) {
        orbitOne.style.transform = `translate3d(${state.normCurrentX * -28}px, ${state.normCurrentY * -20}px, 0)`;
      }
      const orbitTwo = orbitTwoRef.current;
      if (orbitTwo) {
        orbitTwo.style.transform = `translate3d(${state.normCurrentX * 16}px, ${state.normCurrentY * 12}px, 0)`;
      }

      const settled =
        Math.abs(state.targetX - state.currentX) < 0.1 && Math.abs(state.targetY - state.currentY) < 0.1;
      if (settled && !state.pointerInside) {
        state.rafId = 0;
        return;
      }
      state.rafId = requestAnimationFrame(step);
    };

    const trackPointer = (event: PointerEvent) => {
      const rect = section.getBoundingClientRect();
      state.targetX = event.clientX - rect.left;
      state.targetY = event.clientY - rect.top;
      state.normTargetX = state.targetX / rect.width - 0.5;
      state.normTargetY = state.targetY / rect.height - 0.5;
    };

    const handlePointerEnter = (event: PointerEvent) => {
      state.pointerInside = true;
      trackPointer(event);
      // Snap to the entry point so the spotlight doesn't fly in from a corner.
      state.currentX = state.targetX;
      state.currentY = state.targetY;
      spotlightRef.current?.classList.add("market-signal-spotlight-active");
      if (!state.rafId) state.rafId = requestAnimationFrame(step);
    };

    const handlePointerMove = (event: PointerEvent) => {
      trackPointer(event);
      if (!state.rafId) state.rafId = requestAnimationFrame(step);
    };

    const handlePointerLeave = () => {
      state.pointerInside = false;
      spotlightRef.current?.classList.remove("market-signal-spotlight-active");
    };

    section.addEventListener("pointerenter", handlePointerEnter);
    section.addEventListener("pointermove", handlePointerMove);
    section.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      section.removeEventListener("pointerenter", handlePointerEnter);
      section.removeEventListener("pointermove", handlePointerMove);
      section.removeEventListener("pointerleave", handlePointerLeave);
      if (state.rafId) cancelAnimationFrame(state.rafId);
    };
  }, [reducedMotion]);

  const headlineWords = headline.split(" ");

  return (
    <section
      ref={sectionRef}
      className="market-signal-hero relative isolate min-h-[500px] overflow-hidden rounded-[42px] px-6 py-10 sm:px-9 sm:py-12 lg:min-h-[570px] lg:px-12 lg:py-16"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="market-signal-gradient absolute inset-0" />
        <div className="market-signal-grid absolute inset-0" />
        <div className="market-signal-vignette absolute inset-0" />
        <div ref={orbitOneRef} className="absolute right-[-8%] top-[7%] h-[34rem] w-[34rem] will-change-transform">
          <div className="market-signal-orbit market-signal-orbit-one absolute inset-0 rounded-full" />
        </div>
        <div ref={orbitTwoRef} className="absolute bottom-[-24%] left-[42%] h-[24rem] w-[24rem] will-change-transform">
          <div className="market-signal-orbit market-signal-orbit-two absolute inset-0 rounded-full" />
        </div>
        <div className="market-signal-line absolute left-[7%] top-[24%] h-px w-[40%] rotate-[-8deg]" />
        <div className="market-signal-line market-signal-line-soft absolute bottom-[28%] right-[8%] h-px w-[34%] rotate-[12deg]" />
        <div className="market-signal-pulse absolute right-[18%] top-[30%] h-2 w-2 rounded-full bg-white/45" />
        <div className="market-signal-pulse market-signal-pulse-delay absolute right-[34%] top-[64%] h-1.5 w-1.5 rounded-full bg-white/30" />
        <div className="market-signal-pulse market-signal-pulse-slow absolute left-[17%] bottom-[24%] h-1.5 w-1.5 rounded-full bg-white/25" />
        <div ref={spotlightRef} className="market-signal-spotlight" />
        <div className="home-grain absolute inset-0" />
      </div>

      <div className="relative z-10 grid min-h-[420px] content-between gap-14 lg:min-h-[440px]">
        <div className="max-w-4xl">
          <h1 className="max-w-5xl text-5xl font-semibold tracking-tight text-white sm:text-6xl lg:text-[76px] lg:leading-[0.94]">
            {headlineWords.map((word, index) => (
              <Fragment key={`${headline}-${index}`}>
                <span className="home-word" style={{ animationDelay: `${index * 48}ms` }}>
                  {word}
                </span>
                {index < headlineWords.length - 1 ? " " : null}
              </Fragment>
            ))}
          </h1>
          <p className="home-rise home-rise-delay-tagline mt-6 max-w-2xl text-base leading-7 text-white/62 sm:text-lg sm:leading-8">
            Find the editors, designers, strategists, and operators behind creator-led media.
          </p>
          <div className="home-rise home-rise-delay-cta mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/jobs"
              className="home-cta-sheen inline-flex h-11 cursor-pointer items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0f] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Browse jobs
            </Link>
            <Link
              href="/talent"
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-white/15 px-6 text-sm font-semibold text-white/85 transition-colors hover:border-white/30 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Browse talent
            </Link>
          </div>
        </div>

        <div className="grid items-end gap-9 lg:grid-cols-[minmax(0,0.58fr)_minmax(0,0.9fr)]">
          <p className="home-rise home-rise-delay-actions max-w-lg text-sm leading-6 text-subtle sm:text-base sm:leading-7">
            A marketplace for the teams behind creator-led media.
          </p>

          <div className="min-w-0 lg:justify-self-end" aria-live="off">
            <div key={activeStat.value} className="market-signal-scene" data-testid="hero-stat">
              <div className="relative max-w-full">
                <div className="market-signal-stat-glow absolute -inset-x-4 bottom-1 h-16 rounded-full sm:h-20" />
                <p className="market-signal-stat-number relative whitespace-nowrap font-semibold tabular-nums text-white">
                  <StatValue value={activeStat.value} animate={transitionCount > 0 && !reducedMotion} />
                </p>
              </div>
              <div className="mt-4 max-w-xl lg:ml-auto lg:text-right">
                <p data-testid="hero-stat-label" className="text-sm font-semibold uppercase tracking-[0.14em] text-white/72">{activeStat.label}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{activeStat.caption}</p>
                {!reducedMotion ? (
                  <div
                    className="market-signal-progress-track mt-4 lg:ml-auto"
                    aria-hidden="true"
                    data-testid="hero-stat-progress"
                  >
                    <div
                      className="market-signal-progress-fill"
                      style={{ animationDuration: `${STAT_ROTATION_MS}ms` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
