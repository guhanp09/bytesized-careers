"use client";

import React from "react";
import { resolveToolDisplay } from "../../lib/toolCatalog";
import { Icon } from "../Icons";

type ToolChipProps = {
  toolName: string;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
};

const sizeClasses = {
  sm: {
    chip: "gap-1.5 rounded-full px-2.5 py-1.5 text-xs",
    mark: "h-5 w-5 text-[9px]",
    icon: "h-3.5 w-3.5",
  },
  md: {
    chip: "gap-2 rounded-full px-3 py-2 text-[13px]",
    mark: "h-6 w-6 text-[10px]",
    icon: "h-4 w-4",
  },
};

export default function ToolChip({
  toolName,
  size = "sm",
  showLabel = true,
  className = "",
}: ToolChipProps) {
  const tool = resolveToolDisplay(toolName);
  const classes = sizeClasses[size];

  if (!tool.inputName) {
    return null;
  }

  return (
    <span
      data-testid="tool-chip"
      data-tool-logo-key={tool.logoKey || "fallback"}
      className={[
        "inline-flex max-w-full items-center border border-white/[0.10] bg-white/[0.045] font-medium leading-none text-white/70",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        classes.chip,
        className,
      ].join(" ")}
      title={tool.known ? tool.displayName : `${tool.inputName} (custom tool)`}
    >
      <span
        aria-hidden="true"
        className={[
          "inline-flex shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.075] font-semibold text-white/78",
          classes.mark,
        ].join(" ")}
      >
        {tool.iconName ? (
          <Icon name={tool.iconName} className={classes.icon} />
        ) : (
          <span className="translate-y-px">{tool.initials}</span>
        )}
      </span>
      {showLabel ? <span className="min-w-0 truncate">{tool.displayName || tool.inputName}</span> : null}
    </span>
  );
}
