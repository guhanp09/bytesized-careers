"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, CSSProperties, ReactNode, RefObject } from "react";
import { Icon } from "../Icons";

export type PopoverAnchorPoint = {
  x: number;
  y: number;
};

export type AnchoredPopoverPosition = {
  isMobile: boolean;
  top?: number;
  left?: number;
  width?: number;
  maxHeight?: number;
  caretLeft?: number;
  caretTop?: number;
  placement?: "top" | "right" | "bottom" | "left";
  originX?: number;
  originY?: number;
};

type PositionOptions = {
  desktopWidth?: number;
  minDesktopWidth?: number;
  preferredHeight?: number;
  measuredWidth?: number;
  measuredHeight?: number;
  margin?: number;
  gap?: number;
};

type UseAnchoredGlassPopoverOptions = PositionOptions;

const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
};

const hasMeaningfulPositionChange = (
  a: AnchoredPopoverPosition | null,
  b: AnchoredPopoverPosition
) => {
  if (!a) return true;
  return (
    a.isMobile !== b.isMobile ||
    a.placement !== b.placement ||
    Math.abs((a.top ?? 0) - (b.top ?? 0)) > 0.5 ||
    Math.abs((a.left ?? 0) - (b.left ?? 0)) > 0.5 ||
    Math.abs((a.width ?? 0) - (b.width ?? 0)) > 0.5 ||
    Math.abs((a.maxHeight ?? 0) - (b.maxHeight ?? 0)) > 0.5 ||
    Math.abs((a.caretLeft ?? 0) - (b.caretLeft ?? 0)) > 0.5 ||
    Math.abs((a.caretTop ?? 0) - (b.caretTop ?? 0)) > 0.5
  );
};

export function getAnchoredPopoverPosition(
  anchor: DOMRect,
  origin?: PopoverAnchorPoint,
  options: PositionOptions = {}
): AnchoredPopoverPosition {
  const margin = options.margin ?? 20;
  const gap = options.gap ?? 14;
  const isMobile = window.innerWidth < 640;
  const originX = origin?.x || anchor.left + anchor.width / 2;
  const originY = origin?.y || anchor.top + anchor.height / 2;
  const maxWidth = Math.max(280, window.innerWidth - margin * 2);
  const availableHeight = Math.max(280, window.innerHeight - margin * 2);
  const maxPopoverHeight = Math.min(options.preferredHeight ?? availableHeight, availableHeight);

  if (isMobile) {
    return { isMobile, maxHeight: availableHeight, originX, originY };
  }

  const desiredWidth = Math.min(options.desktopWidth ?? 840, maxWidth);
  const minDesktopWidth = Math.min(options.minDesktopWidth ?? 420, desiredWidth);
  const measuredWidth = options.measuredWidth ? Math.min(options.measuredWidth, desiredWidth) : desiredWidth;
  const measuredHeight = Math.min(options.measuredHeight ?? maxPopoverHeight, maxPopoverHeight);
  const cornerSafeArea = 34;

  const makeSidePosition = (placement: "right" | "left") => {
    const left =
      placement === "right"
        ? originX + gap
        : Math.max(margin, originX - gap - measuredWidth);
    const availableWidth =
      placement === "right"
        ? window.innerWidth - margin - left
        : originX - gap - margin;
    const width = Math.min(desiredWidth, Math.max(0, availableWidth));
    if (width < minDesktopWidth) return null;

    const safeLeft =
      placement === "right"
        ? clamp(left, margin, window.innerWidth - width - margin)
        : clamp(originX - gap - width, margin, window.innerWidth - width - margin);
    const height = measuredHeight;
    const top = clamp(originY - height / 2, margin, window.innerHeight - height - margin);

    return {
      isMobile,
      top,
      left: safeLeft,
      width,
      maxHeight: maxPopoverHeight,
      caretTop: clamp(originY - top, cornerSafeArea, height - cornerSafeArea),
      placement,
      originX,
      originY,
    };
  };

  const rightPosition = makeSidePosition("right");
  if (rightPosition) return rightPosition;

  const leftPosition = makeSidePosition("left");
  if (leftPosition) return leftPosition;

  const width = Math.min(desiredWidth, maxWidth);
  const centeredLeft = clamp(originX - width / 2, margin, window.innerWidth - width - margin);
  const belowSpace = window.innerHeight - margin - (originY + gap);
  const aboveSpace = originY - gap - margin;
  const placement: "bottom" | "top" = belowSpace >= Math.min(measuredHeight, maxPopoverHeight * 0.45) || belowSpace >= aboveSpace
    ? "bottom"
    : "top";
  const top =
    placement === "bottom"
      ? clamp(originY + gap, margin, window.innerHeight - measuredHeight - margin)
      : clamp(originY - gap - measuredHeight, margin, window.innerHeight - measuredHeight - margin);

  return {
    isMobile,
    top,
    left: centeredLeft,
    width,
    maxHeight: maxPopoverHeight,
    caretLeft: clamp(originX - centeredLeft, cornerSafeArea, width - cornerSafeArea),
    placement,
    originX,
    originY,
  };
}

export function useAnchoredGlassPopover<T>(options: UseAnchoredGlassPopoverOptions = {}) {
  const [activeItem, setActiveItem] = useState<T | null>(null);
  const [position, setPosition] = useState<AnchoredPopoverPosition | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const originRef = useRef<PopoverAnchorPoint | undefined>(undefined);
  const { desktopWidth, minDesktopWidth, preferredHeight, margin, gap } = options;

  const updatePosition = useCallback(
    (measure = false) => {
      if (!triggerRef.current) return;
      const popoverBounds = measure ? popoverRef.current?.getBoundingClientRect() : undefined;
      const nextPosition = getAnchoredPopoverPosition(triggerRef.current.getBoundingClientRect(), originRef.current, {
        desktopWidth,
        minDesktopWidth,
        preferredHeight,
        margin,
        gap,
        measuredWidth: popoverBounds?.width,
        measuredHeight: popoverBounds?.height,
      });
      setPosition((current) => (hasMeaningfulPositionChange(current, nextPosition) ? nextPosition : current));
    },
    [desktopWidth, minDesktopWidth, preferredHeight, margin, gap]
  );

  const close = useCallback(() => {
    setActiveItem(null);
    setPosition(null);
    originRef.current = undefined;
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const open = useCallback(
    (item: T, target: HTMLElement, origin?: PopoverAnchorPoint) => {
      // Toggle: a second click on the trigger that is already open closes the
      // popover instead of re-opening it. Combined with the outside-click
      // handler below, this means clicking anywhere outside the popover —
      // including the reference-video / portfolio card that opened it —
      // dismisses it.
      if (activeItem !== null && triggerRef.current === target) {
        close();
        return;
      }
      triggerRef.current = target;
      originRef.current = origin;
      setActiveItem(item);
      setPosition(getAnchoredPopoverPosition(target.getBoundingClientRect(), origin, { desktopWidth, minDesktopWidth, preferredHeight, margin, gap }));
    },
    [activeItem, close, desktopWidth, minDesktopWidth, preferredHeight, margin, gap]
  );

  useLayoutEffect(() => {
    if (!activeItem || !position || !popoverRef.current) return;

    updatePosition(true);
    const observer = new ResizeObserver(() => updatePosition(true));
    observer.observe(popoverRef.current);

    return () => observer.disconnect();
  }, [activeItem, position, updatePosition]);

  useEffect(() => {
    if (!activeItem) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const reposition = () => updatePosition(true);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [activeItem, close, updatePosition]);

  return {
    activeItem,
    open,
    close,
    popoverRef,
    position,
  };
}

export function AnchoredGlassPopover({
  active,
  position,
  popoverRef,
  popoverId,
  ariaLabel,
  closeLabel,
  onClose,
  children,
}: {
  active: boolean;
  position: AnchoredPopoverPosition | null;
  popoverRef: RefObject<HTMLDivElement | null>;
  popoverId: string;
  ariaLabel: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();

  const mobileOriginX =
    position?.originX && typeof window !== "undefined"
      ? clamp(position.originX - 12, 24, window.innerWidth - 48)
      : null;
  const transformOrigin = position?.isMobile
    ? mobileOriginX
      ? `${mobileOriginX}px 100%`
      : "50% 100%"
    : position?.placement === "left"
      ? `100% ${position.caretTop || 24}px`
      : position?.placement === "right"
        ? `0px ${position.caretTop || 24}px`
        : `${position?.caretLeft || 24}px ${position?.placement === "top" ? "100%" : "0px"}`;

  const placement = position?.placement || "bottom";
  const clickOffset = position?.originX && position?.left ? clamp((position.originX - position.left) * 0.08, -18, 18) : 0;
  const clickVerticalOffset = position?.originY && position?.top ? clamp((position.originY - position.top) * 0.08, -18, 18) : 0;
  const initialOffset = position?.isMobile
    ? { x: 0, y: 18 }
    : {
        top: { x: clickOffset, y: 14 },
        right: { x: -16, y: clickVerticalOffset },
        bottom: { x: clickOffset, y: -14 },
        left: { x: 16, y: clickVerticalOffset },
      }[placement];

  // Kinked speech-bubble tail. Each placement uses two paths: a closed `fill`
  // whose base runs a few px *inside* the bubble (so the join is seamless and
  // there is no base seam line) and an open `stroke` that traces only the
  // outer silhouette — base → tip → kink → base — with both ends landing exactly
  // on the bubble border. The tip is aligned to the click origin (caret) and the
  // single kink gives the "spoken from here" speech-bubble read.
  const caretX = position?.caretLeft ?? 30;
  const caretY = position?.caretTop ?? 30;
  const tailReach = 21;
  const tailByPlacement = {
    top: {
      // popover above the origin → tail on the bottom edge, pointing down
      viewBox: "0 0 60 30",
      width: 60,
      height: 30,
      style: { bottom: -tailReach, left: caretX - 30 } as CSSProperties,
      fill: "M16 0 L30 28 L52 18 L44 0 Z",
      stroke: "M20.5 9 L30 28 L52 18 L48 9",
    },
    right: {
      // popover right of the origin → tail on the left edge, pointing left
      viewBox: "0 0 30 60",
      width: 30,
      height: 60,
      style: { left: -tailReach, top: caretY - 30 } as CSSProperties,
      fill: "M30 16 L2 30 L12 52 L30 44 Z",
      stroke: "M21 20.5 L2 30 L12 52 L21 48",
    },
    bottom: {
      // popover below the origin → tail on the top edge, pointing up
      viewBox: "0 0 60 30",
      width: 60,
      height: 30,
      style: { top: -tailReach, left: caretX - 30 } as CSSProperties,
      fill: "M16 30 L30 2 L52 12 L44 30 Z",
      stroke: "M20.5 21 L30 2 L52 12 L48 21",
    },
    left: {
      // popover left of the origin → tail on the right edge, pointing right
      viewBox: "0 0 30 60",
      width: 30,
      height: 60,
      style: { right: -tailReach, top: caretY - 30 } as CSSProperties,
      fill: "M0 16 L28 30 L18 52 L0 44 Z",
      stroke: "M9 20.5 L28 30 L18 52 L9 48",
    },
  } satisfies Record<
    NonNullable<AnchoredPopoverPosition["placement"]>,
    { viewBox: string; width: number; height: number; style: CSSProperties; fill: string; stroke: string }
  >;
  const tail = tailByPlacement[placement];

  return (
    <AnimatePresence>
      {active && position ? (
        <motion.div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={ariaLabel}
          initial={
            prefersReducedMotion
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.9, x: initialOffset.x, y: initialOffset.y }
          }
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={
            prefersReducedMotion
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.95, x: initialOffset.x * 0.45, y: initialOffset.y * 0.45 }
          }
          transition={{ duration: prefersReducedMotion ? 0.01 : 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={
            position.isMobile
              ? { left: 12, right: 12, bottom: 12, transformOrigin }
              : {
                  top: position.top,
                  left: position.left,
                  width: position.width,
                  transformOrigin,
                }
          }
          data-placement={placement}
          className="fixed z-[90] rounded-[28px] border border-white/12 bg-[radial-gradient(circle_at_18%_0%,rgba(122,141,166,0.13),transparent_36%),linear-gradient(135deg,rgba(18,23,30,0.88),rgba(9,11,15,0.84))] text-white shadow-[0_35px_120px_-45px_rgba(0,0,0,1)] backdrop-blur-2xl"
        >
          {!position.isMobile ? (
            <svg
              aria-hidden
              data-testid="anchored-popover-caret"
              data-placement={placement}
              viewBox={tail.viewBox}
              width={tail.width}
              height={tail.height}
              className="pointer-events-none absolute z-[1] overflow-visible drop-shadow-[0_16px_22px_rgba(0,0,0,0.28)]"
              style={tail.style}
            >
              {/* solid body that overlaps a few px into the bubble — no base seam */}
              <path d={tail.fill} fill="rgba(20,25,34,0.96)" />
              {/* outer silhouette stroke only: base → tip → kink → base */}
              <path
                d={tail.stroke}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-[2] inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/18 sm:right-5 sm:top-5"
            aria-label={closeLabel}
          >
            <Icon name="close" className="h-5 w-5" />
          </button>

          <div
            className="max-h-[min(840px,calc(100vh-24px))] overflow-y-auto rounded-[28px] p-5 sm:p-6 lg:p-7"
            style={{ maxHeight: position.maxHeight }}
          >
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function GlassDetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ComponentProps<typeof Icon>["name"];
  children: ReactNode;
}) {
  return (
    <section className="pt-8 sm:pt-9">
      <div className="flex items-center gap-3 text-[12px] font-bold uppercase tracking-[0.24em] text-white/88">
        {icon ? <Icon name={icon} className="h-6 w-6 text-white/82" /> : null}
        {title}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
