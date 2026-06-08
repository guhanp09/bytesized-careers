"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendPortfolioItem,
  BackendPortfolioLinkPreviewResponse,
  BackendPortfolioYouTubePreviewResponse,
  BackendHiringIdentity,
  BackendHiringPrimaryPlatform,
  BackendHiringType,
  BackendProfileExperienceItem,
  BackendProfileUpdatePayload,
  BackendProfileResponse,
  BackendRole,
  createMyPortfolioItem,
  deleteMyPortfolioItem,
  exchangeGoogleOAuthForBackend,
  getMyContentStyle,
  getMyProfileCompletion,
  getMyProfile,
  getMyRoles,
  isBackendAuthError,
  listContentStyleNiches,
  listJobsWithMeta,
  listMyHiringIdentities,
  listMyPortfolio,
  listRoles,
  listMyYouTubeChannels,
  previewPortfolioLink,
  previewPortfolioYouTube,
  refreshMyYouTubeChannels,
  upsertMyContentStyle,
  upsertMyRoles,
  upsertGoogleOAuthForMe,
  uploadMyAvatar,
  updateMyPortfolioItem,
  updateMyProfile,
} from "../../lib/backendClient";
import { Job } from "../../lib/types";
import { Icon } from "../Icons";
import RatingDisplay from "../RatingDisplay";
import JobsEmptyState from "../jobs/JobsEmptyState";
import PlatformLogosRow, {
  type ConnectedPlatformAccount,
  type PlatformKey,
} from "../profile/PlatformLogosRow";
import ProfileExperienceEditor, { type ProfileExperienceDraft } from "../profile/ProfileExperienceEditor";
import ProfileExperienceList from "../profile/ProfileExperienceList";
import SocialIconRow from "../profile/SocialIconRow";
import { TagPill } from "../ui";
import PortfolioProjectWorkspace from "./PortfolioProjectWorkspace";
import AddWorkSampleChoiceModal, { type WorkSampleAction, type WorkSampleSourceType } from "./AddWorkSampleChoiceModal";
import ToolPicker, { formatToolString, parseToolString } from "./ToolPicker";
import { buildSocialIconLinks } from "../../lib/profileSocialLinks";
import { inferExperienceFromUrl, sortExperienceItems } from "../../lib/profileExperience";

type YouHubClientProps = {
  backendAccessToken?: string;
  mode?: "display" | "edit";
};

type OfflineProfileIdentity = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  accountType: BackendProfileResponse["account_type"];
  onboardingIntent: BackendProfileResponse["onboarding_intent"];
};

const offlineUsernameFrom = (value?: string | null) => {
  const fallback = "your_profile";
  if (!value) return fallback;
  const base = value.includes("@") ? value.split("@")[0] : value;
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
};

const isBackendUnavailableError = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes("Could not reach backend") ||
    error.message.includes("Failed to fetch") ||
    error.message.includes("fetch failed") ||
    error.message.includes("Network request failed"));

const buildOfflineProfile = (identity: OfflineProfileIdentity): BackendProfileResponse => ({
  id: identity.id,
  email: identity.email,
  account_type: identity.accountType,
  account_type_selected_at: null,
  onboarding_intent: identity.onboardingIntent,
  onboarding_intent_selected_at: null,
  username: identity.username,
  username_change_count: 0,
  username_last_changed_at: null,
  display_name: identity.displayName,
  headline: null,
  skills: [],
  public_links: [],
  experience: [],
  availability_status: "selective",
  location: null,
  timezone: null,
  avatar_mode: "generic",
  avatar_url: null,
  avatar_youtube_channel_id: null,
  social_connections: {
    youtube: { connected: false },
    instagram: { connected: false },
  },
  stats: {
    jobs_posted_count: 0,
    jobs_completed_count: 0,
    projects_count: 0,
    reviews_count: 0,
  },
  reviews: {
    avg_rating: 0,
    review_count: 0,
  },
  collaboration_preferences: {},
  hiring_info: {
    verification_status: "unverified",
  },
  roles: [],
  role_answers_summary: [],
  content_style: {
    format: [],
    tone: [],
  },
  privacy_settings: {
    show_links: true,
    show_skills: true,
    show_location: true,
    show_availability: true,
    show_youtube_badge: true,
  },
  profile_capabilities: {
    canApplyToJobs: false,
    canPostJobs: true,
    hasPortfolio: false,
    hasPublicProfile: Boolean(identity.username),
    hasHiringIdentity: false,
    hasVerifiedSocialOrChannel: false,
    isAdmin: identity.accountType === "ADMIN",
    applyMissingSections: [],
    postMissingSections: [],
    missingHiringFields: [],
  },
  can_change_username: true,
  username_next_change_at: null,
});

type TopTab = "overview" | "jobs" | "portfolio" | "applications" | "saved";
type OwnerProfileViewMode = "talent" | "hiring";
type PortfolioSubTab = "now" | "past";
type PortfolioLaunchSource = NonNullable<BackendPortfolioItem["source_type"]>;
type PortfolioLaunchRequest = {
  shouldFetchYouTube?: boolean;
  sourceType: PortfolioLaunchSource;
  sourceKind?: WorkSampleAction["sourceKind"];
  sourceUrl?: string;
  suggestedTitle?: string;
  linkPreview?: BackendPortfolioLinkPreviewResponse;
  previewError?: string;
};
type InlineField =
  | "display_name"
  | "headline"
  | "skills"
  | "location_timezone"
  | "preferences";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type CompletionKey =
  | "roles"
  | "content_style"
  | "channels"
  | "working_hours"
  | "portfolio"
  | "portfolio_ingest";

type ContentStyleDraft = {
  primary_niche: string;
  format: string[];
  tone: string[];
  target_audience: string;
};

const ALL_TABS: TopTab[] = ["overview", "jobs", "portfolio", "applications", "saved"];
const PAST_JOB_STATUSES = new Set(["archived", "closed", "filled", "expired"]);
const PROJECT_TYPE_LABELS: Record<"oneOff" | "retainer" | "either", string> = {
  oneOff: "One-off",
  retainer: "Retainer",
  either: "Either",
};
const CONTENT_STYLE_FORMAT_OPTIONS = ["Shorts", "Long-form", "Podcast", "Hybrid"] as const;
const CONTENT_STYLE_TONE_OPTIONS = [
  "Educational",
  "Entertaining",
  "Analytical",
  "Conversational",
  "Cinematic",
  "Practical",
] as const;
const PORTFOLIO_SOURCE_OPTIONS = ["youtube", "custom", "drive", "behance", "instagram", "vimeo", "other"] as const;
const HIRING_TYPE_OPTIONS: Array<{ value: BackendHiringType; label: string }> = [
  { value: "individual creator", label: "Individual content creator" },
  { value: "creator agency", label: "Content creator agency" },
  { value: "influencer marketing agency", label: "Influencer marketing agency" },
  { value: "social media agency", label: "Social media agency" },
  { value: "brand", label: "Brand" },
  { value: "production house", label: "Production house" },
  { value: "other", label: "Other" },
];
const HIRING_PRIMARY_PLATFORM_OPTIONS: BackendHiringPrimaryPlatform[] = [
  "YouTube",
  "Instagram",
  "Both",
];
type WorkingHoursMode = "flexible" | "fixed";
const DEFAULT_WORKING_HOURS_START = "09:00";
const DEFAULT_WORKING_HOURS_END = "18:00";
const DEFAULT_WORKING_HOURS_TIMEZONE = "IST";
const FLEXIBLE_WORKING_HOURS_LABEL = "Flexible working hours";

const createEmptyExperienceForm = (): ProfileExperienceDraft => ({
  id: "",
  role: "",
  organization_name: "",
  organization_url: "",
  organization_logo_url: "",
  organization_links: [],
  organization_link_input: "",
  platform: "",
  work_type: "Freelance",
  work_mode: "Remote",
  start_month: "",
  start_year: "",
  end_month: "",
  end_year: "",
  is_current: false,
  description: "",
  tools: [],
  tool_input_value: "",
});

const experienceFormFromItem = (item: BackendProfileExperienceItem): ProfileExperienceDraft => ({
  id: item.id,
  role: item.role || "",
  organization_name: item.organization_name || "",
  organization_url: item.organization_url || "",
  organization_logo_url: item.organization_logo_url || "",
  organization_links: (item.organization_links || [])
    .map((link) => ({
      id: link.id || `link-${Date.now().toString(36)}`,
      url: link.url || "",
      platform: link.platform || "",
      resolved_name: link.resolved_name || "",
      logo_url: link.logo_url || "",
    }))
    .filter((link) => link.url),
  organization_link_input: "",
  platform: item.platform || "",
  work_type: item.work_type || "Freelance",
  work_mode: item.work_mode || "Remote",
  start_month: item.start_month || "",
  start_year: item.start_year || "",
  end_month: item.end_month || "",
  end_year: item.end_year || "",
  is_current: Boolean(item.is_current),
  description: item.description || "",
  tools: (item.tools || []).map((tool) => tool.trim()).filter(Boolean),
  tool_input_value: "",
});

const experienceItemFromForm = (draft: ProfileExperienceDraft): BackendProfileExperienceItem => {
  const inferred = inferExperienceFromUrl(draft.organization_url);
  return {
    id: draft.id || `exp-${Date.now().toString(36)}`,
    role: draft.role.trim(),
    organization_name:
      draft.organization_name.trim() || inferred.suggestedOrganizationName || "Creator team",
    organization_url: draft.organization_url.trim() || null,
    organization_logo_url: draft.organization_logo_url.trim() || null,
    organization_links: draft.organization_links
      .map((link) => ({
        id: link.id,
        url: link.url.trim(),
        platform: link.platform || null,
        resolved_name: link.resolved_name || null,
        logo_url: link.logo_url || null,
      }))
      .filter((link) => link.url),
    platform: draft.platform || inferred.platform || null,
    work_type: draft.work_type || "Freelance",
    work_mode: draft.work_mode || "Remote",
    start_month: draft.start_month || null,
    start_year: draft.start_year.trim() || null,
    end_month: draft.is_current ? null : draft.end_month || null,
    end_year: draft.is_current ? null : draft.end_year.trim() || null,
    is_current: draft.is_current,
    description: draft.description.trim() || null,
    tools: draft.tools,
  };
};

const parseWorkingHours = (
  value?: string | null,
  fallbackTimezone?: string | null
): { mode: WorkingHoursMode; start: string; end: string; timezone: string } => {
  const timezone = fallbackTimezone?.trim() || DEFAULT_WORKING_HOURS_TIMEZONE;
  const text = value?.trim();
  if (!text || /flexible/i.test(text)) {
    return {
      mode: "flexible",
      start: DEFAULT_WORKING_HOURS_START,
      end: DEFAULT_WORKING_HOURS_END,
      timezone,
    };
  }

  const match = text.match(/(\d{2}:\d{2})\s*(?:to|-|–)\s*(\d{2}:\d{2})(?:\s+(.+))?/i);
  if (!match) {
    return {
      mode: "flexible",
      start: DEFAULT_WORKING_HOURS_START,
      end: DEFAULT_WORKING_HOURS_END,
      timezone,
    };
  }

  return {
    mode: "fixed",
    start: match[1],
    end: match[2],
    timezone: match[3]?.trim() || timezone,
  };
};

const formatWorkingHours = ({
  mode,
  start,
  end,
  timezone,
}: {
  mode: WorkingHoursMode;
  start: string;
  end: string;
  timezone: string;
}) => (mode === "flexible" ? FLEXIBLE_WORKING_HOURS_LABEL : `${start} to ${end} ${timezone.trim() || DEFAULT_WORKING_HOURS_TIMEZONE}`);

const PORTFOLIO_TOOL_OPTIONS = [
  "Premiere Pro",
  "After Effects",
  "DaVinci Resolve",
  "Final Cut Pro",
  "CapCut",
  "Photoshop",
  "Figma",
  "Canva",
  "Notion",
  "Google Docs",
] as const;
const DEFAULT_CONTRIBUTION_OPTIONS = [
  "Hook",
  "Research",
  "Packaging",
  "Full edit",
  "Captions",
  "Motion graphics",
] as const;
const ROLE_CONTRIBUTION_OPTIONS: Record<string, readonly string[]> = {
  "video editor": ["Hook", "Pacing", "Captions", "Sound cleanup", "Motion graphics", "Full edit"],
  "thumbnail designer": ["Concept", "Final thumbnail", "A/B variants", "Title packaging"],
  scriptwriter: ["Hook", "Outline", "Full script", "Research notes", "CTA"],
  researcher: ["Topic research", "Source notes", "Fact checks", "Outline"],
  "channel manager": ["Upload workflow", "Metadata", "Scheduling", "Analytics review"],
  "motion graphics designer": ["Motion graphics", "Lower thirds", "Transitions", "Visual systems"],
  "voice over artist": ["Voice over", "Audio cleanup", "Retakes", "Delivery"],
};

const sourceLabel = (source?: string | null, previewSource?: unknown) => {
  const preview = typeof previewSource === "string" ? previewSource.toLowerCase() : "";
  if (preview === "google_docs") return "Google Docs";
  if (preview === "notion") return "Notion";
  if (preview === "figma") return "Figma";
  if (preview === "canva") return "Canva";
  const normalized = (source || "custom").toLowerCase();
  if (normalized === "youtube") return "YouTube";
  if (normalized === "drive") return "Google Drive";
  if (normalized === "behance") return "Behance";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "website") return "Custom URL";
  if (normalized === "custom") return "Custom URL";
  if (normalized === "vimeo") return "Vimeo";
  if (normalized === "other") return "Custom URL";
  return "Custom URL";
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

const contributionOptionsForRole = (roleName: string) => {
  const normalized = roleName.trim().toLowerCase();
  return ROLE_CONTRIBUTION_OPTIONS[normalized] || DEFAULT_CONTRIBUTION_OPTIONS;
};

function ProfileNavButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group relative h-12 whitespace-nowrap px-2 text-left transition-colors cursor-pointer",
        active ? "text-white" : "text-white/58 hover:text-white/82",
      ].join(" ")}
    >
      <span className="block pt-3 text-[15px] font-semibold leading-none">{label}</span>
      <span
        className={[
          "absolute inset-x-2 bottom-0 h-[2.5px] rounded-full transition-colors",
          active ? "bg-white" : "bg-white/0 group-hover:bg-white/20",
        ].join(" ")}
      />
    </button>
  );
}

function SubTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer",
        active
          ? "bg-white text-black border-white"
          : "bg-white/[0.04] border-white/10 text-white/65 hover:bg-white/[0.08] hover:text-white",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function OwnerProfileInfoSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="border-b border-white/[0.08] py-7 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold tracking-tight text-white/92">{title}</h3>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function OwnerProfileInfoRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
}) {
  const content = children ?? value ?? "–";
  return (
    <div className="grid gap-1.5 py-2 text-sm sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-white/42">{label}</dt>
      <dd className="min-w-0 text-white/78">{content}</dd>
    </div>
  );
}

function OwnerOverviewSideSection({
  title,
  count,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  count: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="border-t border-white/10 py-5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
          <p className="mt-1 text-xs text-white/45">{count}</p>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children ? <div className="mt-4 space-y-3">{children}</div> : null}
    </section>
  );
}

const cleanOwnerText = (value?: string | null) => {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["not shared", "not set", "creator-economy profile"].includes(normalized)) {
    return null;
  }
  return text;
};

const formatOwnerTextValue = (value?: string | null) => cleanOwnerText(value) || "–";

const formatOwnerListValue = (values?: (string | null | undefined)[]) => {
  const cleaned = (values || []).map((value) => cleanOwnerText(value)).filter((item): item is string => Boolean(item));
  return cleaned.length ? cleaned.join(", ") : "–";
};

const formatOwnerHiringType = (value?: string | null) => {
  const text = cleanOwnerText(value);
  if (!text) return "–";
  return text
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatOwnerProjectType = (value?: string | null) => {
  if (value === "oneOff" || value === "retainer" || value === "either") {
    return PROJECT_TYPE_LABELS[value];
  }
  return formatOwnerTextValue(value);
};

const formatOwnerCountLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

function SaveIconButton({
  onClick,
  ariaLabel,
  disabled,
  saving = false,
  className = "",
}: {
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  saving?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        "inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 disabled:cursor-not-allowed disabled:opacity-55",
        disabled
          ? "bg-white/20 text-white/45"
          : "cursor-pointer bg-white text-black hover:bg-white/90",
        className,
      ].join(" ")}
    >
      <Icon name={saving ? "clock" : "check"} className="h-4 w-4" />
    </button>
  );
}

function GenericAvatar() {
  return (
    <div className="h-full w-full inline-flex items-center justify-center">
      <Icon name="user" className="h-7 w-7 text-white/70" />
    </div>
  );
}

const parseListInput = (value: string) =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeList = (items: string[] | null | undefined) =>
  (items || []).map((item) => item.trim()).filter(Boolean);

const areListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read selected image."));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read selected image."));
    reader.readAsDataURL(file);
  });

type EditorSectionId = "basics" | "experience" | "roles" | "channels" | "preferences" | "visibility";

const EDITOR_SECTIONS: Array<{ id: EditorSectionId; label: string }> = [
  { id: "basics", label: "Basics" },
  { id: "experience", label: "Experience" },
  { id: "roles", label: "Roles & content" },
  { id: "channels", label: "Channels & trust" },
  { id: "preferences", label: "Collaboration" },
  { id: "visibility", label: "Visibility" },
];

export default function YouHubClient({ backendAccessToken, mode = "display" }: YouHubClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const autoConnectHandledRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const profileLoadedRef = useRef(false);
  const tokenRecoveryPromiseRef = useRef<Promise<string | null> | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditMode = mode === "edit";
  const tabParam = (searchParams.get("tab") || "overview").toLowerCase();
  const previewParam = searchParams.get("preview") === "1";
  const connectParam = searchParams.get("yt_connect");
  const sectionParam = searchParams.get("section");
  const activeTab: TopTab = isEditMode
    ? "overview"
    : ALL_TABS.includes(tabParam as TopTab)
    ? (tabParam as TopTab)
    : "overview";
  const showLegacyPortfolioEditor = false;

  const [portfolioSubTab, setPortfolioSubTab] = useState<PortfolioSubTab>("now");
  const [ownerProfileMode, setOwnerProfileMode] = useState<OwnerProfileViewMode>("talent");
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recoveringBackendToken, setRecoveringBackendToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendPersistenceUnavailable, setBackendPersistenceUnavailable] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [portfolioSaving, setPortfolioSaving] = useState(false);
  const [portfolioLaunchRequest, setPortfolioLaunchRequest] = useState<PortfolioLaunchRequest | null>(null);
  const [hiringSaving, setHiringSaving] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarUploadPreviewUrl, setAvatarUploadPreviewUrl] = useState<string | null>(null);
  const [activeEditorSection, setActiveEditorSection] = useState<EditorSectionId>("basics");
  const [workSampleChooserOpen, setWorkSampleChooserOpen] = useState(false);
  const [setupWidgetOpen, setSetupWidgetOpen] = useState(false);

  const [profile, setProfile] = useState<BackendProfileResponse | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [portfolio, setPortfolio] = useState<BackendPortfolioItem[]>([]);
  const [channelOptions, setChannelOptions] = useState<
    Array<{ channel_id: string; title: string; thumbnail_url?: string | null }>
  >([]);
  const [hiringIdentities, setHiringIdentities] = useState<BackendHiringIdentity[]>([]);
  const [resolvedBackendAccessToken, setResolvedBackendAccessToken] = useState<string | undefined>(
    backendAccessToken
  );

  const [inlineSavingField, setInlineSavingField] = useState<InlineField | null>(null);

  const [draftDisplayName, setDraftDisplayName] = useState("");
  const [draftHeadline, setDraftHeadline] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [experienceDraft, setExperienceDraft] = useState<BackendProfileExperienceItem[]>([]);
  const [experienceForm, setExperienceForm] = useState<ProfileExperienceDraft>(() => createEmptyExperienceForm());
  const [editingExperienceId, setEditingExperienceId] = useState<string | null>(null);
  const [experienceEditorOpen, setExperienceEditorOpen] = useState(isEditMode);
  const [experienceSaving, setExperienceSaving] = useState(false);
  const [experienceCreateFocusNonce, setExperienceCreateFocusNonce] = useState(0);
  const experienceCreateEditorRef = useRef<HTMLDivElement | null>(null);
  const [draftLocation, setDraftLocation] = useState("");
  const [workingHoursMode, setWorkingHoursMode] = useState<WorkingHoursMode>("flexible");
  const [workingHoursStart, setWorkingHoursStart] = useState(DEFAULT_WORKING_HOURS_START);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(DEFAULT_WORKING_HOURS_END);
  const [workingHoursTimezone, setWorkingHoursTimezone] = useState(DEFAULT_WORKING_HOURS_TIMEZONE);
  const [draftPreferenceProjectType, setDraftPreferenceProjectType] = useState<
    "oneOff" | "retainer" | "either" | ""
  >("");
  const [draftPreferenceTurnaround, setDraftPreferenceTurnaround] = useState("");
  const [draftPreferenceRevisions, setDraftPreferenceRevisions] = useState("");
  const [draftHiringType, setDraftHiringType] = useState<BackendHiringType | "">("");
  const [draftHiringWebsiteOrSocialUrl, setDraftHiringWebsiteOrSocialUrl] = useState("");
  const [draftHiringPrimaryPlatform, setDraftHiringPrimaryPlatform] =
    useState<BackendHiringPrimaryPlatform | "">("");
  const [draftHiringChannelsOrPagesManaged, setDraftHiringChannelsOrPagesManaged] = useState("");
  const [avatarMode, setAvatarMode] = useState<"generic" | "youtube_channel">("generic");
  const [avatarChannelId, setAvatarChannelId] = useState("");

  const [editingPortfolioId, setEditingPortfolioId] = useState<string | null>(null);
  const [portfolioSourceType, setPortfolioSourceType] = useState<
    "youtube" | "custom" | "website" | "drive" | "behance" | "instagram" | "vimeo" | "other"
  >("custom");
  const [portfolioTitle, setPortfolioTitle] = useState("");
  const [portfolioRole, setPortfolioRole] = useState("");
  const [portfolioContributionSummary, setPortfolioContributionSummary] = useState("");
  const [portfolioMediaUrl, setPortfolioMediaUrl] = useState("");
  const [portfolioThumbnailUrl, setPortfolioThumbnailUrl] = useState("");
  const [portfolioManualViews, setPortfolioManualViews] = useState("");
  const [portfolioCustomRetentionPercent, setPortfolioCustomRetentionPercent] = useState("");
  const [portfolioCtrPercent, setPortfolioCtrPercent] = useState("");
  const [portfolioTurnaroundDays, setPortfolioTurnaroundDays] = useState("");
  const [portfolioMetricNotes, setPortfolioMetricNotes] = useState("");
  const [portfolioLinks, setPortfolioLinks] = useState("");
  const [portfolioTags, setPortfolioTags] = useState("");
  const [portfolioContributionTags, setPortfolioContributionTags] = useState<string[]>([]);
  const [portfolioTools, setPortfolioTools] = useState("");
  const [portfolioStatus, setPortfolioStatus] = useState<"now" | "past">("now");
  const [portfolioIsPublic, setPortfolioIsPublic] = useState(true);
  const [portfolioIsFeatured, setPortfolioIsFeatured] = useState(false);
  const [rolesCatalog, setRolesCatalog] = useState<BackendRole[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState("");
  const [rolesSaving, setRolesSaving] = useState(false);
  const [contentStyleDraft, setContentStyleDraft] = useState<ContentStyleDraft>({
    primary_niche: "",
    format: [],
    tone: [],
    target_audience: "",
  });
  const [contentStyleSaving, setContentStyleSaving] = useState(false);
  const [contentStyleNiches, setContentStyleNiches] = useState<string[]>([]);
  const [completionMissingSections, setCompletionMissingSections] = useState<string[]>([]);
  const [portfolioYouTubeUrl, setPortfolioYouTubeUrl] = useState("");
  const [portfolioYouTubePreview, setPortfolioYouTubePreview] =
    useState<BackendPortfolioYouTubePreviewResponse | null>(null);
  const [portfolioRetentionPercent, setPortfolioRetentionPercent] = useState("");
  const [portfolioRoleInProject, setPortfolioRoleInProject] = useState("");
  const [portfolioYouTubeContributionSummary, setPortfolioYouTubeContributionSummary] = useState("");
  const [portfolioYouTubeContributionTags, setPortfolioYouTubeContributionTags] = useState<string[]>([]);
  const [portfolioYouTubeTools, setPortfolioYouTubeTools] = useState("");
  const [portfolioYouTubeStatus, setPortfolioYouTubeStatus] = useState<"now" | "past">("past");
  const [portfolioYouTubeIsPublic, setPortfolioYouTubeIsPublic] = useState(true);
  const [portfolioYouTubeIsFeatured, setPortfolioYouTubeIsFeatured] = useState(false);
  const [portfolioYouTubeSaving, setPortfolioYouTubeSaving] = useState(false);
  const [portfolioYouTubeFetching, setPortfolioYouTubeFetching] = useState(false);
  const [portfolioSuccess, setPortfolioSuccess] = useState<string | null>(null);
  const [portfolioFilterSource, setPortfolioFilterSource] = useState<string>("all");
  const [portfolioFilterRole, setPortfolioFilterRole] = useState("");
  const backendToken = resolvedBackendAccessToken || backendAccessToken;
  const oauthProviderAccountId = session?.user?.providerAccountId;
  const oauthAccessToken = session?.user?.accessToken;
  const oauthRefreshToken = session?.user?.refreshToken;
  const oauthExpiresAt = session?.user?.oauthExpiresAt;
  const oauthScope = session?.user?.oauthScope;
  const oauthEmail =
    session?.user?.email ||
    (typeof session?.user?.profile?.email === "string" ? session.user.profile.email : undefined);
  const offlineProfileIdentity = useMemo<OfflineProfileIdentity>(() => {
    const email = session?.user?.email || "local@creatorjobs.dev";
    const username = offlineUsernameFrom(session?.user?.username || email);
    const displayName =
      session?.user?.name ||
      session?.user?.username ||
      username
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") ||
      "CreatorJobs user";

    return {
      id:
        session?.backendUserId ||
        session?.user?.backendUserId ||
        session?.user?.userId ||
        "offline-profile",
      email,
      username,
      displayName,
      accountType: (session?.user?.accountType || "BOTH") as BackendProfileResponse["account_type"],
      onboardingIntent: (session?.user?.onboardingIntent ||
        "DECIDE_LATER") as BackendProfileResponse["onboarding_intent"],
    };
  }, [
    session?.backendUserId,
    session?.user?.accountType,
    session?.user?.backendUserId,
    session?.user?.email,
    session?.user?.name,
    session?.user?.onboardingIntent,
    session?.user?.userId,
    session?.user?.username,
  ]);

  const setTab = useCallback(
    (nextTab: TopTab) => {
      const query = new URLSearchParams(searchParams.toString());
      query.set("tab", nextTab);
      query.delete("section");
      query.delete("returnTo");
      router.replace(`/you?${query.toString()}`);
    },
    [router, searchParams]
  );

  const hydrateFromProfile = useCallback((data: BackendProfileResponse) => {
    setDraftDisplayName(data.display_name || "");
    setDraftHeadline(data.headline || "");
    setExperienceDraft(data.experience || []);
    setExperienceForm(createEmptyExperienceForm());
    setEditingExperienceId(null);
    setExperienceEditorOpen(isEditMode);
    setSelectedTools(
      parseToolString(data.collaboration_preferences?.tools).length
        ? parseToolString(data.collaboration_preferences?.tools)
        : normalizeList(data.skills)
    );
    setDraftLocation(data.location || "");
    const parsedWorkingHours = parseWorkingHours(data.collaboration_preferences?.working_hours, data.timezone);
    setWorkingHoursMode(parsedWorkingHours.mode);
    setWorkingHoursStart(parsedWorkingHours.start);
    setWorkingHoursEnd(parsedWorkingHours.end);
    setWorkingHoursTimezone(parsedWorkingHours.timezone);
    setDraftPreferenceProjectType(data.collaboration_preferences?.project_type_preference || "");
    setDraftPreferenceTurnaround(data.collaboration_preferences?.turnaround || "");
    setDraftPreferenceRevisions(data.collaboration_preferences?.revisions || "");
    setDraftHiringType(data.hiring_info?.hiring_type || "");
    setDraftHiringWebsiteOrSocialUrl(data.hiring_info?.website_or_social_url || "");
    setDraftHiringPrimaryPlatform(data.hiring_info?.primary_platform || "");
    setDraftHiringChannelsOrPagesManaged(data.hiring_info?.channels_or_pages_managed || "");
    setAvatarMode(data.avatar_mode || "generic");
    setAvatarChannelId(data.avatar_youtube_channel_id || "");
  }, [isEditMode]);

  useEffect(() => {
    if (backendAccessToken) {
      setResolvedBackendAccessToken(backendAccessToken);
    }
  }, [backendAccessToken]);

  const exchangeBackendTokenFromOAuth = useCallback(async (): Promise<string | null> => {
    if (tokenRecoveryPromiseRef.current) {
      return tokenRecoveryPromiseRef.current;
    }
    if (sessionStatus !== "authenticated" || !oauthEmail || !oauthProviderAccountId) {
      return null;
    }

    const recoveryPromise = (async () => {
      setRecoveringBackendToken(true);
      try {
        const result = await exchangeGoogleOAuthForBackend({
          email: oauthEmail,
          provider_account_id: oauthProviderAccountId,
          display_name: session?.user?.name || undefined,
          access_token: oauthAccessToken || null,
          refresh_token: oauthRefreshToken || null,
          expires_at: typeof oauthExpiresAt === "number" ? oauthExpiresAt : null,
          scope: typeof oauthScope === "string" ? oauthScope : null,
        });
        const nextToken = result.access_token?.trim();
        if (!nextToken) {
          return null;
        }
        setResolvedBackendAccessToken(nextToken);
        setError(null);
        return nextToken;
      } catch {
        return null;
      } finally {
        setRecoveringBackendToken(false);
        tokenRecoveryPromiseRef.current = null;
      }
    })();

    tokenRecoveryPromiseRef.current = recoveryPromise;
    return recoveryPromise;
  }, [
    oauthAccessToken,
    oauthEmail,
    oauthExpiresAt,
    oauthProviderAccountId,
    oauthRefreshToken,
    oauthScope,
    session?.user?.name,
    sessionStatus,
  ]);

  const withFreshBackendToken = useCallback(
    async <T,>(request: (token: string) => Promise<T>): Promise<T> => {
      let token: string | null | undefined = backendToken;
      if (!token) {
        token = await exchangeBackendTokenFromOAuth();
      }
      if (!token) {
        throw new Error(
          "Persistent backend storage is unavailable. Start the backend and sign in again before saving profile or project changes."
        );
      }

      try {
        return await request(token);
      } catch (err) {
        if (!isBackendAuthError(err)) {
          throw err;
        }
        const recoveredToken = await exchangeBackendTokenFromOAuth();
        if (!recoveredToken) {
          throw err;
        }
        return await request(recoveredToken);
      }
    },
    [backendToken, exchangeBackendTokenFromOAuth]
  );

  const loadData = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    if (!backendToken && sessionStatus === "loading") {
      if (!recoveringBackendToken) {
        setLoading(true);
      }
      return;
    }

    setLoading(true);
    setError(null);
    setBackendPersistenceUnavailable(false);
    try {
      let myProfile: BackendProfileResponse | null = null;
      let profileError: unknown = null;
      let usingOfflineProfile = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          myProfile = await withFreshBackendToken((token) => getMyProfile(token));
          break;
        } catch (err) {
          profileError = err;
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        }
      }
      if (!myProfile) {
        if (isBackendUnavailableError(profileError)) {
          myProfile = buildOfflineProfile(offlineProfileIdentity);
          usingOfflineProfile = true;
          setBackendPersistenceUnavailable(true);
        } else {
          throw (profileError instanceof Error ? profileError : new Error("Failed to load profile."));
        }
      }

      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setProfile(myProfile);
      profileLoadedRef.current = true;
      hydrateFromProfile(myProfile);

      if (usingOfflineProfile) {
        setError(
          "Backend storage is offline. This profile shell is read-only; profile and project changes will not be saved until the backend is running."
        );
        setPortfolio([]);
        setChannelOptions([]);
        setHiringIdentities([]);
        setJobs([]);
        setRolesCatalog([]);
        setSelectedRoleIds([]);
        setContentStyleDraft({
          primary_niche: "",
          format: [],
          tone: [],
          target_audience: "",
        });
        setCompletionMissingSections([]);
        setContentStyleNiches([]);
        return;
      }

      const [
        myPortfolioResult,
        channelsResult,
        allJobsResult,
        roleCatalogResult,
        myRolesResult,
        myContentStyleResult,
        myCompletionResult,
        nicheOptionsResult,
        hiringIdentitiesResult,
      ] = await withFreshBackendToken((token) =>
        Promise.allSettled([
          listMyPortfolio(token),
          listMyYouTubeChannels(token),
          listJobsWithMeta({ limit: 100, offset: 0 }),
          listRoles(),
          getMyRoles(token),
          getMyContentStyle(token),
          getMyProfileCompletion(token),
          listContentStyleNiches(),
          listMyHiringIdentities(token),
        ] as const)
      );

      const portfolioItems =
        myPortfolioResult.status === "fulfilled" ? myPortfolioResult.value.items || [] : [];
      const channels =
        channelsResult.status === "fulfilled" ? channelsResult.value.channels || [] : [];
      const allJobs = allJobsResult.status === "fulfilled" ? allJobsResult.value.items || [] : [];
      const roleCatalogItems =
        roleCatalogResult.status === "fulfilled" ? roleCatalogResult.value.items || [] : [];
      const roleIdsFromEndpoint =
        myRolesResult.status === "fulfilled"
          ? (myRolesResult.value.items || []).map((item) => item.id)
          : [];
      const contentStyle =
        myContentStyleResult.status === "fulfilled"
          ? myContentStyleResult.value
          : myProfile.content_style;
      const identityItems =
        hiringIdentitiesResult.status === "fulfilled" ? hiringIdentitiesResult.value.items || [] : [];

      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setPortfolio(portfolioItems);
      setChannelOptions(channels);
      setHiringIdentities(identityItems);
      setJobs(allJobs.filter((job) => String(job.postedByUserId || "") === myProfile.id));
      setRolesCatalog(roleCatalogItems);
      const nextSelectedRoleIds = roleIdsFromEndpoint.length
        ? roleIdsFromEndpoint
        : (myProfile.roles || []).map((item) => item.id);
      setSelectedRoleIds(nextSelectedRoleIds);
      setContentStyleDraft({
        primary_niche: contentStyle?.primary_niche || "",
        format: contentStyle?.format || [],
        tone: contentStyle?.tone || [],
        target_audience: contentStyle?.target_audience || "",
      });
      if (myCompletionResult.status === "fulfilled") {
        setCompletionMissingSections(myCompletionResult.value.missing_required_sections || []);
      }
      if (nicheOptionsResult.status === "fulfilled") {
        setContentStyleNiches(nicheOptionsResult.value.items || []);
      }
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      if (isBackendAuthError(err) && profileLoadedRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load account data.");
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    backendToken,
    hydrateFromProfile,
    offlineProfileIdentity,
    recoveringBackendToken,
    sessionStatus,
    withFreshBackendToken,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const refreshProfileCompletion = useCallback(async () => {
    try {
      const completion = await withFreshBackendToken((token) => getMyProfileCompletion(token));
      setCompletionMissingSections(completion.missing_required_sections || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh profile completion.");
    }
  }, [withFreshBackendToken]);

  useEffect(() => {
    if (previewParam) setPreviewDismissed(false);
  }, [previewParam]);

  useEffect(() => {
    if (loading || sectionParam !== "hiring-info") return;
    if (activeTab !== "overview") return;
    requestAnimationFrame(() => {
      const target = document.getElementById("hiring-info-section");
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstInput = target.querySelector<HTMLElement>("[data-hiring-first-field]");
      firstInput?.focus({ preventScroll: true });
    });
  }, [activeTab, loading, sectionParam]);

  const scrollToEditorSection = useCallback((sectionId: EditorSectionId) => {
    setActiveEditorSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!isEditMode || loading) return;
    const sectionNodes = EDITOR_SECTIONS.map(({ id }) => document.getElementById(id)).filter(
      (node): node is HTMLElement => Boolean(node)
    );
    if (!sectionNodes.length) return;

    let animationFrame: number | null = null;

    const updateActiveSection = () => {
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight;
      if (scrollBottom >= pageBottom - 80) {
        setActiveEditorSection("visibility");
        return;
      }

      const targetY = window.innerHeight * 0.36;
      const visibleSections = sectionNodes
        .map((node) => ({ id: node.id as EditorSectionId, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom >= 80 && rect.top <= window.innerHeight - 80);

      const candidates = visibleSections.length
        ? visibleSections
        : sectionNodes.map((node) => ({
            id: node.id as EditorSectionId,
            rect: node.getBoundingClientRect(),
          }));

      const nextSection = candidates
        .map((section) => ({
          id: section.id,
          distance: Math.abs(section.rect.top - targetY),
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.id;

      if (nextSection) {
        setActiveEditorSection(nextSection);
      }
    };

    const onScroll = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateActiveSection();
      });
    };

    updateActiveSection();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [isEditMode, loading]);

  useEffect(() => {
    if (!avatarMenuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!avatarMenuRef.current) return;
      if (!avatarMenuRef.current.contains(event.target as Node)) {
        setAvatarMenuOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAvatarMenuOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [avatarMenuOpen]);

  useEffect(() => {
    return () => {
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
      }
    };
  }, []);

  const activeJobs = useMemo(
    () => jobs.filter((job) => !PAST_JOB_STATUSES.has(String(job.status || "").toLowerCase())),
    [jobs]
  );
  const nowPortfolio = useMemo(
    () => portfolio.filter((item) => (item.portfolio_status || item.status) === "now"),
    [portfolio]
  );
  const pastPortfolio = useMemo(
    () => portfolio.filter((item) => (item.portfolio_status || item.status) === "past"),
    [portfolio]
  );
  const filteredPortfolio = useMemo(() => {
    const baseItems = portfolioSubTab === "now" ? nowPortfolio : pastPortfolio;
    const roleNeedle = portfolioFilterRole.trim().toLowerCase();
    return baseItems.filter((item) => {
      const sourceMatches =
        portfolioFilterSource === "all" || (item.source_type || "custom") === portfolioFilterSource;
      const roleText = [item.role_name, item.role, item.user_role_in_project].filter(Boolean).join(" ").toLowerCase();
      const roleMatches = !roleNeedle || roleText.includes(roleNeedle);
      return sourceMatches && roleMatches;
    });
  }, [nowPortfolio, pastPortfolio, portfolioFilterRole, portfolioFilterSource, portfolioSubTab]);
  const featuredPortfolio = useMemo(() => portfolio.filter((item) => item.is_featured), [portfolio]);

  const completion = useMemo(() => {
    const missing = new Set(completionMissingSections);
    const hasConnectedChannelOrPage = Boolean(
      profile?.social_connections?.youtube?.connected ||
        channelOptions.length ||
        profile?.social_connections?.instagram?.connected ||
        profile?.social_connections?.instagram?.handle ||
        profile?.social_connections?.instagram?.url ||
        hiringIdentities.some((identity) => identity.display_name || identity.handle || identity.url)
    );
    const hasWorkingHours = Boolean(profile?.collaboration_preferences?.working_hours);
    const checks: Array<{
      key: CompletionKey;
      done: boolean;
      title: string;
      prompt: string;
    }> = [
      {
        key: "roles",
        done: !missing.has("Select at least one role"),
        title: "Add role",
        prompt: "Choose your primary role so collaborators know your specialty.",
      },
      {
        key: "content_style",
        done: !missing.has("Complete content style"),
        title: "Add content style",
        prompt: "Define niche, format, tone, and audience.",
      },
      {
        key: "channels",
        done: hasConnectedChannelOrPage,
        title: "Connect channel/page",
        prompt: "Add a channel or page to strengthen profile trust.",
      },
      {
        key: "working_hours",
        done: hasWorkingHours,
        title: "Add working hours",
        prompt: "Share when collaborators can usually overlap with you.",
      },
      {
        key: "portfolio",
        done: !missing.has("Add at least one portfolio item"),
        title: "Create first work sample",
        prompt: "Add work hiring teams can review.",
      },
    ];
    const displayScore = checks.length
      ? Math.round((checks.filter((item) => item.done).length / checks.length) * 100)
      : 100;
    return {
      checks,
      displayScore,
    };
  }, [channelOptions.length, completionMissingSections, hiringIdentities, profile]);

  const primaryYouTubeChannel = useMemo(
    () => (channelOptions.length ? channelOptions[0] : null),
    [channelOptions]
  );
  const viewerUserId = session?.backendUserId || session?.user?.backendUserId || null;
  const profileUserId = profile?.id || null;
  const isOwnerView = viewerUserId && profileUserId ? viewerUserId === profileUserId : true;
  const connectedAccounts = useMemo<Record<PlatformKey, ConnectedPlatformAccount[]>>(() => {
    const youtubeAccounts: ConnectedPlatformAccount[] = [];
    const seenYoutube = new Set<string>();
    const registerYouTubeAccount = (account: ConnectedPlatformAccount) => {
      const key = account.id.trim().toLowerCase();
      if (!key || seenYoutube.has(key)) return;
      seenYoutube.add(key);
      youtubeAccounts.push(account);
    };

    for (const channel of channelOptions) {
      const channelId = channel.channel_id?.trim();
      if (!channelId) continue;
      registerYouTubeAccount({
        id: channelId,
        displayName: channel.title || "YouTube channel",
        url: `https://www.youtube.com/channel/${channelId}`,
      });
    }

    const socialYouTube = profile?.social_connections?.youtube;
    if (
      socialYouTube?.connected ||
      socialYouTube?.channel_title ||
      socialYouTube?.channel_handle ||
      socialYouTube?.channel_url
    ) {
      const socialId =
        socialYouTube?.channel_id?.trim() ||
        socialYouTube?.channel_url?.trim() ||
        "youtube-primary";
      const channelUrl =
        socialYouTube?.channel_url?.trim() ||
        (socialYouTube?.channel_id
          ? `https://www.youtube.com/channel/${socialYouTube.channel_id}`
          : undefined);

      registerYouTubeAccount({
        id: socialId,
        displayName: socialYouTube?.channel_title || "YouTube channel",
        handle: socialYouTube?.channel_handle || null,
        url: channelUrl,
      });
    }

    const instagramAccounts: ConnectedPlatformAccount[] = [];
    const socialInstagram = profile?.social_connections?.instagram;
    if (socialInstagram?.connected || socialInstagram?.handle || socialInstagram?.url) {
      const rawHandle = (socialInstagram.handle || "").trim();
      const normalizedHandle = rawHandle ? `@${rawHandle.replace(/^@+/, "")}` : null;
      const profileUrl =
        socialInstagram.url?.trim() ||
        (rawHandle ? `https://www.instagram.com/${rawHandle.replace(/^@+/, "")}` : undefined);

      instagramAccounts.push({
        id: rawHandle.replace(/^@+/, "").toLowerCase() || profileUrl || "instagram-primary",
        displayName: normalizedHandle || "Instagram",
        handle: normalizedHandle,
        url: profileUrl,
      });
    }

    return {
      youtube: youtubeAccounts,
      instagram: instagramAccounts,
    };
  }, [channelOptions, profile]);
  const selectedRoles = useMemo(
    () => rolesCatalog.filter((role) => selectedRoleIds.includes(role.id)),
    [rolesCatalog, selectedRoleIds]
  );
  const hasContentStyleData = Boolean(
    contentStyleDraft.primary_niche.trim() ||
      contentStyleDraft.format.length ||
      contentStyleDraft.tone.length ||
      contentStyleDraft.target_audience.trim()
  );
  const hasConnectedAccountData = Boolean(
    connectedAccounts.youtube.length || connectedAccounts.instagram.length
  );
  const ownerSocialIconLinks = buildSocialIconLinks({
    socialConnections: profile?.social_connections,
    publicLinks: profile?.public_links,
    websiteOrSocialUrl: profile?.hiring_info?.website_or_social_url,
  });
  const filteredRoleSuggestions = useMemo(() => {
    const search = roleSearch.trim().toLowerCase();
    if (!search) return rolesCatalog;
    return rolesCatalog.filter((role) =>
      [role.name, role.category, role.description || ""].join(" ").toLowerCase().includes(search)
    );
  }, [roleSearch, rolesCatalog]);

  const startYouTubeConnectFlow = useCallback(async () => {
    if (sessionStatus !== "authenticated") {
      await signIn("google", {
        callbackUrl: "/you?yt_connect=1",
        prompt: "select_account",
      });
      return;
    }

    if (!oauthProviderAccountId || !oauthAccessToken) {
      await signIn("google", {
        callbackUrl: "/you?yt_connect=1",
        prompt: "consent",
      });
      return;
    }

    setError(null);
    try {
      const refreshed = await withFreshBackendToken(async (token) => {
        await upsertGoogleOAuthForMe(token, {
          provider_account_id: oauthProviderAccountId,
          access_token: oauthAccessToken,
          refresh_token: oauthRefreshToken || null,
          expires_at: typeof oauthExpiresAt === "number" ? oauthExpiresAt : null,
          scope: typeof oauthScope === "string" ? oauthScope : null,
        });
        return refreshMyYouTubeChannels(token);
      });
      setChannelOptions(refreshed.channels || []);
      if (!refreshed.channels?.length) {
        setError("No YouTube channels were returned for this Google account.");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to refresh YouTube channels.";
      if (errorMessage.includes("youtube_reauth_required")) {
        await signIn("google", {
          callbackUrl: "/you?yt_connect=1",
          prompt: "consent",
        });
        return;
      }
      setError(errorMessage);
    }
  }, [
    oauthAccessToken,
    oauthExpiresAt,
    oauthProviderAccountId,
    oauthRefreshToken,
    oauthScope,
    sessionStatus,
    withFreshBackendToken,
  ]);

  const connectPlatformAccount = useCallback(
    async (platformKey: PlatformKey) => {
      if (platformKey === "youtube") {
        await startYouTubeConnectFlow();
        return;
      }
      setError("Instagram connection is not configured in this environment.");
    },
    [startYouTubeConnectFlow]
  );

  const removePlatformAccount = useCallback(
    async (platformKey: PlatformKey, account: ConnectedPlatformAccount) => {
      if (platformKey === "youtube") {
        // TODO: Wire to backend endpoint when per-account YouTube disconnect is available.
        setError(`Removing ${account.displayName || "this YouTube account"} is not available yet.`);
        return;
      }
      // TODO: Wire to backend endpoint when Instagram disconnect is available.
      setError(`Removing ${account.displayName || "this Instagram account"} is not available yet.`);
    },
    []
  );

  const toggleRoleSelection = useCallback(
    async (roleId: string) => {
      const nextRoleIds = selectedRoleIds.includes(roleId)
        ? selectedRoleIds.filter((id) => id !== roleId)
        : [...selectedRoleIds, roleId];

      setRolesSaving(true);
      setError(null);
      try {
        const updatedRoles = await withFreshBackendToken((token) => upsertMyRoles(token, nextRoleIds));
        const normalizedRoleIds = (updatedRoles.items || []).map((item) => item.id);
        setSelectedRoleIds(normalizedRoleIds);
        setProfile((prev) => (prev ? { ...prev, roles: updatedRoles.items || [] } : prev));
        const refreshedProfile = await withFreshBackendToken((token) => getMyProfile(token));
        setProfile(refreshedProfile);
        await refreshProfileCompletion();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save selected roles.");
      } finally {
        setRolesSaving(false);
      }
    },
    [
      refreshProfileCompletion,
      selectedRoleIds,
      withFreshBackendToken,
    ]
  );

  const persistContentStyle = useCallback(async () => {
    const updated = await withFreshBackendToken((token) =>
      upsertMyContentStyle(token, {
        primary_niche: contentStyleDraft.primary_niche || null,
        format: contentStyleDraft.format,
        tone: contentStyleDraft.tone,
        target_audience: contentStyleDraft.target_audience || null,
      })
    );
    setContentStyleDraft({
      primary_niche: updated.primary_niche || "",
      format: updated.format || [],
      tone: updated.tone || [],
      target_audience: updated.target_audience || "",
    });
    setProfile((prev) => (prev ? { ...prev, content_style: updated } : prev));
    await refreshProfileCompletion();
    return updated;
  }, [contentStyleDraft, refreshProfileCompletion, withFreshBackendToken]);

  const saveContentStyle = useCallback(async () => {
    setContentStyleSaving(true);
    setError(null);
    try {
      await persistContentStyle();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save content style.");
    } finally {
      setContentStyleSaving(false);
    }
  }, [persistContentStyle, router]);

  const handleFetchYouTubePortfolioPreview = useCallback(async () => {
    const youtubeUrl = portfolioYouTubeUrl.trim();
    if (!youtubeUrl) {
      setError("Paste a YouTube URL to fetch portfolio metadata.");
      return;
    }

    setPortfolioYouTubeFetching(true);
    setError(null);
    setPortfolioSuccess(null);
    try {
      const preview = await withFreshBackendToken((token) => previewPortfolioYouTube(token, youtubeUrl));
      setPortfolioYouTubePreview(preview);
    } catch (err) {
      setPortfolioYouTubePreview(null);
      setError(err instanceof Error ? err.message : "Failed to fetch YouTube metadata. You can add this project manually.");
    } finally {
      setPortfolioYouTubeFetching(false);
    }
  }, [portfolioYouTubeUrl, withFreshBackendToken]);

  const toggleYouTubeContributionTag = useCallback((tag: string) => {
    setPortfolioYouTubeContributionTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    );
  }, []);

  const toggleCustomContributionTag = useCallback((tag: string) => {
    setPortfolioContributionTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    );
  }, []);

  const handleSaveYouTubePortfolio = useCallback(async () => {
    if (!portfolioYouTubePreview) {
      setError("Fetch a YouTube video before saving.");
      return;
    }
    const roleName = portfolioRoleInProject.trim();

    const retention = parseOptionalNumber(portfolioRetentionPercent);
    if (Number.isNaN(retention) || (retention !== null && (retention < 0 || retention > 100))) {
      setError("Self-reported retention must be a number between 0 and 100.");
      return;
    }

    setPortfolioYouTubeSaving(true);
    setError(null);
    setPortfolioSuccess(null);
    try {
      const payload = {
        title: portfolioYouTubePreview.title,
        source_type: "youtube" as const,
        source_url: portfolioYouTubePreview.source_url,
        youtube_url: portfolioYouTubePreview.source_url,
        media_url: portfolioYouTubePreview.source_url,
        thumbnail_url: portfolioYouTubePreview.thumbnail_url || undefined,
        channel_name: portfolioYouTubePreview.channel_name || undefined,
        channel_id: portfolioYouTubePreview.channel_id || undefined,
        published_at: portfolioYouTubePreview.published_at || undefined,
        ...(roleName
          ? {
              role_name: roleName,
              role: roleName,
              user_role_in_project: roleName,
            }
          : {}),
        contribution_summary: portfolioYouTubeContributionSummary.trim() || portfolioYouTubePreview.description || undefined,
        description: portfolioYouTubeContributionSummary.trim() || portfolioYouTubePreview.description || undefined,
        contribution_tags: portfolioYouTubeContributionTags,
        tags: ["YouTube"],
        tools: parseListInput(portfolioYouTubeTools),
        public_metrics: portfolioYouTubePreview.public_metrics,
        manual_metrics: {
          ...(retention !== null ? { retention_percent: retention } : {}),
        },
        retention_percent: retention ?? undefined,
        verification_status: "youtube_metadata_verified" as const,
        visibility: portfolioYouTubeIsPublic ? "public" as const : "private" as const,
        is_public: portfolioYouTubeIsPublic,
        status: portfolioYouTubeStatus,
        portfolio_status: portfolioYouTubeStatus,
        is_featured: portfolioYouTubeIsFeatured,
        links: [portfolioYouTubePreview.source_url],
      };
      const refreshed = await withFreshBackendToken(async (token) => {
        await createMyPortfolioItem(token, payload);
        return listMyPortfolio(token);
      });
      setPortfolio(refreshed.items || []);
      setPortfolioSuccess("YouTube work sample saved.");
      setPortfolioYouTubePreview(null);
      setPortfolioYouTubeUrl("");
      setPortfolioRetentionPercent("");
      setPortfolioRoleInProject("");
      setPortfolioYouTubeContributionSummary("");
      setPortfolioYouTubeContributionTags([]);
      setPortfolioYouTubeTools("");
      setPortfolioYouTubeStatus("past");
      setPortfolioYouTubeIsPublic(true);
      setPortfolioYouTubeIsFeatured(false);
      await refreshProfileCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save YouTube portfolio item.");
    } finally {
      setPortfolioYouTubeSaving(false);
    }
  }, [
    portfolioRetentionPercent,
    portfolioRoleInProject,
    portfolioYouTubeContributionSummary,
    portfolioYouTubeContributionTags,
    portfolioYouTubeIsFeatured,
    portfolioYouTubeIsPublic,
    portfolioYouTubePreview,
    portfolioYouTubeStatus,
    portfolioYouTubeTools,
    refreshProfileCompletion,
    withFreshBackendToken,
  ]);

  const toggleContentStyleChip = useCallback(
    (field: "format" | "tone", value: string) => {
      setContentStyleDraft((prev) => {
        const hasValue = prev[field].includes(value);
        const nextValues = hasValue
          ? prev[field].filter((item) => item !== value)
          : [...prev[field], value];
        return { ...prev, [field]: nextValues };
      });
    },
    []
  );

  useEffect(() => {
    if (connectParam !== "1") {
      autoConnectHandledRef.current = false;
      return;
    }
    if (sessionStatus !== "authenticated" || autoConnectHandledRef.current) {
      return;
    }
    autoConnectHandledRef.current = true;
    void (async () => {
      await startYouTubeConnectFlow();
      router.replace("/you");
    })();
  }, [connectParam, router, sessionStatus, startYouTubeConnectFlow]);

  useEffect(() => {
    if (isEditMode) {
      setExperienceEditorOpen(true);
    }
  }, [isEditMode]);

  useEffect(() => {
    if (!experienceEditorOpen || editingExperienceId || !experienceCreateFocusNonce) return;
    requestAnimationFrame(() => {
      const target = experienceCreateEditorRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const outOfView = rect.top < 88 || rect.bottom > window.innerHeight;
      if (outOfView) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [editingExperienceId, experienceCreateFocusNonce, experienceEditorOpen]);

  const applyProfileUpdate = useCallback(
    (updated: BackendProfileResponse) => {
      setProfile(updated);
      hydrateFromProfile(updated);
    },
    [hydrateFromProfile]
  );

  const buildEditorProfilePayload = useCallback(
    (): BackendProfileUpdatePayload => ({
      display_name: draftDisplayName.trim(),
      headline: draftHeadline.trim(),
      skills: selectedTools,
      experience: experienceDraft,
      location: draftLocation.trim(),
      timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : "",
      project_type_preference: draftPreferenceProjectType || null,
      collaboration_turnaround: draftPreferenceTurnaround.trim(),
      collaboration_revisions: draftPreferenceRevisions.trim(),
      collaboration_working_hours: formatWorkingHours({
        mode: workingHoursMode,
        start: workingHoursStart,
        end: workingHoursEnd,
        timezone: workingHoursTimezone,
      }),
      collaboration_tools: formatToolString(selectedTools),
      hiring_type: draftHiringType || null,
      hiring_website_or_social_url: draftHiringWebsiteOrSocialUrl.trim() || null,
      hiring_primary_platform: draftHiringPrimaryPlatform || null,
      hiring_channels_or_pages_managed: draftHiringChannelsOrPagesManaged.trim() || null,
    }),
    [
      draftDisplayName,
      draftHeadline,
      experienceDraft,
      draftHiringChannelsOrPagesManaged,
      draftHiringPrimaryPlatform,
      draftHiringType,
      draftHiringWebsiteOrSocialUrl,
      draftLocation,
      draftPreferenceProjectType,
      draftPreferenceRevisions,
      draftPreferenceTurnaround,
      selectedTools,
      workingHoursEnd,
      workingHoursMode,
      workingHoursStart,
      workingHoursTimezone,
    ]
  );

  const persistProfileUpdate = useCallback(
    async (payload: BackendProfileUpdatePayload) => {
      const updated = await withFreshBackendToken((token) => updateMyProfile(token, payload));
      applyProfileUpdate(updated);
      return updated;
    },
    [applyProfileUpdate, withFreshBackendToken]
  );

  const patchProfile = useCallback(
    async (payload: BackendProfileUpdatePayload, fallbackError: string) => {
      setProfileSaving(true);
      setError(null);
      try {
        const updated = await persistProfileUpdate(payload);
        return updated;
      } catch (err) {
        setError(err instanceof Error ? err.message : fallbackError);
        return null;
      } finally {
        setProfileSaving(false);
      }
    },
    [persistProfileUpdate]
  );

  const handleAvatarFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setError("Choose an image file for your avatar.");
        return;
      }

      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      avatarObjectUrlRef.current = objectUrl;
      setAvatarUploadPreviewUrl(objectUrl);
      setAvatarMenuOpen(false);
      setAvatarSaving(true);
      setError(null);

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const updated = await withFreshBackendToken((token) =>
          uploadMyAvatar(token, {
            file_name: file.name || "avatar",
            content_type: file.type,
            data_url: dataUrl,
          })
        );
        applyProfileUpdate(updated);
        if (avatarObjectUrlRef.current) {
          URL.revokeObjectURL(avatarObjectUrlRef.current);
          avatarObjectUrlRef.current = null;
        }
        setAvatarUploadPreviewUrl(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload avatar.");
      } finally {
        setAvatarSaving(false);
      }
    },
    [applyProfileUpdate, withFreshBackendToken]
  );

  const isFieldDirty = useCallback(
    (field: InlineField) => {
      if (!profile) return false;
      if (field === "display_name") {
        return draftDisplayName.trim() !== (profile.display_name || "").trim();
      }
      if (field === "headline") {
        return draftHeadline.trim() !== (profile.headline || "").trim();
      }
      if (field === "skills") {
        const storedTools = parseToolString(profile.collaboration_preferences?.tools).length
          ? parseToolString(profile.collaboration_preferences?.tools)
          : normalizeList(profile.skills);
        return !areListsEqual(selectedTools, storedTools);
      }
      if (field === "location_timezone") {
        return draftLocation.trim() !== (profile.location || "").trim();
      }
      const workingHoursValue = formatWorkingHours({
        mode: workingHoursMode,
        start: workingHoursStart,
        end: workingHoursEnd,
        timezone: workingHoursTimezone,
      });
      return (
        (draftPreferenceProjectType || "") !==
          (profile.collaboration_preferences?.project_type_preference || "") ||
        draftPreferenceTurnaround.trim() !==
          (profile.collaboration_preferences?.turnaround || "").trim() ||
        draftPreferenceRevisions.trim() !==
          (profile.collaboration_preferences?.revisions || "").trim() ||
        workingHoursValue !== (profile.collaboration_preferences?.working_hours || "").trim() ||
        formatToolString(selectedTools) !== (profile.collaboration_preferences?.tools || "").trim()
      );
    },
    [
      draftDisplayName,
      draftHeadline,
      draftLocation,
      draftPreferenceProjectType,
      draftPreferenceRevisions,
      draftPreferenceTurnaround,
      profile,
      selectedTools,
      workingHoursEnd,
      workingHoursMode,
      workingHoursStart,
      workingHoursTimezone,
    ]
  );

  const saveInlineField = async (field: InlineField) => {
    if (!isFieldDirty(field)) {
      return;
    }
    setInlineSavingField(field);
    const payload: BackendProfileUpdatePayload =
      field === "display_name"
        ? { display_name: draftDisplayName.trim() }
        : field === "headline"
          ? { headline: draftHeadline.trim() }
          : field === "skills"
            ? { skills: selectedTools, collaboration_tools: formatToolString(selectedTools) }
            : field === "location_timezone"
              ? {
                  location: draftLocation.trim(),
                  timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : "",
                }
              : {
                  project_type_preference: draftPreferenceProjectType || null,
                  collaboration_turnaround: draftPreferenceTurnaround.trim(),
                  collaboration_revisions: draftPreferenceRevisions.trim(),
                  collaboration_working_hours: formatWorkingHours({
                    mode: workingHoursMode,
                    start: workingHoursStart,
                    end: workingHoursEnd,
                    timezone: workingHoursTimezone,
                  }),
                  collaboration_tools: formatToolString(selectedTools),
                };
    await patchProfile(payload, "Failed to save profile field.");
    setInlineSavingField(null);
  };

  const saveExperienceItems = useCallback(
    async (items: BackendProfileExperienceItem[]) => {
      setExperienceSaving(true);
      try {
        const updated = await patchProfile({ experience: items }, "Failed to save experience.");
        if (updated) {
          await refreshProfileCompletion();
          router.refresh();
          return true;
        }
        return false;
      } finally {
        setExperienceSaving(false);
      }
    },
    [patchProfile, refreshProfileCompletion, router]
  );

  const resetExperienceForm = () => {
    setExperienceForm(createEmptyExperienceForm());
    setEditingExperienceId(null);
    if (!isEditMode) {
      setExperienceEditorOpen(false);
    }
  };

  const startAddExperience = () => {
    if (!editingExperienceId && experienceEditorOpen) {
      setExperienceCreateFocusNonce((value) => value + 1);
      return;
    }
    setExperienceForm(createEmptyExperienceForm());
    setEditingExperienceId(null);
    setExperienceEditorOpen(true);
    setExperienceCreateFocusNonce((value) => value + 1);
  };

  const submitExperienceForm = async () => {
    const nextItem = experienceItemFromForm(experienceForm);
    if (!nextItem.role || !nextItem.organization_name) {
      setError("Add a role and channel/page/company before saving experience.");
      return;
    }
    const nextItems = editingExperienceId
      ? experienceDraft.map((item) => (item.id === editingExperienceId ? nextItem : item))
      : [nextItem, ...experienceDraft];
    const saved = await saveExperienceItems(sortExperienceItems(nextItems));
    if (saved) resetExperienceForm();
  };

  const editExperienceItem = (item: BackendProfileExperienceItem) => {
    setExperienceForm(experienceFormFromItem(item));
    setEditingExperienceId(item.id);
    setExperienceEditorOpen(true);
  };

  useEffect(() => {
    if (!editingExperienceId) return;
    const frame = window.requestAnimationFrame(() => {
      const match = Array.from(document.querySelectorAll<HTMLElement>("[data-experience-editing-id]")).find(
        (element) => element.dataset.experienceEditingId === editingExperienceId
      );
      match?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingExperienceId]);

  const renderExperienceEditor = (focusRole: boolean) => (
    <ProfileExperienceEditor
      key={editingExperienceId || experienceForm.id || "new-experience"}
      draft={experienceForm}
      onChange={setExperienceForm}
      onSubmit={() => void submitExperienceForm()}
      onCancel={resetExperienceForm}
      saving={experienceSaving}
      isEditing={focusRole}
      autoFocusRole={focusRole}
      focusRequest={focusRole ? experienceCreateFocusNonce : undefined}
    />
  );

  const removeExperienceItem = async (itemId: string) => {
    await saveExperienceItems(sortExperienceItems(experienceDraft.filter((item) => item.id !== itemId)));
    if (editingExperienceId === itemId) resetExperienceForm();
  };

  const updateAvatarMode = async (
    nextMode: "generic" | "youtube_channel",
    nextChannelId: string | null = null
  ) => {
    setAvatarSaving(true);
    const updated = await patchProfile(
      {
        avatar_mode: nextMode,
        avatar_youtube_channel_id: nextMode === "youtube_channel" ? nextChannelId : null,
      },
      "Failed to update avatar mode."
    );
    if (updated) {
      setAvatarMode(updated.avatar_mode || "generic");
      setAvatarChannelId(updated.avatar_youtube_channel_id || "");
      setAvatarMenuOpen(false);
    }
    setAvatarSaving(false);
  };

  const resetPortfolioForm = () => {
    setEditingPortfolioId(null);
    setPortfolioSourceType("custom");
    setPortfolioTitle("");
    setPortfolioRole("");
    setPortfolioContributionSummary("");
    setPortfolioMediaUrl("");
    setPortfolioThumbnailUrl("");
    setPortfolioManualViews("");
    setPortfolioCustomRetentionPercent("");
    setPortfolioCtrPercent("");
    setPortfolioTurnaroundDays("");
    setPortfolioMetricNotes("");
    setPortfolioLinks("");
    setPortfolioTags("");
    setPortfolioContributionTags([]);
    setPortfolioTools("");
    setPortfolioStatus("now");
    setPortfolioIsPublic(true);
    setPortfolioIsFeatured(false);
  };

  const handleSavePortfolioItem = async () => {
    if (!portfolioTitle.trim()) {
      setError("Portfolio title is required.");
      return;
    }
    if (!portfolioMediaUrl.trim() && !portfolioContributionSummary.trim()) {
      setError("Add either a media URL or a contribution summary.");
      return;
    }
    const manualViews = parseOptionalNumber(portfolioManualViews);
    const ctrPercent = parseOptionalNumber(portfolioCtrPercent);
    const retentionPercent = parseOptionalNumber(portfolioCustomRetentionPercent);
    const turnaroundDays = parseOptionalNumber(portfolioTurnaroundDays);
    if (Number.isNaN(manualViews) || Number.isNaN(ctrPercent) || Number.isNaN(retentionPercent) || Number.isNaN(turnaroundDays)) {
      setError("Metrics must be numeric when provided.");
      return;
    }
    if (
      (retentionPercent !== null && (retentionPercent < 0 || retentionPercent > 100)) ||
      (ctrPercent !== null && (ctrPercent < 0 || ctrPercent > 100))
    ) {
      setError("Retention and CTR must be between 0 and 100.");
      return;
    }

    setPortfolioSaving(true);
    setError(null);
    setPortfolioSuccess(null);
    try {
      const manualMetrics = {
        ...(manualViews !== null ? { views: manualViews } : {}),
        ...(retentionPercent !== null ? { retention_percent: retentionPercent } : {}),
        ...(ctrPercent !== null ? { ctr_percent: ctrPercent } : {}),
        ...(turnaroundDays !== null ? { turnaround_days: turnaroundDays } : {}),
        ...(portfolioMetricNotes.trim() ? { notes: portfolioMetricNotes.trim() } : {}),
      };
      const roleName = portfolioRole.trim();
      const payload = {
        title: portfolioTitle.trim(),
        source_type: portfolioSourceType,
        source_url: portfolioMediaUrl.trim() || undefined,
        ...(roleName
          ? {
              role_name: roleName,
              role: roleName,
              user_role_in_project: roleName,
            }
          : {}),
        contribution_summary: portfolioContributionSummary.trim() || undefined,
        description: portfolioContributionSummary.trim() || undefined,
        timeframe: portfolioStatus,
        media_url: portfolioMediaUrl.trim() || undefined,
        thumbnail_url: portfolioThumbnailUrl.trim() || undefined,
        metrics: portfolioMetricNotes.trim() || undefined,
        links: parseListInput(portfolioLinks),
        tags: parseListInput(portfolioTags),
        contribution_tags: portfolioContributionTags,
        tools: parseListInput(portfolioTools),
        manual_metrics: manualMetrics,
        verification_status: "manual" as const,
        visibility: portfolioIsPublic ? "public" as const : "private" as const,
        portfolio_status: portfolioStatus,
        status: portfolioStatus,
        is_public: portfolioIsPublic,
        is_featured: portfolioIsFeatured,
      };

      const refreshed = await withFreshBackendToken(async (token) => {
        if (editingPortfolioId) {
          await updateMyPortfolioItem(token, editingPortfolioId, payload);
        } else {
          await createMyPortfolioItem(token, payload);
        }
        return listMyPortfolio(token);
      });
      setPortfolio(refreshed.items || []);
      resetPortfolioForm();
      setPortfolioSuccess(editingPortfolioId ? "Portfolio item updated." : "Custom work sample saved.");
      await refreshProfileCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save portfolio item.");
    } finally {
      setPortfolioSaving(false);
    }
  };

  const startEditPortfolio = (item: BackendPortfolioItem) => {
    setEditingPortfolioId(item.id);
    setPortfolioSourceType(item.source_type === "website" ? "custom" : item.source_type || (item.youtube_url ? "youtube" : "custom"));
    setPortfolioTitle(item.title || "");
    setPortfolioRole(item.role_name || item.role || item.user_role_in_project || "");
    setPortfolioContributionSummary(item.contribution_summary || item.description || "");
    setPortfolioMediaUrl(item.source_url || item.media_url || item.youtube_url || "");
    setPortfolioThumbnailUrl(item.thumbnail_url || "");
    setPortfolioManualViews(String(metricNumber(item.manual_metrics?.views) ?? ""));
    setPortfolioCtrPercent(String(metricNumber(item.manual_metrics?.ctr_percent) ?? ""));
    setPortfolioCustomRetentionPercent(String(metricNumber(item.manual_metrics?.retention_percent ?? item.retention_percent) ?? ""));
    setPortfolioTurnaroundDays(String(metricNumber(item.manual_metrics?.turnaround_days) ?? ""));
    setPortfolioMetricNotes(typeof item.manual_metrics?.notes === "string" ? item.manual_metrics.notes : item.metrics || "");
    setPortfolioLinks((item.links || []).join("\n"));
    setPortfolioTags((item.tags || []).join(", "));
    setPortfolioContributionTags(item.contribution_tags || []);
    setPortfolioTools((item.tools || []).join(", "));
    setPortfolioStatus(item.portfolio_status || item.status || "now");
    setPortfolioIsPublic((item.visibility || (item.is_public ? "public" : "private")) === "public");
    setPortfolioIsFeatured(Boolean(item.is_featured));
    setTab("portfolio");
  };

  const handleDeletePortfolio = async (itemId: string) => {
    setPortfolioSaving(true);
    setError(null);
    try {
      const refreshed = await withFreshBackendToken(async (token) => {
        await deleteMyPortfolioItem(token, itemId);
        return listMyPortfolio(token);
      });
      setPortfolio(refreshed.items || []);
      if (editingPortfolioId === itemId) resetPortfolioForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete portfolio item.");
    } finally {
      setPortfolioSaving(false);
    }
  };

  const avatarPreviewUrl = useMemo<string | undefined>(() => {
    if (avatarUploadPreviewUrl) return avatarUploadPreviewUrl;
    if (avatarMode !== "youtube_channel") return profile?.avatar_url || undefined;
    if (!avatarChannelId) return profile?.avatar_url || undefined;
    const selected = channelOptions.find((item) => item.channel_id === avatarChannelId);
    return selected?.thumbnail_url || profile?.avatar_url || undefined;
  }, [avatarChannelId, avatarMode, avatarUploadPreviewUrl, channelOptions, profile?.avatar_url]);

  const primaryDisplayName = (
    profile?.social_connections?.youtube?.connected || primaryYouTubeChannel
      ? profile?.social_connections?.youtube?.channel_title || primaryYouTubeChannel?.title
      : profile?.display_name
  )?.trim() || "Add your name";
  const usernameLabel = `@${(profile?.username || "your_profile").replace(/^@+/, "")}`;
  const hasYouTubeDisplayName = Boolean(
    profile?.social_connections?.youtube?.connected || primaryYouTubeChannel
  );
  const formatHeroText = (value?: string | null) => value?.trim() || "–";
  const heroMetadataParts = [
    usernameLabel,
    formatHeroText(profile?.location),
    formatHeroText(profile?.collaboration_preferences?.working_hours),
  ];
  const heroHeadlineValue = formatHeroText(profile?.headline);
  const heroToolsValue = normalizeList(profile?.skills).length
    ? normalizeList(profile?.skills).join(" · ")
    : "–";
  const publishedPortfolio = portfolio.filter((item) => (item.publish_status || "published") === "published");
  const ownerRoleNames = selectedRoles.map((role) => role.name).filter(Boolean);
  const ownerFormatNames = normalizeList(contentStyleDraft.format);
  const ownerToneNames = normalizeList(contentStyleDraft.tone);
  const ownerConnectedChannelNames = [
    ...connectedAccounts.youtube.map((account) => `YouTube: ${account.displayName}`),
    ...connectedAccounts.instagram.map((account) => `Instagram: ${account.displayName}`),
  ];
  const ownerOverviewRows = [
    ["Roles", formatOwnerListValue(ownerRoleNames)],
    ["Primary niche", formatOwnerTextValue(contentStyleDraft.primary_niche)],
    ["Formats", formatOwnerListValue(ownerFormatNames)],
    ["Tone", formatOwnerListValue(ownerToneNames)],
    ["Target audience", formatOwnerTextValue(contentStyleDraft.target_audience)],
  ].filter(([, value]) => value !== "–");
  const ownerProfileDetailsRows = [
    ["Primary platform", formatOwnerTextValue(profile?.hiring_info?.primary_platform)],
    ["Connected channels/pages", formatOwnerListValue(ownerConnectedChannelNames)],
    ["Website / social URL", formatOwnerTextValue(profile?.hiring_info?.website_or_social_url)],
  ].filter(([, value]) => value !== "–");
  const ownerRecruiterProfileRows = [
    ["Hiring type", formatOwnerHiringType(profile?.hiring_info?.hiring_type)],
    ["Primary platform", formatOwnerTextValue(profile?.hiring_info?.primary_platform)],
    ["Channels/pages", formatOwnerTextValue(profile?.hiring_info?.channels_or_pages_managed) !== "–" ? formatOwnerTextValue(profile?.hiring_info?.channels_or_pages_managed) : formatOwnerListValue(ownerConnectedChannelNames)],
    ["Typical roles", formatOwnerListValue(activeJobs.map((job) => job.category || job.title))],
    ["Content niche", formatOwnerTextValue(contentStyleDraft.primary_niche)],
  ].filter(([, value]) => value !== "–");
  const ownerRecruiterDetailRows = [
    ["Website / social URL", formatOwnerTextValue(profile?.hiring_info?.website_or_social_url)],
    ["Channel or brand context", formatOwnerListValue(ownerConnectedChannelNames)],
    ["Hiring context", formatOwnerTextValue(profile?.hiring_info?.channels_or_pages_managed)],
  ].filter(([, value]) => value !== "–");
  const ownerCollaborationRows = [
    ["Project type preference", formatOwnerProjectType(profile?.collaboration_preferences?.project_type_preference)],
    ["Turnaround", formatOwnerTextValue(profile?.collaboration_preferences?.turnaround)],
    ["Revisions", formatOwnerTextValue(profile?.collaboration_preferences?.revisions)],
    ["Working hours", formatOwnerTextValue(profile?.collaboration_preferences?.working_hours)],
    ["Tools", formatOwnerTextValue(profile?.collaboration_preferences?.tools)],
  ].filter(([, value]) => value !== "–");
  const ownerRecruiterCollaborationRows = [
    ["Project type preference", formatOwnerProjectType(profile?.collaboration_preferences?.project_type_preference)],
    ["Typical turnaround", formatOwnerTextValue(profile?.collaboration_preferences?.turnaround)],
    ["Revision expectations", formatOwnerTextValue(profile?.collaboration_preferences?.revisions)],
    ["Working hours", formatOwnerTextValue(profile?.collaboration_preferences?.working_hours)],
    ["Tools/workflow", formatOwnerTextValue(profile?.collaboration_preferences?.tools)],
  ].filter(([, value]) => value !== "–");
  const effectiveOwnerProfileMode: OwnerProfileViewMode = ownerProfileMode;
  const ownerExperienceItems = experienceDraft;
  const ownerPortfolioPreview = (featuredPortfolio.length ? featuredPortfolio : portfolio).slice(0, 2);
  const ownerJobsPreview = activeJobs.slice(0, 2);
  const toPortfolioLaunchSource = (sourceType: WorkSampleSourceType): PortfolioLaunchSource => {
    if (
      sourceType === "youtube" ||
      sourceType === "custom" ||
      sourceType === "drive" ||
      sourceType === "behance" ||
      sourceType === "instagram" ||
      sourceType === "vimeo" ||
      sourceType === "other"
    ) {
      return sourceType;
    }
    return "custom";
  };
  const launchPortfolioEditor = (
    sourceType: PortfolioLaunchSource,
    sourceKind: WorkSampleAction["sourceKind"] | undefined,
    sourceUrl = "",
    suggestedTitle = "",
    shouldFetchYouTube = false,
    linkPreview?: BackendPortfolioLinkPreviewResponse,
    previewError = ""
  ) => {
    setPortfolioLaunchRequest({
      sourceType,
      sourceKind,
      sourceUrl,
      suggestedTitle,
      shouldFetchYouTube,
      linkPreview,
      previewError,
    });
    setTab("portfolio");
  };
  const previewWorkLink = useCallback(
    (url: string) => withFreshBackendToken((token) => previewPortfolioLink(token, url)),
    [withFreshBackendToken]
  );
  const chooseWorkSampleSource = (action: WorkSampleAction) => {
    setWorkSampleChooserOpen(false);
    const sourceType = toPortfolioLaunchSource(action.sourceType);
    launchPortfolioEditor(
      sourceType,
      action.sourceKind,
      action.url,
      action.suggestedTitle || "",
      sourceType === "youtube" && !action.preview && !action.previewError,
      action.preview,
      action.previewError || ""
    );
  };
  const portfolioChecklist = [
    { key: "sample", label: "Create first work sample", done: publishedPortfolio.length > 0 },
    { key: "role", label: "Add work-sample role", done: portfolio.some((item) => item.role_name || item.role || item.user_role_in_project) },
    { key: "contribution", label: "Add contribution details", done: portfolio.some((item) => item.contribution_summary || item.description || item.contribution_tags?.length) },
    { key: "tools", label: "Add tools/outcome", done: portfolio.some((item) => item.tools?.length) },
    {
      key: "metric",
      label: "Add one metric",
      done: portfolio.some((item) => {
        const publicMetrics = item.public_metrics || {};
        const manualMetrics = item.manual_metrics || {};
        return Boolean(
          Object.keys(publicMetrics).length ||
            Object.keys(manualMetrics).length ||
            item.views ||
            item.retention_percent ||
            item.metrics
        );
      }),
    },
    { key: "featured", label: "Pin best work", done: portfolio.some((item) => item.is_featured) },
  ];
  const setupTasks = [
    {
      key: "working-hours",
      label: "Add working hours",
      done: completion.checks.find((item) => item.key === "working_hours")?.done ?? false,
      onClick: () => router.push("/you/edit#working-hours"),
    },
    {
      key: "roles",
      label: "Add role",
      done: selectedRoles.length > 0,
      onClick: () => router.push("/you/edit#roles"),
    },
    {
      key: "content-style",
      label: "Add content style",
      done: hasContentStyleData,
      onClick: () => router.push("/you/edit#content-style"),
    },
    {
      key: "channels",
      label: "Connect channel/page",
      done: hasConnectedAccountData,
      onClick: () => router.push("/you/edit#channels"),
    },
    {
      key: "work-sample",
      label: "Create first work sample",
      done: publishedPortfolio.length > 0,
      onClick: () => setWorkSampleChooserOpen(true),
    },
    {
      key: "tools-outcome",
      label: "Add tools/outcome",
      done: portfolioChecklist.some((item) => item.key === "tools" && item.done) || portfolioChecklist.some((item) => item.key === "metric" && item.done),
      onClick: () => {
        if (portfolio.length) {
          setTab("portfolio");
          return;
        }
        setWorkSampleChooserOpen(true);
      },
    },
  ];
  const setupCompletionCount = setupTasks.filter((item) => item.done).length;
  const setupWidgetPercent = setupTasks.length
    ? Math.round((setupCompletionCount / setupTasks.length) * 100)
    : 100;
  const visibleSetupTasks = [...setupTasks]
    .sort((a, b) => Number(a.done) - Number(b.done))
    .slice(0, 5);
  const hiddenSetupTaskCount = Math.max(0, setupTasks.length - visibleSetupTasks.length);
  const activeContributionOptions = contributionOptionsForRole(portfolioRole);
  const activeYouTubeContributionOptions = contributionOptionsForRole(portfolioRoleInProject);
  const saveHiringInfo = useCallback(async () => {
    setHiringSaving(true);
    setError(null);
    try {
      await persistProfileUpdate(buildEditorProfilePayload());
      await refreshProfileCompletion();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save hiring info.");
    } finally {
      setHiringSaving(false);
    }
  }, [
    buildEditorProfilePayload,
    persistProfileUpdate,
    refreshProfileCompletion,
    router,
  ]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-3xl border border-white/10 bg-white/[0.05] animate-pulse" />
        <div className="h-24 rounded-3xl border border-white/10 bg-white/[0.05] animate-pulse" />
      </div>
    );
  }

  if (error && !profile) {
    return (
      <section className="rounded-2xl border border-amber-200/25 bg-amber-200/10 p-4 text-sm text-amber-100">
        {error}
      </section>
    );
  }

  if (!profile) return null;

  const saveDirtyEditorFields = async () => {
    setProfileSaving(true);
    setError(null);
    try {
      await persistProfileUpdate(buildEditorProfilePayload());
      await refreshProfileCompletion();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile fields.");
      return false;
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveAllEditorChanges = async () => {
    if (backendPersistenceUnavailable || saveStatus === "saving") return;
    if (saveStatusTimeoutRef.current) {
      clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = null;
    }
    setSaveStatus("saving");
    setSaveError(null);
    setError(null);
    setProfileSaving(true);
    setRolesSaving(true);
    setContentStyleSaving(true);
    setExperienceSaving(true);

    try {
      await persistProfileUpdate(buildEditorProfilePayload());
      const updatedRoles = await withFreshBackendToken((token) => upsertMyRoles(token, selectedRoleIds));
      const normalizedRoleIds = (updatedRoles.items || []).map((item) => item.id);
      setSelectedRoleIds(normalizedRoleIds);
      setProfile((prev) => (prev ? { ...prev, roles: updatedRoles.items || [] } : prev));
      await persistContentStyle();
      await refreshProfileCompletion();
      router.refresh();

      setSaveStatus("saved");
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
        saveStatusTimeoutRef.current = null;
      }, 1800);
    } catch {
      setSaveStatus("error");
      setSaveError("Couldn’t save changes. Try again.");
    } finally {
      setProfileSaving(false);
      setRolesSaving(false);
      setContentStyleSaving(false);
      setExperienceSaving(false);
    }
  };

  const editorSaveInProgress =
    saveStatus === "saving" ||
    profileSaving ||
    rolesSaving ||
    contentStyleSaving ||
    hiringSaving ||
    experienceSaving;

  if (isEditMode) {
    return (
      <div data-profile-scope className="space-y-6">
        <section className="rounded-[28px] border border-white/10 bg-[#15161a] p-5 shadow-[0_24px_78px_-48px_rgba(0,0,0,1)] sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Profile editor
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Edit profile
              </h1>
            </div>
            <div className="flex justify-start lg:justify-end">
              <div className="flex flex-col items-start gap-2 lg:items-end">
                <SaveIconButton
                  onClick={() => void handleSaveAllEditorChanges()}
                  disabled={backendPersistenceUnavailable || editorSaveInProgress}
                  saving={editorSaveInProgress}
                  ariaLabel="Save profile changes"
                />
                {saveStatus === "saved" ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-white/48">
                    <Icon name="check" className="h-3.5 w-3.5" />
                    Changes saved
                  </p>
                ) : null}
                {saveStatus === "error" && saveError ? (
                  <p className="text-xs text-amber-100/78">{saveError}</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-xs text-amber-100">
            {error}
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-[88px] space-y-1 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              {EDITOR_SECTIONS.map(({ id, label }) => {
                const active = activeEditorSection === id;
                return (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollToEditorSection(id)}
                  className={[
                    "flex w-full origin-left cursor-pointer items-center rounded-xl px-3 py-2 text-left text-sm transition-all duration-200",
                    active
                      ? "translate-x-1 font-semibold text-white"
                      : "font-medium text-white/46 hover:translate-x-0.5 hover:text-white/72",
                  ].join(" ")}
                >
                  {label}
                </button>
                );
              })}
            </nav>
          </aside>

          <div className="space-y-5 pb-24">
            <section id="basics" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Basics</h2>
                </div>
                <div id="banner" className="scroll-mt-24 relative shrink-0">
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => void handleAvatarFileChange(event)}
                  />
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={avatarSaving || profileSaving}
                    title="Upload avatar"
                    aria-label="Upload avatar"
                    className="group/avatar relative h-20 w-20 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] shadow-[0_18px_48px_-32px_rgba(0,0,0,1)] transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-white/15 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                    {avatarPreviewUrl ? (
                      <img src={avatarPreviewUrl} alt={primaryDisplayName} className="h-full w-full object-cover" />
                    ) : (
                      <GenericAvatar />
                    )}
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover/avatar:bg-black/40 group-hover/avatar:opacity-100 group-focus-visible/avatar:bg-black/40 group-focus-visible/avatar:opacity-100">
                      <Icon name="image" className="h-6 w-6 text-white/86" />
                    </span>
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-white/55">Display name</span>
                  <input
                    value={draftDisplayName}
                    onChange={(event) => setDraftDisplayName(event.target.value)}
                    disabled={hasYouTubeDisplayName}
                    className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35 disabled:text-white/40"
                    placeholder="Add your name"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/55">Headline</span>
                  <input
                    value={draftHeadline}
                    onChange={(event) => setDraftHeadline(event.target.value)}
                    className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                    placeholder="Video editor for creator-led channels"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-white/55">Location</span>
                  <input
                    value={draftLocation}
                    onChange={(event) => setDraftLocation(event.target.value)}
                    className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                    placeholder="Chennai, India"
                  />
                </label>
                <div id="working-hours" className="scroll-mt-24 space-y-3 md:col-span-2">
                  <p className="text-xs text-white/55">Working hours</p>
                  <div className="inline-flex rounded-full border border-white/12 bg-white/[0.035] p-1">
                    {[
                      ["flexible", "Flexible"],
                      ["fixed", "Set hours"],
                    ].map(([mode, label]) => (
                      <button
                        key={`working-hours-mode-${mode}`}
                        type="button"
                        onClick={() => setWorkingHoursMode(mode as WorkingHoursMode)}
                        className={[
                          "h-8 cursor-pointer rounded-full px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15",
                          workingHoursMode === mode
                            ? "bg-white text-black"
                            : "text-white/56 hover:text-white",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {workingHoursMode === "fixed" ? (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(120px,0.8fr)]">
                      <label className="space-y-1">
                        <span className="text-xs text-white/45">From</span>
                        <input
                          type="time"
                          value={workingHoursStart}
                          onChange={(event) => setWorkingHoursStart(event.target.value)}
                          className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-white/45">To</span>
                        <input
                          type="time"
                          value={workingHoursEnd}
                          onChange={(event) => setWorkingHoursEnd(event.target.value)}
                          className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-white/45">Time zone</span>
                        <input
                          value={workingHoursTimezone}
                          onChange={(event) => setWorkingHoursTimezone(event.target.value)}
                          className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                          placeholder="IST"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
                <ToolPicker value={selectedTools} onChange={setSelectedTools} />
              </div>
              <div className="mt-5 flex justify-end">
                <SaveIconButton
                  onClick={() => void saveDirtyEditorFields()}
                  disabled={profileSaving}
                  saving={profileSaving}
                  ariaLabel="Save basics"
                />
              </div>
            </section>

            <section id="experience" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <h2 className="text-xl font-semibold text-white">Experience</h2>
                {editingExperienceId ? (
                  <button
                    type="button"
                    onClick={startAddExperience}
                    className="w-fit cursor-pointer text-xs font-semibold text-white/50 transition-colors hover:text-white"
                  >
                    Add new
                  </button>
                ) : null}
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.8fr)]">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  {!editingExperienceId && experienceEditorOpen ? (
                    <div ref={experienceCreateEditorRef} className={experienceDraft.length ? "mb-5" : ""}>
                      <ProfileExperienceEditor
                        key={editingExperienceId || experienceForm.id || "new-experience"}
                        draft={experienceForm}
                        onChange={setExperienceForm}
                        onSubmit={() => void submitExperienceForm()}
                        onCancel={resetExperienceForm}
                        saving={experienceSaving}
                        isEditing={false}
                        autoFocusRole
                        focusRequest={experienceCreateFocusNonce}
                      />
                    </div>
                  ) : null}

                  <ProfileExperienceList
                    items={experienceDraft}
                    emptyState={<p className="text-sm text-white/50">No experience added yet.</p>}
                    editingItemId={editingExperienceId}
                    renderEditingItem={() => renderExperienceEditor(true)}
                    actions={(item) => (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => editExperienceItem(item)}
                          aria-label={`Edit experience at ${item.organization_name}`}
                          className="cursor-pointer text-[11px] font-semibold text-white/48 transition-colors hover:text-white"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeExperienceItem(item.id)}
                          aria-label={`Remove experience at ${item.organization_name}`}
                          disabled={experienceSaving}
                          className="cursor-pointer text-[11px] font-semibold text-white/38 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  />
                </div>
              </div>
            </section>

            <section id="roles" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <h2 className="text-xl font-semibold text-white">Roles & content style</h2>
              <div id="content-style" className="mt-5 scroll-mt-24 space-y-5">
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-xs text-white/55">Role search</span>
                    <input
                      value={roleSearch}
                      onChange={(event) => setRoleSearch(event.target.value)}
                      placeholder="Video editor, thumbnail designer..."
                      className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs text-white/55">Primary niche</span>
                    <input
                      list="content-style-niche-options"
                      value={contentStyleDraft.primary_niche}
                      onChange={(event) =>
                        setContentStyleDraft((prev) => ({ ...prev, primary_niche: event.target.value }))
                      }
                      placeholder="Retention editing, faceless finance, podcasts..."
                      className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                    />
                  </label>
                </div>
                <datalist id="content-style-niche-options">
                  {contentStyleNiches.map((niche) => <option key={`edit-niche-${niche}`} value={niche} />)}
                </datalist>

                {selectedRoles.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedRoles.map((role) => (
                      <button
                        key={`edit-selected-role-${role.id}`}
                        type="button"
                        onClick={() => void toggleRoleSelection(role.id)}
                        className="cursor-pointer rounded-full border border-white/20 bg-white/[0.08] px-3 py-1 text-xs text-white/90 transition-colors hover:bg-white/[0.12]"
                      >
                        {role.name}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {filteredRoleSuggestions.slice(0, 8).map((role) => (
                    <button
                      key={`edit-role-suggestion-${role.id}`}
                      type="button"
                      disabled={rolesSaving}
                      onClick={() => void toggleRoleSelection(role.id)}
                      className={[
                        "rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        selectedRoleIds.includes(role.id)
                          ? "cursor-pointer border-white/30 bg-white/[0.09] text-white"
                          : "cursor-pointer border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.08]",
                      ].join(" ")}
                    >
                      <p className="text-sm font-semibold">{role.name}</p>
                      <p className="mt-1 text-xs text-white/55">{role.category}</p>
                    </button>
                  ))}
                </div>

                <div>
                  <p className="text-xs text-white/55">Formats</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CONTENT_STYLE_FORMAT_OPTIONS.map((value) => (
                      <button
                        key={`edit-format-${value}`}
                        type="button"
                        onClick={() => toggleContentStyleChip("format", value)}
                        className={[
                          "cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors",
                          contentStyleDraft.format.includes(value)
                            ? "border-white/30 bg-white/[0.1] text-white"
                            : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]",
                        ].join(" ")}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs text-white/55">Tone</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CONTENT_STYLE_TONE_OPTIONS.map((value) => (
                      <button
                        key={`edit-tone-${value}`}
                        type="button"
                        onClick={() => toggleContentStyleChip("tone", value)}
                        className={[
                          "cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors",
                          contentStyleDraft.tone.includes(value)
                            ? "border-white/30 bg-white/[0.1] text-white"
                            : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]",
                        ].join(" ")}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-white/55">Target audience</span>
                  <input
                    value={contentStyleDraft.target_audience}
                    onChange={(event) =>
                      setContentStyleDraft((prev) => ({ ...prev, target_audience: event.target.value }))
                    }
                    className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                    placeholder="New content creators learning retention editing"
                  />
                </label>

                <div className="flex justify-end">
                  <SaveIconButton
                    onClick={() => void saveContentStyle()}
                    disabled={contentStyleSaving}
                    saving={contentStyleSaving}
                    ariaLabel="Save content style"
                  />
                </div>
              </div>
            </section>

            <section id="channels" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <h2 className="text-xl font-semibold text-white">Channels & trust</h2>
              <div className="mt-5 space-y-5">
                <PlatformLogosRow
                  isOwnerView={isOwnerView}
                  connectedAccounts={connectedAccounts}
                  onConnectAccount={connectPlatformAccount}
                  onRemoveAccount={removePlatformAccount}
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-xs text-white/55">Hiring type</span>
                    <select
                      value={draftHiringType}
                      onChange={(event) => setDraftHiringType(event.target.value as BackendHiringType | "")}
                      className="h-10 w-full cursor-pointer rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
                    >
                      <option value="">Choose type</option>
                      {HIRING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-white/55">Primary platform</span>
                    <select
                      value={draftHiringPrimaryPlatform}
                      onChange={(event) => setDraftHiringPrimaryPlatform(event.target.value as BackendHiringPrimaryPlatform | "")}
                      className="h-10 w-full cursor-pointer rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
                    >
                      <option value="">Choose platform</option>
                      {HIRING_PRIMARY_PLATFORM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-white/55">Website or social URL</span>
                    <input
                      value={draftHiringWebsiteOrSocialUrl}
                      onChange={(event) => setDraftHiringWebsiteOrSocialUrl(event.target.value)}
                      className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                      placeholder="https://youtube.com/@channel"
                    />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs text-white/55">Hiring context</span>
                  <textarea
                    value={draftHiringChannelsOrPagesManaged}
                    onChange={(event) => setDraftHiringChannelsOrPagesManaged(event.target.value)}
                    className="min-h-[82px] w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35"
                    placeholder="Optional context applicants can use to understand your hiring background."
                  />
                </label>
                <div className="flex justify-end">
                  <SaveIconButton
                    onClick={() => void saveHiringInfo()}
                    disabled={hiringSaving}
                    saving={hiringSaving}
                    ariaLabel="Save trust info"
                  />
                </div>
              </div>
            </section>

            <section id="preferences" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <h2 className="text-xl font-semibold text-white">Collaboration preferences</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <select
                  value={draftPreferenceProjectType}
                  onChange={(event) => setDraftPreferenceProjectType(event.target.value as "oneOff" | "retainer" | "either" | "")}
                  className="h-10 cursor-pointer rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
                >
                  <option value="">Project type preference</option>
                  <option value="oneOff">One-off</option>
                  <option value="retainer">Retainer</option>
                  <option value="either">Either</option>
                </select>
                <input value={draftPreferenceTurnaround} onChange={(event) => setDraftPreferenceTurnaround(event.target.value)} className="h-10 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Turnaround" />
                <input value={draftPreferenceRevisions} onChange={(event) => setDraftPreferenceRevisions(event.target.value)} className="h-10 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Revisions" />
              </div>
              <div className="mt-5 flex justify-end">
                <SaveIconButton
                  onClick={() => void saveInlineField("preferences")}
                  disabled={inlineSavingField === "preferences" || !isFieldDirty("preferences")}
                  saving={inlineSavingField === "preferences"}
                  ariaLabel="Save collaboration preferences"
                />
              </div>
            </section>

            <section id="visibility" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <h2 className="text-xl font-semibold text-white">Visibility & customization</h2>
	              <div className="mt-5 grid gap-3 md:grid-cols-2">
	                {[
	                  ["Links", profile.privacy_settings?.show_links],
	                  ["Tools", profile.privacy_settings?.show_skills],
	                  ["Location", profile.privacy_settings?.show_location],
                  ["Working hours", profile.privacy_settings?.show_availability],
                  ["YouTube badge", profile.privacy_settings?.show_youtube_badge],
                ].map(([label, enabled]) => (
                  <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
                    <p className="text-sm font-semibold text-white/82">{label}</p>
                    <p className="mt-1 text-xs text-white/48">{enabled ? "Shown when populated" : "Hidden by privacy settings"}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-profile-scope className="space-y-6">
      {previewParam && !previewDismissed ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-white/75">Previewing public profile</p>
          <button
            type="button"
            onClick={() => setPreviewDismissed(true)}
            className="h-8 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 hover:bg-white/[0.08] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
            Exit preview
          </button>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[30px] border border-white/10 bg-[#141519] shadow-[0_28px_90px_-52px_rgba(0,0,0,1)]">
        <div className="group/banner relative min-h-[150px] border-b border-white/10 bg-[#18191d] sm:min-h-[226px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.16),transparent_30%),radial-gradient(circle_at_78%_6%,rgba(255,255,255,0.08),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.018)_48%,rgba(0,0,0,0.28))]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#141519] to-transparent" />
          {isOwnerView ? (
            <Link
              href="/you/edit#banner"
              title="Banner upload is not available yet"
              className="pointer-events-none absolute inset-0 z-10 flex cursor-pointer items-center justify-center text-center opacity-0 transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/banner:pointer-events-auto group-hover/banner:opacity-100"
            >
              <span className="rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-white/62 backdrop-blur-sm transition-colors hover:bg-black/28 hover:text-white/78">
                <Icon name="image" className="mx-auto h-7 w-7" />
                <span className="mt-2 block text-sm font-semibold">Add banner image</span>
                <span className="mt-1 block text-xs text-white/42">Recommended 3200 × 410px</span>
              </span>
            </Link>
          ) : null}
        </div>

        <div className="px-5 pb-6 sm:px-8 sm:pb-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div ref={avatarMenuRef} className="relative z-10 -mt-8 shrink-0 sm:-mt-12">
                <button
                  type="button"
                  onClick={() => setAvatarMenuOpen((prev) => !prev)}
                  className="h-28 w-28 aspect-square overflow-hidden rounded-[28px] border border-white/20 bg-[#2a2b30] shadow-[0_24px_70px_-34px_rgba(0,0,0,1)] inline-flex items-center justify-center transition-colors hover:border-white/30 hover:bg-white/[0.12] sm:h-[136px] sm:w-[136px] cursor-pointer"
                  aria-label="Select avatar mode"
                >
                  {avatarPreviewUrl ? (
                    <img
                      src={avatarPreviewUrl}
                      alt={profile.display_name || profile.username || "Profile avatar"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <GenericAvatar />
                  )}
                </button>

                {avatarMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-72 rounded-2xl border border-white/15 bg-[#111216] p-3 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.95)]">
                    <p className="text-xs text-white/55">Avatar source</p>
                    <button
                      type="button"
                      onClick={() => void updateAvatarMode("generic")}
                      disabled={avatarSaving || profileSaving}
                      className={[
                        "mt-2 w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors inline-flex items-center justify-between cursor-pointer",
                        avatarMode === "generic"
                          ? "border-white/30 bg-white/[0.08] text-white"
                          : "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.08]",
                      ].join(" ")}
                    >
                      <span>Default avatar</span>
                      {avatarMode === "generic" ? <Icon name="check" className="h-4 w-4" /> : null}
                    </button>

                    {channelOptions.length ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-white/55">Use YouTube channel avatar</p>
                        {channelOptions.map((channel) => (
                          <button
                            key={channel.channel_id}
                            type="button"
                            onClick={() => void updateAvatarMode("youtube_channel", channel.channel_id)}
                            disabled={avatarSaving || profileSaving}
                            className={[
                              "w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors inline-flex items-center justify-between gap-2 cursor-pointer",
                              avatarMode === "youtube_channel" && avatarChannelId === channel.channel_id
                                ? "border-white/30 bg-white/[0.08] text-white"
                                : "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.08]",
                            ].join(" ")}
                          >
                            <span className="inline-flex min-w-0 items-center gap-2">
                              {channel.thumbnail_url ? (
                                <img
                                  src={channel.thumbnail_url}
                                  alt={channel.title}
                                  className="h-6 w-6 rounded-full object-cover"
                                />
                              ) : (
                                <span className="h-6 w-6 rounded-full border border-white/20 bg-white/[0.05] inline-flex items-center justify-center">
                                  <Icon name="youtube" className="h-3.5 w-3.5 text-white/70" />
                                </span>
                              )}
                              <span className="truncate">{channel.title}</span>
                            </span>
                            {avatarMode === "youtube_channel" && avatarChannelId === channel.channel_id ? (
                              <Icon name="check" className="h-4 w-4 shrink-0" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 flex justify-start sm:justify-center">
                  <div className="inline-flex w-fit items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.035] p-1">
                    {(["talent", "hiring"] as const).map((mode) => (
                      <button
                        key={`owner-header-profile-mode-${mode}`}
                        type="button"
                        aria-pressed={effectiveOwnerProfileMode === mode}
                        onClick={() => setOwnerProfileMode(mode)}
                        className={[
                          "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                          effectiveOwnerProfileMode === mode
                            ? "bg-white text-black"
                            : "text-white/55 hover:bg-white/[0.06] hover:text-white/82",
                        ].join(" ")}
                      >
                        {mode === "talent" ? "Talent" : "Recruiter"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-3 pt-4 sm:pt-5 lg:pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="max-w-full break-words text-[36px] font-semibold leading-[1.04] tracking-tight text-white sm:text-[46px] lg:text-[52px]">
                    {primaryDisplayName}
                  </h1>
                  <Link
                    href="/you/edit"
                    aria-label="Edit profile"
                    className="group/action relative mt-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.045] hover:text-white/86 focus:outline-none focus:ring-2 focus:ring-white/15"
                  >
                    <Icon name="pencil" className="h-4 w-4" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
                      Edit profile
                    </span>
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-medium text-white/55">
                  {heroMetadataParts.map((part, index) => (
                    <span key={`hero-meta-${part}`} className="inline-flex items-center gap-2.5">
                      {index > 0 ? <span className="text-white/22">•</span> : null}
                      <span>{part}</span>
                    </span>
                  ))}
                </div>

                <div className="max-w-4xl space-y-2.5">
                  <p className="text-base font-medium leading-relaxed text-white/78 sm:text-lg">
                    {heroHeadlineValue}
                  </p>
                  <p className="text-sm leading-6 text-white/54 sm:text-[15px]">{heroToolsValue}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <RatingDisplay />
                  {profile.profile_capabilities?.hasVerifiedSocialOrChannel ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/70">
                      Verified channel
                    </span>
                  ) : null}
                  {profile.profile_capabilities?.canPostJobs ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/70">
                      Hiring ready
                    </span>
                  ) : null}
                </div>

                <SocialIconRow links={ownerSocialIconLinks} />
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end lg:pt-7">
              <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.025] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <button
                  type="button"
                  aria-label="View public profile"
                  onClick={() =>
                    profile.username
                      ? window.open(`/u/${encodeURIComponent(profile.username)}?preview=1`, "_blank", "noopener,noreferrer")
                      : undefined
                  }
                  disabled={!profile.username}
                  className={[
                    "group/action relative inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                    profile.username
                      ? "text-white/48 hover:bg-white/[0.045] hover:text-white/86 focus:outline-none focus:ring-2 focus:ring-white/15 cursor-pointer"
                      : "text-white/28 cursor-not-allowed",
                  ].join(" ")}
                >
                  <Icon name="external-link" className="h-4 w-4" />
                  <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
                    View public profile
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      <nav className="overflow-x-auto border-b border-white/[0.08] px-5 pt-1 sm:px-8">
        <div className="flex min-w-max items-end gap-8">
          {[
            { key: "overview" as TopTab, label: "Overview" },
            { key: "portfolio" as TopTab, label: "Portfolio" },
            { key: "jobs" as TopTab, label: "Jobs" },
            { key: "applications" as TopTab, label: "Applications" },
            { key: "saved" as TopTab, label: "Saved" },
          ].map((item) => (
            <ProfileNavButton
              key={`profile-nav-${item.key}`}
              label={item.label}
              active={activeTab === item.key}
              onClick={() => setTab(item.key)}
            />
          ))}
        </div>
      </nav>

      <div className="px-5 py-5 sm:px-8 sm:py-7">
        <div className="min-w-0 space-y-6">
          {error ? (
            <section className="rounded-xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-xs text-amber-100">
              {error}
            </section>
          ) : null}

          <section className="min-w-0">
            <div className="min-w-0">
          {activeTab === "overview" ? (
            <div className="grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
              <div className="min-w-0">
                {effectiveOwnerProfileMode === "hiring" ? (
                  <>
                    <OwnerProfileInfoSection title="Hiring profile">
                      {ownerRecruiterProfileRows.length ? (
                        <dl className="space-y-1">
                          {ownerRecruiterProfileRows.map(([rowLabel, value]) => (
                            <OwnerProfileInfoRow key={`owner-hiring-profile-${rowLabel}`} label={rowLabel} value={value} />
                          ))}
                        </dl>
                      ) : (
                        <p className="text-sm leading-6 text-white/50">No hiring profile details added yet.</p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection title="Recruiter details">
                      {ownerRecruiterDetailRows.length ? (
                        <dl className="space-y-1">
                          {ownerRecruiterDetailRows.map(([rowLabel, value]) => (
                            <OwnerProfileInfoRow key={`owner-recruiter-detail-${rowLabel}`} label={rowLabel} value={value} />
                          ))}
                        </dl>
                      ) : (
                        <p className="text-sm leading-6 text-white/50">No recruiter details added yet.</p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection title="Collaboration">
                      {ownerRecruiterCollaborationRows.length ? (
                        <dl className="space-y-1">
                          {ownerRecruiterCollaborationRows.map(([rowLabel, value]) => (
                            <OwnerProfileInfoRow key={`owner-recruiter-collab-${rowLabel}`} label={rowLabel} value={value} />
                          ))}
                        </dl>
                      ) : (
                        <p className="text-sm leading-6 text-white/50">No collaboration details added yet.</p>
                      )}
                    </OwnerProfileInfoSection>
                  </>
                ) : (
                  <>
                    <OwnerProfileInfoSection
                      title="Experience"
                      actions={
                        !experienceEditorOpen ? (
                          <button
                            type="button"
                            onClick={startAddExperience}
                            className="inline-flex w-fit cursor-pointer items-center text-xs font-semibold text-white/58 transition-colors hover:text-white"
                          >
                            Add experience
                          </button>
                        ) : null
                      }
                    >
                      {!editingExperienceId && experienceEditorOpen ? (
                        <div ref={experienceCreateEditorRef} className={ownerExperienceItems.length ? "mb-5" : ""}>
                          <ProfileExperienceEditor
                            key={editingExperienceId || experienceForm.id || "new-experience"}
                            draft={experienceForm}
                            onChange={setExperienceForm}
                            onSubmit={() => void submitExperienceForm()}
                            onCancel={resetExperienceForm}
                            saving={experienceSaving}
                            isEditing={false}
                            autoFocusRole
                            focusRequest={experienceCreateFocusNonce}
                          />
                        </div>
                      ) : null}

                      {ownerExperienceItems.length ? (
                        <ProfileExperienceList
                          items={ownerExperienceItems}
                          editingItemId={editingExperienceId}
                          renderEditingItem={() => renderExperienceEditor(true)}
                          actions={(item) => (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => editExperienceItem(item)}
                                aria-label={`Edit experience at ${item.organization_name}`}
                                className="cursor-pointer text-[11px] font-semibold text-white/48 transition-colors hover:text-white"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeExperienceItem(item.id)}
                                aria-label={`Remove experience at ${item.organization_name}`}
                                disabled={experienceSaving}
                                className="cursor-pointer text-[11px] font-semibold text-white/38 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        />
                      ) : experienceEditorOpen ? null : (
                        <p className="text-sm leading-6 text-white/50">No experience added yet.</p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection title="Roles & content">
                      {ownerOverviewRows.length ? (
                        <dl className="space-y-1">
                          {ownerOverviewRows.map(([rowLabel, value]) => (
                            <OwnerProfileInfoRow key={`owner-roles-content-${rowLabel}`} label={rowLabel} value={value} />
                          ))}
                        </dl>
                      ) : (
                        <p className="text-sm leading-6 text-white/50">No role details added yet.</p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection title="Profile details">
                      {ownerProfileDetailsRows.length ? (
                        <dl className="space-y-1">
                          {ownerProfileDetailsRows.map(([rowLabel, value]) => (
                            <OwnerProfileInfoRow key={`owner-profile-detail-${rowLabel}`} label={rowLabel} value={value} />
                          ))}
                        </dl>
                      ) : (
                        <p className="text-sm leading-6 text-white/50">No profile details added yet.</p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection title="Collaboration">
                      {ownerCollaborationRows.length ? (
                        <dl className="space-y-1">
                          {ownerCollaborationRows.map(([rowLabel, value]) => (
                            <OwnerProfileInfoRow key={`owner-collab-${rowLabel}`} label={rowLabel} value={value} />
                          ))}
                        </dl>
                      ) : (
                        <p className="text-sm leading-6 text-white/50">No collaboration details added yet.</p>
                      )}
                    </OwnerProfileInfoSection>
                  </>
                )}
              </div>

              <aside className="min-w-0 lg:border-l lg:border-white/[0.08] lg:pl-8">
                {effectiveOwnerProfileMode === "hiring" ? (
                  <OwnerOverviewSideSection
                    title="Jobs"
                    count={formatOwnerCountLabel(activeJobs.length, "open job", "open jobs")}
                    actionLabel={activeJobs.length ? "View jobs →" : undefined}
                    onAction={activeJobs.length ? () => setTab("jobs") : undefined}
                  >
                    {ownerJobsPreview.length ? (
                      ownerJobsPreview.map((job) => (
                        <Link
                          key={`owner-overview-job-${job.id}`}
                          href={`/jobs/${encodeURIComponent(String(job.id))}`}
                          className="group block cursor-pointer text-sm"
                        >
                          <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                            {job.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-white/42">
                            {[job.category, job.location].filter(Boolean).join(" · ") || "Open job"}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="text-sm text-white/50">No open jobs.</p>
                    )}
                  </OwnerOverviewSideSection>
                ) : (
                  <OwnerOverviewSideSection
                    title="Portfolio"
                    count={formatOwnerCountLabel(publishedPortfolio.length, "project", "projects")}
                    actionLabel={publishedPortfolio.length ? "View portfolio →" : undefined}
                    onAction={publishedPortfolio.length ? () => setTab("portfolio") : undefined}
                  >
                    {ownerPortfolioPreview.length ? (
                      ownerPortfolioPreview.map((item) => (
                        <Link
                          key={`owner-overview-project-${item.id}`}
                          href={`/you/projects/${encodeURIComponent(item.id)}`}
                          className="group block cursor-pointer text-sm"
                        >
                          <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                            {item.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-white/42">
                            {[item.role_name || item.role || item.user_role_in_project, item.channel_name]
                              .filter(Boolean)
                              .join(" · ") || "Work sample"}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="text-sm text-white/50">No work samples added yet.</p>
                    )}
                  </OwnerOverviewSideSection>
                )}

                {effectiveOwnerProfileMode === "hiring" ? (
                  <OwnerOverviewSideSection
                    title="Portfolio"
                    count={formatOwnerCountLabel(publishedPortfolio.length, "project", "projects")}
                    actionLabel={publishedPortfolio.length ? "View portfolio →" : undefined}
                    onAction={publishedPortfolio.length ? () => setTab("portfolio") : undefined}
                  >
                    {ownerPortfolioPreview.length ? (
                      ownerPortfolioPreview.map((item) => (
                        <Link
                          key={`owner-overview-recruiter-project-${item.id}`}
                          href={`/you/projects/${encodeURIComponent(item.id)}`}
                          className="group block cursor-pointer text-sm"
                        >
                          <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                            {item.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-white/42">
                            {[item.role_name || item.role || item.user_role_in_project, item.channel_name]
                              .filter(Boolean)
                              .join(" · ") || "Work sample"}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="text-sm text-white/50">No work samples added yet.</p>
                    )}
                  </OwnerOverviewSideSection>
                ) : (
                  <OwnerOverviewSideSection title="Talent listings" count="0 talent listings">
                    <p className="text-sm text-white/50">No talent listings added yet.</p>
                  </OwnerOverviewSideSection>
                )}

                <OwnerOverviewSideSection
                  title={effectiveOwnerProfileMode === "hiring" ? "Talent listings" : "Jobs"}
                  count={
                    effectiveOwnerProfileMode === "hiring"
                      ? "0 talent listings"
                      : formatOwnerCountLabel(activeJobs.length, "open job", "open jobs")
                  }
                  actionLabel={effectiveOwnerProfileMode === "talent" && activeJobs.length ? "View jobs →" : undefined}
                  onAction={effectiveOwnerProfileMode === "talent" && activeJobs.length ? () => setTab("jobs") : undefined}
                >
                  {effectiveOwnerProfileMode === "hiring" ? (
                    <p className="text-sm text-white/50">No talent listings added yet.</p>
                  ) : ownerJobsPreview.length ? (
                    ownerJobsPreview.map((job) => (
                      <Link
                        key={`owner-overview-talent-job-${job.id}`}
                        href={`/jobs/${encodeURIComponent(String(job.id))}`}
                        className="group block cursor-pointer text-sm"
                      >
                        <span className="block truncate font-medium text-white/78 transition-colors group-hover:text-white">
                          {job.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-white/42">
                          {[job.category, job.location].filter(Boolean).join(" · ") || "Open job"}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <p className="text-sm text-white/50">No open jobs.</p>
                  )}
                </OwnerOverviewSideSection>
              </aside>
            </div>
          ) : null}

          {activeTab === "jobs" ? (
            <div className="space-y-5">
              {activeJobs.length ? (
                <div className="grid gap-3">
                  {activeJobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/jobs/${encodeURIComponent(String(job.id))}`}
                      className="group cursor-pointer rounded-3xl border border-white/[0.085] bg-white/[0.04] p-4 transition-colors hover:border-white/[0.16] hover:bg-white/[0.065] sm:p-5"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-white/58">
                              Open
                            </span>
                            {job.channel.verified ? (
                              <span className="rounded-full border border-white/[0.09] bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-white/58">
                                Verified
                              </span>
                            ) : null}
                          </div>
                          <h3 className="mt-3 text-base font-semibold tracking-tight text-white/92 sm:text-lg">
                            {job.title}
                          </h3>
                          <p className="mt-1 text-sm text-white/55">
                            {[job.channel.name, job.location, job.budget].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-white/68 transition-colors group-hover:bg-white/[0.07] group-hover:text-white">
                          View job
                          <Icon name="external-link" className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <JobsEmptyState owner />
              )}
            </div>
          ) : null}

          {activeTab === "portfolio" ? (
            <PortfolioProjectWorkspace
              portfolio={portfolio}
              rolesCatalog={rolesCatalog}
              withFreshBackendToken={withFreshBackendToken}
              onPortfolioChange={setPortfolio}
              onRefreshProfileCompletion={refreshProfileCompletion}
              setGlobalError={setError}
              persistenceDisabled={backendPersistenceUnavailable}
              launchSource={portfolioLaunchRequest?.sourceType || null}
              launchSourceKind={portfolioLaunchRequest?.sourceKind}
              launchSourceUrl={portfolioLaunchRequest?.sourceUrl || ""}
              launchSuggestedTitle={portfolioLaunchRequest?.suggestedTitle || ""}
              launchShouldFetchYouTube={Boolean(portfolioLaunchRequest?.shouldFetchYouTube)}
              launchLinkPreview={portfolioLaunchRequest?.linkPreview || null}
              launchPreviewError={portfolioLaunchRequest?.previewError || ""}
              onLaunchHandled={() => setPortfolioLaunchRequest(null)}
            />
          ) : null}

          {showLegacyPortfolioEditor && activeTab === "portfolio" ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Portfolio</h2>
                  <p className="mt-1 text-sm text-white/60">Show hiring teams what you can actually do.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => document.getElementById("youtube-import-card")?.scrollIntoView({ behavior: "smooth" })}
                    className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Icon name="youtube" className="h-4 w-4" />
                    Import from YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => document.getElementById("custom-project-card")?.scrollIntoView({ behavior: "smooth" })}
                    className="h-10 rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white/85 hover:bg-white/[0.08] inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    Add custom project
                  </button>
                </div>
              </div>

              {portfolioSuccess ? (
                <section className="rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-4 py-3 text-xs text-emerald-100">
                  {portfolioSuccess}
                </section>
              ) : null}

              <div className="space-y-4">
                  <article id="youtube-import-card" className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white/90">Import a work sample from YouTube</h3>
                      <p className="mt-1 text-xs text-white/60">
                        Paste a public YouTube video. We’ll fetch the thumbnail, title, channel, views, and public metadata. You add what you worked on.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        className="h-10 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={portfolioYouTubeUrl}
                        onChange={(event) => setPortfolioYouTubeUrl(event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => void handleFetchYouTubePortfolioPreview()}
                        disabled={portfolioYouTubeFetching}
                        className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60 inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Icon name="youtube" className="h-4 w-4" />
                        {portfolioYouTubeFetching ? "Fetching..." : "Fetch video"}
                      </button>
                    </div>

                    {portfolioYouTubePreview ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-4">
                        <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                          <div className="aspect-video overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                            {portfolioYouTubePreview.thumbnail_url ? (
                              <img
                                src={portfolioYouTubePreview.thumbnail_url}
                                alt={portfolioYouTubePreview.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full inline-flex items-center justify-center text-white/35">
                                <Icon name="youtube" className="h-8 w-8" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="inline-flex rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2 py-1 text-[11px] font-semibold text-emerald-100">
                              YouTube metadata fetched
                            </div>
                            <h4 className="mt-2 text-base font-semibold text-white/90">{portfolioYouTubePreview.title}</h4>
                            <p className="mt-1 text-xs text-white/55">
                              {[portfolioYouTubePreview.channel_name, formatCompactNumber(portfolioYouTubePreview.public_metrics.views) ? `${formatCompactNumber(portfolioYouTubePreview.public_metrics.views)} views` : null, formatDateShort(portfolioYouTubePreview.published_at), String(portfolioYouTubePreview.public_metrics.duration || "") || null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs text-white/60">Your role in this project (optional)</label>
                            <input
                              list="portfolio-role-options"
                              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                              placeholder="Video Editor"
                              value={portfolioRoleInProject}
                              onChange={(event) => setPortfolioRoleInProject(event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-white/60">Tools used</label>
                            <input
                              list="portfolio-tool-options"
                              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                              placeholder="Premiere Pro, After Effects"
                              value={portfolioYouTubeTools}
                              onChange={(event) => setPortfolioYouTubeTools(event.target.value)}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs text-white/60">What did you handle?</p>
                          <div className="flex flex-wrap gap-2">
                            {activeYouTubeContributionOptions.map((tag) => {
                              const selected = portfolioYouTubeContributionTags.includes(tag);
                              return (
                                <button
                                  key={`yt-contribution-${tag}`}
                                  type="button"
                                  onClick={() => toggleYouTubeContributionTag(tag)}
                                  className={[
                                    "rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer",
                                    selected
                                      ? "border-white/30 bg-white/[0.12] text-white"
                                      : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]",
                                  ].join(" ")}
                                >
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs text-white/60">Self-reported retention %</label>
                            <input
                              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              placeholder="Optional"
                              value={portfolioRetentionPercent}
                              onChange={(event) => setPortfolioRetentionPercent(event.target.value)}
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <select
                              className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer"
                              value={portfolioYouTubeStatus}
                              onChange={(event) => setPortfolioYouTubeStatus(event.target.value as "now" | "past")}
                            >
                              <option value="past">Past</option>
                              <option value="now">Now</option>
                            </select>
                            <label className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 inline-flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                              <input type="checkbox" checked={portfolioYouTubeIsPublic} onChange={(event) => setPortfolioYouTubeIsPublic(event.target.checked)} />
                              Public
                            </label>
                            <label className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 inline-flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                              <input type="checkbox" checked={portfolioYouTubeIsFeatured} onChange={(event) => setPortfolioYouTubeIsFeatured(event.target.checked)} />
                              Featured
                            </label>
                          </div>
                        </div>
                        <textarea
                          className="min-h-[80px] w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35"
                          placeholder="Notes / contribution summary"
                          value={portfolioYouTubeContributionSummary}
                          onChange={(event) => setPortfolioYouTubeContributionSummary(event.target.value)}
                        />
                        <SaveIconButton
                          onClick={() => void handleSaveYouTubePortfolio()}
                          disabled={portfolioYouTubeSaving}
                          saving={portfolioYouTubeSaving}
                          ariaLabel="Save portfolio item"
                        />
                      </div>
                    ) : null}
                  </article>

                  <article id="custom-project-card" className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-white/90">
                      {editingPortfolioId ? "Edit work sample" : "Add custom project"}
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Project title" value={portfolioTitle} onChange={(event) => setPortfolioTitle(event.target.value)} />
                      <select className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer" value={portfolioSourceType} onChange={(event) => setPortfolioSourceType(event.target.value as typeof portfolioSourceType)}>
                        {PORTFOLIO_SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
                      </select>
                    </div>
                    <input list="portfolio-role-options" className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Role (optional), e.g. Video Editor" value={portfolioRole} onChange={(event) => setPortfolioRole(event.target.value)} />
                    <textarea className="min-h-[90px] w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35" placeholder="Description / contribution summary" value={portfolioContributionSummary} onChange={(event) => setPortfolioContributionSummary(event.target.value)} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Media URL or project link" value={portfolioMediaUrl} onChange={(event) => setPortfolioMediaUrl(event.target.value)} />
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Thumbnail image URL" value={portfolioThumbnailUrl} onChange={(event) => setPortfolioThumbnailUrl(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-white/60">Contribution details</p>
                      <div className="flex flex-wrap gap-2">
                        {activeContributionOptions.map((tag) => {
                          const selected = portfolioContributionTags.includes(tag);
                          return (
                            <button key={`custom-contribution-${tag}`} type="button" onClick={() => toggleCustomContributionTag(tag)} className={["rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer", selected ? "border-white/30 bg-white/[0.12] text-white" : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]"].join(" ")}>
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Views" value={portfolioManualViews} onChange={(event) => setPortfolioManualViews(event.target.value)} />
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Retention %" value={portfolioCustomRetentionPercent} onChange={(event) => setPortfolioCustomRetentionPercent(event.target.value)} />
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="CTR %" value={portfolioCtrPercent} onChange={(event) => setPortfolioCtrPercent(event.target.value)} />
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Turnaround days" value={portfolioTurnaroundDays} onChange={(event) => setPortfolioTurnaroundDays(event.target.value)} />
                    </div>
                    <input className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Metric notes, links, conversion, subscribers gained, etc." value={portfolioMetricNotes} onChange={(event) => setPortfolioMetricNotes(event.target.value)} />
                    <input className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Links (comma or newline separated)" value={portfolioLinks} onChange={(event) => setPortfolioLinks(event.target.value)} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input list="portfolio-tool-options" className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Tools (comma separated)" value={portfolioTools} onChange={(event) => setPortfolioTools(event.target.value)} />
                      <input className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35" placeholder="Tags (comma separated)" value={portfolioTags} onChange={(event) => setPortfolioTags(event.target.value)} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <select className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white cursor-pointer" value={portfolioStatus} onChange={(event) => setPortfolioStatus(event.target.value as "now" | "past")}>
                        <option value="now">Now</option>
                        <option value="past">Past</option>
                      </select>
                      <label className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 inline-flex items-center gap-2 text-sm text-white/80 cursor-pointer"><input type="checkbox" checked={portfolioIsPublic} onChange={(event) => setPortfolioIsPublic(event.target.checked)} />Public</label>
                      <label className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 inline-flex items-center gap-2 text-sm text-white/80 cursor-pointer"><input type="checkbox" checked={portfolioIsFeatured} onChange={(event) => setPortfolioIsFeatured(event.target.checked)} />Featured</label>
                      <button type="button" onClick={handleSavePortfolioItem} disabled={portfolioSaving} className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60 inline-flex items-center justify-center gap-2 cursor-pointer">
                        <Icon name="check" className="h-4 w-4" />
                        {portfolioSaving ? "Saving..." : editingPortfolioId ? "Update" : "Add"}
                      </button>
                    </div>
                    {editingPortfolioId ? (
                      <button type="button" onClick={resetPortfolioForm} className="h-9 rounded-xl border border-white/15 bg-white/[0.04] px-4 text-xs font-semibold text-white/80 hover:bg-white/[0.08] inline-flex items-center gap-2 cursor-pointer">
                        <Icon name="x" className="h-4 w-4" />
                        Cancel edit
                      </button>
                    ) : null}
                  </article>

                  <datalist id="portfolio-role-options">
                    {rolesCatalog.map((role) => <option key={`portfolio-role-option-${role.id}`} value={role.name} />)}
                  </datalist>
                  <datalist id="portfolio-tool-options">
                    {PORTFOLIO_TOOL_OPTIONS.map((tool) => <option key={`portfolio-tool-option-${tool}`} value={tool} />)}
                  </datalist>

                  <section className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-white/90">Featured work</h3>
                        <p className="mt-1 text-xs text-white/55">Pin your strongest work sample for fast scanning.</p>
                      </div>
                    </div>
                    {featuredPortfolio.length ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {featuredPortfolio.slice(0, 2).map((item) => (
                          <article key={`featured-${item.id}`} className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Featured</p>
                            <p className="mt-1 text-sm font-semibold text-white/90">{item.title}</p>
                            <p className="mt-1 text-xs text-white/55">{item.role_name || item.role || sourceLabel(item.source_type, item.public_metrics?.source_type)}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60">No featured work pinned yet.</div>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="text-sm font-semibold text-white/90">All work</h3>
                      <div className="flex flex-wrap gap-2">
                        <SubTab label="Now" active={portfolioSubTab === "now"} onClick={() => setPortfolioSubTab("now")} />
                        <SubTab label="Past" active={portfolioSubTab === "past"} onClick={() => setPortfolioSubTab("past")} />
                        <select className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs font-semibold text-white/70 cursor-pointer" value={portfolioFilterSource} onChange={(event) => setPortfolioFilterSource(event.target.value)}>
                          <option value="all">All sources</option>
                          {PORTFOLIO_SOURCE_OPTIONS.map((source) => <option key={`filter-${source}`} value={source}>{sourceLabel(source)}</option>)}
                        </select>
                        <input className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-white placeholder:text-white/35" placeholder="Filter role" value={portfolioFilterRole} onChange={(event) => setPortfolioFilterRole(event.target.value)} />
                      </div>
                    </div>

                    {filteredPortfolio.length ? (
                      <div className="grid gap-3">
                        {filteredPortfolio.map((item) => {
                          const publicMetrics = item.public_metrics || {};
                          const manualMetrics = item.manual_metrics || {};
                          const views = formatCompactNumber(publicMetrics.views ?? item.views);
                          const likes = formatCompactNumber(publicMetrics.likes);
                          const comments = formatCompactNumber(publicMetrics.comments);
                          const retention = metricNumber(manualMetrics.retention_percent ?? item.retention_percent);
                          const ctr = metricNumber(manualMetrics.ctr_percent);
                          const turnaround = metricNumber(manualMetrics.turnaround_days);
                          return (
                            <article key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05]">
                              <div className="grid gap-0 sm:grid-cols-[220px_minmax(0,1fr)]">
                                <div className="aspect-video bg-white/[0.04] sm:aspect-auto">
                                  {item.thumbnail_url ? (
                                    <img src={item.thumbnail_url} alt={item.title} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="h-full min-h-[150px] w-full inline-flex items-center justify-center text-white/35">
                                      <Icon name={item.source_type === "youtube" ? "youtube" : "briefcase"} className="h-9 w-9" />
                                    </div>
                                  )}
                                </div>
                                <div className="p-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">{sourceLabel(item.source_type, item.public_metrics?.source_type)}</span>
                                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/65">{item.verification_status === "youtube_metadata_verified" ? "YouTube metadata verified" : "Self-reported"}</span>
                                    {item.is_featured ? <span className="rounded-full border border-white/20 bg-white/[0.1] px-2 py-1 text-[11px] font-semibold text-white">Featured</span> : null}
                                    <span className="text-[11px] text-white/45">{formatDateShort(item.published_at || item.published_date || item.created_at)}</span>
                                  </div>
                                  <h4 className="mt-3 text-base font-semibold text-white/90">{item.title}</h4>
                                  <p className="mt-1 text-xs text-white/55">{item.role_name || item.role || item.user_role_in_project || "Role not set"}</p>
                                  {item.contribution_summary || item.description ? <p className="mt-2 text-sm leading-relaxed text-white/65">{item.contribution_summary || item.description}</p> : null}
                                  {(item.contribution_tags || []).length ? <div className="mt-3 flex flex-wrap gap-1.5">{(item.contribution_tags || []).map((tag) => <TagPill key={`${item.id}-contribution-${tag}`}>{tag}</TagPill>)}</div> : null}
                                  {item.tools?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{item.tools.map((tool) => <TagPill key={`${item.id}-tool-${tool}`}>{tool}</TagPill>)}</div> : null}
                                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
                                    {views ? <span>{views} views</span> : null}
                                    {likes ? <span>{likes} likes</span> : null}
                                    {comments ? <span>{comments} comments</span> : null}
                                    {retention !== null ? <span>Self-reported retention {retention}%</span> : null}
                                    {ctr !== null ? <span>Self-reported CTR {ctr}%</span> : null}
                                    {turnaround !== null ? <span>{turnaround} day turnaround</span> : null}
                                  </div>
                                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap gap-2">
                                      {(item.links || []).slice(0, 2).map((link) => (
                                        <a key={`${item.id}-link-${link}`} href={link} target="_blank" rel="noreferrer" className="cursor-pointer break-all text-xs text-white/70 underline-offset-2 hover:text-white hover:underline">Open project</a>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button type="button" onClick={() => startEditPortfolio(item)} className="h-8 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 hover:bg-white/[0.08] inline-flex items-center gap-1.5 cursor-pointer"><Icon name="pencil" className="h-3.5 w-3.5" />Edit</button>
                                      <button type="button" onClick={() => void handleDeletePortfolio(item.id)} className="h-8 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-white/80 hover:bg-white/[0.08] inline-flex items-center gap-1.5 cursor-pointer"><Icon name="x" className="h-3.5 w-3.5" />Delete</button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center">
                        <p className="text-sm text-white/70">Start with one strong work sample. Import a YouTube video or add a custom project.</p>
                      </div>
                    )}
                  </section>
              </div>
            </div>
          ) : null}

          {activeTab === "applications" ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center">
              <p className="text-sm text-white/70">You haven&apos;t applied to any jobs yet.</p>
              <Link
                href="/"
                className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 cursor-pointer"
              >
                <Icon name="search" className="h-4 w-4 mr-2" />
                Browse jobs
              </Link>
            </div>
          ) : null}

          {activeTab === "saved" ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center">
              <p className="text-sm text-white/70">No saved jobs yet.</p>
              <Link
                href="/"
                className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 cursor-pointer"
              >
                <Icon name="search" className="h-4 w-4 mr-2" />
                Browse jobs
              </Link>
            </div>
          ) : null}
            </div>
          </section>
        </div>
      </div>
      </section>

      {workSampleChooserOpen ? (
        <AddWorkSampleChoiceModal
          onClose={() => setWorkSampleChooserOpen(false)}
          onChoose={chooseWorkSampleSource}
          onPreviewLink={previewWorkLink}
        />
      ) : null}

      {isOwnerView ? (
        <div className="fixed bottom-5 right-5 z-40 max-w-[calc(100vw-2.5rem)]">
          {setupWidgetOpen ? (
            <section className="w-[300px] max-w-full rounded-2xl border border-white/[0.085] bg-[#141519] p-3.5 shadow-[0_20px_70px_-38px_rgba(0,0,0,1)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white/95">Profile setup</h2>
                  <p className="mt-1 text-xs text-white/50">
                    {setupCompletionCount} of {setupTasks.length} complete
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{setupWidgetPercent}%</span>
                  <button
                    type="button"
                    onClick={() => setSetupWidgetOpen(false)}
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-white/62 transition-colors hover:bg-white/[0.075] hover:text-white"
                    aria-label="Collapse profile setup"
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 h-px overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white/45 transition-[width] duration-300 ease-out"
                  style={{ width: `${setupWidgetPercent}%` }}
                />
              </div>
              <div className="mt-3 space-y-1">
                {visibleSetupTasks.map((task) => (
                  <button
                    key={task.key}
                    type="button"
                    onClick={task.onClick}
                    className={[
                      "inline-flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-xs transition-colors hover:bg-white/[0.055]",
                      task.done ? "text-emerald-100/80" : "text-white/78",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-5 w-5 shrink-0 rounded-full border inline-flex items-center justify-center transition-colors",
                        task.done
                          ? "border-emerald-200/70 bg-emerald-200/10 text-emerald-200/95"
                          : "border-white/30 bg-transparent text-transparent",
                      ].join(" ")}
                    >
                      {task.done ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span
                      className={[
                        "min-w-0 flex-1 truncate",
                        task.done ? "text-emerald-100/78 line-through decoration-emerald-100/60" : "text-white/80",
                      ].join(" ")}
                    >
                      {task.label}
                    </span>
                  </button>
                ))}
              </div>
              {hiddenSetupTaskCount > 0 ? (
                <p className="mt-2 text-xs text-white/42">
                  {hiddenSetupTaskCount} more setup task{hiddenSetupTaskCount === 1 ? "" : "s"} hidden.
                </p>
              ) : null}
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setSetupWidgetOpen(true)}
              className="inline-flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.09] bg-[#141519] px-3 py-2.5 text-left shadow-[0_16px_54px_-34px_rgba(0,0,0,1)] transition-colors hover:bg-[#191a1e]"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-white/70">
                <Icon name="check" className="h-3.5 w-3.5" />
              </span>
              <span>
                <span className="block text-xs font-semibold text-white/90">Profile setup</span>
                <span className="block text-[11px] text-white/48">{setupWidgetPercent}% complete</span>
              </span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
