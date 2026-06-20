"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "./Icons";

export type RecommendedChecklistItem<StepId extends string = string> = {
  id: string;
  label: string;
  complete: boolean;
  step: StepId;
  targetId?: string;
};

export default function RecommendedChecklistPopup<StepId extends string>({
  items,
  onSelect,
  ariaLabel = "Recommended listing details",
}: {
  items: Array<RecommendedChecklistItem<StepId>>;
  onSelect: (item: RecommendedChecklistItem<StepId>) => void;
  ariaLabel?: string;
}) {
  const previousStatusRef = useRef<Map<string, boolean> | null>(null);
  const [justCompleted, setJustCompleted] = useState<Set<string>>(() => new Set());
  const completedCount = items.filter((item) => item.complete).length;
  const progress = items.length ? Math.round((completedCount / items.length) * 100) : 100;
  const statusSignature = useMemo(
    () => items.map((item) => `${item.id}:${item.complete ? "1" : "0"}`).join("|"),
    [items]
  );

  useEffect(() => {
    const current = new Map(items.map((item) => [item.id, item.complete]));
    const previous = previousStatusRef.current;
    previousStatusRef.current = current;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!previous || prefersReducedMotion) return;

    const newlyCompleted = items.filter((item) => item.complete && previous.get(item.id) === false);
    if (!newlyCompleted.length) return;

    setJustCompleted((existing) => {
      const next = new Set(existing);
      newlyCompleted.forEach((item) => next.add(item.id));
      return next;
    });

    const timers = newlyCompleted.map((item) =>
      window.setTimeout(() => {
        setJustCompleted((existing) => {
          const next = new Set(existing);
          next.delete(item.id);
          return next;
        });
      }, 720)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [items, statusSignature]);

  return (
    <>
      <section
        className="fixed bottom-4 right-4 z-40 w-[min(292px,calc(100vw-2rem))] rounded-2xl border border-white/[0.075] bg-[#101014]/92 p-3 text-white shadow-[0_20px_60px_-42px_rgba(0,0,0,1)] backdrop-blur-md sm:bottom-5 sm:right-5"
        aria-label={ariaLabel}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold tracking-tight text-white/78">Improve your listing</h2>
          <span
            className="text-[11px] font-semibold tabular-nums text-white/48"
            aria-label={`${progress}% complete`}
          >
            {progress}%
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.075]" aria-hidden="true">
          <div
            className="h-full rounded-full bg-white/38 transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-4 text-white/38">
          Small details can help the right people decide faster.
        </p>
        <ul className="mt-2.5 space-y-1" aria-label={`Recommended details ${progress}% complete`}>
          {items.map((item) => {
            const animateComplete = justCompleted.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-label={item.complete ? `${item.label} completed` : `Go to ${item.label}`}
                  aria-pressed={item.complete}
                  onClick={() => onSelect(item)}
                  className={[
                    "group flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/24",
                    item.complete
                      ? "text-white/42 hover:bg-white/[0.025] hover:text-white/52"
                      : "text-white/66 hover:bg-white/[0.045] hover:text-white/86",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                      item.complete
                        ? "border-emerald-200/20 bg-emerald-200/[0.10] text-emerald-100/75"
                        : "border-white/18 bg-transparent text-transparent group-hover:border-white/28",
                      animateComplete ? "cj-checklist-check-run" : "",
                    ].join(" ")}
                    aria-hidden="true"
                  >
                    {item.complete ? <Icon name="check" className="h-2.5 w-2.5" /> : null}
                  </span>
                  <span className="relative min-w-0">
                    <span className="relative z-10 block truncate">{item.label}</span>
                    {item.complete ? (
                      <span
                        aria-hidden="true"
                        className={[
                          "pointer-events-none absolute left-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-white/32",
                          animateComplete ? "cj-checklist-strike-run" : "w-full",
                        ].join(" ")}
                      />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <style>{`
        .cj-checklist-strike-run {
          width: 0;
          animation: cj-checklist-strike 520ms cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
        }

        .cj-checklist-check-run {
          animation: cj-checklist-settle 360ms cubic-bezier(0.18, 0.9, 0.22, 1.1);
        }

        @keyframes cj-checklist-strike {
          from {
            width: 0;
          }
          to {
            width: 100%;
          }
        }

        @keyframes cj-checklist-settle {
          0% {
            transform: scale(0.86);
          }
          62% {
            transform: scale(1.08);
          }
          100% {
            transform: scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .cj-checklist-strike-run,
          .cj-checklist-check-run {
            animation: none;
          }

          .cj-checklist-strike-run {
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
