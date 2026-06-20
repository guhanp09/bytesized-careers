"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  BackendPortfolioItem,
  BackendPortfolioUpdatePayload,
  BackendProfileResponse,
  BackendPublicProfileResponse,
  deleteMyPortfolioItem,
  updateMyPortfolioItem,
} from "../../lib/backendClient";
import { Icon } from "../Icons";
import RatingDisplay from "../RatingDisplay";

type ProjectProfile = Pick<
  BackendProfileResponse | BackendPublicProfileResponse,
  "username" | "display_name" | "headline" | "avatar_url" | "location" | "availability_status" | "reviews" | "roles"
>;

type ProjectDetailPageProps = {
  project: BackendPortfolioItem;
  profile: ProjectProfile;
  owner?: boolean;
  backendAccessToken?: string;
  backHref: string;
  backLabel: string;
  profileHref: string;
};

type SourceType = NonNullable<BackendPortfolioItem["source_type"]>;

type EditForm = {
  title: string;
  sourceType: SourceType;
  sourceUrl: string;
  thumbnailUrl: string;
  roleName: string;
  visibility: "public" | "private";
  portfolioStatus: "now" | "past";
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  currentlyWorking: boolean;
  contributionSummary: string;
  contributionTags: string;
  tools: string;
  tags: string;
  views: string;
  retentionPercent: string;
  ctrPercent: string;
  turnaroundDays: string;
  subscriberGain: string;
  metricNotes: string;
};

const SOURCE_OPTIONS: Array<{ value: SourceType; label: string }> = [
  { value: "youtube", label: "YouTube" },
  { value: "vimeo", label: "Vimeo" },
  { value: "drive", label: "Google Drive" },
  { value: "behance", label: "Behance" },
  { value: "instagram", label: "Instagram" },
  { value: "website", label: "Custom URL" },
  { value: "custom", label: "Custom URL" },
  { value: "other", label: "Other" },
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

const YEAR_OPTIONS = Array.from({ length: 12 }, (_, index) => String(new Date().getFullYear() - index));

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const metricNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseOptionalNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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

const sourceLabel = (source?: string | null, previewSource?: unknown) => {
  const preview = typeof previewSource === "string" ? previewSource.toLowerCase() : "";
  if (preview === "google_docs") return "Google Docs";
  if (preview === "notion") return "Notion";
  if (preview === "figma") return "Figma";
  if (preview === "canva") return "Canva";
  const normalized = (source || "custom").toLowerCase();
  if (normalized === "youtube") return "YouTube";
  if (normalized === "vimeo") return "Vimeo";
  if (normalized === "drive") return "Google Drive";
  if (normalized === "behance") return "Behance";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "website" || normalized === "custom" || normalized === "other") return "Custom URL";
  return "Custom URL";
};

const domainFromUrl = (value?: string | null) => {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const readTimeline = (project: BackendPortfolioItem) => {
  const metrics = project.public_metrics || {};
  const raw = metrics.project_timeline;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const timeline = raw as Record<string, unknown>;
  return {
    startMonth: asString(timeline.start_month),
    startYear: asString(timeline.start_year),
    endMonth: asString(timeline.end_month),
    endYear: asString(timeline.end_year),
    currentlyWorking: Boolean(timeline.currently_working),
  };
};

const formatTimeline = (project: BackendPortfolioItem) => {
  const timeline = readTimeline(project);
  if (!timeline) return project.portfolio_status === "now" || project.status === "now" ? "Current project" : null;
  const start = [timeline.startMonth, timeline.startYear].filter(Boolean).join(" ");
  const end = timeline.currentlyWorking ? "Present" : [timeline.endMonth, timeline.endYear].filter(Boolean).join(" ");
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} - ${timeline.currentlyWorking ? "Present" : "End date open"}`;
  if (timeline.currentlyWorking) return "Currently active";
  return null;
};

const parseList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const externalProjectUrl = (project: BackendPortfolioItem) =>
  project.source_url || project.media_url || project.youtube_url || project.links?.[0] || "";

const isLikelyInternalHref = (value: string) => value.startsWith("/");

const normalizeProjectHref = (value?: string | null) => {
  const href = value?.trim();
  if (!href) return null;
  if (isLikelyInternalHref(href)) return href;
  try {
    const url = new URL(href);
    return url.href;
  } catch {
    return null;
  }
};

const roleForProject = (project: BackendPortfolioItem) =>
  project.role_name || project.role || project.user_role_in_project || "";

const sourceNameForProject = (project: BackendPortfolioItem) => {
  const publicMetrics = project.public_metrics || {};
  const channelName = asString(publicMetrics.channel_name) || asString(publicMetrics.author_name);
  if (project.source_type === "youtube") return project.channel_name || channelName || "YouTube";
  return domainFromUrl(externalProjectUrl(project)) || sourceLabel(project.source_type, publicMetrics.source_type);
};

const buildEditForm = (project: BackendPortfolioItem): EditForm => {
  const manualMetrics = project.manual_metrics || {};
  const timeline = readTimeline(project);
  return {
    title: project.title || "",
    sourceType: project.source_type || "custom",
    sourceUrl: externalProjectUrl(project),
    thumbnailUrl: project.thumbnail_url || "",
    roleName: roleForProject(project),
    visibility: (project.visibility || (project.is_public ? "public" : "private")) === "private" ? "private" : "public",
    portfolioStatus: project.portfolio_status || project.status || "now",
    startMonth: timeline?.startMonth || "",
    startYear: timeline?.startYear || "",
    endMonth: timeline?.endMonth || "",
    endYear: timeline?.endYear || "",
    currentlyWorking: timeline?.currentlyWorking ?? (project.portfolio_status || project.status) === "now",
    contributionSummary: project.contribution_summary || project.description || "",
    contributionTags: (project.contribution_tags || []).join(", "),
    tools: (project.tools || []).join(", "),
    tags: (project.tags || []).join(", "),
    views: String(metricNumber(manualMetrics.views ?? project.views) ?? ""),
    retentionPercent: String(metricNumber(manualMetrics.retention_percent ?? project.retention_percent) ?? ""),
    ctrPercent: String(metricNumber(manualMetrics.ctr_percent) ?? ""),
    turnaroundDays: String(metricNumber(manualMetrics.turnaround_days) ?? ""),
    subscriberGain: String(metricNumber(manualMetrics.subscriber_gain) ?? ""),
    metricNotes: asString(manualMetrics.metric_notes) || asString(manualMetrics.notes) || project.metrics || "",
  };
};

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-xs font-semibold text-white/68">
      {children}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/42">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyOwnerPrompt({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] px-3 py-2 text-sm text-white/42">
      {children}
    </p>
  );
}

function FactRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/8 py-3 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/36">{label}</span>
      <span className="max-w-[180px] text-right text-sm text-white/76">{value}</span>
    </div>
  );
}

function InteractiveProjectLink({
  href,
  className,
  label,
  children,
}: {
  href: string;
  className: string;
  label: string;
  children: ReactNode;
}) {
  if (isLikelyInternalHref(href)) {
    return (
      <Link href={href} aria-label={label} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={className}>
      {children}
    </a>
  );
}

function IconAction({
  label,
  onClick,
  icon,
  tone = "normal",
}: {
  label: string;
  onClick: () => void;
  icon: Parameters<typeof Icon>[0]["name"];
  tone?: "normal" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        "group/action relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] transition-colors focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer",
        tone === "danger"
          ? "text-rose-200/72 hover:border-rose-200/20 hover:bg-rose-400/10 hover:text-rose-100"
          : "text-white/68 hover:border-white/18 hover:bg-white/[0.08] hover:text-white",
      ].join(" ")}
    >
      <Icon name={icon} className="h-4 w-4" />
      <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
        {label}
      </span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-white/50">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

const fieldClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/22 focus:bg-white/[0.06]";
const textareaClass =
  "min-h-[118px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-white/28 focus:border-white/22 focus:bg-white/[0.06]";

export default function ProjectDetailPage({
  project: initialProject,
  profile,
  owner = false,
  backendAccessToken,
  backHref,
  backLabel,
  profileHref,
}: ProjectDetailPageProps) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(() => buildEditForm(initialProject));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publicMetrics = project.public_metrics || {};
  const manualMetrics = project.manual_metrics || {};
  const sourceUrl = normalizeProjectHref(externalProjectUrl(project));
  const role = roleForProject(project);
  const timeline = formatTimeline(project);
  const publishedDate = formatDateShort(asString(publicMetrics.published_at) || project.published_at || project.published_date);
  const sourceName = sourceNameForProject(project);
  const source = sourceLabel(project.source_type, publicMetrics.source_type);
  const contextLine = [source, sourceName, publishedDate || timeline].filter(Boolean).join(" · ");
  const displayName = profile.display_name || profile.username || "Content creator";
  const username = profile.username || "content-creator";
  const avatarUrl = profile.avatar_url || "";
  const contributionTags = project.contribution_tags || [];
  const tools = project.tools || [];
  const tags = project.tags || [];
  const views = formatCompactNumber(publicMetrics.views ?? manualMetrics.views ?? project.views);
  const likes = formatCompactNumber(publicMetrics.likes);
  const comments = formatCompactNumber(publicMetrics.comments);
  const retention = metricNumber(manualMetrics.retention_percent ?? project.retention_percent);
  const ctr = metricNumber(manualMetrics.ctr_percent);
  const turnaround = metricNumber(manualMetrics.turnaround_days);
  const subscriberGain = metricNumber(manualMetrics.subscriber_gain);
  const metricNotes = asString(manualMetrics.metric_notes) || asString(manualMetrics.notes) || project.metrics || "";
  const metricItems = [
    views ? { label: "Views", value: views } : null,
    likes ? { label: "Likes", value: likes } : null,
    comments ? { label: "Comments", value: comments } : null,
    retention !== null ? { label: "Retention", value: `${retention}% self-reported` } : null,
    ctr !== null ? { label: "CTR", value: `${ctr}% self-reported` } : null,
    turnaround !== null ? { label: "Turnaround", value: `${turnaround} days` } : null,
    subscriberGain !== null ? { label: "Subscribers", value: `+${subscriberGain}` } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const creatorRole = profile.roles?.[0]?.name || profile.headline || "";
  const updateForm = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveProject = async () => {
    if (!owner || !backendAccessToken) return;
    const title = form.title.trim();
    const sourceUrlValue = form.sourceUrl.trim();
    if (!title) {
      setError("Add a project title before saving.");
      return;
    }

    const numericFields = [
      parseOptionalNumber(form.views),
      parseOptionalNumber(form.retentionPercent),
      parseOptionalNumber(form.ctrPercent),
      parseOptionalNumber(form.turnaroundDays),
      parseOptionalNumber(form.subscriberGain),
    ];
    if (numericFields.some(Number.isNaN)) {
      setError("Metrics must be valid numbers.");
      return;
    }
    const [viewsValue, retentionValue, ctrValue, turnaroundValue, subscriberGainValue] = numericFields;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const publicMetricsPayload = {
        ...(project.public_metrics || {}),
        project_timeline: {
          start_month: form.startMonth,
          start_year: form.startYear,
          end_month: form.endMonth,
          end_year: form.endYear,
          currently_working: form.currentlyWorking,
        },
      };
      const manualMetricsPayload: Record<string, unknown> = {
        ...(project.manual_metrics || {}),
      };
      const setMetric = (key: string, value: number | null) => {
        if (value === null) {
          delete manualMetricsPayload[key];
        } else {
          manualMetricsPayload[key] = value;
        }
      };
      setMetric("views", viewsValue);
      setMetric("retention_percent", retentionValue);
      setMetric("ctr_percent", ctrValue);
      setMetric("turnaround_days", turnaroundValue);
      setMetric("subscriber_gain", subscriberGainValue);
      if (form.metricNotes.trim()) {
        manualMetricsPayload.metric_notes = form.metricNotes.trim();
      } else {
        delete manualMetricsPayload.metric_notes;
        delete manualMetricsPayload.notes;
      }

      const payload: BackendPortfolioUpdatePayload = {
        title,
        source_type: form.sourceType,
        source_url: sourceUrlValue || undefined,
        media_url: sourceUrlValue || undefined,
        links: sourceUrlValue ? [sourceUrlValue] : [],
        thumbnail_url: form.thumbnailUrl.trim() || undefined,
        role_name: form.roleName.trim() || undefined,
        user_role_in_project: form.roleName.trim() || undefined,
        visibility: form.visibility,
        is_public: form.visibility === "public",
        portfolio_status: form.portfolioStatus,
        status: form.portfolioStatus,
        description: form.contributionSummary.trim() || undefined,
        contribution_summary: form.contributionSummary.trim() || undefined,
        contribution_tags: parseList(form.contributionTags),
        tools: parseList(form.tools),
        tags: parseList(form.tags),
        views: viewsValue ?? undefined,
        retention_percent: retentionValue ?? undefined,
        metrics: form.metricNotes.trim() || undefined,
        public_metrics: publicMetricsPayload,
        manual_metrics: manualMetricsPayload,
        publish_status: project.publish_status || "published",
        verification_status: project.verification_status || "manual",
        is_featured: Boolean(project.is_featured),
      };
      const updated = await updateMyPortfolioItem(backendAccessToken, project.id, payload);
      setProject(updated);
      setForm(buildEditForm(updated));
      setEditing(false);
      setMessage("Project updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project.");
    } finally {
      setSaving(false);
    }
  };

  const togglePinned = async () => {
    if (!owner || !backendAccessToken) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateMyPortfolioItem(backendAccessToken, project.id, {
        is_featured: !project.is_featured,
      });
      setProject(updated);
      setMessage(updated.is_featured ? "Project pinned." : "Project unpinned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pin state.");
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async () => {
    if (!owner || !backendAccessToken) return;
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteMyPortfolioItem(backendAccessToken, project.id);
      router.push("/you?tab=portfolio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project.");
      setSaving(false);
    }
  };

  const overviewText = project.contribution_summary || project.description;
  const hasOutcome = metricItems.length > 0 || metricNotes;

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      <section className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href={backHref} className="text-sm font-semibold text-white/56 transition-colors hover:text-white">
            {backLabel}
          </Link>
          {owner ? (
            <div className="flex items-center gap-2">
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open original project"
                  className="group/action relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/68 transition-colors hover:border-white/18 hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/15"
                >
                  <Icon name="external-link" className="h-4 w-4" />
                  <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
                    Open original project
                  </span>
                </a>
              ) : null}
              <IconAction label={project.is_featured ? "Unpin project" : "Pin project"} icon="pin" onClick={togglePinned} />
              <IconAction label="Edit project" icon="pencil" onClick={() => setEditing((value) => !value)} />
              <IconAction label="Delete project" icon="x" tone="danger" onClick={deleteProject} />
            </div>
          ) : null}
        </div>

        {message ? (
          <div className="mb-4 rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-4 py-3 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#15161a] shadow-[0_26px_90px_-54px_rgba(0,0,0,1)]">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
            <div className="bg-black/25">
              {sourceUrl ? (
                <InteractiveProjectLink
                  href={sourceUrl}
                  label={`Open project: ${project.title}`}
                  className="group/project relative block aspect-video overflow-hidden bg-white/[0.035] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/18"
                >
                  {project.thumbnail_url ? (
                    <img
                      src={project.thumbnail_url}
                      alt={project.title}
                      className="h-full w-full object-cover transition-[filter,transform] duration-300 group-hover/project:brightness-[0.82] group-focus-visible/project:brightness-[0.82]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,#202126,#111216)] text-white/42 transition-[filter] duration-300 group-hover/project:brightness-[0.82] group-focus-visible/project:brightness-[0.82]">
                      <Icon name={project.source_type === "youtube" ? "youtube" : "briefcase"} className="h-14 w-14" />
                    </div>
                  )}
                  <span className="pointer-events-none absolute inset-0 bg-black/0 opacity-0 transition-colors duration-300 group-hover/project:bg-black/10 group-hover/project:opacity-100 group-focus-visible/project:bg-black/10 group-focus-visible/project:opacity-100" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-[opacity,transform] duration-300 group-hover/project:opacity-100 group-focus-visible/project:opacity-100">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/14 bg-black/36 text-white/88 shadow-[0_16px_40px_-22px_rgba(0,0,0,1)] backdrop-blur-md">
                      <Icon name="external-link" className="h-4 w-4" />
                    </span>
                  </span>
                </InteractiveProjectLink>
              ) : (
                <div className="aspect-video overflow-hidden bg-white/[0.035]">
                  {project.thumbnail_url ? (
                    <img src={project.thumbnail_url} alt={project.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,#202126,#111216)] text-white/42">
                      <Icon name={project.source_type === "youtube" ? "youtube" : "briefcase"} className="h-14 w-14" />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between p-5 sm:p-7">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Chip>{source}</Chip>
                  {project.verification_status === "youtube_metadata_verified" ? <Chip>Metadata verified</Chip> : null}
                  {project.is_featured ? <Chip>Featured</Chip> : null}
                  {owner && project.visibility === "private" ? <Chip>Private</Chip> : null}
                  {owner && project.publish_status === "draft" ? <Chip>Draft</Chip> : null}
                </div>
                {sourceUrl ? (
                  <InteractiveProjectLink
                    href={sourceUrl}
                    label={`Open project: ${project.title}`}
                    className="group/title mt-5 inline-flex max-w-full cursor-pointer items-start gap-2 text-white underline-offset-4 transition-colors hover:text-white hover:underline focus:outline-none focus:ring-2 focus:ring-white/15"
                  >
                    <h1 className="max-w-full text-3xl font-semibold tracking-tight text-inherit underline-offset-4 group-hover/title:underline sm:text-4xl lg:text-5xl">
                      {project.title}
                    </h1>
                    <span className="mt-2 shrink-0 text-white/42 transition-colors group-hover/title:text-white/72 group-focus-visible/title:text-white/72 sm:mt-2.5">
                      <Icon name="external-link" className="h-4 w-4" />
                    </span>
                  </InteractiveProjectLink>
                ) : (
                  <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                    {project.title}
                  </h1>
                )}
                {role ? (
                  <p className="mt-3 text-lg font-semibold text-white/82 sm:text-xl">{role}</p>
                ) : owner ? (
                  <p className="mt-3 text-sm text-white/42">Add a role for this project.</p>
                ) : null}
                {contextLine ? <p className="mt-3 text-sm text-white/54">{contextLine}</p> : null}
              </div>
              {!sourceUrl && owner ? (
                <div className="mt-8">
                  <EmptyOwnerPrompt>Add an original project link.</EmptyOwnerPrompt>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <Section title="Project overview">
              {overviewText ? (
                <p className="whitespace-pre-line text-base leading-relaxed text-white/76">{overviewText}</p>
              ) : owner ? (
                <EmptyOwnerPrompt>Add a contribution summary.</EmptyOwnerPrompt>
              ) : null}
            </Section>

            {(role || contributionTags.length || owner) ? (
              <Section title="My role">
                {role ? <p className="text-lg font-semibold text-white/86">{role}</p> : owner ? <EmptyOwnerPrompt>Add your role.</EmptyOwnerPrompt> : null}
                {contributionTags.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {contributionTags.map((tag) => <Chip key={`contribution-${tag}`}>{tag}</Chip>)}
                  </div>
                ) : owner ? (
                  <div className="mt-4"><EmptyOwnerPrompt>Add what you handled.</EmptyOwnerPrompt></div>
                ) : null}
              </Section>
            ) : null}

            {(tools.length || owner) ? (
              <Section title="Tools used">
                {tools.length ? (
                  <div className="flex flex-wrap gap-2">
                    {tools.map((tool) => <Chip key={`tool-${tool}`}>{tool}</Chip>)}
                  </div>
                ) : owner ? (
                  <EmptyOwnerPrompt>Add tools used.</EmptyOwnerPrompt>
                ) : null}
              </Section>
            ) : null}

            {(hasOutcome || owner) ? (
              <Section title="Outcome">
                {metricItems.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {metricItems.map((metric) => (
                      <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-white/36">{metric.label}</p>
                        <p className="mt-2 text-xl font-semibold text-white/90">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                ) : owner ? (
                  <EmptyOwnerPrompt>Add outcome metrics.</EmptyOwnerPrompt>
                ) : null}
                {metricNotes ? <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-white/66">{metricNotes}</p> : null}
              </Section>
            ) : null}

            {(tags.length || owner) ? (
              <Section title="Tags">
                {tags.length ? (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => <Chip key={`tag-${tag}`}>{tag}</Chip>)}
                  </div>
                ) : owner ? (
                  <EmptyOwnerPrompt>Add tags.</EmptyOwnerPrompt>
                ) : null}
              </Section>
            ) : null}

            {editing && owner ? (
              <Section title="Edit project">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Project title">
                    <input className={fieldClass} value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
                  </Field>
                  <Field label="Your role">
                    <input className={fieldClass} value={form.roleName} onChange={(event) => updateForm("roleName", event.target.value)} />
                  </Field>
                  <Field label="Source type">
                    <select className={fieldClass} value={form.sourceType} onChange={(event) => updateForm("sourceType", event.target.value as SourceType)}>
                      {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Visibility">
                    <select className={fieldClass} value={form.visibility} onChange={(event) => updateForm("visibility", event.target.value as "public" | "private")}>
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                    </select>
                  </Field>
                  <Field label="Original project URL">
                    <input className={fieldClass} value={form.sourceUrl} onChange={(event) => updateForm("sourceUrl", event.target.value)} placeholder="https://..." />
                  </Field>
                  <Field label="Cover image URL">
                    <input className={fieldClass} value={form.thumbnailUrl} onChange={(event) => updateForm("thumbnailUrl", event.target.value)} placeholder="https://..." />
                  </Field>
                  <Field label="Status">
                    <select className={fieldClass} value={form.portfolioStatus} onChange={(event) => updateForm("portfolioStatus", event.target.value as "now" | "past")}>
                      <option value="now">Now</option>
                      <option value="past">Past</option>
                    </select>
                  </Field>
                  <Field label="Currently working">
                    <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white/72">
                      <input type="checkbox" checked={form.currentlyWorking} onChange={(event) => updateForm("currentlyWorking", event.target.checked)} />
                      Currently working on this
                    </label>
                  </Field>
                  <Field label="Start month">
                    <select className={fieldClass} value={form.startMonth} onChange={(event) => updateForm("startMonth", event.target.value)}>
                      <option value="">Start month</option>
                      {MONTH_OPTIONS.map((month) => <option key={`start-month-${month}`} value={month}>{month}</option>)}
                    </select>
                  </Field>
                  <Field label="Start year">
                    <select className={fieldClass} value={form.startYear} onChange={(event) => updateForm("startYear", event.target.value)}>
                      <option value="">Start year</option>
                      {YEAR_OPTIONS.map((year) => <option key={`start-year-${year}`} value={year}>{year}</option>)}
                    </select>
                  </Field>
                  <Field label="End month">
                    <select className={fieldClass} value={form.endMonth} disabled={form.currentlyWorking} onChange={(event) => updateForm("endMonth", event.target.value)}>
                      <option value="">End month</option>
                      {MONTH_OPTIONS.map((month) => <option key={`end-month-${month}`} value={month}>{month}</option>)}
                    </select>
                  </Field>
                  <Field label="End year">
                    <select className={fieldClass} value={form.endYear} disabled={form.currentlyWorking} onChange={(event) => updateForm("endYear", event.target.value)}>
                      <option value="">End year</option>
                      {YEAR_OPTIONS.map((year) => <option key={`end-year-${year}`} value={year}>{year}</option>)}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Contribution summary">
                      <textarea className={textareaClass} value={form.contributionSummary} onChange={(event) => updateForm("contributionSummary", event.target.value)} />
                    </Field>
                  </div>
                  <Field label="Handled areas">
                    <textarea className={textareaClass} value={form.contributionTags} onChange={(event) => updateForm("contributionTags", event.target.value)} placeholder="Research, full edit, publishing" />
                  </Field>
                  <Field label="Tools">
                    <textarea className={textareaClass} value={form.tools} onChange={(event) => updateForm("tools", event.target.value)} placeholder="Premiere Pro, Figma, YouTube Studio" />
                  </Field>
                  <Field label="Tags">
                    <textarea className={textareaClass} value={form.tags} onChange={(event) => updateForm("tags", event.target.value)} placeholder="3D, education, retention" />
                  </Field>
                  <Field label="Metric notes">
                    <textarea className={textareaClass} value={form.metricNotes} onChange={(event) => updateForm("metricNotes", event.target.value)} />
                  </Field>
                  <Field label="Views">
                    <input className={fieldClass} value={form.views} onChange={(event) => updateForm("views", event.target.value)} />
                  </Field>
                  <Field label="Retention %">
                    <input className={fieldClass} value={form.retentionPercent} onChange={(event) => updateForm("retentionPercent", event.target.value)} />
                  </Field>
                  <Field label="CTR %">
                    <input className={fieldClass} value={form.ctrPercent} onChange={(event) => updateForm("ctrPercent", event.target.value)} />
                  </Field>
                  <Field label="Turnaround days">
                    <input className={fieldClass} value={form.turnaroundDays} onChange={(event) => updateForm("turnaroundDays", event.target.value)} />
                  </Field>
                  <Field label="Subscriber gain">
                    <input className={fieldClass} value={form.subscriberGain} onChange={(event) => updateForm("subscriberGain", event.target.value)} />
                  </Field>
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setForm(buildEditForm(project));
                      setEditing(false);
                      setError(null);
                    }}
                    className="h-10 rounded-full border border-white/10 bg-white/[0.035] px-4 text-sm font-semibold text-white/68 transition-colors hover:bg-white/[0.075] hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveProject()}
                    disabled={saving}
                    className="h-10 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </Section>
            ) : null}
          </div>

          <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <div className="flex items-center gap-3">
                {avatarUrl ? (
                  <Link
                    href={profileHref}
                    aria-label={`Open profile: ${displayName}`}
                    className="block rounded-2xl transition-[box-shadow,filter] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-white/15"
                  >
                    <img src={avatarUrl} alt={displayName} className="h-12 w-12 rounded-2xl object-cover" />
                  </Link>
                ) : (
                  <Link
                    href={profileHref}
                    aria-label={`Open profile: ${displayName}`}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.055] text-white/50 transition-[border-color,background-color,color] hover:border-white/18 hover:bg-white/[0.08] hover:text-white/72 focus:outline-none focus:ring-2 focus:ring-white/15"
                  >
                    <Icon name="user" className="h-5 w-5" />
                  </Link>
                )}
                <div className="min-w-0">
                  <Link
                    href={profileHref}
                    className="block truncate text-sm font-semibold text-white/90 transition-colors hover:text-white hover:underline focus:outline-none focus:ring-2 focus:ring-white/15"
                  >
                    {displayName}
                  </Link>
                  <p className="truncate text-xs text-white/48">@{username}</p>
                </div>
              </div>
              {creatorRole ? <p className="mt-4 text-sm leading-relaxed text-white/68">{creatorRole}</p> : null}
              {profile.location ? <p className="mt-2 text-sm text-white/48">{profile.location}</p> : null}
              <div className="mt-3">
                <RatingDisplay />
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <h2 className="text-sm font-semibold text-white/90">Project facts</h2>
              <div className="mt-2">
                <FactRow label="Source" value={source} />
                <FactRow label="Channel" value={sourceName} />
                <FactRow label="Timeline" value={timeline || publishedDate} />
                <FactRow label="Role" value={role} />
                {owner ? <FactRow label="Visibility" value={project.visibility || (project.is_public ? "Public" : "Private")} /> : null}
                <FactRow label="Verified" value={project.verification_status === "youtube_metadata_verified" ? "Metadata verified" : null} />
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}
