"use client";

import { useEffect, useRef, useState } from "react";

export default function useFitTitle({
  text,
  maxLines,
  basePx,
  minPx,
  stepPx,
  scale,
}: {
  text: string;
  maxLines: number;
  basePx: number;
  minPx: number;
  stepPx: number;
  scale: number;
}) {
  const ref = useRef<HTMLHeadingElement | null>(null);
  const [fontPx, setFontPx] = useState<number>(Math.round(basePx * scale));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      let size = Math.round(basePx * scale);
      el.style.fontSize = `${size}px`;

      const cs = window.getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight || "0") || size * 1.1;
      const maxHeight = lineHeight * maxLines;

      while (el.scrollHeight > maxHeight && size > minPx) {
        size -= stepPx;
        el.style.fontSize = `${size}px`;
      }

      setFontPx(size);
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    const t = window.setTimeout(compute, 50);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [text, maxLines, basePx, minPx, stepPx, scale]);

  return { ref, fontPx };
}
