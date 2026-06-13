"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Reveals children with a rise/fade transition the first time they scroll
 * into view. SSR/no-JS renders content visible; the hide is applied
 * imperatively after mount and only to elements still below the fold
 * (anti-flash guard), so above-the-fold content never blinks.
 */
export default function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    if (node.getBoundingClientRect().top < window.innerHeight * 0.92) {
      return;
    }

    node.classList.add("home-reveal-hidden");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.classList.remove("home-reveal-hidden");
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.classList.remove("home-reveal-hidden");
    };
  }, []);

  return (
    <div
      ref={ref}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}
      className={["home-reveal", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
