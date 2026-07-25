"use client";

import { useEffect, useRef } from "react";

import { Icon } from "../Icons";

export type CompletionChecklistItem = {
  key: string;
  title: string;
  done: boolean;
};

type ProfileCompletionCardProps = {
  variant?: "sidebar";
  title?: string;
  percentage: number;
  helperText: string;
  items: CompletionChecklistItem[];
  recommendedKey?: string | null;
  expanded: boolean;
  hiddenCount: number;
  onToggleExpanded: () => void;
  onTaskClick: (key: string) => void;
  className?: string;
};

const join = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export default function ProfileCompletionCard({
  variant = "sidebar",
  title = "Improve your profile",
  percentage,
  helperText,
  items,
  recommendedKey = null,
  expanded,
  hiddenCount,
  onToggleExpanded,
  onTaskClick,
  className,
}: ProfileCompletionCardProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollCompletedRef = useRef(false);
  const hasUserScrolledRef = useRef(false);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    const onUserScroll = () => {
      hasUserScrolledRef.current = true;
      if (autoScrollTimerRef.current) {
        clearTimeout(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
    };

    container.addEventListener("wheel", onUserScroll, { passive: true });
    container.addEventListener("touchmove", onUserScroll, { passive: true });
    container.addEventListener("scroll", onUserScroll, { passive: true });

    return () => {
      container.removeEventListener("wheel", onUserScroll);
      container.removeEventListener("touchmove", onUserScroll);
      container.removeEventListener("scroll", onUserScroll);
      if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoScrollCompletedRef.current || hasUserScrolledRef.current || items.length === 0) return;
    if (autoScrollTimerRef.current) {
      clearTimeout(autoScrollTimerRef.current);
    }
    autoScrollTimerRef.current = setTimeout(() => {
      autoScrollCompletedRef.current = true;
      if (hasUserScrolledRef.current) return;
      const container = listRef.current;
      if (!container) return;
      const taskElements = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-task-id]"));
      const completedElements = taskElements.filter(
        (element) => element.dataset.taskCompleted === "true"
      );
      if (completedElements.length <= 2) return;
      const firstIncompleteElement = taskElements.find(
        (element) => element.dataset.taskCompleted !== "true"
      );
      if (!firstIncompleteElement) return;

      const containerPaddingTop = Number.parseFloat(getComputedStyle(container).paddingTop || "0") || 0;
      const firstOfLastTwoCompleted = completedElements[completedElements.length - 2];
      const containerTop = container.getBoundingClientRect().top;
      const completedAnchorTop =
        firstOfLastTwoCompleted.getBoundingClientRect().top - containerTop + container.scrollTop;
      const targetTop = Math.max(0, completedAnchorTop - containerPaddingTop);

      container.scrollTo({
        top: targetTop,
        behavior: "smooth",
      });
    }, 1000);
  }, [items]);

  return (
    <section
      className={join(
        "rounded-2xl border border-white/[0.07] bg-white/[0.028] p-3.5 shadow-[0_14px_38px_-34px_rgba(0,0,0,0.95)]",
        variant === "sidebar"
          ? // Sidebar dimensions are sized to match reference proportions while keeping existing design language.
            "w-full lg:max-h-[310px]"
          : "",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/95">{title}</h2>
        <span className="text-sm font-semibold text-white">{percentage}%</span>
      </div>

      <div className="mt-2">
        <div className="h-px overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/45 transition-[width] duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-white/55">{helperText}</p>

      <div
        ref={listRef}
        className={join(
          "mt-3 min-h-0 overflow-y-auto",
          expanded ? "max-h-[196px] pr-1" : "max-h-[144px]"
        )}
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="space-y-1">
          {items.map((item) => (
            <button
              key={item.key}
              id={`task-${item.key}`}
              data-task-id={item.key}
              data-task-completed={item.done ? "true" : "false"}
              type="button"
              onClick={() => onTaskClick(item.key)}
              className={join(
                "group min-h-8 w-full rounded-lg px-1.5 text-left text-xs transition-colors inline-flex items-center gap-2.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25",
                item.done
                  ? "text-emerald-100/80 hover:bg-white/[0.03]"
                  : item.key === recommendedKey
                    ? "text-white/95 bg-white/[0.07] hover:bg-white/[0.1]"
                    : "text-white/82 hover:bg-white/[0.06]"
              )}
            >
              <span
                className={join(
                  "relative h-[18px] w-[18px] shrink-0 rounded-full border inline-flex items-center justify-center transition-colors duration-300",
                  item.done ? "border-emerald-200/70 bg-emerald-200/10" : "border-white/45 bg-transparent"
                )}
              >
                <span
                  className={join(
                    "transition-all duration-300",
                    item.done ? "opacity-100 scale-100 text-emerald-200/95" : "opacity-0 scale-75 text-transparent"
                  )}
                >
                  <Icon name="check" className="h-3.5 w-3.5" />
                </span>
              </span>

              <span className="flex-1 min-w-0">
                <span
                  className={join(
                    "relative inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-middle transition-colors duration-300",
                    item.done ? "text-emerald-100/80" : "text-inherit",
                    "after:absolute after:left-0 after:top-1/2 after:h-px after:w-full after:origin-left after:transition-transform after:duration-300 after:content-['']",
                    item.done
                      ? "after:scale-x-100 after:bg-emerald-100/80"
                      : "after:scale-x-0 after:bg-transparent"
                  )}
                >
                  {item.title}
                </span>
              </span>

              {!item.done ? <span className="text-base leading-none text-subtle">›</span> : null}
            </button>
          ))}
        </div>
      </div>

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="mt-1 text-xs font-medium text-white/65 hover:text-white/85 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 rounded-md"
        >
          {expanded ? "See less" : `See more (${hiddenCount})`}
        </button>
      ) : null}
    </section>
  );
}
