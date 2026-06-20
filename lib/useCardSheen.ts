import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Cursor-reactive sheen for cards. Writes `--mx`/`--my` CSS vars on the card
 * element on pointer move (no React state, no re-renders); pair with a child
 * `<div className="home-card-sheen -z-10" />` and `relative isolate` on the card.
 */
export function useCardSheen() {
  const rectRef = useRef<DOMRect | null>(null);

  const onPointerEnter = (event: ReactPointerEvent<HTMLElement>) => {
    rectRef.current = event.currentTarget.getBoundingClientRect();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = rectRef.current ?? event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return { onPointerEnter, onPointerMove };
}
