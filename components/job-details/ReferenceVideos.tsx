"use client";

import { useMemo } from "react";
import type { BackendPortfolioItem } from "../../lib/backendClient";
import type { ReferenceVideo } from "../../lib/types";
import {
  buildTimestampedVideoUrl,
  formatReferenceTimestamp,
  timestampAriaLabel,
} from "../../lib/referenceVideos";
import { Icon } from "../Icons";
import PortfolioPreviewRail from "../profile/PortfolioPreviewRail";
import {
  AnchoredGlassPopover,
  GlassDetailSection,
  useAnchoredGlassPopover,
} from "../ui/AnchoredGlassPopover";

const EMPTY_DATE = "1970-01-01T00:00:00.000Z";

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

function referenceVideoToPortfolioItem(video: ReferenceVideo, idx: number): BackendPortfolioItem {
  const youtubeId = getYouTubeId(video.url);
  const sourceType: BackendPortfolioItem["source_type"] = youtubeId ? "youtube" : "website";
  const title = video.title?.trim() || `Reference video ${idx + 1}`;
  const idPart = youtubeId || encodeURIComponent(video.url).replace(/%/g, "").slice(0, 48) || String(idx + 1);

  return {
    id: `job-reference-video-${idx + 1}-${idPart}`,
    user_id: "job-reference-videos",
    title,
    source_type: sourceType,
    source_url: video.url,
    role_id: null,
    role_name: null,
    role: null,
    user_role_in_project: null,
    description: video.description || null,
    contribution_summary: video.whatToReference || null,
    timeframe: "now",
    media_url: null,
    metrics: null,
    youtube_url: youtubeId ? video.url : null,
    thumbnail_url: video.thumbnailUrl || getYouTubeThumb(video.url),
    thumbnail_options: [],
    channel_name: video.platform || (youtubeId ? "YouTube Reference" : "Reference video"),
    channel_id: youtubeId,
    views: null,
    published_date: null,
    published_at: null,
    duration: null,
    retention_percent: null,
    links: [video.url],
    tags: [],
    contribution_tags: [],
    tools: [],
    public_metrics: {},
    manual_metrics: {},
    verification_status: "manual",
    visibility: "public",
    publish_status: "published",
    portfolio_status: "now",
    is_featured: false,
    status: "now",
    is_public: true,
    created_at: EMPTY_DATE,
    updated_at: EMPTY_DATE,
  };
}

export default function ReferenceVideos({ videos }: { videos: ReferenceVideo[] }) {
  const items = useMemo(() => videos.map(referenceVideoToPortfolioItem), [videos]);
  const videosById = useMemo(() => new Map(items.map((item, idx) => [item.id, videos[idx]])), [items, videos]);
  const popover = useAnchoredGlassPopover<BackendPortfolioItem>({ desktopWidth: 760, preferredHeight: 620 });
  const activeItem = popover.activeItem;
  const activeVideo = activeItem ? videosById.get(activeItem.id) : null;
  const popoverId = "job-reference-video-popover";

  return (
    <>
      <PortfolioPreviewRail
        items={items}
        getHref={(item) => item.source_url}
        onItemActivate={popover.open}
        activeItemId={activeItem?.id || null}
        itemControlsId={popoverId}
        ariaLabel="Reference videos"
        keyPrefix="job-reference-video"
        externalLinkLabelPrefix="View reference details"
        internalLinkLabelPrefix="View reference details"
        showCreatedDateFallback={false}
      />

      <AnchoredGlassPopover
        active={Boolean(activeItem && activeVideo)}
        position={popover.position}
        popoverRef={popover.popoverRef}
        popoverId={popoverId}
        ariaLabel={activeItem ? `Reference video details: ${activeItem.title}` : "Reference video details"}
        closeLabel="Close reference video details"
        onClose={popover.close}
      >
        {activeItem && activeVideo ? (
          <>
            <div className="grid gap-5 pr-12 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-6">
              <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_18px_55px_-38px_rgba(0,0,0,1)]">
                {activeItem.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeItem.thumbnail_url}
                    alt=""
                    loading="eager"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-subtle">
                    <Icon name="youtube" className="h-7 w-7" />
                  </div>
                )}
              </div>
              <div className="min-w-0 sm:pt-1">
                <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[26px]">
                  {activeItem.title}
                </h2>
                <p className="mt-4 text-sm font-medium text-muted">{activeItem.channel_name || "YouTube Reference"}</p>
                <a
                  href={activeVideo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open on YouTube: ${activeItem.title}`}
                  className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm font-semibold text-white/64 transition-colors hover:border-white/18 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/18"
                >
                  Open on YouTube
                  <Icon name="external-link" className="h-4 w-4" />
                </a>
              </div>
            </div>

            {activeVideo.whatToReference ? (
              <GlassDetailSection title="What to Reference" icon="eye">
                <p className="text-base leading-relaxed text-white/74">{activeVideo.whatToReference}</p>
              </GlassDetailSection>
            ) : null}

            {activeVideo.timestampNotes?.length ? (
              <GlassDetailSection title="Timestamp Notes" icon="clock">
                <div className="space-y-4">
                  {activeVideo.timestampNotes.map((note, idx) => {
                    const timeLabel = note.time || formatReferenceTimestamp(note.seconds);
                    return (
                      <div
                        key={note.id || `${note.seconds}-${idx}`}
                        className="grid gap-2 sm:grid-cols-[112px_minmax(140px,190px)_minmax(0,1fr)] sm:gap-5"
                      >
                        <a
                          href={buildTimestampedVideoUrl(activeVideo.url, note.seconds)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={timestampAriaLabel(activeItem.title, note, "YouTube")}
                          className="group inline-flex w-fit cursor-pointer items-center gap-2 text-base font-semibold text-violet-300 transition-colors hover:text-violet-200 focus:outline-none focus:ring-2 focus:ring-white/18"
                        >
                          <span>{timeLabel}</span>
                          <Icon name="external-link" className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </a>
                        <p className="min-w-0 text-base font-semibold leading-7 text-white/86">{note.title}</p>
                        {note.description ? (
                          <p className="min-w-0 text-sm leading-7 text-white/58 sm:text-base">{note.description}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </GlassDetailSection>
            ) : null}
          </>
        ) : null}
      </AnchoredGlassPopover>
    </>
  );
}
