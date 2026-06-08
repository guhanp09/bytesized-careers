"use client";

import React from "react";
import { Icon } from "../Icons";

function getYouTubeId(url: string) {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");

    const v = u.searchParams.get("v");
    if (v) return v;

    const shortsMatch = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortsMatch?.[1]) return shortsMatch[1];

    const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embedMatch?.[1]) return embedMatch[1];

    return null;
  } catch {
    return null;
  }
}

function getYouTubeThumb(url: string) {
  const id = getYouTubeId(url);
  if (!id) return null;
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

export default function ReferenceVideos({
  videos,
}: {
  videos: { url: string; title?: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v, idx) => {
        const thumb = getYouTubeThumb(v.url);
        const title = v.title ?? `Reference video ${idx + 1}`;

        return (
          <a
            key={`${v.url}-${idx}`}
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className={[
              "group block overflow-hidden rounded-2xl",
              "bg-white/[0.06] border border-white/10",
              "shadow-[0_12px_35px_-26px_rgba(0,0,0,0.95)]",
              "transition-all duration-150",
              "hover:-translate-y-[1px] hover:border-white/20",
              "cursor-pointer",
            ].join(" ")}
            aria-label={`Open YouTube video: ${title}`}
            title="Open in YouTube"
          >
            <div className="relative aspect-video w-full bg-black/30">
              {thumb ? (
                <img
                  src={thumb}
                  alt={title}
                  className="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                  loading="lazy"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-white/60 text-sm">
                  Preview unavailable
                </div>
              )}

              <div
                className={[
                  "absolute inset-0 flex items-center justify-center",
                  "bg-black/0 group-hover:bg-black/25",
                  "transition-colors duration-150",
                ].join(" ")}
              >
                <div
                  className={[
                    "opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100",
                    "transition-all duration-150",
                    "rounded-2xl bg-black/55 border border-white/15",
                    "px-4 py-3",
                    "shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 text-white">
                    <Icon name="youtube" className="w-6 h-6" />
                    <span className="text-sm font-semibold">Open</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="text-sm font-semibold text-white/90 line-clamp-1">{title}</div>
              <div className="text-xs text-white/55 mt-1 line-clamp-1">YouTube reference</div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
