"use client";

import type { ReactNode } from "react";
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
import { Icon } from "../Icons";
import { TagPill } from "../ui";
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
  description: string;
  contributionTags: string[];
  tools: string[];
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

const MONTH_OPTIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const YEAR_OPTIONS = Array.from({ length: 9 }, (_, index) => String(new Date().getFullYear() + 1 - index));

const DEFAULT_TOOLS = [
  "Premiere Pro",
  "After Effects",
  "CapCut",
  "DaVinci Resolve",
  "Final Cut Pro",
  "Photoshop",
  "Figma",
  "Canva",
  "Notion",
  "YouTube Studio",
  "Audacity",
  "Logic Pro",
  "Descript",
  "Riverside",
  "Google Docs",
];

const ROLE_TOOLS: Record<string, string[]> = {
  "video editor": ["Premiere Pro", "After Effects", "CapCut", "DaVinci Resolve"],
  "thumbnail designer": ["Photoshop", "Canva", "Figma"],
  scriptwriter: ["Google Docs", "Notion"],
  researcher: ["Google Docs", "Notion", "Sheets"],
  "motion graphics designer": ["After Effects", "Blender", "Premiere Pro"],
  animator: ["After Effects", "Blender", "Premiere Pro"],
};

const WIZARD_STEPS = [
  { key: "source-cover", label: "Source attached" },
  { key: "details", label: "Details next" },
  { key: "contribution", label: "Contribution" },
  { key: "review", label: "Ready to review" },
] as const;

const WIZARD_STEP_ORDER = [0, 2, 3, 6] as const;

const emptyDraft = (sourceType: SourceType = "custom"): PortfolioDraft => ({
  title: "",
  sourceType,
  sourceUrl: "",
  thumbnailUrl: "",
  thumbnailOptions: [],
  roleName: "",
  visibility: "public",
  portfolioStatus: sourceType === "youtube" ? "past" : "now",
  description: "",
  contributionTags: [],
  tools: [],
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

const parseListInput = (value: string) =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseOptionalNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const matchingRoleKey = (roleName: string) => {
  const normalized = roleName.trim().toLowerCase();
  return Object.keys(ROLE_TOOLS).find((roleKey) => normalized.includes(roleKey));
};

const uniqueList = (items: string[]) => Array.from(new Set(items));

const toolOptionsForRole = (roleName: string, sourceType: SourceType) => {
  const roleKey = matchingRoleKey(roleName);
  const roleTools = roleKey ? ROLE_TOOLS[roleKey] || [] : [];
  const sourceTools =
    sourceType === "drive"
      ? ["Google Docs", "Sheets", "Notion"]
      : sourceType === "custom" || sourceType === "website"
        ? ["Figma", "Canva", "Notion"]
        : sourceType === "instagram"
          ? ["CapCut", "Premiere Pro", "Canva"]
          : [];
  return uniqueList([...roleTools, ...sourceTools, ...DEFAULT_TOOLS]).slice(0, 14);
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

const formatTimeline = (draft: PortfolioDraft) => {
  const start = [draft.startMonth, draft.startYear].filter(Boolean).join(" ");
  const end = draft.currentlyWorking ? "Present" : [draft.endMonth, draft.endYear].filter(Boolean).join(" ");
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} - ${draft.currentlyWorking ? "Present" : "End date open"}`;
  if (draft.currentlyWorking) return "Currently working on this";
  return "Timeline not set";
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
  projectHref,
  showActions = true,
}: {
  item: BackendPortfolioItem;
  onDelete?: (id: string) => void;
  onToggleFeatured?: (item: BackendPortfolioItem) => void;
  projectHref?: string;
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
  const projectLinks = item.links?.length
    ? item.links
    : [item.source_url, item.media_url, item.youtube_url].filter((link): link is string => Boolean(link));
  const primaryProjectLink = projectLinks[0] || null;
  const hasOwnerMenu = Boolean(onToggleFeatured || onDelete);
  const isProjectClickable = Boolean(projectHref || primaryProjectLink);
  const openProject = useCallback(() => {
    if (!primaryProjectLink || typeof window === "undefined") return;
    window.open(primaryProjectLink, "_blank", "noopener,noreferrer");
  }, [primaryProjectLink]);
  const activateCard = useCallback(() => {
    if (projectHref) {
      router.push(projectHref);
      return;
    }
    openProject();
  }, [openProject, projectHref, router]);

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
      role={isProjectClickable ? "link" : undefined}
      aria-label={isProjectClickable ? `${projectHref ? "Open project detail" : "Open project"}: ${item.title}` : undefined}
      tabIndex={isProjectClickable ? 0 : undefined}
      onClick={isProjectClickable ? activateCard : undefined}
      onKeyDown={
        isProjectClickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateCard();
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
          <div className="h-full w-full inline-flex items-center justify-center text-white/35">
            <Icon name={item.source_type === "youtube" ? "youtube" : "briefcase"} className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{sourceLabel(item.source_type, publicMetrics.source_type)}</Badge>
          {item.verification_status === "youtube_metadata_verified" ? <Badge>Verified</Badge> : null}
          {item.publish_status === "draft" ? <Badge>Draft</Badge> : null}
          {item.visibility === "private" || item.is_public === false ? <Badge>Private</Badge> : null}
          {item.is_featured ? <Badge>Featured</Badge> : null}
        </div>
        <h4 className="mt-3 line-clamp-2 text-base font-semibold leading-snug text-white/95">{item.title}</h4>
        <p className="mt-1 line-clamp-1 text-sm font-semibold text-white/78">{item.role_name || item.role || item.user_role_in_project || "Role not set"}</p>
        {sourceLine ? <p className="mt-1 line-clamp-1 text-xs text-white/48">{sourceLine}</p> : null}
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
                  className="group/action relative inline-flex h-8 w-8 items-center justify-center rounded-full text-white/38 transition-colors hover:bg-white/[0.045] hover:text-white/82 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer"
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
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label="Create portfolio project"
      className="group flex h-full cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] text-left shadow-[0_18px_50px_-34px_rgba(0,0,0,0.95)] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.05] hover:shadow-[0_24px_60px_-34px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:border-white/10 disabled:hover:bg-white/[0.03] disabled:hover:shadow-[0_18px_50px_-34px_rgba(0,0,0,0.95)]"
    >
      <div className="flex w-full flex-col">
        <div className="relative aspect-video overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.018))]">
          <div className="absolute inset-0 bg-black/8 transition-colors duration-200 group-hover:bg-black/[0.03]" />
          <div className="absolute inset-0 flex items-center justify-center text-white/52 transition-colors duration-200 group-hover:text-white/78">
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/48">
              Platform
            </span>
          </div>

          <div className="mt-4 space-y-2">
            <p className="text-[16px] font-semibold leading-snug text-white/86">Project title</p>
            <p className="text-sm font-medium text-white/58">Role</p>
            <p className="text-xs text-white/40">Source · date</p>
          </div>
        </div>
      </div>
    </button>
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
  const [tagInput, setTagInput] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceDisplayType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PortfolioStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState("");
  const [workSampleChooserOpen, setWorkSampleChooserOpen] = useState(false);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
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
  const toolOptions = toolOptionsForRole(draft.roleName, draft.sourceType);
  const currentWizardIndex = Math.max(0, WIZARD_STEP_ORDER.indexOf(editorStep as typeof WIZARD_STEP_ORDER[number]));
  const wizardProgress = ((currentWizardIndex + 1) / WIZARD_STEPS.length) * 100;
  const activeWizardStep = WIZARD_STEPS[currentWizardIndex];

  useEffect(() => {
    if (!editorOpen) return;
    editorBodyRef.current?.scrollTo({ top: 0 });
  }, [editorOpen, editorStep]);

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
      publicMetrics: previewSource ? { source_type: previewSource } : {},
      verificationStatus: sourceType === "youtube" ? "youtube_metadata_verified" : "manual",
    });
    setEditorStep(0);
    setTagInput("");
    setToolInput("");
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
      description: trimToSnippet(preview.description_snippet || preview.description),
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
      description: trimToSnippet(preview.description),
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
    setTagInput("");
    setToolInput("");
    setLocalError(
      previewError ||
        (preview.status === "manual_required"
          ? sourceFallbackMessage(sourceType, preview.source_type)
          : null)
    );
    setSuccess(null);
    setEditorOpen(true);
  }, []);

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
          description: trimToSnippet(preview.description) || prev.description,
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

  const toggleListItem = (field: "contributionTags" | "tools" | "tags", value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    setDraft((prev) => {
      const list = prev[field];
      const exists = list.some((item) => item.toLowerCase() === cleaned.toLowerCase());
      if (exists) return { ...prev, [field]: list.filter((item) => item.toLowerCase() !== cleaned.toLowerCase()) };
      if (field === "tags" && list.length >= 10) return prev;
      return { ...prev, [field]: [...list, cleaned] };
    });
  };

  const addTag = () => {
    toggleListItem("tags", tagInput);
    setTagInput("");
  };

  const addTool = () => {
    setDraft((prev) => {
      const additions = parseListInput(toolInput).filter(
        (tool) => !prev.tools.some((current) => current.toLowerCase() === tool.toLowerCase())
      );
      return additions.length ? { ...prev, tools: [...prev.tools, ...additions] } : prev;
    });
    setToolInput("");
  };

  const validateAndBuildPayload = (publishStatus: PublishStatus): BackendPortfolioCreatePayload | null => {
    const title = draft.title.trim();
    const sourceUrl = draft.sourceUrl.trim();
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
    if (!sourceUrl && !description) {
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
        draft.endYear ||
        draft.currentlyWorking
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
      description: description || undefined,
      contribution_summary: description || undefined,
      contribution_tags: draft.contributionTags,
      tools: draft.tools,
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

  const saveProject = async (publishStatus: PublishStatus) => {
    const payload = validateAndBuildPayload(publishStatus);
    if (!payload) return;
    setSaving(true);
    setLocalError(null);
    setGlobalError(null);
    try {
      await withFreshBackendToken((token) =>
        editingId ? updateMyPortfolioItem(token, editingId, payload) : createMyPortfolioItem(token, payload)
      );
      await refreshPortfolio();
      setSuccess(publishStatus === "draft" ? "Draft saved." : "Project published.");
      setEditorOpen(false);
      setEditingId(null);
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
    if (editorStep === 2 && !draft.roleName.trim()) {
      setLocalError(REQUIRED_ROLE_ERROR);
      return;
    }
    if (editorStep === 0) {
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
    setEditorStep(WIZARD_STEP_ORDER[Math.min(currentWizardIndex + 1, WIZARD_STEP_ORDER.length - 1)]);
  };

  const goToPreviousStep = () => {
    setLocalError(null);
    setEditorStep(WIZARD_STEP_ORDER[Math.max(currentWizardIndex - 1, 0)]);
  };

  const updateTimelineCurrent = (checked: boolean) => {
    setDraft((prev) => ({
      ...prev,
      currentlyWorking: checked,
      portfolioStatus: checked ? "now" : "past",
      endMonth: checked ? "" : prev.endMonth,
      endYear: checked ? "" : prev.endYear,
    }));
  };

  const previewCard = (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <div className="aspect-video bg-white/[0.035]">
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
            className="h-full w-full object-cover opacity-80"
          />
        )}
      </div>
      <div className="p-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge>Project</Badge>
          <Badge>{sourceLabel(draft.sourceType, draft.publicMetrics.source_type)}</Badge>
          <Badge>{draft.sourceType === "youtube" ? "YouTube metadata verified" : "External link"}</Badge>
          {draft.visibility === "private" ? <Badge>Private</Badge> : null}
        </div>
        <p className="mt-2 text-sm font-semibold text-white/90">{draft.title || "Project title"}</p>
        <p className="mt-1 text-xs text-white/55">{draft.roleName || "Your role"}</p>
        <p className="mt-1 text-xs text-white/42">{formatTimeline(draft)}</p>
        {draft.description ? <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-white/58">{draft.description}</p> : null}
        {draft.contributionTags.length || draft.tools.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...draft.contributionTags, ...draft.tools].slice(0, 5).map((tag) => (
              <TagPill key={`preview-${tag}`}>{tag}</TagPill>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderWizardStep = () => {
    if (editorStep === 0) {
      return (
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
          <h4 className="text-lg font-semibold text-white/92">Source & cover</h4>
          <p className="mt-2 text-sm leading-relaxed text-white/58">
            Review the attached project link and choose the visual cover hiring teams will see.
          </p>
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
                  className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
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
          {Object.keys(draft.publicMetrics).length ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-semibold text-white/70">{sourceLabel(draft.sourceType, draft.publicMetrics.source_type)}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/48">
                {[draft.channelName || draft.publicMetrics.author_name, formatCompactNumber(draft.publicMetrics.views) ? `${formatCompactNumber(draft.publicMetrics.views)} views` : null, draft.durationLabel]
                  .filter(Boolean)
                .join(" · ") || sourceFallbackMessage(draft.sourceType, draft.publicMetrics.source_type)}
              </p>
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <p className="text-xs font-semibold text-white/55">Cover / thumbnail</p>
              <div className="mt-2 aspect-video overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                {draft.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.thumbnailUrl} alt="Thumbnail preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-white/42">
                    No thumbnail found
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-white/55">Thumbnail image URL</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                  placeholder="https://image-url..."
                  value={draft.thumbnailUrl}
                  onChange={(event) => setDraft((prev) => ({ ...prev, thumbnailUrl: event.target.value }))}
                />
              </label>
              <p className="text-xs leading-relaxed text-white/48">Optional. Paste an image URL to override the generated cover.</p>
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
        </section>
      );
    }

    if (editorStep === 2) {
      return (
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
          <h4 className="text-lg font-semibold text-white/92">Project details</h4>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-white/55">Project title</span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                placeholder="e.g. Thumbnail redesign for finance channel"
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
                className={`mt-2 h-11 w-full rounded-xl border bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35 ${
                  localError === REQUIRED_ROLE_ERROR
                    ? "border-amber-200/50 focus:border-amber-200/70"
                    : "border-white/10"
                }`}
                placeholder="e.g. Video Editor, Thumbnail Designer, Scriptwriter"
                value={draft.roleName}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, roleName: event.target.value }));
                  if (localError === REQUIRED_ROLE_ERROR) {
                    setLocalError(null);
                  }
                }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-white/55">Visibility</span>
              <select
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer"
                value={draft.visibility}
                onChange={(event) => setDraft((prev) => ({ ...prev, visibility: event.target.value as Visibility }))}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-3">
            <p className="text-xs font-semibold text-white/55">Project timeline</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer"
                  value={draft.startMonth}
                  onChange={(event) => setDraft((prev) => ({ ...prev, startMonth: event.target.value }))}
                  aria-label="Start month"
                >
                  <option value="">Start month</option>
                  {MONTH_OPTIONS.map((month) => <option key={`start-${month}`} value={month}>{month}</option>)}
                </select>
                <select
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer"
                  value={draft.startYear}
                  onChange={(event) => setDraft((prev) => ({ ...prev, startYear: event.target.value }))}
                  aria-label="Start year"
                >
                  <option value="">Start year</option>
                  {YEAR_OPTIONS.map((year) => <option key={`start-${year}`} value={year}>{year}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white disabled:opacity-45 cursor-pointer"
                  value={draft.endMonth}
                  onChange={(event) => setDraft((prev) => ({ ...prev, endMonth: event.target.value }))}
                  disabled={draft.currentlyWorking}
                  aria-label="End month"
                >
                  <option value="">{draft.currentlyWorking ? "Present" : "End month"}</option>
                  {MONTH_OPTIONS.map((month) => <option key={`end-${month}`} value={month}>{month}</option>)}
                </select>
                <select
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white disabled:opacity-45 cursor-pointer"
                  value={draft.endYear}
                  onChange={(event) => setDraft((prev) => ({ ...prev, endYear: event.target.value }))}
                  disabled={draft.currentlyWorking}
                  aria-label="End year"
                >
                  <option value="">{draft.currentlyWorking ? "Present" : "End year"}</option>
                  {YEAR_OPTIONS.map((year) => <option key={`end-${year}`} value={year}>{year}</option>)}
                </select>
              </div>
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-white/72">
              <input
                type="checkbox"
                checked={draft.currentlyWorking}
                onChange={(event) => updateTimelineCurrent(event.target.checked)}
              />
              Currently working on this
            </label>
            <p className="mt-2 text-xs text-white/42">{formatTimeline(draft)}</p>
          </div>
        </section>
      );
    }

    if (editorStep === 3) {
      return (
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
          <h4 className="text-lg font-semibold text-white/92">Contribution</h4>
          <label className="mt-4 block">
            <span className="text-xs font-semibold text-white/55">Contribution summary</span>
            <textarea
              className="mt-2 min-h-[118px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35"
              placeholder="Briefly explain what you made, what you handled, and why it mattered."
              value={draft.description}
              onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>
          <p className="mt-5 text-xs font-semibold text-white/55">Tools used</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {toolOptions.map((tool) => {
              const selected = draft.tools.includes(tool);
              return (
                <button
                  key={`tool-${tool}`}
                  type="button"
                  onClick={() => toggleListItem("tools", tool)}
                  className={[
                    "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                    selected
                      ? "border-white/28 bg-white/[0.12] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/68 hover:bg-white/[0.08]",
                  ].join(" ")}
                >
                  {tool}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
              placeholder="Add tools, comma separated"
              value={toolInput}
              onChange={(event) => setToolInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTool();
                }
              }}
            />
            <button
              type="button"
              onClick={addTool}
              className="h-10 rounded-xl border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 hover:bg-white/[0.08] cursor-pointer"
            >
              Add
            </button>
          </div>
          <div className="mt-5">
            <p className="text-xs font-semibold text-white/55">Tags</p>
            <p className="mt-1 text-xs text-white/42">Add up to 10 tags so collaborators can find this project.</p>
            <div className="mt-2 flex gap-2">
              <input
                className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                placeholder="Retention edit, finance, shorts"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                type="button"
                onClick={addTag}
                className="h-10 rounded-xl border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 hover:bg-white/[0.08] cursor-pointer"
              >
                Add
              </button>
            </div>
            {draft.tags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.tags.map((tag) => (
                  <button key={`tag-${tag}`} type="button" onClick={() => toggleListItem("tags", tag)}>
                    <TagPill>{tag}</TagPill>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      );
    }

    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
        <h4 className="text-lg font-semibold text-white/92">Review</h4>
        <div className="mt-4 max-w-md">{previewCard}</div>
        <label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/78">
          <input
            type="checkbox"
            checked={draft.isFeatured}
            onChange={(event) => setDraft((prev) => ({ ...prev, isFeatured: event.target.checked }))}
          />
          Featured
        </label>
      </section>
    );
  };

  return (
    <div className="space-y-5">
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
              className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs text-white placeholder:text-white/35"
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
                projectHref={`/you/projects/${encodeURIComponent(item.id)}`}
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

      {success ? (
        <section className="rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-4 py-3 text-xs text-emerald-100">
          {success}
        </section>
      ) : null}

      {workSampleChooserOpen ? (
        <AddWorkSampleChoiceModal
          onClose={() => setWorkSampleChooserOpen(false)}
          onChoose={chooseWorkSampleSource}
          onPreviewLink={previewWorkLink}
        />
      ) : null}

      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/70 px-4 py-4 backdrop-blur-sm">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#1d1d1f] shadow-[0_30px_110px_-40px_rgba(0,0,0,1)]">
            <div className="shrink-0 border-b border-white/10 bg-[#1d1d1f]/95 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/42">
                  {editingId ? "Edit project" : draft.sourceType === "youtube" ? "YouTube import" : "New project"}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-white">Project builder</h3>
                <p className="mt-1 text-sm text-white/52">{activeWizardStep.label}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="h-9 w-9 rounded-lg border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08] inline-flex items-center justify-center cursor-pointer"
                aria-label="Close project editor"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white/62 transition-[width] duration-300 ease-out"
                  style={{ width: `${wizardProgress}%` }}
                />
              </div>
            </div>

            <div ref={editorBodyRef} className="min-h-0 flex-1 overflow-y-auto p-5 pt-6">
              {localError ? (
                <section className="mb-4 rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-sm text-amber-100">
                  {localError}
                </section>
              ) : null}
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="min-w-0">{renderWizardStep()}</div>
                {currentWizardIndex < WIZARD_STEPS.length - 1 ? (
                  <aside className="hidden space-y-3 lg:block">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/38">Card preview</p>
                    {previewCard}
                  </aside>
                ) : null}
              </div>
            </div>

            <div className="shrink-0 border-t border-white/10 bg-[#1d1d1f]/95 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="h-10 rounded-xl px-4 text-sm font-semibold text-white/55 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={goToPreviousStep}
                    disabled={currentWizardIndex === 0 || saving}
                    className="h-10 rounded-xl border border-white/12 bg-white/[0.035] px-4 text-sm font-semibold text-white/72 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveProject("draft")}
                    disabled={saving}
                    className="h-10 rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white/82 hover:bg-white/[0.08] disabled:opacity-60 cursor-pointer"
                  >
                    {saving ? "Saving..." : "Save draft"}
                  </button>
                  {currentWizardIndex === WIZARD_STEPS.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => void saveProject("published")}
                      disabled={saving}
                      className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60 cursor-pointer"
                    >
                      {saving ? "Publishing..." : "Publish"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void goToNextStep()}
                      disabled={saving || refreshingPreview}
                      className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60 cursor-pointer"
                    >
                      {editorStep === 0 && refreshingPreview ? "Refreshing..." : "Next"}
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
