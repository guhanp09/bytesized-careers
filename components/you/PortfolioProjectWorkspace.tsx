"use client";

import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  BackendPortfolioCreatePayload,
  BackendPortfolioItem,
  BackendPortfolioLinkPreviewResponse,
  BackendPortfolioYouTubePreviewResponse,
  BackendRole,
  createMyPortfolioItem,
  deleteMyPortfolioItem,
  listMyPortfolio,
  previewPortfolioLink,
  previewPortfolioYouTube,
  updateMyPortfolioItem,
} from "../../lib/backendClient";
import { portfolioSummaryPreview } from "../../lib/portfolioCard";
import { getPortfolioTimestampNotes } from "../../lib/portfolioDetails";
import { parseReferenceTimestamp } from "../../lib/referenceVideos";
import type { ReferenceTimestampNote } from "../../lib/types";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "../Icons";
import { usePortfolioDetailPopup } from "../profile/PortfolioDetailPopup";
import { type PopoverAnchorPoint } from "../ui/AnchoredGlassPopover";
import { AnimatedStep, type StepDirection } from "../ui/StepTransition";
import ToolPicker from "./ToolPicker";
import AddWorkSampleChoiceModal, {
  type WorkSampleAction,
  type WorkSampleSourceType,
} from "./AddWorkSampleChoiceModal";

type SourceType = NonNullable<BackendPortfolioItem["source_type"]>;
type SourceDisplayType =
  | "youtube"
  | "custom"
  | "drive"
  | "google_docs"
  | "notion"
  | "behance"
  | "instagram"
  | "vimeo"
  | "figma"
  | "canva";
type SourceOption = {
  value: SourceDisplayType;
  label: string;
  sourceType: SourceType;
  previewSource?: string;
};
type PortfolioStatus = "now" | "past";
type Visibility = "public" | "private";
type PublishStatus = "draft" | "published";
type ThumbnailOption = { quality?: string; url: string; width?: number; height?: number };
const REQUIRED_ROLE_ERROR = "Enter your role before continuing.";

type PortfolioDraft = {
  title: string;
  sourceType: SourceType;
  sourceUrl: string;
  thumbnailUrl: string;
  thumbnailOptions: ThumbnailOption[];
  roleName: string;
  visibility: Visibility;
  portfolioStatus: PortfolioStatus;
  shortSummary: string;
  description: string;
  contributionTags: string[];
  tools: string[];
  contributionHighlights: string[];
  timestampNotes: ReferenceTimestampNote[];
  contentNiches: string[];
  contentGenres: string[];
  platforms: string[];
  formats: string[];
  results: string[];
  tags: string[];
  publicMetrics: Record<string, unknown>;
  manualViews: string;
  retentionPercent: string;
  ctrPercent: string;
  turnaroundDays: string;
  subscriberGain: string;
  metricNotes: string;
  channelName: string;
  channelId: string;
  publishedAt: string;
  durationIso: string;
  durationLabel: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  currentlyWorking: boolean;
  verificationStatus: "youtube_metadata_verified" | "manual" | "unverified";
  isFeatured: boolean;
};

type PortfolioProjectWorkspaceProps = {
  portfolio: BackendPortfolioItem[];
  rolesCatalog: BackendRole[];
  withFreshBackendToken: <T>(request: (token: string) => Promise<T>) => Promise<T>;
  onPortfolioChange: (items: BackendPortfolioItem[]) => void;
  onRefreshProfileCompletion: () => Promise<void>;
  setGlobalError: (message: string | null) => void;
  persistenceDisabled?: boolean;
  launchSource?: SourceType | null;
  launchSourceKind?: WorkSampleAction["sourceKind"];
  launchShouldFetchYouTube?: boolean;
  launchSourceUrl?: string;
  launchSuggestedTitle?: string;
  launchLinkPreview?: BackendPortfolioLinkPreviewResponse | null;
  launchPreviewError?: string;
  onLaunchHandled?: () => void;
  /**
   * Builder-only mode: render just the project builder (wizard editor + work-sample
   * chooser) without the portfolio grid/filters, so the *real* builder can be opened
   * in-flow from outside /you (e.g. the job-application popup). The host drives it via
   * the `launch*` props and is notified through `onProjectCreated` / `onClose`.
   */
  embedded?: boolean;
  /** Fired with the newly created project after a successful save in embedded mode. */
  onProjectCreated?: (item: BackendPortfolioItem) => void;
  /** Fired when the builder is dismissed (cancelled) in embedded mode. */
  onClose?: () => void;
};

const SOURCE_OPTIONS: SourceOption[] = [
  { value: "youtube", label: "YouTube", sourceType: "youtube" },
  { value: "custom", label: "Custom URL", sourceType: "custom" },
  { value: "drive", label: "Google Drive", sourceType: "drive" },
  { value: "google_docs", label: "Google Docs", sourceType: "drive", previewSource: "google_docs" },
  { value: "notion", label: "Notion", sourceType: "custom", previewSource: "notion" },
  { value: "behance", label: "Behance", sourceType: "behance" },
  { value: "instagram", label: "Instagram", sourceType: "instagram" },
  { value: "vimeo", label: "Vimeo", sourceType: "vimeo" },
  { value: "figma", label: "Figma", sourceType: "custom", previewSource: "figma" },
  { value: "canva", label: "Canva", sourceType: "custom", previewSource: "canva" },
];

const WIZARD_STEPS = [
  { key: "project-details", label: "Project details", icon: "image", motivation: "Show recruiters the work and how it appears." },
  { key: "contribution-details", label: "Contribution details", icon: "bolt", motivation: "Show the proof behind your work so recruiters can evaluate it fast." },
  { key: "tools", label: "TOOLS", icon: "sliders-horizontal", motivation: "Add the tools that shaped the final output." },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: ComponentProps<typeof Icon>["name"];
  motivation: string;
}>;

const WIZARD_STEP_ORDER = [0, 1, 2] as const;

const emptyDraft = (sourceType: SourceType = "custom"): PortfolioDraft => ({
  title: "",
  sourceType,
  sourceUrl: "",
  thumbnailUrl: "",
  thumbnailOptions: [],
  roleName: "",
  visibility: "public",
  portfolioStatus: sourceType === "youtube" ? "past" : "now",
  shortSummary: "",
  description: "",
  contributionTags: [],
  tools: [],
  contributionHighlights: [],
  timestampNotes: [],
  contentNiches: [],
  contentGenres: [],
  platforms: [],
  formats: [],
  results: [],
  tags: [],
  publicMetrics: {},
  manualViews: "",
  retentionPercent: "",
  ctrPercent: "",
  turnaroundDays: "",
  subscriberGain: "",
  metricNotes: "",
  channelName: "",
  channelId: "",
  publishedAt: "",
  durationIso: "",
  durationLabel: "",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: "",
  currentlyWorking: sourceType !== "youtube",
  verificationStatus: sourceType === "youtube" ? "youtube_metadata_verified" : "manual",
  isFeatured: false,
});

const sourceOptionForDisplayValue = (value: SourceDisplayType) =>
  SOURCE_OPTIONS.find((option) => option.value === value) || SOURCE_OPTIONS[1];

const displaySourceToPreviewSource = (source?: SourceDisplayType | null) => {
  if (source === "google_docs" || source === "notion" || source === "figma" || source === "canva") {
    return source;
  }
  return null;
};

const sourceKindToDisplaySource = (sourceKind?: WorkSampleAction["sourceKind"]): SourceDisplayType | null => {
  if (!sourceKind) return null;
  if (sourceKind === "youtube") return "youtube";
  if (sourceKind === "vimeo") return "vimeo";
  if (sourceKind === "drive") return "drive";
  if (sourceKind === "docs") return "google_docs";
  if (sourceKind === "notion") return "notion";
  if (sourceKind === "behance") return "behance";
  if (sourceKind === "instagram") return "instagram";
  if (sourceKind === "figma") return "figma";
  if (sourceKind === "canva") return "canva";
  return "custom";
};

const previewSourceToDisplaySource = (previewSource?: unknown): SourceDisplayType | null => {
  const preview = typeof previewSource === "string" ? previewSource : "";
  if (preview === "youtube") return "youtube";
  if (preview === "vimeo") return "vimeo";
  if (preview === "drive") return "drive";
  if (preview === "google_docs") return "google_docs";
  if (preview === "notion") return "notion";
  if (preview === "behance") return "behance";
  if (preview === "instagram") return "instagram";
  if (preview === "figma") return "figma";
  if (preview === "canva") return "canva";
  if (preview === "website" || preview === "external_link" || preview === "unknown" || preview === "tiktok") {
    return "custom";
  }
  return null;
};

const sourceDisplayValue = (source?: string | null, previewSource?: unknown): SourceDisplayType => {
  const displayFromPreview = previewSourceToDisplaySource(previewSource);
  if (displayFromPreview) return displayFromPreview;
  if (source === "youtube") return "youtube";
  if (source === "vimeo") return "vimeo";
  if (source === "drive") return "drive";
  if (source === "behance") return "behance";
  if (source === "instagram") return "instagram";
  return "custom";
};

const sourceLabel = (source?: string | null, previewSource?: unknown) =>
  sourceOptionForDisplayValue(sourceDisplayValue(source, previewSource)).label;

const toSourceType = (sourceType: WorkSampleSourceType): SourceType => {
  if (sourceType === "youtube" || sourceType === "drive" || sourceType === "behance" || sourceType === "instagram" || sourceType === "vimeo") {
    return sourceType;
  }
  return "custom";
};

const previewSourceToSourceType = (sourceType?: string | null): SourceType => {
  if (sourceType === "youtube") return "youtube";
  if (sourceType === "vimeo") return "vimeo";
  if (sourceType === "drive" || sourceType === "google_docs") return "drive";
  if (sourceType === "behance") return "behance";
  if (sourceType === "instagram") return "instagram";
  return "custom";
};

const normalizeProjectUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
};

const displaySourceFromUrl = (url: string): SourceDisplayType => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) return "youtube";
    if (host.endsWith("vimeo.com")) return "vimeo";
    if (host === "drive.google.com") return "drive";
    if (host === "docs.google.com") return "google_docs";
    if (host.endsWith("notion.so") || host.endsWith("notion.site")) return "notion";
    if (host.endsWith("behance.net")) return "behance";
    if (host.endsWith("instagram.com")) return "instagram";
    if (host.endsWith("figma.com")) return "figma";
    if (host.endsWith("canva.com")) return "canva";
  } catch {
    return "custom";
  }
  return "custom";
};

const isObviousPrivateAppUrl = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "gmail.com" ||
      host === "mail.google.com" ||
      host === "inbox.google.com" ||
      host === "outlook.live.com" ||
      host === "outlook.office.com" ||
      host === "mail.yahoo.com"
    );
  } catch {
    return false;
  }
};

const metricNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatCompactNumber = (value: unknown) => {
  const number = metricNumber(value);
  return number === null ? null : Intl.NumberFormat("en", { notation: "compact" }).format(number);
};

const formatDateShort = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const parseOptionalNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const domainFromUrl = (url?: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const placeholderCoverUrl = (title: string) => {
  const text = encodeURIComponent((title || "Project").slice(0, 42));
  return `https://placehold.co/1200x675/202124/f5f5f5?text=${text}`;
};

const sourceFallbackMessage = (sourceType: SourceType, previewSource?: unknown) => {
  const label = sourceLabel(sourceType, previewSource);
  if (sourceType === "drive" || previewSource === "google_docs") {
    return `We couldn't fetch all details from this ${label} link. The file may be private or restricted. Make sure it is set to "Anyone with the link can view," or continue by filling details manually.`;
  }
  if (sourceType === "youtube") {
    return "YouTube details could not be fetched right now. You can still continue by filling the details manually.";
  }
  return "Details from this link could not be fetched. You can still continue by filling the details manually.";
};

const readTimeline = (metrics: Record<string, unknown>) => {
  const raw = metrics.project_timeline;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const timeline = raw as Record<string, unknown>;
  return {
    startMonth: typeof timeline.start_month === "string" ? timeline.start_month : "",
    startYear: typeof timeline.start_year === "string" ? timeline.start_year : "",
    endMonth: typeof timeline.end_month === "string" ? timeline.end_month : "",
    endYear: typeof timeline.end_year === "string" ? timeline.end_year : "",
    currentlyWorking: Boolean(timeline.currently_working),
  };
};

const formatTimelineLabel = (timeline: ReturnType<typeof readTimeline>) => {
  if (!timeline) return null;
  const start = [timeline.startMonth, timeline.startYear].filter(Boolean).join(" ");
  const end = timeline.currentlyWorking ? "Present" : [timeline.endMonth, timeline.endYear].filter(Boolean).join(" ");
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} - ${timeline.currentlyWorking ? "Present" : "End date open"}`;
  if (timeline.currentlyWorking) return "Currently active";
  return null;
};

const toTextInput = (value: unknown) => {
  const number = metricNumber(value);
  if (number !== null) return String(number);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
};

const listFromItem = (...values: unknown[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      if (typeof entry !== "string") return;
      const cleaned = entry.replace(/\s+/g, " ").trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(cleaned);
    });
  });
  return result;
};

const thumbnailOptionsFromItem = (options?: Array<Record<string, unknown>>) =>
  (options || [])
    .map((option): ThumbnailOption | null => {
      if (typeof option.url !== "string" || !option.url) return null;
      return {
        quality: typeof option.quality === "string" ? option.quality : undefined,
        url: option.url,
        width: typeof option.width === "number" ? option.width : undefined,
        height: typeof option.height === "number" ? option.height : undefined,
      };
    })
    .filter((option): option is ThumbnailOption => Boolean(option));

const sourceTypeFromItem = (sourceType?: BackendPortfolioItem["source_type"]): SourceType => sourceType || "custom";

const draftFromPortfolioItem = (item: BackendPortfolioItem): PortfolioDraft => {
  const sourceType = sourceTypeFromItem(item.source_type);
  const publicMetrics = item.public_metrics || {};
  const manualMetrics = item.manual_metrics || {};
  const timeline = readTimeline(publicMetrics);
  const status = item.portfolio_status || item.status || "now";
  const sourceUrl = item.source_url || item.youtube_url || item.media_url || item.links?.[0] || "";
  const thumbnailOptions = thumbnailOptionsFromItem(item.thumbnail_options);
  const publicMetricDuration = publicMetrics.duration_label || publicMetrics.duration;

  return {
    ...emptyDraft(sourceType),
    title: item.title || "",
    sourceType,
    sourceUrl,
    thumbnailUrl: item.thumbnail_url || "",
    thumbnailOptions,
    roleName: item.role_name || item.role || item.user_role_in_project || "",
    visibility: item.visibility === "private" || item.is_public === false ? "private" : "public",
    portfolioStatus: status === "past" ? "past" : "now",
    shortSummary: item.contribution_summary || item.description || item.what_i_did || item.whatIDid || "",
    description: item.what_i_did || item.whatIDid || item.description || item.contribution_summary || "",
    contributionTags: listFromItem(item.contribution_tags),
    tools: listFromItem(item.tools),
    contributionHighlights: listFromItem(item.contribution_highlights, item.contributionHighlights),
    timestampNotes: getPortfolioTimestampNotes(item),
    contentNiches: listFromItem(item.content_niches, item.contentNiches),
    contentGenres: listFromItem(item.content_genres, item.contentGenres),
    platforms: listFromItem(item.platforms),
    formats: listFromItem(item.formats),
    results: listFromItem(item.results),
    tags: listFromItem(item.tags),
    publicMetrics,
    manualViews: toTextInput(manualMetrics.views ?? publicMetrics.views ?? item.views),
    retentionPercent: toTextInput(manualMetrics.retention_percent ?? item.retention_percent),
    ctrPercent: toTextInput(manualMetrics.ctr_percent),
    turnaroundDays: toTextInput(manualMetrics.turnaround_days),
    subscriberGain: toTextInput(manualMetrics.subscriber_gain),
    metricNotes: typeof manualMetrics.metric_notes === "string" ? manualMetrics.metric_notes : "",
    channelName:
      item.channel_name ||
      (typeof publicMetrics.channel_name === "string" ? publicMetrics.channel_name : "") ||
      (typeof publicMetrics.author_name === "string" ? publicMetrics.author_name : ""),
    channelId: item.channel_id || (typeof publicMetrics.channel_id === "string" ? publicMetrics.channel_id : ""),
    publishedAt: item.published_at || item.published_date || (typeof publicMetrics.published_at === "string" ? publicMetrics.published_at : ""),
    durationIso: typeof publicMetrics.duration_iso === "string" ? publicMetrics.duration_iso : "",
    durationLabel: item.duration || (typeof publicMetricDuration === "string" ? publicMetricDuration : ""),
    startMonth: timeline?.startMonth || "",
    startYear: timeline?.startYear || "",
    endMonth: timeline?.endMonth || "",
    endYear: timeline?.endYear || "",
    currentlyWorking: timeline ? timeline.currentlyWorking : status !== "past",
    verificationStatus: item.verification_status || (sourceType === "youtube" ? "youtube_metadata_verified" : "manual"),
    isFeatured: Boolean(item.is_featured),
  };
};

const trimToSnippet = (value?: string | null) => {
  const cleaned = (value || "").trim();
  if (!cleaned) return "";
  return cleaned.length > 180 ? `${cleaned.slice(0, 180).trim()}...` : cleaned;
};

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">
      {children}
    </span>
  );
}

export function PortfolioProjectCard({
  item,
  onDelete,
  onToggleFeatured,
  onEdit,
  projectHref,
  onActivate,
  showActions = true,
}: {
  item: BackendPortfolioItem;
  onDelete?: (id: string) => void;
  onToggleFeatured?: (item: BackendPortfolioItem) => void;
  onEdit?: (item: BackendPortfolioItem) => void;
  projectHref?: string;
  onActivate?: (item: BackendPortfolioItem, target: HTMLElement, origin?: PopoverAnchorPoint) => void;
  showActions?: boolean;
}) {
  const router = useRouter();
  const publicMetrics = item.public_metrics || {};
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const publishedMetricDate = typeof publicMetrics.published_at === "string" ? publicMetrics.published_at : undefined;
  const publishedDate = formatDateShort(publishedMetricDate || item.published_at || item.published_date || item.created_at);
  const timelineLabel = formatTimelineLabel(readTimeline(publicMetrics));
  const publicChannelName =
    typeof publicMetrics.channel_name === "string"
      ? publicMetrics.channel_name
      : typeof publicMetrics.author_name === "string"
        ? publicMetrics.author_name
        : "";
  const sourceName =
    item.source_type === "youtube"
      ? item.channel_name || publicChannelName || "YouTube"
      : domainFromUrl(item.source_url || item.media_url || item.youtube_url || item.links?.[0]) || sourceLabel(item.source_type, publicMetrics.source_type);
  const sourceLine = [sourceName, publishedDate || timelineLabel].filter(Boolean).join(" · ");
  const summaryPreview = portfolioSummaryPreview(item);
  // Owner-only management states (not platform/verification badges) — kept so owners
  // can still spot drafts/private/featured items. Only rendered when present.
  const statusBadges = [
    item.publish_status === "draft" ? "Draft" : null,
    item.visibility === "private" || item.is_public === false ? "Private" : null,
    item.is_featured ? "Featured" : null,
  ].filter((label): label is string => Boolean(label));
  const projectLinks = item.links?.length
    ? item.links
    : [item.source_url, item.media_url, item.youtube_url].filter((link): link is string => Boolean(link));
  const primaryProjectLink = projectLinks[0] || null;
  const hasOwnerMenu = Boolean(onEdit || onToggleFeatured || onDelete || primaryProjectLink);
  const isProjectClickable = Boolean(onActivate || projectHref || primaryProjectLink);
  const openProject = useCallback(() => {
    if (!primaryProjectLink || typeof window === "undefined") return;
    window.open(primaryProjectLink, "_blank", "noopener,noreferrer");
  }, [primaryProjectLink]);
  const activateCard = useCallback((target: HTMLElement, origin?: PopoverAnchorPoint) => {
    if (onActivate) {
      onActivate(item, target, origin);
      return;
    }
    if (projectHref) {
      router.push(projectHref);
      return;
    }
    openProject();
  }, [item, onActivate, openProject, projectHref, router]);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current || !(event.target instanceof Node)) return;
      if (menuButtonRef.current?.contains(event.target)) return;
      if (!menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("touchstart", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("touchstart", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <article
      role={isProjectClickable ? (onActivate ? "button" : "link") : undefined}
      aria-label={
        isProjectClickable
          ? `${onActivate ? "Open portfolio project details" : projectHref ? "Open project detail" : "Open project"}: ${item.title}`
          : undefined
      }
      tabIndex={isProjectClickable ? 0 : undefined}
      onClick={
        isProjectClickable
          ? (event) => activateCard(event.currentTarget, { x: event.clientX, y: event.clientY })
          : undefined
      }
      onKeyDown={
        isProjectClickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateCard(event.currentTarget);
              }
            }
          : undefined
      }
      className={[
        "group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.055] shadow-[0_18px_50px_-34px_rgba(0,0,0,0.95)] transition-[border-color,background-color,box-shadow,transform] duration-200",
        isProjectClickable
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.066] hover:shadow-[0_26px_70px_-38px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-white/15"
          : "",
      ].join(" ")}
    >
      <div className="aspect-video overflow-hidden rounded-t-2xl bg-white/[0.035]">
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={item.title}
            className={[
              "h-full w-full object-cover transition-[filter,transform] duration-500",
              isProjectClickable ? "group-hover:scale-[1.015] group-hover:brightness-110" : "",
            ].join(" ")}
          />
        ) : (
          <div className="h-full w-full inline-flex items-center justify-center text-subtle">
            <Icon name={item.source_type === "youtube" ? "youtube" : "briefcase"} className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        {/* Owner-only status chips. Platform/verification badges were removed; the
            card now uses that space for the project summary preview below. */}
        {statusBadges.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {statusBadges.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : null}
        <h4 className="line-clamp-2 text-base font-semibold leading-snug text-white/95">{item.title}</h4>
        <p className="mt-1 line-clamp-1 text-sm font-semibold text-white/78">{item.role_name || item.role || item.user_role_in_project || "Role not set"}</p>
        {sourceLine ? <p className="mt-1 line-clamp-1 text-xs text-muted">{sourceLine}</p> : null}
        {summaryPreview ? (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/62">{summaryPreview}</p>
        ) : null}
        {showActions && hasOwnerMenu ? (
          <div className="mt-auto flex justify-end pt-3">
            <div
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="relative">
                <button
                  ref={menuButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Project actions"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="group/action relative inline-flex h-8 w-8 items-center justify-center rounded-full text-subtle transition-colors hover:bg-white/[0.045] hover:text-white/82 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer"
                >
                  <span className="-mt-1 text-xl leading-none">⋯</span>
                  <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
                    Project actions
                  </span>
                </button>
                {menuOpen ? (
                  <div
                    ref={menuRef}
                    role="menu"
                    className="absolute right-0 top-full z-[80] mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#15161a] p-1 shadow-[0_24px_60px_-22px_rgba(0,0,0,1)]"
                  >
                    {onEdit ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit(item);
                        }}
                        className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-white/72 transition-colors hover:bg-white/[0.07] hover:text-white cursor-pointer"
                      >
                        Edit project
                      </button>
                    ) : null}
                    {onToggleFeatured ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onToggleFeatured(item);
                        }}
                        className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-white/72 transition-colors hover:bg-white/[0.07] hover:text-white cursor-pointer"
                      >
                        {item.is_featured ? "Unpin from top" : "Pin to top"}
                      </button>
                    ) : null}
                    {primaryProjectLink ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          openProject();
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs font-semibold text-white/72 transition-colors hover:bg-white/[0.07] hover:text-white cursor-pointer"
                      >
                        <span>Open project</span>
                        <Icon name="external-link" className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {onDelete ? (
                      <>
                        <div className="my-1 border-t border-white/10" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            onDelete(item.id);
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-200/82 transition-colors hover:bg-rose-400/10 hover:text-rose-100 cursor-pointer"
                        >
                          Delete project
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function AddWorkSampleCard({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick: (target: HTMLButtonElement, origin: PopoverAnchorPoint) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget, { x: event.clientX, y: event.clientY })}
      aria-label="Create portfolio project"
      className="group flex h-full cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] text-left shadow-[0_18px_50px_-34px_rgba(0,0,0,0.95)] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.05] hover:shadow-[0_24px_60px_-34px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:border-white/10 disabled:hover:bg-white/[0.03] disabled:hover:shadow-[0_18px_50px_-34px_rgba(0,0,0,0.95)]"
    >
      <div className="flex w-full flex-col">
        <div className="relative aspect-video overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.018))]">
          <div className="absolute inset-0 bg-black/8 transition-colors duration-200 group-hover:bg-black/[0.03]" />
          <div className="absolute inset-0 flex items-center justify-center text-muted transition-colors duration-200 group-hover:text-white/78">
            <div className="flex flex-col items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-white/[0.035] shadow-[0_16px_40px_-26px_rgba(0,0,0,1)] transition-colors duration-200 group-hover:border-white/22 group-hover:bg-white/[0.06]">
                <Icon name="plus" className="h-7 w-7 transition-colors duration-200 group-hover:text-white/92" />
              </span>
              <span className="text-[12px] font-semibold tracking-[0.16em] text-white/74 transition-colors duration-200 group-hover:text-white/92">
                ADD PROJECT
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          {/* Placeholder mirrors the real card layout: title, role, source · date,
              summary preview — no platform/verification badge. */}
          <div className="space-y-2">
            <p className="text-[16px] font-semibold leading-snug text-white/86">Project title</p>
            <p className="text-sm font-medium text-white/58">Role</p>
            <p className="text-xs text-subtle">Source · date</p>
            <p className="text-sm leading-relaxed text-subtle">Short summary preview…</p>
          </div>
        </div>
      </div>
    </button>
  );
}

// Section heading with a rounded icon badge, shared by the contribution + tools steps.
function BuilderSectionHeading({
  icon,
  iconClassName,
  children,
}: {
  icon: ComponentProps<typeof Icon>["name"];
  iconClassName?: string;
  children: ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-3 text-base font-semibold text-white">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
        <Icon name={icon} className={["h-4 w-4", iconClassName || "text-white/70"].join(" ")} />
      </span>
      {children}
    </h3>
  );
}

// A small, brief check that confirms a list row was captured into builder state.
function CommitCheck({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/90 text-[#06210f]"
          aria-hidden
        >
          <Icon name="check" className="h-3 w-3" />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

export default function PortfolioProjectWorkspace({
  portfolio,
  rolesCatalog,
  withFreshBackendToken,
  onPortfolioChange,
  onRefreshProfileCompletion,
  setGlobalError,
  persistenceDisabled = false,
  launchSource = null,
  launchSourceKind,
  launchShouldFetchYouTube = false,
  launchSourceUrl = "",
  launchSuggestedTitle = "",
  launchLinkPreview = null,
  launchPreviewError = "",
  onLaunchHandled,
  embedded = false,
  onProjectCreated,
  onClose,
}: PortfolioProjectWorkspaceProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStep, setEditorStep] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PortfolioDraft>(() => emptyDraft());
  const [youtubeFetching, setYoutubeFetching] = useState(false);
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [lastPreviewAttemptedUrl, setLastPreviewAttemptedUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceDisplayType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PortfolioStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState("");
  const [workSampleChooserOpen, setWorkSampleChooserOpen] = useState(false);
  const [draftSavedToast, setDraftSavedToast] = useState(false);
  const [stepDirection, setStepDirection] = useState<StepDirection>("forward");
  const [highlightChecked, setHighlightChecked] = useState(false);
  const [timestampChecked, setTimestampChecked] = useState(false);
  const portfolioDetailPopup = usePortfolioDetailPopup("owner-portfolio-detail-popup");
  const highlightRefs = useRef<Array<HTMLInputElement | null>>([]);
  const timestampTimeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingHighlightFocus = useRef<number | null>(null);
  const pendingTimestampFocus = useRef<number | null>(null);
  const highlightCheckTimer = useRef<number | undefined>(undefined);
  const timestampCheckTimer = useRef<number | undefined>(undefined);
  const showPortfolioFilters = portfolio.length >= 3;

  const filteredProjects = useMemo(() => {
    const roleNeedle = roleFilter.trim().toLowerCase();
    return portfolio.filter((item) => {
      if (!showPortfolioFilters) return true;
      const sourceOk = sourceFilter === "all" || sourceDisplayValue(item.source_type, item.public_metrics?.source_type) === sourceFilter;
      const statusOk = statusFilter === "all" || (item.portfolio_status || item.status || "now") === statusFilter;
      const roleValue = (item.role_name || item.role || item.user_role_in_project || "").toLowerCase();
      const roleOk = !roleNeedle || roleValue.includes(roleNeedle);
      return sourceOk && statusOk && roleOk;
    });
  }, [portfolio, roleFilter, showPortfolioFilters, sourceFilter, statusFilter]);

  const hasAnyProjects = portfolio.length > 0;
  const currentWizardIndex = Math.max(0, WIZARD_STEP_ORDER.indexOf(editorStep as typeof WIZARD_STEP_ORDER[number]));
  const wizardProgress = ((currentWizardIndex + 1) / WIZARD_STEPS.length) * 100;
  const activeWizardStep = WIZARD_STEPS[currentWizardIndex];


  useEffect(() => {
    if (!draftSavedToast) return;
    const timer = window.setTimeout(() => setDraftSavedToast(false), 2200);
    return () => window.clearTimeout(timer);
  }, [draftSavedToast]);

  // Focus the row created by Enter / the plus control once it has rendered.
  useEffect(() => {
    if (pendingHighlightFocus.current !== null) {
      highlightRefs.current[pendingHighlightFocus.current]?.focus();
      pendingHighlightFocus.current = null;
    }
    if (pendingTimestampFocus.current !== null) {
      timestampTimeRefs.current[pendingTimestampFocus.current]?.focus();
      pendingTimestampFocus.current = null;
    }
  });

  const refreshPortfolio = async () => {
    const refreshed = await withFreshBackendToken((token) => listMyPortfolio(token));
    onPortfolioChange(refreshed.items || []);
    await onRefreshProfileCompletion();
  };

  const openEditor = useCallback((
    sourceType: SourceType = "custom",
    sourceUrl = "",
    suggestedTitle = "",
    displaySource?: SourceDisplayType | null
  ) => {
    const previewSource = displaySourceToPreviewSource(displaySource);
    setLastPreviewAttemptedUrl(normalizeProjectUrl(sourceUrl));
    setEditingId(null);
    setDraft({
      ...emptyDraft(sourceType),
      sourceUrl,
      title: suggestedTitle,
      shortSummary: "",
      publicMetrics: previewSource ? { source_type: previewSource } : {},
      verificationStatus: sourceType === "youtube" ? "youtube_metadata_verified" : "manual",
    });
    setEditorStep(0);
    setLocalError(null);
    setSuccess(null);
    setEditorOpen(true);
  }, []);

  const applyPreview = useCallback((preview: BackendPortfolioYouTubePreviewResponse) => {
    const nextMetrics: Record<string, unknown> = {
      ...preview.public_metrics,
      ...(preview.view_count !== undefined ? { views: preview.view_count } : {}),
      ...(preview.like_count !== undefined ? { likes: preview.like_count } : {}),
      ...(preview.comment_count !== undefined ? { comments: preview.comment_count } : {}),
      ...(preview.duration_iso ? { duration_iso: preview.duration_iso } : {}),
      ...(preview.duration_label ? { duration_label: preview.duration_label } : {}),
      ...(preview.channel_name ? { channel_name: preview.channel_name } : {}),
      ...(preview.channel_id ? { channel_id: preview.channel_id } : {}),
      ...(preview.published_at ? { published_at: preview.published_at } : {}),
    };
    setDraft({
      ...emptyDraft("youtube"),
      title: preview.title,
      sourceUrl: preview.source_url,
      thumbnailUrl: preview.thumbnail_url || "",
      thumbnailOptions: (preview.thumbnail_options || []).filter(
        (item): item is ThumbnailOption => typeof item.url === "string"
      ),
      shortSummary: trimToSnippet(preview.description_snippet || preview.description),
      description: "",
      publicMetrics: nextMetrics,
      channelName: preview.channel_name || "",
      channelId: preview.channel_id || "",
      publishedAt: preview.published_at || "",
      durationIso: preview.duration_iso || "",
      durationLabel: preview.duration_label || "",
      startMonth: "",
      startYear: "",
      endMonth: "",
      endYear: "",
      currentlyWorking: false,
      verificationStatus: "youtube_metadata_verified",
    });
    setLastPreviewAttemptedUrl(normalizeProjectUrl(preview.source_url));
    setEditorStep(0);
  }, []);

  const openEditorFromLinkPreview = useCallback((
    preview: BackendPortfolioLinkPreviewResponse,
    suggestedTitle = "",
    previewError = "",
    sourceKind?: WorkSampleAction["sourceKind"]
  ) => {
    const displaySource =
      sourceKindToDisplaySource(sourceKind) ||
      previewSourceToDisplaySource(preview.source_type) ||
      displaySourceFromUrl(preview.source_url || preview.canonical_url);
    const metricsSourceType = displaySourceToPreviewSource(displaySource) || preview.source_type;
    const sourceType = previewSourceToSourceType(metricsSourceType);
    const publicMetrics: Record<string, unknown> = {
      ...preview.public_metrics,
      source_type: metricsSourceType,
      provider_name: preview.provider_name,
      confidence: preview.confidence,
      preview_status: preview.status,
    };
    if (preview.author_name) publicMetrics.author_name = preview.author_name;
    if (preview.published_at) publicMetrics.published_at = preview.published_at;

    const duration = preview.public_metrics?.duration;
    const previewUrl = preview.source_url || preview.canonical_url;
    setLastPreviewAttemptedUrl(normalizeProjectUrl(previewUrl));
    setEditingId(null);
    setDraft({
      ...emptyDraft(sourceType),
      title: preview.title || suggestedTitle,
      sourceUrl: preview.source_url || preview.canonical_url,
      thumbnailUrl: preview.thumbnail_url || "",
      shortSummary: trimToSnippet(preview.description),
      description: "",
      publicMetrics,
      channelName: preview.source_type === "youtube" ? preview.author_name : "",
      publishedAt: preview.published_at || "",
      durationLabel: typeof duration === "string" ? duration : "",
      startMonth: "",
      startYear: "",
      endMonth: "",
      endYear: "",
      currentlyWorking: sourceType !== "youtube",
      verificationStatus:
        preview.source_type === "youtube" && preview.confidence === "high" && preview.status === "ok"
          ? "youtube_metadata_verified"
          : "manual",
    });
    setEditorStep(0);
    setLocalError(
      previewError ||
        (preview.status === "manual_required"
          ? sourceFallbackMessage(sourceType, preview.source_type)
          : null)
    );
    setSuccess(null);
    setEditorOpen(true);
  }, []);

  const openEditorForProject = useCallback(
    (item: BackendPortfolioItem) => {
      if (persistenceDisabled) {
        setGlobalError("Backend storage is offline. Start the backend before adding or editing projects.");
        return;
      }
      setLastPreviewAttemptedUrl(normalizeProjectUrl(item.source_url || item.youtube_url || item.media_url || item.links?.[0] || ""));
      setEditingId(item.id);
      setDraft(draftFromPortfolioItem(item));
      setEditorStep(0);
      setLocalError(null);
      setSuccess(null);
      setEditorOpen(true);
    },
    [persistenceDisabled, setGlobalError]
  );

  const fetchYouTubePreview = useCallback(async (url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setLocalError("Paste a YouTube URL first.");
      return;
    }
    setYoutubeFetching(true);
    setLocalError(null);
    setGlobalError(null);
    try {
      const preview = await withFreshBackendToken((token) => previewPortfolioYouTube(token, trimmedUrl));
      applyPreview(preview);
    } catch {
      setLocalError(sourceFallbackMessage("youtube"));
    } finally {
      setYoutubeFetching(false);
    }
  }, [applyPreview, setGlobalError, withFreshBackendToken]);

  const previewWorkLink = useCallback(
    (url: string) => withFreshBackendToken((token) => previewPortfolioLink(token, url)),
    [withFreshBackendToken]
  );

  const refreshProjectPreview = useCallback(async () => {
    const normalizedUrl = normalizeProjectUrl(draft.sourceUrl);
    if (!normalizedUrl) {
      setLocalError("Paste a valid Project URL to refresh preview.");
      return false;
    }
    if (isObviousPrivateAppUrl(normalizedUrl)) {
      setLocalError("Use a public or shareable Project URL. Private app links like Gmail cannot be previewed.");
      return false;
    }

    const detectedDisplaySource = displaySourceFromUrl(normalizedUrl);
    const detectedOption = sourceOptionForDisplayValue(detectedDisplaySource);
    const detectedPreviewSource = displaySourceToPreviewSource(detectedDisplaySource);

    setRefreshingPreview(true);
    setLocalError(null);
    setGlobalError(null);
    try {
      const preview = await previewWorkLink(normalizedUrl);
      const displaySource =
        displaySourceFromUrl(preview.source_url || preview.canonical_url || normalizedUrl) ||
        previewSourceToDisplaySource(preview.source_type) ||
        detectedDisplaySource;
      const metricsSourceType = displaySourceToPreviewSource(displaySource) || preview.source_type;
      const sourceType = previewSourceToSourceType(metricsSourceType);
      const duration = preview.public_metrics?.duration;
      const refreshedSourceUrl = preview.source_url || preview.canonical_url || normalizedUrl;

      setDraft((prev) => {
        const publicMetrics: Record<string, unknown> = {
          ...prev.publicMetrics,
          ...preview.public_metrics,
          source_type: metricsSourceType,
          provider_name: preview.provider_name,
          confidence: preview.confidence,
          preview_status: preview.status,
        };
        if (preview.author_name) publicMetrics.author_name = preview.author_name;
        if (preview.published_at) publicMetrics.published_at = preview.published_at;

        return {
          ...prev,
          sourceType,
          sourceUrl: refreshedSourceUrl,
          title: preview.title || prev.title,
          thumbnailUrl: preview.thumbnail_url || prev.thumbnailUrl,
          shortSummary: trimToSnippet(preview.description) || prev.shortSummary,
          publicMetrics,
          channelName: sourceType === "youtube" ? preview.author_name || prev.channelName : prev.channelName,
          publishedAt: preview.published_at || prev.publishedAt,
          durationLabel: typeof duration === "string" ? duration : prev.durationLabel,
          verificationStatus:
            preview.source_type === "youtube" && preview.confidence === "high" && preview.status === "ok"
              ? "youtube_metadata_verified"
              : sourceType === "youtube"
                ? prev.verificationStatus
                : "manual",
        };
      });
      setLastPreviewAttemptedUrl(normalizeProjectUrl(refreshedSourceUrl) || normalizedUrl);
      setLocalError(preview.status === "manual_required" ? sourceFallbackMessage(sourceType, metricsSourceType) : null);
      return true;
    } catch {
      setLastPreviewAttemptedUrl(normalizedUrl);
      setDraft((prev) => {
        const publicMetrics = { ...prev.publicMetrics };
        if (detectedPreviewSource) {
          publicMetrics.source_type = detectedPreviewSource;
        } else {
          delete publicMetrics.source_type;
        }
        return {
          ...prev,
          sourceType: detectedOption.sourceType,
          sourceUrl: normalizedUrl,
          publicMetrics,
          verificationStatus: detectedOption.sourceType === "youtube" ? prev.verificationStatus : "manual",
        };
      });
      setLocalError(sourceFallbackMessage(detectedOption.sourceType, detectedPreviewSource));
      return true;
    } finally {
      setRefreshingPreview(false);
    }
  }, [draft.sourceUrl, previewWorkLink, setGlobalError]);

  const chooseWorkSampleSource = (action: WorkSampleAction) => {
    setWorkSampleChooserOpen(false);
    const sourceType = toSourceType(action.sourceType);
    const sourceUrl = action.url;
    if (action.preview) {
      openEditorFromLinkPreview(action.preview, action.suggestedTitle || "", action.previewError || "", action.sourceKind);
      return;
    }
    openEditor(sourceType, sourceUrl, action.suggestedTitle || "", sourceKindToDisplaySource(action.sourceKind));
    if (action.previewError) {
      setLocalError(action.previewError);
    }
    if (!action.previewError && sourceType === "youtube" && sourceUrl) {
      void fetchYouTubePreview(sourceUrl);
    }
  };

  useEffect(() => {
    if (!launchSource) return;
    if (persistenceDisabled) {
      setGlobalError("Backend storage is offline. Start the backend before adding or editing projects.");
      onLaunchHandled?.();
      return;
    }
    if (launchLinkPreview) {
      openEditorFromLinkPreview(launchLinkPreview, launchSuggestedTitle, launchPreviewError, launchSourceKind);
    } else {
      openEditor(launchSource, launchSourceUrl, launchSuggestedTitle, sourceKindToDisplaySource(launchSourceKind));
    }
    if (!launchLinkPreview && launchShouldFetchYouTube && launchSource === "youtube" && launchSourceUrl) {
      void fetchYouTubePreview(launchSourceUrl);
    }
    onLaunchHandled?.();
  }, [
    fetchYouTubePreview,
    launchLinkPreview,
    launchPreviewError,
    launchShouldFetchYouTube,
    launchSource,
    launchSourceKind,
    launchSourceUrl,
    launchSuggestedTitle,
    onLaunchHandled,
    openEditor,
    openEditorFromLinkPreview,
    persistenceDisabled,
    setGlobalError,
  ]);

  // ---- Contribution details: list-style editable rows --------------------
  // The visible rows ARE the builder state (empties allowed while editing); the
  // payload filters empties/dupes via listFromItem + the timestamp filter, so
  // blank scaffold rows are never persisted as real data.
  const HIGHLIGHT_MIN_ROWS = 3;
  const HIGHLIGHT_MAX = 8;
  const TIMESTAMP_MIN_ROWS = 2;
  const TIMESTAMP_MAX = 10;
  const blankTimestampRow = (): ReferenceTimestampNote => ({ time: "", title: "", description: "", seconds: 0 });
  const isTimestampRowFilled = (row: ReferenceTimestampNote) =>
    Boolean(row.time.trim() || row.title.trim() || row.description.trim());

  // Scaffold a minimum number of blank rows so the step reads as a list by default.
  const highlightRows =
    draft.contributionHighlights.length >= HIGHLIGHT_MIN_ROWS
      ? draft.contributionHighlights
      : [...draft.contributionHighlights, ...Array(HIGHLIGHT_MIN_ROWS - draft.contributionHighlights.length).fill("")];
  const timestampRows =
    draft.timestampNotes.length >= TIMESTAMP_MIN_ROWS
      ? draft.timestampNotes
      : [...draft.timestampNotes, ...Array(TIMESTAMP_MIN_ROWS - draft.timestampNotes.length).fill(0).map(blankTimestampRow)];

  const flashHighlightCheck = () => {
    setHighlightChecked(true);
    window.clearTimeout(highlightCheckTimer.current);
    highlightCheckTimer.current = window.setTimeout(() => setHighlightChecked(false), 750);
  };
  const flashTimestampCheck = () => {
    setTimestampChecked(true);
    window.clearTimeout(timestampCheckTimer.current);
    timestampCheckTimer.current = window.setTimeout(() => setTimestampChecked(false), 750);
  };

  const updateHighlightRow = (index: number, value: string) => {
    const next = highlightRows.slice();
    next[index] = value;
    setDraft((prev) => ({ ...prev, contributionHighlights: next }));
  };
  // Enter on a filled row commits it (already auto-saved) and moves to the next row,
  // creating one if needed.
  const commitHighlightRow = (index: number) => {
    if (!highlightRows[index].trim()) return;
    const next = highlightRows.slice();
    if (index === next.length - 1 && next.filter((row) => row.trim()).length < HIGHLIGHT_MAX) {
      next.push("");
    }
    setDraft((prev) => ({ ...prev, contributionHighlights: next }));
    pendingHighlightFocus.current = Math.min(index + 1, next.length - 1);
    flashHighlightCheck();
  };
  const addHighlightRow = () => {
    const next = highlightRows.slice();
    if (next[next.length - 1].trim() !== "" && next.filter((row) => row.trim()).length < HIGHLIGHT_MAX) {
      next.push("");
    }
    setDraft((prev) => ({ ...prev, contributionHighlights: next }));
    pendingHighlightFocus.current = next.length - 1;
    flashHighlightCheck();
  };
  const removeHighlight = (index: number) => {
    const next = highlightRows.filter((_, currentIndex) => currentIndex !== index);
    setDraft((prev) => ({ ...prev, contributionHighlights: next.length ? next : [""] }));
  };

  const updateTimestampRow = (index: number, field: "time" | "title" | "description", value: string) => {
    const next = timestampRows.map((row, currentIndex) => (currentIndex === index ? { ...row, [field]: value } : row));
    setDraft((prev) => ({ ...prev, timestampNotes: next }));
    if (localError) setLocalError(null);
  };
  // Enter from the description commits the row (with timestamp validation) and moves on.
  const commitTimestampRow = (index: number) => {
    const row = timestampRows[index];
    if (!isTimestampRowFilled(row)) return;
    const seconds = parseReferenceTimestamp(row.time);
    if (seconds === null) {
      setLocalError("Use a timestamp like 0:42 or 12:35.");
      return;
    }
    const filledCount = timestampRows.filter(
      (entry) => parseReferenceTimestamp(entry.time) !== null && (entry.title.trim() || entry.description.trim())
    ).length;
    const next = timestampRows.map((entry, currentIndex) =>
      currentIndex === index ? { ...entry, seconds, id: entry.id || `note-${Date.now()}` } : entry
    );
    if (index === next.length - 1 && filledCount < TIMESTAMP_MAX) {
      next.push(blankTimestampRow());
    }
    setDraft((prev) => ({ ...prev, timestampNotes: next }));
    pendingTimestampFocus.current = Math.min(index + 1, next.length - 1);
    setLocalError(null);
    flashTimestampCheck();
  };
  const addTimestampRow = () => {
    const next = timestampRows.slice();
    if (isTimestampRowFilled(next[next.length - 1]) && next.length < TIMESTAMP_MAX + 2) {
      next.push(blankTimestampRow());
    }
    setDraft((prev) => ({ ...prev, timestampNotes: next }));
    pendingTimestampFocus.current = next.length - 1;
    flashTimestampCheck();
  };
  const removeTimestampNote = (index: number) => {
    const next = timestampRows.filter((_, currentIndex) => currentIndex !== index);
    setDraft((prev) => ({ ...prev, timestampNotes: next.length ? next : [blankTimestampRow()] }));
  };

  const validateAndBuildPayload = (publishStatus: PublishStatus): BackendPortfolioCreatePayload | null => {
    const title = draft.title.trim();
    const sourceUrl = draft.sourceUrl.trim();
    const shortSummary = draft.shortSummary.trim();
    const description = draft.description.trim();
    const coverUrl = draft.thumbnailUrl.trim() || placeholderCoverUrl(title);
    const roleName = draft.roleName.trim();
    const retention = parseOptionalNumber(draft.retentionPercent);
    const ctr = parseOptionalNumber(draft.ctrPercent);
    const turnaround = parseOptionalNumber(draft.turnaroundDays);
    const manualViews = parseOptionalNumber(draft.manualViews);
    const subscriberGain = parseOptionalNumber(draft.subscriberGain);

    if (!title) {
      setLocalError("Add a project title before saving.");
      return null;
    }
    if (!sourceUrl && !shortSummary && !description) {
      setLocalError("Add a project link or contribution summary before saving.");
      return null;
    }
    if (Number.isNaN(retention) || Number.isNaN(ctr) || Number.isNaN(turnaround) || Number.isNaN(manualViews) || Number.isNaN(subscriberGain)) {
      setLocalError("Saved numeric fields must be valid.");
      return null;
    }
    if ((retention !== null && (retention < 0 || retention > 100)) || (ctr !== null && (ctr < 0 || ctr > 100))) {
      setLocalError("Retention and CTR must be between 0 and 100.");
      return null;
    }
    if (publishStatus === "published" && !roleName) {
      setLocalError("Select your exact role before publishing.");
      return null;
    }
    const manualMetrics: Record<string, unknown> = {};
    if (manualViews !== null) manualMetrics.views = manualViews;
    if (retention !== null) manualMetrics.retention_percent = retention;
    if (ctr !== null) manualMetrics.ctr_percent = ctr;
    if (turnaround !== null) manualMetrics.turnaround_days = turnaround;
    if (subscriberGain !== null) manualMetrics.subscriber_gain = subscriberGain;
    if (draft.metricNotes.trim()) manualMetrics.metric_notes = draft.metricNotes.trim();

    const publicMetrics: Record<string, unknown> = {
      ...draft.publicMetrics,
      ...(draft.channelName ? { channel_name: draft.channelName } : {}),
      ...(draft.channelId ? { channel_id: draft.channelId } : {}),
      ...(draft.publishedAt ? { published_at: draft.publishedAt } : {}),
      ...(draft.durationIso ? { duration_iso: draft.durationIso } : {}),
      ...(draft.durationLabel ? { duration_label: draft.durationLabel } : {}),
    };
    const hasTimeline = Boolean(
      draft.startMonth ||
        draft.startYear ||
        draft.endMonth ||
        draft.endYear
    );
    if (hasTimeline) {
      publicMetrics.project_timeline = {
        start_month: draft.startMonth,
        start_year: draft.startYear,
        end_month: draft.currentlyWorking ? "" : draft.endMonth,
        end_year: draft.currentlyWorking ? "" : draft.endYear,
        currently_working: draft.currentlyWorking,
      };
    }
    const derivedPortfolioStatus: PortfolioStatus = draft.currentlyWorking ? "now" : "past";
    const contributionHighlights = listFromItem(draft.contributionHighlights).slice(0, 8);
    const timestampNotes = draft.timestampNotes
      .map((note) => {
        const seconds = parseReferenceTimestamp(note.time);
        return seconds === null ? null : { ...note, seconds };
      })
      .filter((note): note is ReferenceTimestampNote => note !== null && Boolean(note.title.trim() || note.description.trim()))
      .slice(0, 10);

    return {
      title,
      source_type: draft.sourceType,
      source_url: sourceUrl || undefined,
      youtube_url: draft.sourceType === "youtube" ? sourceUrl : undefined,
      media_url: sourceUrl || undefined,
      thumbnail_url: coverUrl,
      thumbnail_options: draft.thumbnailOptions,
      role_name: roleName || undefined,
      role: roleName || undefined,
      user_role_in_project: roleName || undefined,
      description: shortSummary || description || undefined,
      contribution_summary: shortSummary || description || undefined,
      what_i_did: shortSummary || description || undefined,
      contribution_highlights: contributionHighlights,
      timestamp_notes: timestampNotes.map((note) => ({
        id: note.id || null,
        time: note.time,
        seconds: note.seconds,
        title: note.title,
        description: note.description,
      })),
      contribution_tags: draft.contributionTags,
      tools: draft.tools,
      content_niches: draft.contentNiches,
      content_genres: draft.contentGenres,
      platforms: draft.platforms,
      formats: draft.formats,
      results: draft.results,
      tags: draft.tags.slice(0, 10),
      public_metrics: publicMetrics,
      manual_metrics: manualMetrics,
      views: typeof publicMetrics.views === "number" ? publicMetrics.views : undefined,
      channel_name: draft.channelName || undefined,
      channel_id: draft.channelId || undefined,
      published_at: draft.publishedAt || undefined,
      duration: draft.durationLabel || undefined,
      links: sourceUrl ? [sourceUrl] : [],
      verification_status: draft.sourceType === "youtube" ? "youtube_metadata_verified" : draft.verificationStatus || "manual",
      visibility: draft.visibility,
      is_public: draft.visibility === "public",
      portfolio_status: derivedPortfolioStatus,
      status: derivedPortfolioStatus,
      publish_status: publishStatus,
      is_featured: draft.isFeatured,
    };
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    if (embedded) onClose?.();
  };

  const saveProject = async (publishStatus: PublishStatus) => {
    const payload = validateAndBuildPayload(publishStatus);
    if (!payload) return;
    const wasCreate = !editingId;
    setSaving(true);
    setLocalError(null);
    setGlobalError(null);
    try {
      const saved = await withFreshBackendToken((token) =>
        editingId ? updateMyPortfolioItem(token, editingId, payload) : createMyPortfolioItem(token, payload)
      );
      await refreshPortfolio();
      if (publishStatus === "draft" && !embedded) {
        // Save draft: confirm inline (check + toast) and keep the builder open so the
        // user can keep editing from any step without losing data. A freshly created
        // draft becomes the edit target so repeat saves update it instead of duplicating.
        if (wasCreate) setEditingId(saved.id);
        setSuccess("Draft saved");
        setDraftSavedToast(true);
      } else {
        setSuccess(publishStatus === "draft" ? "Draft saved" : "Project published.");
        setEditorOpen(false);
        setEditingId(null);
        // Hand the freshly created project back so an embedded host (e.g. the job-apply
        // popup) can auto-select it without leaving the flow. Fired only on create.
        if (wasCreate) onProjectCreated?.(saved);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to save project.");
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (id: string) => {
    setSaving(true);
    setLocalError(null);
    try {
      await withFreshBackendToken((token) => deleteMyPortfolioItem(token, id));
      await refreshPortfolio();
      setSuccess("Project deleted.");
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to delete project.");
    } finally {
      setSaving(false);
    }
  };

  const toggleFeatured = async (item: BackendPortfolioItem) => {
    setSaving(true);
    try {
      await withFreshBackendToken((token) =>
        updateMyPortfolioItem(token, item.id, { is_featured: !item.is_featured })
      );
      await refreshPortfolio();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to update featured work.");
    } finally {
      setSaving(false);
    }
  };

  const goToNextStep = async () => {
    if (editorStep === 0 && !draft.sourceUrl.trim()) {
      setLocalError("Keep a project link attached before continuing.");
      return;
    }
    if (editorStep === 0) {
      if (!draft.title.trim()) {
        setLocalError("Add a project title before continuing.");
        return;
      }
      if (!draft.roleName.trim()) {
        setLocalError(REQUIRED_ROLE_ERROR);
        return;
      }
      const normalizedUrl = normalizeProjectUrl(draft.sourceUrl);
      if (!normalizedUrl) {
        setLocalError("Paste a valid Project URL before continuing.");
        return;
      }
      if (isObviousPrivateAppUrl(normalizedUrl)) {
        setLocalError("Use a public or shareable Project URL. Private app links like Gmail cannot be previewed.");
        return;
      }
      if (normalizedUrl !== lastPreviewAttemptedUrl) {
        const canContinue = await refreshProjectPreview();
        if (!canContinue) return;
      } else {
        setLocalError(null);
      }
    } else {
      setLocalError(null);
    }
    setStepDirection("forward");
    setEditorStep(WIZARD_STEP_ORDER[Math.min(currentWizardIndex + 1, WIZARD_STEP_ORDER.length - 1)]);
  };

  const goToPreviousStep = () => {
    setLocalError(null);
    setStepDirection("back");
    setEditorStep(WIZARD_STEP_ORDER[Math.max(currentWizardIndex - 1, 0)]);
  };

  const previewViews = formatCompactNumber(draft.publicMetrics.views ?? draft.manualViews);
  const previewPublishedDate = formatDateShort(draft.publishedAt);
  const previewSourceName = draft.channelName || sourceLabel(draft.sourceType, draft.publicMetrics.source_type);
  const previewSourceLine = [
    previewSourceName,
    previewViews ? `${previewViews} views` : null,
    previewPublishedDate,
  ]
    .filter(Boolean)
    .join(" · ");
  const previewSummary = portfolioSummaryPreview({
    contribution_summary: draft.shortSummary,
    description: draft.shortSummary,
  });

  const previewCard = (
    <div className="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] text-left shadow-[0_18px_50px_-34px_rgba(0,0,0,0.95)]">
      <div className="aspect-video overflow-hidden bg-[radial-gradient(circle_at_26%_22%,rgba(255,255,255,0.11),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.018)_52%,rgba(0,0,0,0.25))]">
        {draft.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={draft.thumbnailUrl}
            alt="Project preview"
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={placeholderCoverUrl(draft.title)}
            alt="Generated project preview"
            className="h-full w-full object-cover opacity-75"
          />
        )}
      </div>
      <div className="p-4">
        <p className="truncate text-sm font-semibold text-white/90">{draft.title || "Project title"}</p>
        <p className="mt-1 text-sm font-medium text-white/72">{draft.roleName || "Role"}</p>
        <p className="mt-1 text-xs text-muted">{previewSourceLine || "Source · date"}</p>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/65">
          {previewSummary || "Short summary preview..."}
        </p>
      </div>
    </div>
  );

  const previewWithVisibility = (
    <div className="space-y-3">
      {previewCard}
      <select
        aria-label="Project visibility"
        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/78 transition-colors hover:border-white/18 hover:bg-white/[0.06] focus:border-white/24 focus:outline-none focus:ring-2 focus:ring-white/10 cursor-pointer"
        value={draft.visibility}
        onChange={(event) => setDraft((prev) => ({ ...prev, visibility: event.target.value as Visibility }))}
      >
        <option value="public">Public</option>
        <option value="private">Private</option>
      </select>
    </div>
  );

  const renderWizardStep = () => {
    if (editorStep === 0) {
      return (
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
          <h4 className="flex items-center gap-2 text-lg font-semibold text-white/92">
            <Icon name="image" className="h-5 w-5 text-white/70" />
            Project details
          </h4>
          <div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <label className="block">
              <span className="text-xs font-semibold text-white/55">Source</span>
              <select
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer"
                value={sourceDisplayValue(draft.sourceType, draft.publicMetrics.source_type)}
                onChange={(event) => {
                  const option = sourceOptionForDisplayValue(event.target.value as SourceDisplayType);
                  setDraft((prev) => {
                    const publicMetrics = { ...prev.publicMetrics };
                    const previewSource = displaySourceToPreviewSource(option.value);
                    if (previewSource) {
                      publicMetrics.source_type = previewSource;
                    } else {
                      delete publicMetrics.source_type;
                    }
                    return {
                      ...prev,
                      sourceType: option.sourceType,
                      publicMetrics,
                      verificationStatus: option.sourceType === "youtube" ? "youtube_metadata_verified" : "manual",
                    };
                  });
                }}
              >
                {SOURCE_OPTIONS.map((source) => (
                  <option key={`editor-source-${source.value}`} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="block">
              <label htmlFor="project-builder-url" className="text-xs font-semibold text-white/55">Project URL</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="project-builder-url"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle"
                  placeholder="https://..."
                  value={draft.sourceUrl}
                  onChange={(event) => {
                    setDraft((prev) => ({ ...prev, sourceUrl: event.target.value }));
                  }}
                />
                <button
                  type="button"
                  onClick={() => void refreshProjectPreview()}
                  disabled={refreshingPreview || youtubeFetching}
                  className="h-11 shrink-0 rounded-xl border border-white/14 bg-white/[0.04] px-4 text-sm font-semibold text-white/78 transition-colors hover:border-white/24 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {refreshingPreview ? "Refreshing..." : "Refresh preview"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-white/55">Project title</span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle"
                placeholder="e.g. Finance explainer cleanup"
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-white/55">
                Your role <span className="text-amber-200">*</span>
              </span>
              <input
                list="portfolio-project-role-options"
                aria-invalid={localError === REQUIRED_ROLE_ERROR}
                className={`mt-2 h-11 w-full rounded-xl border bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle ${
                  localError === REQUIRED_ROLE_ERROR
                    ? "border-amber-200/50 focus:border-amber-200/70"
                    : "border-white/10"
                }`}
                placeholder="e.g. Video editor"
                value={draft.roleName}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, roleName: event.target.value }));
                  if (localError === REQUIRED_ROLE_ERROR) {
                    setLocalError(null);
                  }
                }}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-white/55">Brief summary of your contribution</span>
              <textarea
                className="mt-2 min-h-[86px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-subtle"
                maxLength={220}
                placeholder="Packaging, pacing, and execution for a creator-led YouTube workflow."
                value={draft.shortSummary}
                onChange={(event) => setDraft((prev) => ({ ...prev, shortSummary: event.target.value }))}
              />
            </label>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <p className="text-xs font-semibold text-white/55">Cover / thumbnail</p>
              <div className="mt-2 aspect-video overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                {draft.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.thumbnailUrl} alt="Thumbnail preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-subtle">
                    No thumbnail found
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-white/55">Thumbnail image URL</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle"
                  placeholder="https://image-url..."
                  value={draft.thumbnailUrl}
                  onChange={(event) => setDraft((prev) => ({ ...prev, thumbnailUrl: event.target.value }))}
                />
              </label>
              <p className="text-xs leading-relaxed text-muted">Optional. Paste an image URL to override the generated cover.</p>
              {draft.thumbnailOptions.length ? (
                <div className="flex flex-wrap gap-2">
                  {draft.thumbnailOptions.map((option) => (
                    <button
                      key={`${option.quality || "thumb"}-${option.url}`}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, thumbnailUrl: option.url }))}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/68 hover:bg-white/[0.08] cursor-pointer"
                    >
                      {option.quality || "Thumbnail"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 lg:hidden">
            {previewWithVisibility}
          </div>
        </section>
      );
    }

    if (editorStep === 1) {
      // Combined "Contribution details": highlights + timestamp notes, both as
      // list-style editable rows that read like the final scannable list.
      return (
        <div className="space-y-7">
          <section>
            <BuilderSectionHeading icon="bolt" iconClassName="text-[#4f6bf6]">Contribution highlights</BuilderSectionHeading>
            <div className="mt-4 space-y-2">
              {highlightRows.map((row, index) => {
                const filled = row.trim().length > 0;
                return (
                  <div key={`highlight-${index}`} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-right text-sm tabular-nums text-subtle" aria-hidden>
                      {index + 1}.
                    </span>
                    <input
                      ref={(element) => {
                        highlightRefs.current[index] = element;
                      }}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle focus:border-white/24 focus:outline-none focus:ring-2 focus:ring-white/10"
                      maxLength={140}
                      placeholder={index === 0 ? "e.g. Reworked hooks for better retention" : "Add another highlight"}
                      value={row}
                      aria-label={`Contribution highlight ${index + 1}`}
                      onChange={(event) => updateHighlightRow(index, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitHighlightRow(index);
                        }
                      }}
                    />
                    {filled ? (
                      <button
                        type="button"
                        onClick={() => removeHighlight(index)}
                        aria-label={`Remove highlight: ${row}`}
                        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-subtle transition-colors hover:bg-white/[0.07] hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
                      >
                        <Icon name="x" className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="h-6 w-6 shrink-0" aria-hidden />
                    )}
                  </div>
                );
              })}
              <div className="flex items-center gap-2 pl-0.5 pt-1">
                <button
                  type="button"
                  onClick={addHighlightRow}
                  aria-label="Add contribution highlight"
                  className="inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 cursor-pointer"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Add highlight
                </button>
                <CommitCheck show={highlightChecked} />
              </div>
            </div>
          </section>

          <section className="border-t border-white/[0.07] pt-7">
            <BuilderSectionHeading icon="clock">Timestamp notes</BuilderSectionHeading>
            <div className="mt-4 space-y-2">
              <div className="grid grid-cols-[72px_minmax(0,0.9fr)_minmax(0,1.5fr)_auto] items-center gap-2 px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Time</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Label</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">What changed</span>
                <span aria-hidden />
              </div>
              {timestampRows.map((row, index) => {
                const filled = isTimestampRowFilled(row);
                return (
                  <div
                    key={`timestamp-${index}`}
                    className="grid grid-cols-[72px_minmax(0,0.9fr)_minmax(0,1.5fr)_auto] items-center gap-2"
                  >
                    <input
                      ref={(element) => {
                        timestampTimeRefs.current[index] = element;
                      }}
                      className="h-10 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-sm text-white placeholder:text-subtle focus:border-white/24 focus:outline-none focus:ring-2 focus:ring-white/10"
                      placeholder="0:12"
                      value={row.time}
                      aria-label={`Timestamp ${index + 1} time`}
                      onChange={(event) => updateTimestampRow(index, "time", event.target.value)}
                    />
                    <input
                      className="h-10 min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle focus:border-white/24 focus:outline-none focus:ring-2 focus:ring-white/10"
                      maxLength={60}
                      placeholder="Opening hook"
                      value={row.title}
                      aria-label={`Timestamp ${index + 1} title`}
                      onChange={(event) => updateTimestampRow(index, "title", event.target.value)}
                    />
                    <input
                      className="h-10 min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-subtle focus:border-white/24 focus:outline-none focus:ring-2 focus:ring-white/10"
                      maxLength={220}
                      placeholder="What changed at this moment"
                      value={row.description}
                      aria-label={`Timestamp ${index + 1} description`}
                      onChange={(event) => updateTimestampRow(index, "description", event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitTimestampRow(index);
                        }
                      }}
                    />
                    {filled ? (
                      <button
                        type="button"
                        onClick={() => removeTimestampNote(index)}
                        aria-label={`Remove timestamp note ${index + 1}`}
                        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-subtle transition-colors hover:bg-white/[0.07] hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
                      >
                        <Icon name="x" className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="h-6 w-6 shrink-0" aria-hidden />
                    )}
                  </div>
                );
              })}
              <div className="flex items-center gap-2 pl-0.5 pt-1">
                <button
                  type="button"
                  onClick={addTimestampRow}
                  aria-label="Add timestamp note"
                  className="inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 cursor-pointer"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Add timestamp
                </button>
                <CommitCheck show={timestampChecked} />
              </div>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div>
        <BuilderSectionHeading icon="sliders-horizontal">TOOLS</BuilderSectionHeading>
        <div className="mt-4">
          <ToolPicker
            value={draft.tools}
            onChange={(tools) => setDraft((prev) => ({ ...prev, tools }))}
            label=""
            placeholder="Search or add tools..."
            className="space-y-3"
            inputId="portfolio-builder-tools-picker"
          />
        </div>
      </div>
    );
  };

  const editorPanelContent = (showInlineClose: boolean) => (
    <>
      <div
        className={[
          "shrink-0 border-b border-white/10",
          showInlineClose ? "bg-[#1d1d1f]/95 p-5 backdrop-blur" : "pb-5 pr-12 sm:pr-14",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {editorStep === 0 ? (
              // Step 1 keeps its fuller header (it carries the wide preview layout).
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
                  {editingId ? "Edit project" : draft.sourceType === "youtube" ? "YouTube import" : "New project"}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-white">Project builder</h3>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                  <Icon name={activeWizardStep.icon} className="h-4 w-4 text-white/55" />
                  <span>{activeWizardStep.label}</span>
                </p>
              </>
            ) : (
              // Later steps: a single quiet motivational line above the progress bar.
              <p className="text-[15px] font-medium leading-relaxed text-white/72">
                {activeWizardStep.motivation}
              </p>
            )}
          </div>
          {showInlineClose ? (
            <button
              type="button"
              onClick={closeEditor}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
              aria-label="Close project editor"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#4f6bf6] transition-[width] duration-300 ease-out"
              style={{ width: `${wizardProgress}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-muted">
            Step {currentWizardIndex + 1} of {WIZARD_STEPS.length}
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="sync" initial={false} custom={stepDirection}>
          <AnimatedStep key={editorStep} direction={stepDirection}>
            <div className="h-full overflow-y-auto">
              {editorStep === 0 ? (
                // Step 1 keeps its two-column project-details + live preview layout.
                <div className="p-5 pt-6">
                  {localError ? (
                    <section className="mb-4 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-sm text-amber-100">
                      {localError}
                    </section>
                  ) : null}
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="min-w-0">{renderWizardStep()}</div>
                    <aside className="hidden lg:block">{previewWithVisibility}</aside>
                  </div>
                </div>
              ) : (
                // Later steps: a calm, centered, single-task column — no preview, no inner card.
                // Each step renders its own section heading(s), so no duplicate step title here.
                <div className="flex min-h-full items-center justify-center px-5 py-6">
                  <div className="w-full max-w-[680px]">
                    {localError ? (
                      <section className="mb-4 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-sm text-amber-100">
                        {localError}
                      </section>
                    ) : null}
                    {renderWizardStep()}
                  </div>
                </div>
              )}
            </div>
          </AnimatedStep>
        </AnimatePresence>
      </div>

      <div
        className={[
          "shrink-0 border-t border-white/10",
          showInlineClose ? "bg-[#1d1d1f]/95 p-4" : "mt-5 bg-[#0d1015]/72 py-4 backdrop-blur-xl",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={goToPreviousStep}
            disabled={currentWizardIndex === 0 || saving}
            aria-label="Previous step"
            className={[
              "inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
              currentWizardIndex === 0
                ? "cursor-not-allowed text-disabled"
                : "cursor-pointer text-white/70 hover:text-white",
            ].join(" ")}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveProject("draft")}
              disabled={saving}
              className="h-10 cursor-pointer rounded-xl px-3 text-sm font-semibold text-white/70 transition-colors hover:text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save draft"}
            </button>
            {currentWizardIndex === WIZARD_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => void saveProject("published")}
                disabled={saving}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-[#4f6bf6] px-5 text-sm font-semibold text-white shadow-[0_14px_34px_-16px_rgba(79,107,246,0.9)] transition-colors hover:bg-[#4560ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f6bf6]/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Publishing..." : "Publish"}
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void goToNextStep()}
                disabled={saving || refreshingPreview}
                aria-label="Next step"
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-[#4f6bf6] px-5 text-sm font-semibold text-white shadow-[0_14px_34px_-16px_rgba(79,107,246,0.9)] transition-colors hover:bg-[#4560ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f6bf6]/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editorStep === 0 && refreshingPreview ? "Refreshing..." : "Next"}
                {editorStep === 0 && refreshingPreview ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <datalist id="portfolio-project-role-options">
        {rolesCatalog.map((role) => (
          <option key={`project-role-${role.id}`} value={role.name} />
        ))}
      </datalist>
    </>
  );

  return (
    <div className="space-y-5">
      {!embedded ? (
      <section className="min-w-0">
        {showPortfolioFilters ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <select
              className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/72 cursor-pointer"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SourceDisplayType | "all")}
            >
              <option value="all">All sources</option>
              {SOURCE_OPTIONS.map((source) => (
                <option key={`source-filter-${source.value}`} value={source.value}>
                  {source.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/72 cursor-pointer"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as PortfolioStatus | "all")}
            >
              <option value="all">Now / Past</option>
              <option value="now">Now</option>
              <option value="past">Past</option>
            </select>
            <input
              className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs text-white placeholder:text-subtle"
              placeholder="Filter role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            />
          </div>
        ) : null}

        <div
          className={[
            "grid auto-rows-max content-start items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3",
            hasAnyProjects ? "md:min-h-[760px] md:pb-20" : "",
          ].join(" ")}
        >
          {hasAnyProjects && filteredProjects.length ? (
            filteredProjects.map((item) => (
              <PortfolioProjectCard
                key={item.id}
                item={item}
                onActivate={portfolioDetailPopup.open}
                onEdit={openEditorForProject}
                onDelete={deleteProject}
                onToggleFeatured={toggleFeatured}
              />
            ))
          ) : hasAnyProjects ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-white/58">
              No projects match these filters.
            </div>
          ) : null}
          <AddWorkSampleCard
            disabled={persistenceDisabled}
            onClick={() => {
              if (persistenceDisabled) {
                setGlobalError("Backend storage is offline. Start the backend before adding projects.");
                return;
              }
              setWorkSampleChooserOpen(true);
            }}
          />
        </div>
      </section>
      ) : null}

      {success && !embedded ? (
        <section className="rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-4 py-3 text-xs text-emerald-100">
          {success}
        </section>
      ) : null}

      {workSampleChooserOpen ? (
        <AddWorkSampleChoiceModal
          elevated={embedded}
          onClose={() => setWorkSampleChooserOpen(false)}
          onChoose={chooseWorkSampleSource}
          onPreviewLink={previewWorkLink}
        />
      ) : null}

      {!embedded ? portfolioDetailPopup.popover : null}

      {editorOpen ? (
        <div className={`fixed inset-0 ${embedded ? "z-[80]" : "z-50"} flex items-center justify-center overflow-hidden bg-black/70 px-4 py-4 backdrop-blur-sm`}>
          <div
            className={[
              "flex w-full flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#1d1d1f] shadow-[0_30px_110px_-40px_rgba(0,0,0,1)] transition-[max-width,height] duration-300 ease-out",
              // Step 1 stays wide/tall for the preview; the combined Contribution
              // details step is a touch taller (two sections); Tools is compact.
              editorStep === 0
                ? "max-w-5xl h-[min(760px,calc(100vh-2rem))]"
                : editorStep === 1
                  ? "max-w-[760px] h-[min(680px,calc(100vh-2rem))]"
                  : "max-w-[720px] h-[min(560px,calc(100vh-2rem))]",
            ].join(" ")}
          >
            {editorPanelContent(true)}
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {draftSavedToast ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
            <motion.div
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-emerald-300/25 bg-[#0f231b]/95 px-4 py-2.5 text-sm font-semibold text-emerald-50 shadow-[0_20px_60px_-30px_rgba(0,0,0,1)] backdrop-blur-xl"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 520, damping: 22, delay: 0.05 }}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-[#06210f]"
              >
                <Icon name="check" className="h-3.5 w-3.5" />
              </motion.span>
              Draft saved
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
