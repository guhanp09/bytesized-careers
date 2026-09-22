"use client";

import Link from "next/link";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "../Icons";
import { Reveal } from "../ui";

type IconName = Parameters<typeof Icon>[0]["name"];
type TabKey = "talent" | "recruiter";

type StepNode = {
  /** Stable identifier for React keys + test ids (display label may repeat across branches). */
  id: string;
  /** Human-facing step label, e.g. "Step 1" / "Step 2" / "Step 3". */
  label: string;
  icon: IconName;
  title: string;
  body: string;
};

type Tab = {
  key: TabKey;
  label: string;
  title: string;
  cta: { label: string; href: string };
  start: StepNode;
  branches: StepNode[];
  end: StepNode;
};

const TABS: Tab[] = [
  {
    key: "talent",
    label: "For Talent",
    title: "Use CreatorJobs as talent",
    cta: { label: "Create your free profile", href: "/you" },
    start: {
      id: "start",
      label: "Step 1",
      icon: "user-plus",
      title: "Create your profile",
      body: "Add your roles, tools, rates, and work samples.",
    },
    branches: [
      {
        id: "a",
        label: "Step 2",
        icon: "search",
        title: "Browse jobs",
        body: "Explore creator-native opportunities that fit your skills.",
      },
      {
        id: "b",
        label: "Step 2",
        icon: "globe",
        title: "Publish a talent listing",
        body: "Show recruiters what you do and how you work.",
      },
    ],
    end: {
      id: "end",
      label: "Step 3",
      icon: "check",
      title: "Apply or respond",
      body: "Send an application, or review a hiring request in your workspace.",
    },
  },
  {
    key: "recruiter",
    label: "For Recruiters",
    title: "Use CreatorJobs for hiring",
    cta: { label: "Create your hiring profile", href: "/you" },
    start: {
      id: "start",
      label: "Step 1",
      icon: "briefcase",
      title: "Create your hiring profile",
      body: "Set up your presence so talent knows who you are hiring for.",
    },
    branches: [
      {
        id: "a",
        label: "Step 2",
        icon: "search",
        title: "Browse talent",
        body: "Discover creators and specialists who fit your needs.",
      },
      {
        id: "b",
        label: "Step 2",
        icon: "file",
        title: "Publish a job listing",
        body: "Share the role and attract the right talent.",
      },
    ],
    end: {
      id: "end",
      label: "Step 3",
      icon: "check",
      title: "Review and decide",
      body: "Compare responses, message participants, and record the next step.",
    },
  },
];

type Point = { x: number; y: number };
type Anchor = Point & { strong: boolean };
type FlowGeometry = { width: number; height: number; paths: string[]; anchors: Anchor[] };

/**
 * Measures the real card-edge anchors so the connector paths connect from the
 * outside edge of one card to the outside edge of the next — they live entirely
 * in the gaps between cards and never cross a card interior. Desktop only; below
 * lg a simple vertical guide is used instead.
 */
function useFlowGeometry(
  flowRef: React.RefObject<HTMLDivElement | null>,
  startRef: React.RefObject<HTMLElement | null>,
  endRef: React.RefObject<HTMLElement | null>,
  branchRefs: React.MutableRefObject<Array<HTMLElement | null>>,
  activeKey: TabKey
) {
  const [geometry, setGeometry] = useState<FlowGeometry | null>(null);

  const measure = useCallback(() => {
    const flow = flowRef.current;
    const start = startRef.current;
    const end = endRef.current;
    const branches = branchRefs.current.filter(Boolean) as HTMLElement[];
    if (!flow || !start || !end || branches.length < 2) {
      setGeometry(null);
      return;
    }
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
      setGeometry(null);
      return;
    }

    const container = flow.getBoundingClientRect();
    const rel = (rect: DOMRect) => ({
      left: rect.left - container.left,
      right: rect.right - container.left,
      midY: rect.top + rect.height / 2 - container.top,
    });

    const s = rel(start.getBoundingClientRect());
    const e = rel(end.getBoundingClientRect());
    const startAnchor: Point = { x: s.right, y: s.midY };
    const endAnchor: Point = { x: e.left, y: e.midY };

    const paths: string[] = [];
    const anchors: Anchor[] = [
      { ...startAnchor, strong: true },
      { ...endAnchor, strong: true },
    ];
    for (const branch of branches) {
      const b = rel(branch.getBoundingClientRect());
      // Control points sit at the horizontal midpoint of each gap (lead 0.5): they line
      // up vertically rather than crossing, so the curve is a single broad, non-bulging
      // S — a flowing route, not a tight parenthesis/brace. The wide column gaps give it
      // long horizontal travel before and after the bend.
      const inMidX = (startAnchor.x + b.left) / 2;
      const outMidX = (b.right + endAnchor.x) / 2;
      paths.push(
        `M ${startAnchor.x} ${startAnchor.y} C ${inMidX} ${startAnchor.y}, ${inMidX} ${b.midY}, ${b.left} ${b.midY}`
      );
      paths.push(
        `M ${b.right} ${b.midY} C ${outMidX} ${b.midY}, ${outMidX} ${endAnchor.y}, ${endAnchor.x} ${endAnchor.y}`
      );
      anchors.push({ x: b.left, y: b.midY, strong: false }, { x: b.right, y: b.midY, strong: false });
    }

    setGeometry({ width: container.width, height: container.height, paths, anchors });
  }, [flowRef, startRef, endRef, branchRefs]);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    // Defer the first measure out of the synchronous effect body; the observer
    // also fires immediately on observe(), and again on any size/content change.
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => measure());
    observer.observe(flow);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
    // Re-measure when the active tab swaps (panel remounts → new nodes, new heights).
  }, [measure, activeKey, flowRef]);

  return geometry;
}

function FlowConnectors({ geometry }: { geometry: FlowGeometry | null }) {
  return (
    <svg
      aria-hidden="true"
      data-testid="howitworks-connectors"
      width={geometry?.width || 0}
      height={geometry?.height || 0}
      viewBox={geometry ? `0 0 ${geometry.width} ${geometry.height}` : "0 0 0 0"}
      className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
    >
      {geometry?.paths.map((d, index) => (
        <path
          key={index}
          d={d}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
      {geometry?.anchors.map((anchor, index) => (
        <circle
          key={`anchor-${index}`}
          cx={anchor.x}
          cy={anchor.y}
          r={anchor.strong ? 4 : 2.5}
          fill={anchor.strong ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.22)"}
        />
      ))}
    </svg>
  );
}

const StepCard = forwardRef<HTMLElement, { step: StepNode; testId: string }>(function StepCard(
  { step, testId },
  ref
) {
  return (
    <article
      ref={ref}
      data-testid={testId}
      className={[
        "relative z-10 flex flex-col items-center rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 text-center",
        "shadow-[0_18px_50px_-38px_rgba(0,0,0,0.95)] backdrop-blur transition-colors duration-200",
        "hover:border-white/15 hover:bg-white/[0.045]",
      ].join(" ")}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#0b0b0f] shadow-[0_14px_34px_-18px_rgba(255,255,255,0.5)]">
        <Icon name={step.icon} className="h-5 w-5" />
      </span>
      <span className="mt-4 text-[11px] font-semibold tracking-[0.16em] text-subtle">{step.label}</span>
      <h3 className="mt-2 text-sm font-semibold tracking-tight text-white">{step.title}</h3>
      <p className="mx-auto mt-2 max-w-[26ch] text-[13px] leading-6 text-muted">{step.body}</p>
    </article>
  );
});

export function HomeHowItWorks() {
  const [activeKey, setActiveKey] = useState<TabKey>("talent");
  const active = TABS.find((tab) => tab.key === activeKey) ?? TABS[0];

  const flowRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLElement>(null);
  const branchRefs = useRef<Array<HTMLElement | null>>([]);
  const geometry = useFlowGeometry(flowRef, startRef, endRef, branchRefs, activeKey);

  return (
    <section className="space-y-8">
      <Reveal>
        <div className="flex flex-col items-center text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">How it works</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{active.title}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">
            Whether you&rsquo;re hiring for a channel or looking for creator-native work, the path is short.
          </p>

          <div
            role="tablist"
            aria-label="How it works audience"
            className="mt-7 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1"
          >
            {TABS.map((tab) => {
              const isActive = tab.key === activeKey;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`howitworks-tab-${tab.key}`}
                  onClick={() => setActiveKey(tab.key)}
                  className={[
                    "inline-flex h-9 cursor-pointer items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                    isActive ? "bg-white text-[#0b0b0f]" : "text-white/60 hover:text-white",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </Reveal>

      <div className="relative mx-auto max-w-[1240px]" data-testid="howitworks-flow" ref={flowRef}>
        <FlowConnectors geometry={geometry} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-5 top-12 bottom-12 w-px bg-gradient-to-b from-transparent via-white/12 to-transparent lg:hidden"
        />
        <div
          key={activeKey}
          role="tabpanel"
          data-testid="howitworks-panel"
          className="ui-crossfade relative grid gap-4 lg:min-h-[420px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-20 xl:gap-28"
        >
          <StepCard ref={startRef} step={active.start} testId="howitworks-step-start" />

          <div
            data-testid="howitworks-branches"
            className="relative grid gap-4 rounded-[28px] border border-white/[0.06] bg-white/[0.018] p-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-6 lg:border-0 lg:bg-transparent lg:p-0"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-3 top-1/2 hidden h-px w-3 bg-white/12 sm:block lg:hidden"
            />
            {active.branches.map((branch, index) => (
              <StepCard
                key={branch.id}
                ref={(el) => {
                  branchRefs.current[index] = el;
                }}
                step={branch}
                testId={`howitworks-branch-${branch.id}`}
              />
            ))}
          </div>

          <StepCard ref={endRef} step={active.end} testId="howitworks-step-end" />
        </div>
      </div>

      <div className="flex justify-center">
        <Link
          href={active.cta.href}
          data-testid="howitworks-cta"
          className="home-cta-sheen inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0f] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          {active.cta.label}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
