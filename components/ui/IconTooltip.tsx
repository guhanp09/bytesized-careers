"use client";

import React from "react";
import { createPortal } from "react-dom";

type TooltipPosition = {
  left: number;
  top: number;
  placement: "top" | "bottom";
};

export default function IconTooltip({
  label,
  anchorRef,
  open,
  id,
  className = "",
  sideOffset = 5,
}: {
  label: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  id?: string;
  className?: string;
  sideOffset?: number;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [position, setPosition] = React.useState<TooltipPosition | null>(null);
  const tooltipRef = React.useRef<HTMLSpanElement | null>(null);

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      setPosition(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const tooltip = tooltipRef.current;
    const tooltipWidth = tooltip?.offsetWidth ?? 0;
    const tooltipHeight = tooltip?.offsetHeight ?? 0;
    const viewportPadding = 8;
    const centeredLeft = rect.left + rect.width / 2;
    const minLeft = tooltipWidth ? tooltipWidth / 2 + viewportPadding : viewportPadding;
    const maxLeft = tooltipWidth ? window.innerWidth - tooltipWidth / 2 - viewportPadding : window.innerWidth - viewportPadding;
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const hasTopSpace = !tooltipHeight || rect.top - sideOffset - tooltipHeight >= viewportPadding;
    const nextPosition: TooltipPosition = hasTopSpace
      ? {
          left,
          top: rect.top - sideOffset,
          placement: "top",
        }
      : {
          left,
          top: rect.bottom + sideOffset,
          placement: "bottom",
        };

    setPosition((current) =>
      current &&
      Math.abs(current.left - nextPosition.left) < 0.5 &&
      Math.abs(current.top - nextPosition.top) < 0.5 &&
      current.placement === nextPosition.placement
        ? current
        : nextPosition
    );
  }, [anchorRef, sideOffset]);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    const handle = () => updatePosition();

    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, updatePosition]);

  if (!mounted || !open || !position) return null;

  return createPortal(
    <span
      ref={tooltipRef}
      id={id}
      role="tooltip"
      className={[
        "pointer-events-none fixed z-[9999] -translate-x-1/2",
        position.placement === "top" ? "-translate-y-full" : "translate-y-0",
        "rounded-md border border-white/10 bg-black/80 px-2 py-1",
        "max-w-[calc(100vw-16px)] whitespace-nowrap text-[11px] text-white/90",
        "shadow-[0_8px_18px_-10px_rgba(0,0,0,0.9)]",
        className,
      ].join(" ")}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
    >
      {label}
    </span>,
    document.body
  );
}
