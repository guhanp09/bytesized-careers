"use client";

import React, { useId } from "react";

import { Icon } from "../Icons";

export default function IconFact({
  icon,
  label,
  value,
  className = "",
  iconClassName = "",
  valueClassName = "",
  tooltipClassName = "",
  interactiveTooltip = false,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  value: React.ReactNode;
  className?: string;
  iconClassName?: string;
  valueClassName?: string;
  tooltipClassName?: string;
  interactiveTooltip?: boolean;
}) {
  const tooltipId = useId();

  return (
    <span className={["group/iconfact relative inline-flex min-w-0 items-center gap-2", className].join(" ")}>
      {interactiveTooltip ? (
        <button
          type="button"
          aria-label={label}
          aria-describedby={tooltipId}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={[
            "peer inline-flex h-4 w-4 flex-none cursor-help items-center justify-center rounded-full text-white/50 transition-colors",
            "hover:text-white/78 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 focus-visible:text-white/78",
            iconClassName,
          ].join(" ")}
        >
          <Icon name={icon} className="h-4 w-4" />
        </button>
      ) : (
        <span
          aria-hidden="true"
          title={label}
          className={[
            "peer inline-flex h-4 w-4 flex-none cursor-help items-center justify-center text-white/50 transition-colors",
            "group-hover/iconfact:text-white/78",
            iconClassName,
          ].join(" ")}
        >
          <Icon name={icon} className="h-4 w-4" />
        </span>
      )}

      <span className="sr-only">{`${label}: `}</span>
      <span className={["min-w-0 leading-snug text-white/90", valueClassName].join(" ")}>{value}</span>

      <span
        id={interactiveTooltip ? tooltipId : undefined}
        role="tooltip"
        className={[
          "pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-white/10 bg-[#111216] px-2.5 py-1.5 text-[11px] font-medium leading-none text-white/82 opacity-0 shadow-[0_18px_40px_-24px_rgba(0,0,0,1)] transition-opacity duration-150 whitespace-nowrap",
          "group-hover/iconfact:opacity-100",
          interactiveTooltip ? "peer-hover:opacity-100 peer-focus-visible:opacity-100" : "",
          tooltipClassName,
        ].join(" ")}
      >
        {label}
      </span>
    </span>
  );
}
