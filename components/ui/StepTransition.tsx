"use client";

import { motion, useIsPresent } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Shared multi-step transition used by the Post Job flow and the Portfolio
 * Builder so step-to-step movement feels identical across the platform.
 *
 * Each step renders as an `absolute inset-0` layer inside a `relative
 * overflow-hidden` viewport; on change the incoming step slides in from the
 * travel direction while the outgoing step slides out the opposite way
 * (`AnimatePresence mode="sync"`). Drive it with a `"forward" | "back"`
 * direction set right before the step index changes.
 */
export type StepDirection = "forward" | "back";

export const STEP_TRANSITION_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const stepTransitionVariants = {
  enter: (dir: StepDirection) => ({
    x: dir === "forward" ? 24 : -24,
    scale: 0.98,
    opacity: 0.85,
    transition: { duration: 0.28, ease: STEP_TRANSITION_EASE },
  }),
  center: {
    x: 0,
    scale: 1,
    opacity: 1,
    transition: { duration: 0.3, ease: STEP_TRANSITION_EASE },
  },
  exit: (dir: StepDirection) => ({
    x: dir === "forward" ? "-110%" : "110%",
    opacity: 1,
    transition: { duration: 0.28, ease: STEP_TRANSITION_EASE },
  }),
} as const;

export function AnimatedStep({
  direction,
  className,
  children,
}: {
  direction: StepDirection;
  className?: string;
  children: ReactNode;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      className={["absolute inset-0", isPresent ? "" : "pointer-events-none", className || ""].join(" ")}
      style={{ zIndex: isPresent ? 1 : 2 }}
      custom={direction}
      initial="enter"
      animate="center"
      exit="exit"
      variants={stepTransitionVariants}
    >
      {children}
    </motion.div>
  );
}
