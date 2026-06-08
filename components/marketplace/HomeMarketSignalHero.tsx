"use client";

import { useEffect, useState } from "react";

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

export function HomeMarketSignalHero() {
  const [headline, setHeadline] = useState<(typeof homepageHeadlines)[number]>(homepageHeadlines[0]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionCount, setTransitionCount] = useState(0);
  const reducedMotion = useReducedMotion();
  const activeSceneIndex = reducedMotion ? 0 : activeIndex;
  const activeStat = heroStats[activeSceneIndex];

  useEffect(() => {
    const applyStoredHeadline = () => setHeadline(resolveStoredHeadline());
    applyStoredHeadline();
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    const delay = Math.min(5000 + transitionCount * 2000, 17000);
    const timeout = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % heroStats.length);
      setTransitionCount((current) => current + 1);
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [reducedMotion, transitionCount]);

  return (
    <section className="market-signal-hero relative isolate min-h-[500px] overflow-hidden rounded-[42px] px-6 py-10 sm:px-9 sm:py-12 lg:min-h-[570px] lg:px-12 lg:py-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="market-signal-gradient absolute inset-0" />
        <div className="market-signal-grid absolute inset-0" />
        <div className="market-signal-vignette absolute inset-0" />
        <div className="market-signal-orbit market-signal-orbit-one absolute right-[-8%] top-[7%] h-[34rem] w-[34rem] rounded-full" />
        <div className="market-signal-orbit market-signal-orbit-two absolute bottom-[-24%] left-[42%] h-[24rem] w-[24rem] rounded-full" />
        <div className="market-signal-line absolute left-[7%] top-[24%] h-px w-[40%] rotate-[-8deg]" />
        <div className="market-signal-line market-signal-line-soft absolute bottom-[28%] right-[8%] h-px w-[34%] rotate-[12deg]" />
        <div className="market-signal-pulse absolute right-[18%] top-[30%] h-2 w-2 rounded-full bg-white/45" />
        <div className="market-signal-pulse market-signal-pulse-delay absolute right-[34%] top-[64%] h-1.5 w-1.5 rounded-full bg-white/30" />
        <div className="market-signal-pulse market-signal-pulse-slow absolute left-[17%] bottom-[24%] h-1.5 w-1.5 rounded-full bg-white/25" />
      </div>

      <div className="relative z-10 grid min-h-[420px] content-between gap-14 lg:min-h-[440px]">
        <div className="home-rise max-w-4xl">
          <h1 className="max-w-5xl text-5xl font-semibold tracking-tight text-white sm:text-6xl lg:text-[76px] lg:leading-[0.94]">
            {headline}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/62 sm:text-lg sm:leading-8">
            Find the editors, designers, strategists, and operators behind creator-led media.
          </p>
        </div>

        <div className="grid items-end gap-9 lg:grid-cols-[minmax(0,0.58fr)_minmax(0,0.9fr)]">
          <p className="home-rise home-rise-delay-actions max-w-lg text-sm leading-6 text-white/42 sm:text-base sm:leading-7">
            A marketplace for the teams behind creator-led media.
          </p>

          <div className="min-w-0 lg:justify-self-end" aria-live="off">
            <div key={activeStat.value} className="market-signal-scene">
              <div className="relative max-w-full">
                <div className="market-signal-stat-glow absolute -inset-x-4 bottom-1 h-16 rounded-full sm:h-20" />
                <p className="market-signal-stat-number relative whitespace-nowrap font-semibold text-white">
                  {activeStat.value}
                </p>
              </div>
              <div className="mt-4 max-w-xl lg:ml-auto lg:text-right">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/72">{activeStat.label}</p>
                <p className="mt-2 text-sm leading-6 text-white/48">{activeStat.caption}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
