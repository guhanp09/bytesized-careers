"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendPortfolioItem,
  BackendPortfolioLinkPreviewResponse,
  BackendPortfolioYouTubePreviewResponse,
  BackendHiringPrimaryPlatform,
  BackendHiringType,
  BackendProfileExperienceItem,
  BackendProfileReviewItem,
  BackendProfileUpdatePayload,
  BackendProfileResponse,
  BackendRole,
  createMyPortfolioItem,
  canUseLocalMockFallback,
  deleteMyPortfolioItem,
  exchangeGoogleOAuthForBackend,
  getMyContentStyle,
  getMyProfileCompletion,
  updateMyOnboardingIntent,
  deleteJob,
  getMyProfile,
  getMyRoles,
  isBackendAuthError,
  isProductionRuntime,
  listContentStyleNiches,
  listJobsWithMeta,
  listMyPortfolio,
  listRoles,
  listMyYouTubeChannels,
  previewPortfolioLink,
  previewPortfolioYouTube,
  refreshMyYouTubeChannels,
  upsertMyContentStyle,
  upsertMyRoles,
  upsertMyRolesByName,
  upsertGoogleOAuthForMe,
  uploadMyAvatar,
  uploadMyBanner,
  updateMyPortfolioItem,
  updateMyProfile,
} from "../../lib/backendClient";
import { Job } from "../../lib/types";
import { Icon } from "../Icons";
import { JobCard } from "../JobCard";
import ConfirmDialog from "../ui/ConfirmDialog";
import RatingDisplay from "../RatingDisplay";
import JobsEmptyState from "../jobs/JobsEmptyState";
import PlatformLogosRow, {
  type ConnectedPlatformAccount,
  type PlatformKey,
} from "../profile/PlatformLogosRow";
import ProfileExperienceEditor, { type ProfileExperienceDraft } from "../profile/ProfileExperienceEditor";
import ProfileExperienceList from "../profile/ProfileExperienceList";
import PortfolioDetailRail from "../profile/PortfolioDetailRail";
import { ProfileReviewsPreviewRail, ProfileReviewsTabContent } from "../profile/ProfileReviews";
import SocialIconRow from "../profile/SocialIconRow";
import { TagPill } from "../ui";
import OwnerSavedTab from "./OwnerSavedTab";
import ProfileCompletionCard from "./ProfileCompletionCard";
import OnboardingNextSteps from "./OnboardingNextSteps";
import { hasChosenIntent, intentToMode, type OnboardingIntent } from "../../lib/onboarding";
import {
  buildRecruiterChecklist,
  buildTalentChecklist,
  checklistProgress,
} from "../../lib/profileChecklist";
import PortfolioProjectWorkspace from "./PortfolioProjectWorkspace";
import AddWorkSampleChoiceModal, { type WorkSampleAction, type WorkSampleSourceType } from "./AddWorkSampleChoiceModal";
import LocationAutocompleteField from "./LocationAutocompleteField";
import { ChipSelectEditor, SingleChoiceChips, WorkingHoursField } from "./HiringFieldEditors";
import ToolPicker, { formatToolString, parseToolString } from "./ToolPicker";
import {
  buildSocialIconLinks,
  normalizeSocialProfileUrl,
  platformDisplayName,
} from "../../lib/profileSocialLinks";
import { formatListingTitle } from "../../lib/displayText";
import { inferExperienceFromUrl, sortExperienceItems } from "../../lib/profileExperience";
import { findLocalLocationByDisplayName } from "../../lib/localLocations";
import { getCustomLocationValidationError, normalizeCustomLocationInput } from "../../lib/locationValidation";
import type { LocationDetails } from "../../lib/locationTypes";
import { normalizeProfileTag, sanitizeProfileTags, validateProfileTag, validateProfileTags } from "../../lib/profileTags";
import {
  formatProjectTypePreference,
  formatRevisionsPreference,
  formatTurnaroundPreference,
  formatWorkingHoursPreference,
  normalizeRevisionsPreferenceForSave,
  validateRevisionsPreference,
  validateTurnaroundPreference,
  type ProjectTypePreference,
} from "../../lib/workPreferences";

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
  bio: null,
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
    show_bio: true,
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

type TopTab = "overview" | "jobs" | "portfolio" | "reviews" | "saved";
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
  | "bio"
  | "skills"
  | "availability_status"
  | "location_timezone"
  | "preferences";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type ContentStyleDraft = {
  primary_niche: string;
  format: string[];
  tone: string[];
  target_audience: string;
};

type OwnerInlineEditorId =
  | "bio"
  | "specialization"
  | "platforms"
  | "tools"
  | "availability"
  | "work-preferences"
  | "work-model"
  // Recruiter/hiring profile field-specific editors (one per row).
  | "hiring-niches"
  | "hiring-genres"
  | "hiring-formats"
  | "hiring-platforms"
  | "hiring-collaboration"
  | "hiring-work-model"
  | "hiring-tags"
  // Talent profile field-specific editors (one per row).
  | "talent-niches"
  | "talent-genres"
  | "talent-formats"
  | "talent-platforms"
  | "talent-tags";

const ALL_TABS: TopTab[] = ["overview", "jobs", "portfolio", "reviews", "saved"];
const PAST_JOB_STATUSES = new Set(["archived", "closed", "filled", "expired"]);
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
// Suggestion catalogs for the recruiter/hiring profile field editors. Each field
// also accepts custom free-text where noted (see ownerRecruiterMetadataGroups).
const HIRING_NICHE_SUGGESTIONS = [
  "Tech",
  "Finance",
  "Gaming",
  "Education",
  "Health & Fitness",
  "Beauty",
  "Fashion",
  "Food",
  "Travel",
  "Business",
  "Entertainment",
  "Lifestyle",
  "Sports",
  "Music",
  "News & Politics",
  "Personal finance",
] as const;
const HIRING_GENRE_SUGGESTIONS = [
  "Explainers",
  "Tutorials",
  "Reviews",
  "Vlogs",
  "Interviews",
  "Documentaries",
  "Commentary",
  "Storytelling",
  "Reactions",
  "Listicles",
  "Case studies",
  "Behind the scenes",
] as const;
const HIRING_FORMAT_SUGGESTIONS = [
  "Long-form video",
  "Short-form video",
  "Thumbnails",
  "Scripts",
  "Editing",
  "Motion graphics",
  "Channel management",
  "Captions & subtitles",
  "Podcast editing",
  "Graphic design",
  "Voiceover",
  "Research",
] as const;
const HIRING_PLATFORM_SUGGESTIONS = [
  "YouTube",
  "Instagram",
  "TikTok",
  "LinkedIn",
  "X (Twitter)",
  "Facebook",
  "Twitch",
  "Spotify",
  "Threads",
  "Snapchat",
] as const;
const COLLABORATION_STYLE_SUGGESTIONS = [
  "One-off",
  "Retainer",
  "Part-time",
  "Full-time",
  "Contract",
  "Project-based",
  "Trial first",
  "Ongoing",
] as const;
const HIRING_TAG_SUGGESTIONS = [
  "Fast turnaround",
  "Hindi content",
  "Long-term",
  "Beginner friendly",
  "High volume",
  "Premium quality",
  "Remote friendly",
  "Flexible hours",
] as const;
const WORK_MODE_OPTIONS = ["Remote", "Hybrid", "On-site"] as const;
// Talent work-preferences presets. Project type stays code-backed (the backend
// enum), turnaround/revisions are suggestions that also accept custom text — so
// the field shows what a good answer looks like without spelling out a tutorial.
const PROJECT_TYPE_OPTIONS = [
  { value: "oneOff", label: "One-off" },
  { value: "retainer", label: "Retainer" },
  { value: "either", label: "Both" },
] as const;
const TURNAROUND_SUGGESTIONS = [
  { value: "Within 24 hours", label: "Within 24 hours" },
  { value: "2–3 days", label: "2–3 days" },
  { value: "About a week", label: "About a week" },
  { value: "2+ weeks", label: "2+ weeks" },
  { value: "Flexible / depends on scope", label: "Flexible / depends on scope" },
] as const;
const REVISIONS_SUGGESTIONS = [
  { value: "1 round", label: "1 round" },
  { value: "2 rounds", label: "2 rounds" },
  { value: "3 rounds", label: "3 rounds" },
  { value: "Unlimited", label: "Unlimited" },
  { value: "Case by case", label: "Case by case" },
] as const;
type WorkingHoursMode = "flexible" | "fixed";
type BasicsSocialLinkDraft = {
  id: string;
  value: string;
};
const DEFAULT_WORKING_HOURS_START = "09:00";
const DEFAULT_WORKING_HOURS_END = "18:00";
const DEFAULT_WORKING_HOURS_TIMEZONE = "IST";
const FLEXIBLE_WORKING_HOURS_LABEL = "Flexible working hours";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const RESERVED_PROFILE_HANDLES = new Set([
  "you",
  "jobs",
  "talent",
  "post",
  "admin",
  "api",
  "login",
  "signup",
  "settings",
  "applications",
  "reviews",
  "portfolio",
  "search",
  "saved",
]);
const RECENT_HIRE_ROLE_LABELS: Record<string, string> = {
  editing: "Video Editor",
  design: "Designer",
  writing: "Scriptwriter",
  thumbnails: "Thumbnail Designer",
  shorts: "Shorts Editor",
  "motion graphics": "Motion Designer",
  "channel manager": "Channel Manager",
  research: "Researcher",
  "voice over": "Voice Actor",
  marketing: "Marketing Strategist",
};

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
      aria-pressed={active}
      onClick={onClick}
      className={[
        "group relative h-12 whitespace-nowrap px-2 text-left transition-colors cursor-pointer",
        active ? "text-white" : "text-white/58 hover:text-white/82",
      ].join(" ")}
    >
      <span className="block pt-3 text-[15px] font-semibold leading-none">{label}</span>
      <span
        className={[
          "absolute inset-x-2 bottom-0 h-[2.5px] origin-center rounded-full bg-white transition-[transform,opacity] duration-300 ease-out",
          active ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-30",
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
  title: ReactNode;
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

function InlineHelpTooltip({
  label,
  tooltip,
  tooltipId,
}: {
  label: string;
  tooltip: string;
  tooltipId: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <span className="relative inline-flex">
        <button
          type="button"
          aria-label={`${label} help`}
          aria-describedby={tooltipId}
          className="peer inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-white/12 text-white/45 transition-colors hover:border-white/22 hover:text-white/74 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 focus-visible:text-white/74"
        >
          <Icon name="help" className="h-3.5 w-3.5" />
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-white/10 bg-[#111216] px-3 py-2 text-[11px] font-medium leading-5 text-white/76 opacity-0 shadow-[0_18px_40px_-24px_rgba(0,0,0,1)] transition-opacity duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100"
        >
          {tooltip}
        </span>
      </span>
    </span>
  );
}

function OwnerInlineActionButton({
  label,
  icon = "pencil",
  onClick,
  expanded,
  controlsId,
}: {
  label: string;
  icon?: "pencil" | "plus";
  onClick: () => void;
  expanded?: boolean;
  controlsId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={expanded ? controlsId : undefined}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

function OwnerInlineGhostLink({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <Link href={href} className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white">
      <span>{label}</span>
    </Link>
  );
}

function OwnerInlineEditorActions({
  onCancel,
  onSave,
  saving,
  saveLabel,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel: string;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer text-xs font-medium text-white/48 transition-colors hover:text-white"
      >
        Cancel
      </button>
      <SaveIconButton onClick={onSave} saving={saving} ariaLabel={saveLabel} disabled={saving} />
    </div>
  );
}

function OwnerMetadataSidebar({
  groups,
}: {
  groups: Array<{
    key: string;
    label: string;
    values: string[];
    emptyLabel: string;
    actions?: ReactNode;
    editor?: ReactNode;
  }>;
}) {
  return (
    <aside className="min-w-0 lg:border-l lg:border-white/[0.08] lg:pl-8">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={`owner-metadata-${group.key}`} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/34">{group.label}</h4>
              {group.actions}
            </div>
            {group.editor ? (
              group.editor
            ) : group.values.length ? (
              <div className="flex flex-wrap gap-1.5">
                {group.values.slice(0, 8).map((value) => (
                  <TagPill key={`owner-metadata-${group.key}-${value}`}>{value}</TagPill>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-white/46">{group.emptyLabel}</p>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function OwnerPortfolioPreviewList({ items }: { items: BackendPortfolioItem[] }) {
  return (
    <PortfolioDetailRail
      items={items}
      ariaLabel="Portfolio preview"
      keyPrefix="owner-overview-project"
      itemControlsId="owner-overview-portfolio-popup"
    />
  );
}

/**
 * Owner-only wrapper around a JobCard: renders the normal card plus a small overflow
 * menu (top-right) with a Delete action. The menu lives as a sibling of the card's
 * `role="link"` element (not nested inside it), so it never hijacks card navigation.
 */
function OwnerJobCard({
  job,
  token,
  onDeleted,
}: {
  job: Job;
  token?: string;
  onDeleted: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!token) {
      setError("Sign in again to delete this job.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteJob(token, String(job.id));
      setConfirmOpen(false);
      onDeleted(String(job.id));
    } catch {
      setError("Couldn’t delete this job. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <JobCard job={job} />

      <div className="absolute right-2.5 top-2.5 z-20">
        <button
          type="button"
          aria-label="Manage job"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Manage"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#15151b]/90 text-white/60 backdrop-blur transition hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <Icon name="more" className="h-[18px] w-[18px]" />
        </button>

        {menuOpen ? (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div
              role="menu"
              aria-label="Manage job"
              className="absolute right-0 z-50 mt-2 w-44 rounded-2xl border border-white/[0.1] bg-[#15151b] p-1.5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)]"
            >
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="trash" className="h-4 w-4 text-white/50" />
                Delete job
              </button>
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] font-medium text-amber-100/85">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this job?"
        body="It will be removed from the marketplace and can’t be undone. Applications you’ve already received stay in your inbox."
        confirmLabel="Delete job"
        destructive
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function OwnerJobsPreviewList({
  items,
  token,
  onJobDeleted,
}: {
  items: Job[];
  token?: string;
  onJobDeleted: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden">
      <div
        aria-label="Jobs preview"
        className="flex snap-x snap-proximity gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,transparent,black_18px,black_calc(100%-18px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((job) => (
          <div
            key={`owner-overview-job-${job.id}`}
            className="min-w-[340px] snap-start sm:min-w-[360px] lg:min-w-[390px]"
          >
            <OwnerJobCard job={job} token={token} onDeleted={onJobDeleted} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OwnerHiringExperienceList({ items }: { items: Job[] }) {
  return (
    <div className="divide-y divide-white/[0.08]">
      {items.map((job) => {
        const orgName = job.channel.name.trim() || "Creator team";
        const roleLabel = normalizeRecentHireRole(job.category || job.title);
        const initials = orgName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("");
        return (
          <div key={`owner-hiring-experience-${job.id}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-4 first:pt-0 last:pb-0">
            <div className="flex h-11 w-11 shrink-0 self-start items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-xs font-semibold text-white/62">
              {job.channel.logoUrl ? (
                <img src={job.channel.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials || "CJ"
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/88">
                {roleLabel} | {orgName}
              </p>
              <p className="mt-1 text-sm font-medium text-white/58">{job.type || job.contractType || "Engagement"}</p>
              <p className="mt-1 text-xs text-white/45">
                {[job.postedShort, job.workMode || job.location].filter(Boolean).join(" · ")}
              </p>
              {job.tags.length ? <p className="mt-1 text-xs text-white/45">{job.tags.slice(0, 4).join(" · ")}</p> : null}
              <p className="mt-2 text-sm leading-6 text-white/62">{formatListingTitle(job.title)}</p>
            </div>
          </div>
        );
      })}
    </div>
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

const normalizeRecentHireRole = (value?: string | null) => {
  const text = cleanOwnerText(value);
  if (!text) return "Creator Role";
  const withoutPrefix = text.replace(/^hired\s+/i, "").trim();
  return RECENT_HIRE_ROLE_LABELS[withoutPrefix.toLowerCase()] || withoutPrefix;
};

const formatOwnerTextValue = (value?: string | null) => cleanOwnerText(value) || "–";

const splitOwnerValues = (value?: string | null) =>
  (value || "")
    .split(/[·,]/)
    .map((part) => cleanOwnerText(part))
    .filter((part): part is string => Boolean(part));

const cleanOwnerList = (values: Array<string | null | undefined>) =>
  values.map((value) => cleanOwnerText(value)).filter((value): value is string => Boolean(value));

const createBasicsSocialLinkDraft = (value = ""): BasicsSocialLinkDraft => ({
  id: `social-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  value,
});

const normalizeProfileHandle = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();

const validateBasicsDisplayName = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "Display name is required.";
  if (trimmed.length < 2) return "Display name must be at least 2 characters.";
  if (trimmed.length > 80) return "Display name is too long.";
  if (/https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) {
    return "Use your name or brand name, not a URL.";
  }
  if (/\s{3,}/.test(trimmed)) return "Use normal spacing in your name.";
  return null;
};

const validateBasicsUsername = (value: string) => {
  const normalized = normalizeProfileHandle(value);
  if (!normalized) return "Username is required.";
  if (normalized.length < 3 || normalized.length > 20) return "Username must be 3-20 characters.";
  if (/\s/.test(normalized)) return "Usernames cannot contain spaces.";
  if (/[/.]/.test(normalized) || /https?:\/\/|www\./i.test(value)) {
    return "Use your profile username, not a URL.";
  }
  if (!/^[a-z0-9][a-z0-9_]{2,19}$/.test(normalized)) {
    return "Use only lowercase letters, numbers, or underscores.";
  }
  if (RESERVED_PROFILE_HANDLES.has(normalized)) return "This username is reserved.";
  return null;
};

const normalizeBasicsSocialLinks = (drafts: BasicsSocialLinkDraft[]) => {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const raw = draft.value.trim();
    if (!raw) continue;
    const normalized = normalizeSocialProfileUrl(raw);
    if (!normalized.ok) {
      return { ok: false as const, error: normalized.error };
    }
    const key = normalized.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(normalized.url);
  }
  return { ok: true as const, urls };
};

const formatOwnerProjectType = (value?: string | null) => {
  return formatProjectTypePreference(value) || formatOwnerTextValue(value);
};

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

const HEADLINE_PLACEHOLDERS = [
  "Video editor for tech reviewers",
  "Videographer for food vloggers in Mumbai",
  "Thumbnail designer for finance YouTubers",
  "Script writer for Hindi comedy pages on Instagram",
] as const;

const HEADLINE_HELP_TOOLTIP =
  "A one-line role statement shown under your name. Make it highly specific: your primary role + your niche/platform/location.";

const OWNER_BIO_EMPTY_STATE = "Add a professional introduction.";
const TALENT_BIO_HELP_TOOLTIP =
  "Write a short professional introduction in your own voice. Highlight what sets you apart in your niche and the kind of opportunities you're looking for (as talent seeking job opportunities).";
const RECRUITER_BIO_HELP_TOOLTIP =
  "Write a short professional introduction in your own voice. Explain what you create or hire for, what makes your projects distinct, and the kind of talent you want to collaborate with (as a recruiter seeking collaboration with talent).";

const resolveLocationDraftForSave = ({
  draftLocation,
  currentLocation,
  selectedLocation,
}: {
  draftLocation: string;
  currentLocation?: string | null;
  selectedLocation: LocationDetails | null;
}) => {
  const nextLocation = normalizeCustomLocationInput(draftLocation);
  if (!nextLocation) return { displayName: "" };

  const storedLocation = (currentLocation || "").trim();
  if (selectedLocation?.displayName === nextLocation) {
    return { displayName: selectedLocation.displayName };
  }

  const knownLocalLocation = findLocalLocationByDisplayName(nextLocation);
  if (knownLocalLocation) {
    return { displayName: knownLocalLocation.displayName };
  }

  if (nextLocation === storedLocation && !selectedLocation) {
    return { displayName: nextLocation };
  }

  const customLocationError = getCustomLocationValidationError(nextLocation);
  if (customLocationError) {
    return { error: customLocationError };
  }

  return { displayName: nextLocation };
};

export default function YouHubClient({ backendAccessToken, mode = "display" }: YouHubClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus, update: updateSession } = useSession();
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerObjectUrlRef = useRef<string | null>(null);
  const basicsEditorRef = useRef<HTMLDivElement | null>(null);
  const basicsHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [onboardingIntentSaving, setOnboardingIntentSaving] = useState(false);
  const [onboardingChosenLocally, setOnboardingChosenLocally] = useState(false);
  const onboardingModeInitializedRef = useRef(false);
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
  const [bannerSaving, setBannerSaving] = useState(false);
  const [bannerUploadPreviewUrl, setBannerUploadPreviewUrl] = useState<string | null>(null);
  const [basicsEditorOpen, setBasicsEditorOpen] = useState(false);
  const [basicsSaving, setBasicsSaving] = useState(false);
  const [basicsError, setBasicsError] = useState<string | null>(null);
  const [basicsEditorHighlighted, setBasicsEditorHighlighted] = useState(false);
  const [headlineGhostExampleIndex, setHeadlineGhostExampleIndex] = useState(0);
  const [headlineGhostText, setHeadlineGhostText] = useState("");
  const [headlineGhostDeleting, setHeadlineGhostDeleting] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState<EditorSectionId>("basics");
  const [activeOwnerInlineEditor, setActiveOwnerInlineEditor] = useState<OwnerInlineEditorId | null>(null);
  const [workSampleChooserOpen, setWorkSampleChooserOpen] = useState(false);
  const [setupWidgetOpen, setSetupWidgetOpen] = useState(false);

  const [profile, setProfile] = useState<BackendProfileResponse | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [portfolio, setPortfolio] = useState<BackendPortfolioItem[]>([]);
  const [channelOptions, setChannelOptions] = useState<
    Array<{ channel_id: string; title: string; thumbnail_url?: string | null }>
  >([]);
  const [resolvedBackendAccessToken, setResolvedBackendAccessToken] = useState<string | undefined>(
    backendAccessToken
  );

  const [inlineSavingField, setInlineSavingField] = useState<InlineField | null>(null);

  const [draftDisplayName, setDraftDisplayName] = useState("");
  const [draftUsername, setDraftUsername] = useState("");
  const [draftHeadline, setDraftHeadline] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [draftSocialLinks, setDraftSocialLinks] = useState<BasicsSocialLinkDraft[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [experienceDraft, setExperienceDraft] = useState<BackendProfileExperienceItem[]>([]);
  const [experienceForm, setExperienceForm] = useState<ProfileExperienceDraft>(() => createEmptyExperienceForm());
  const [editingExperienceId, setEditingExperienceId] = useState<string | null>(null);
  const [experienceEditorOpen, setExperienceEditorOpen] = useState(isEditMode);
  const [experienceSaving, setExperienceSaving] = useState(false);
  const [experienceCreateFocusNonce, setExperienceCreateFocusNonce] = useState(0);
  const experienceCreateEditorRef = useRef<HTMLDivElement | null>(null);
  const [draftLocation, setDraftLocation] = useState("");
  const [draftLocationSelection, setDraftLocationSelection] = useState<LocationDetails | null>(null);
  const [locationDraftError, setLocationDraftError] = useState<string | null>(null);
  const [draftAvailabilityStatus, setDraftAvailabilityStatus] =
    useState<BackendProfileResponse["availability_status"]>("selective");
  const [workingHoursMode, setWorkingHoursMode] = useState<WorkingHoursMode>("flexible");
  const [workingHoursStart, setWorkingHoursStart] = useState(DEFAULT_WORKING_HOURS_START);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(DEFAULT_WORKING_HOURS_END);
  const [workingHoursTimezone, setWorkingHoursTimezone] = useState(DEFAULT_WORKING_HOURS_TIMEZONE);
  const [draftPreferenceProjectType, setDraftPreferenceProjectType] = useState<ProjectTypePreference | "">("");
  const [draftPreferenceTurnaround, setDraftPreferenceTurnaround] = useState("");
  const [draftPreferenceRevisions, setDraftPreferenceRevisions] = useState("");
  const [preferenceDraftError, setPreferenceDraftError] = useState<string | null>(null);
  const [draftHiringType, setDraftHiringType] = useState<BackendHiringType | "">("");
  const [draftHiringWebsiteOrSocialUrl, setDraftHiringWebsiteOrSocialUrl] = useState("");
  const [draftHiringPrimaryPlatform, setDraftHiringPrimaryPlatform] =
    useState<BackendHiringPrimaryPlatform | "">("");
  const [draftHiringChannelsOrPagesManaged, setDraftHiringChannelsOrPagesManaged] = useState("");
  const [draftWorkMode, setDraftWorkMode] = useState("");
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
  // The setter feeds refreshProfileCompletion (used across save flows); the value
  // itself is no longer read directly — checklist signals derive from local state.
  const [, setCompletionMissingSections] = useState<string[]>([]);
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
    setDraftUsername(data.username || "");
    setDraftHeadline(data.headline || "");
    setDraftBio(data.bio || "");
    const publicLinks = data.public_links || [];
    setDraftSocialLinks(
      publicLinks.length
        ? publicLinks.map((url) => createBasicsSocialLinkDraft(url))
        : [createBasicsSocialLinkDraft("")]
    );
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
    setDraftLocationSelection(null);
    setLocationDraftError(null);
    setDraftAvailabilityStatus(data.availability_status || "selective");
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
    setDraftWorkMode(data.collaboration_preferences?.work_mode || "");
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
      const canUseOfflineShell = !isProductionRuntime() || canUseLocalMockFallback();

      if (!backendToken && canUseOfflineShell) {
        myProfile = buildOfflineProfile(offlineProfileIdentity);
        usingOfflineProfile = true;
        setBackendPersistenceUnavailable(true);
      } else {
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
      }
      if (!myProfile) {
        if (canUseOfflineShell && (isBackendUnavailableError(profileError) || !backendToken)) {
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
        setError(null);
        setPortfolio([]);
        setChannelOptions([]);
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
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setPortfolio(portfolioItems);
      setChannelOptions(channels);
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
    if (typeof window === "undefined") return;
    if (!basicsEditorOpen) return;

    const panel = basicsEditorRef.current;
    if (!panel) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rect = panel.getBoundingClientRect();
    const topMargin = 88;
    const bottomMargin = 40;
    const fullyVisible = rect.top >= topMargin && rect.bottom <= window.innerHeight - bottomMargin;

    if (!fullyVisible) {
      panel.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    }

    setBasicsEditorHighlighted(true);
    if (basicsHighlightTimeoutRef.current) {
      clearTimeout(basicsHighlightTimeoutRef.current);
    }
    basicsHighlightTimeoutRef.current = setTimeout(() => {
      setBasicsEditorHighlighted(false);
      basicsHighlightTimeoutRef.current = null;
    }, prefersReducedMotion ? 900 : 1200);

    return () => {
      if (basicsHighlightTimeoutRef.current) {
        clearTimeout(basicsHighlightTimeoutRef.current);
        basicsHighlightTimeoutRef.current = null;
      }
    };
  }, [basicsEditorOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!basicsEditorOpen || draftHeadline.trim()) {
      setHeadlineGhostText("");
      setHeadlineGhostDeleting(false);
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const example = HEADLINE_PLACEHOLDERS[headlineGhostExampleIndex];

    if (prefersReducedMotion) {
      setHeadlineGhostText(example);
      setHeadlineGhostDeleting(false);
      return;
    }

    let timeoutMs = 55;
    let nextAction = () => {
      setHeadlineGhostText((current) => current + example.charAt(current.length));
    };

    if (!headlineGhostDeleting && headlineGhostText.length >= example.length) {
      timeoutMs = 1300;
      nextAction = () => setHeadlineGhostDeleting(true);
    } else if (headlineGhostDeleting && headlineGhostText.length > 0) {
      timeoutMs = 28;
      nextAction = () => setHeadlineGhostText((current) => current.slice(0, -1));
    } else if (headlineGhostDeleting && headlineGhostText.length === 0) {
      timeoutMs = 260;
      nextAction = () => {
        setHeadlineGhostDeleting(false);
        setHeadlineGhostExampleIndex((current) => (current + 1) % HEADLINE_PLACEHOLDERS.length);
      };
    }

    const timeoutId = window.setTimeout(nextAction, timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [basicsEditorOpen, draftHeadline, headlineGhostDeleting, headlineGhostExampleIndex, headlineGhostText]);

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
  // After an owner deletes one of their jobs from a card menu, drop it from local
  // state so the grid/preview update instantly without a full reload.
  const handleJobDeleted = useCallback((id: string) => {
    setJobs((prev) => prev.filter((job) => String(job.id) !== String(id)));
  }, []);
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

  // Profile completion is now driven by the unified, mode-aware checklist built
  // below (buildTalentChecklist / buildRecruiterChecklist), which both the inline
  // ProfileCompletionCard and the floating setup bubble consume.

  const sessionOnboardingIntent = (session?.user?.onboardingIntent ?? null) as OnboardingIntent | null;
  const sessionOnboardingSelectedAt = session?.user?.onboardingIntentSelectedAt ?? null;
  const onboardingChosen =
    onboardingChosenLocally || hasChosenIntent(sessionOnboardingSelectedAt);

  // Open the hub in the mode the user's onboarding intent implies — once, on first
  // authenticated load, and never overriding a later manual mode switch.
  useEffect(() => {
    if (onboardingModeInitializedRef.current) return;
    if (sessionStatus !== "authenticated") return;
    onboardingModeInitializedRef.current = true;
    const intentMode = intentToMode(sessionOnboardingIntent);
    if (intentMode) setOwnerProfileMode(intentMode);
  }, [sessionStatus, sessionOnboardingIntent]);

  const handleChooseOnboardingIntent = useCallback(
    async (intent: OnboardingIntent) => {
      setOnboardingIntentSaving(true);
      setOnboardingChosenLocally(true); // optimistic: hide the chooser immediately
      const intentMode = intentToMode(intent);
      if (intentMode) setOwnerProfileMode(intentMode);
      try {
        const me = await withFreshBackendToken((token) => updateMyOnboardingIntent(token, intent));
        await updateSession({
          user: {
            onboardingIntent: me.onboarding_intent,
            onboardingIntentSelectedAt: me.onboarding_intent_selected_at ?? new Date().toISOString(),
          },
        });
      } catch {
        // Non-fatal: the local choice still drives this session's UI and will persist
        // on the next successful profile sync.
      } finally {
        setOnboardingIntentSaving(false);
      }
    },
    [updateSession, withFreshBackendToken]
  );

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
      sanitizeProfileTags(splitOwnerValues(contentStyleDraft.target_audience)).length
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
    const targetAudienceTags = splitOwnerValues(contentStyleDraft.target_audience);
    const tagError = validateProfileTags(targetAudienceTags);
    if (tagError) {
      throw new Error(tagError);
    }
    const normalizedTargetAudience = sanitizeProfileTags(targetAudienceTags).join(", ");
    const updated = await withFreshBackendToken((token) =>
      upsertMyContentStyle(token, {
        primary_niche: contentStyleDraft.primary_niche || null,
        format: contentStyleDraft.format,
        tone: contentStyleDraft.tone,
        target_audience: normalizedTargetAudience || null,
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save content style.");
      return false;
    } finally {
      setContentStyleSaving(false);
    }
  }, [persistContentStyle, router]);

  const resetToolsDraft = useCallback(() => {
    setSelectedTools(
      parseToolString(profile?.collaboration_preferences?.tools).length
        ? parseToolString(profile?.collaboration_preferences?.tools)
        : normalizeList(profile?.skills)
    );
  }, [profile?.collaboration_preferences?.tools, profile?.skills]);

  const resetLocationDraft = useCallback(() => {
    setDraftLocation(profile?.location || "");
    setDraftLocationSelection(null);
    setLocationDraftError(null);
    const parsedWorkingHours = parseWorkingHours(
      profile?.collaboration_preferences?.working_hours,
      profile?.timezone
    );
    setWorkingHoursMode(parsedWorkingHours.mode);
    setWorkingHoursStart(parsedWorkingHours.start);
    setWorkingHoursEnd(parsedWorkingHours.end);
    setWorkingHoursTimezone(parsedWorkingHours.timezone);
  }, [profile?.collaboration_preferences?.working_hours, profile?.location, profile?.timezone]);

  const resetPreferencesDraft = useCallback(() => {
    setPreferenceDraftError(null);
    setDraftPreferenceProjectType(profile?.collaboration_preferences?.project_type_preference || "");
    setDraftPreferenceTurnaround(profile?.collaboration_preferences?.turnaround || "");
    setDraftPreferenceRevisions(profile?.collaboration_preferences?.revisions || "");
    const parsedWorkingHours = parseWorkingHours(
      profile?.collaboration_preferences?.working_hours,
      profile?.timezone
    );
    setWorkingHoursMode(parsedWorkingHours.mode);
    setWorkingHoursStart(parsedWorkingHours.start);
    setWorkingHoursEnd(parsedWorkingHours.end);
    setWorkingHoursTimezone(parsedWorkingHours.timezone);
  }, [
    profile?.collaboration_preferences?.project_type_preference,
    profile?.collaboration_preferences?.revisions,
    profile?.collaboration_preferences?.turnaround,
    profile?.collaboration_preferences?.working_hours,
    profile?.timezone,
  ]);


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
      availability_status: draftAvailabilityStatus || "selective",
      location:
        resolveLocationDraftForSave({
          draftLocation,
          currentLocation: profile?.location,
          selectedLocation: draftLocationSelection,
        }).displayName ?? draftLocation.trim(),
      timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : "",
      project_type_preference: draftPreferenceProjectType || null,
      collaboration_turnaround: draftPreferenceTurnaround.trim(),
      collaboration_revisions: normalizeRevisionsPreferenceForSave(draftPreferenceRevisions),
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
      draftAvailabilityStatus,
      experienceDraft,
      draftLocationSelection,
      draftHiringChannelsOrPagesManaged,
      draftHiringPrimaryPlatform,
      draftHiringType,
      draftHiringWebsiteOrSocialUrl,
      draftLocation,
      draftPreferenceProjectType,
      draftPreferenceRevisions,
      draftPreferenceTurnaround,
      selectedTools,
      profile?.location,
      workingHoursEnd,
      workingHoursMode,
      workingHoursStart,
      workingHoursTimezone,
    ]
  );

  const validatePreferencesDraft = useCallback(() => {
    const nextError =
      validateTurnaroundPreference(draftPreferenceTurnaround) ||
      validateRevisionsPreference(draftPreferenceRevisions);
    setPreferenceDraftError(nextError);
    if (nextError) {
      setError(nextError);
      return false;
    }
    return true;
  }, [draftPreferenceRevisions, draftPreferenceTurnaround]);

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

      if (!file.type.startsWith("image/") || !ALLOWED_AVATAR_TYPES.has(file.type)) {
        setError("Upload an image file.");
        return;
      }

      if (file.size > AVATAR_MAX_BYTES) {
        setError("Image is too large.");
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
        setError(err instanceof Error ? err.message : "Could not update profile photo. Try again.");
      } finally {
        setAvatarSaving(false);
      }
    },
    [applyProfileUpdate, withFreshBackendToken]
  );

  const handleBannerFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setError("Choose an image file for your banner.");
        return;
      }

      if (bannerObjectUrlRef.current) {
        URL.revokeObjectURL(bannerObjectUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      bannerObjectUrlRef.current = objectUrl;
      setBannerUploadPreviewUrl(objectUrl);
      setBannerSaving(true);
      setError(null);

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const updated = await withFreshBackendToken((token) =>
          uploadMyBanner(token, {
            file_name: file.name || "banner",
            content_type: file.type,
            data_url: dataUrl,
          })
        );
        applyProfileUpdate(updated);
        if (bannerObjectUrlRef.current) {
          URL.revokeObjectURL(bannerObjectUrlRef.current);
          bannerObjectUrlRef.current = null;
        }
        setBannerUploadPreviewUrl(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload banner.");
      } finally {
        setBannerSaving(false);
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
      if (field === "bio") {
        return draftBio.trim() !== (profile.bio || "").trim();
      }
      if (field === "skills") {
        const storedTools = parseToolString(profile.collaboration_preferences?.tools).length
          ? parseToolString(profile.collaboration_preferences?.tools)
          : normalizeList(profile.skills);
        return !areListsEqual(selectedTools, storedTools);
      }
      if (field === "availability_status") {
        return (draftAvailabilityStatus || "selective") !== (profile.availability_status || "selective");
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
        workingHoursValue !== (profile.collaboration_preferences?.working_hours || "").trim()
      );
    },
    [
      draftDisplayName,
      draftAvailabilityStatus,
      draftBio,
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
    if (field === "location_timezone") {
      const locationError = validateLocationDraft();
      if (locationError) {
        setLocationDraftError(locationError);
        setError(locationError);
        return false;
      }
    }
    setInlineSavingField(field);
    const payload: BackendProfileUpdatePayload =
      field === "display_name"
        ? { display_name: draftDisplayName.trim() }
        : field === "headline"
          ? { headline: draftHeadline.trim() }
          : field === "bio"
            ? { bio: draftBio.trim() }
          : field === "skills"
            ? { skills: selectedTools, collaboration_tools: formatToolString(selectedTools) }
            : field === "availability_status"
              ? { availability_status: draftAvailabilityStatus || "selective" }
            : field === "location_timezone"
              ? {
                  location:
                    resolveLocationDraftForSave({
                      draftLocation,
                      currentLocation: profile?.location,
                      selectedLocation: draftLocationSelection,
                    }).displayName ?? draftLocation.trim(),
                  timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : "",
                }
              : {
                  project_type_preference: draftPreferenceProjectType || null,
                  collaboration_turnaround: draftPreferenceTurnaround.trim(),
                  collaboration_revisions: normalizeRevisionsPreferenceForSave(draftPreferenceRevisions),
                  collaboration_working_hours: formatWorkingHours({
                    mode: workingHoursMode,
                    start: workingHoursStart,
                    end: workingHoursEnd,
                    timezone: workingHoursTimezone,
                  }),
                };
    const saved = await patchProfile(payload, "Failed to save profile field.");
    setInlineSavingField(null);
    return Boolean(saved);
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

  const bannerPreviewUrl = useMemo<string | undefined>(
    () => bannerUploadPreviewUrl || profile?.banner_url || undefined,
    [bannerUploadPreviewUrl, profile?.banner_url]
  );

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
  const ownerConnectedPlatforms = [
    connectedAccounts.youtube.length ? "YouTube" : null,
    connectedAccounts.instagram.length ? "Instagram" : null,
  ].filter((item): item is string => Boolean(item));
  // Recruiter hiring fields. Prefer the new multi-value columns; fall back to the
  // legacy single primary_platform (+ connected accounts) so old profiles still render.
  const ownerHiringPlatformValues = (() => {
    const stored = normalizeList(profile?.hiring_info?.platforms);
    if (stored.length) return stored;
    return cleanOwnerList([profile?.hiring_info?.primary_platform, ...ownerConnectedPlatforms]);
  })();
  const ownerCollaborationStyleValues = normalizeList(profile?.collaboration_preferences?.styles);
  const ownerHiringTagValues = splitOwnerValues(profile?.hiring_info?.channels_or_pages_managed);
  // Recruiter (hiring) metadata, stored separately from the talent content_style so
  // the two sides can be customised independently.
  const ownerHiringNicheValues = normalizeList(profile?.hiring_info?.niches);
  const ownerHiringGenreValues = normalizeList(profile?.hiring_info?.genres);
  const ownerHiringFormatValues = normalizeList(profile?.hiring_info?.formats);
  // Talent-side publishing platforms, separate from the recruiter hiring platforms.
  const ownerCreatorPlatformValues = normalizeList(profile?.creator_platforms);
  // Talent-side values (content_style) surfaced for the "reuse from other side" option.
  const ownerTalentNicheValues = splitOwnerValues(contentStyleDraft.primary_niche);
  const ownerTalentTagValues = sanitizeProfileTags(splitOwnerValues(contentStyleDraft.target_audience));
  const effectiveOwnerProfileMode: OwnerProfileViewMode = ownerProfileMode;
  const ownerExperienceItems = experienceDraft;
  const ownerBioText = cleanOwnerText(profile?.bio);
  const ownerBioTooltip =
    effectiveOwnerProfileMode === "hiring" ? RECRUITER_BIO_HELP_TOOLTIP : TALENT_BIO_HELP_TOOLTIP;
  const ownerReviewItems = useMemo<BackendProfileReviewItem[]>(() => profile?.review_items || [], [profile?.review_items]);
  const closeOwnerInlineEditor = () => setActiveOwnerInlineEditor(null);
  const updateDraftLocationValue = useCallback((value: string) => {
    setDraftLocation(value);
    setLocationDraftError(null);
  }, []);
  const updateDraftLocationSelection = useCallback((location: LocationDetails | null) => {
    setDraftLocationSelection(location);
    setLocationDraftError(null);
  }, []);
  const validateLocationDraft = useCallback(() => {
    return (
      resolveLocationDraftForSave({
        draftLocation,
        currentLocation: profile?.location,
        selectedLocation: draftLocationSelection,
      }).error || null
    );
  }, [draftLocation, draftLocationSelection, profile?.location]);
  const resetBasicsDrafts = useCallback(() => {
    if (!profile) return;
    hydrateFromProfile(profile);
    setBasicsError(null);
    setLocationDraftError(null);
  }, [hydrateFromProfile, profile]);
  const openBasicsEditor = () => {
    resetBasicsDrafts();
    setActiveOwnerInlineEditor(null);
    setBasicsEditorOpen(true);
  };
  const cancelBasicsEditor = () => {
    resetBasicsDrafts();
    setBasicsEditorHighlighted(false);
    setBasicsEditorOpen(false);
  };
  const updateBasicsSocialLink = (id: string, value: string) => {
    setDraftSocialLinks((current) =>
      current.map((link) => (link.id === id ? { ...link, value } : link))
    );
  };
  const addBasicsSocialLink = () => {
    setDraftSocialLinks((current) => [...current, createBasicsSocialLinkDraft("")]);
  };
  const removeBasicsSocialLink = (id: string) => {
    setDraftSocialLinks((current) => {
      const next = current.filter((link) => link.id !== id);
      return next.length ? next : [createBasicsSocialLinkDraft("")];
    });
  };
  const handleSaveBasicsEditor = async () => {
    if (!profile) return;

    const displayNameError = validateBasicsDisplayName(draftDisplayName);
    if (displayNameError) {
      setBasicsError(displayNameError);
      return;
    }

    const usernameError = validateBasicsUsername(draftUsername);
    if (usernameError) {
      setBasicsError(usernameError);
      return;
    }

    const normalizedSocialLinks = normalizeBasicsSocialLinks(draftSocialLinks);
    if (!normalizedSocialLinks.ok) {
      setBasicsError(normalizedSocialLinks.error);
      return;
    }

    const locationError = validateLocationDraft();
    if (locationError) {
      setLocationDraftError(locationError);
      setBasicsError(locationError);
      return;
    }

    setBasicsSaving(true);
    setProfileSaving(true);
    setBasicsError(null);
    setError(null);
    try {
      const resolvedLocation = resolveLocationDraftForSave({
        draftLocation,
        currentLocation: profile.location,
        selectedLocation: draftLocationSelection,
      });
      await persistProfileUpdate({
        display_name: draftDisplayName.trim().replace(/\s{2,}/g, " "),
        username: normalizeProfileHandle(draftUsername),
        headline: draftHeadline.trim(),
        skills: selectedTools,
        public_links: normalizedSocialLinks.urls,
        location: resolvedLocation.displayName ?? draftLocation.trim(),
        timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : "",
        collaboration_working_hours: formatWorkingHours({
          mode: workingHoursMode,
          start: workingHoursStart,
          end: workingHoursEnd,
          timezone: workingHoursTimezone,
        }),
        collaboration_tools: formatToolString(selectedTools),
      });
      setBasicsEditorHighlighted(false);
      setBasicsEditorOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save profile basics. Try again.";
      setBasicsError(message);
      setError(message);
    } finally {
      setBasicsSaving(false);
      setProfileSaving(false);
    }
  };
  const openPortfolioManager = () => {
    setTab("portfolio");
    setWorkSampleChooserOpen(true);
  };
  const handleSaveBioInline = async () => {
    const saved = await saveInlineField("bio");
    if (saved || !isFieldDirty("bio")) {
      closeOwnerInlineEditor();
    }
  };
  // Save specialization by NAME so a user can add a role that isn't in the
  // catalog yet; the backend reuses or creates the role and returns the linked
  // set. Keep id-based state + the catalog in sync from the response.
  const handleSaveRolesByName = async (names: string[]) => {
    setRolesSaving(true);
    setError(null);
    try {
      const updatedRoles = await withFreshBackendToken((token) => upsertMyRolesByName(token, names));
      const savedRoles = updatedRoles.items || [];
      setSelectedRoleIds(savedRoles.map((role) => role.id));
      setProfile((prev) => (prev ? { ...prev, roles: savedRoles } : prev));
      setRolesCatalog((prev) => {
        const byId = new Map(prev.map((role) => [role.id, role]));
        for (const role of savedRoles) byId.set(role.id, role);
        return Array.from(byId.values());
      });
      await refreshProfileCompletion();
      router.refresh();
      closeOwnerInlineEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save specialization.");
    } finally {
      setRolesSaving(false);
    }
  };
  const handleSaveToolsInline = async () => {
    const saved = await saveInlineField("skills");
    if (saved || !isFieldDirty("skills")) {
      closeOwnerInlineEditor();
    }
  };
  const handleSaveAvailabilityInline = async () => {
    const saved = await saveInlineField("availability_status");
    if (saved || !isFieldDirty("availability_status")) {
      closeOwnerInlineEditor();
    }
  };
  const handleSavePreferencesInline = async () => {
    if (!validatePreferencesDraft()) return;
    const saved = await saveInlineField("preferences");
    if (saved || !isFieldDirty("preferences")) {
      closeOwnerInlineEditor();
    }
  };
  // --- Recruiter/hiring field-specific savers --------------------------------
  // Each persists ONLY its own slice. The ChipSelectEditor instances own their
  // isolated drafts and hand back the final values on Save, so these never read
  // a shared draft for the field being edited.
  const saveHiringContentStyleField = async (
    field: "primary_niche" | "tone" | "format" | "target_audience",
    values: string[]
  ): Promise<boolean> => {
    const nextTargetAudienceValues =
      field === "target_audience"
        ? values.map(normalizeProfileTag)
        : splitOwnerValues(contentStyleDraft.target_audience);
    const tagError = validateProfileTags(nextTargetAudienceValues);
    if (field === "target_audience" && tagError) {
      setError(tagError);
      return false;
    }
    const normalizedTargetAudience = sanitizeProfileTags(nextTargetAudienceValues).join(", ");
    setProfileSaving(true);
    setError(null);
    try {
      const updated = await withFreshBackendToken((token) =>
        upsertMyContentStyle(token, {
          primary_niche:
            field === "primary_niche"
              ? values.join(", ") || null
              : contentStyleDraft.primary_niche || null,
          format: field === "format" ? values : contentStyleDraft.format,
          tone: field === "tone" ? values : contentStyleDraft.tone,
          target_audience:
            field === "target_audience"
              ? normalizedTargetAudience || null
              : contentStyleDraft.target_audience || null,
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
      return false;
    } finally {
      setProfileSaving(false);
    }
  };
  const saveHiringPlatformsField = async (values: string[]): Promise<boolean> => {
    // Backend syncs hiring_primary_platform from this list for legacy filters.
    const updated = await patchProfile({ hiring_platforms: values }, "Could not save platforms. Try again.");
    return Boolean(updated);
  };
  // Recruiter niches/genres/formats persist to dedicated hiring_* columns, kept
  // independent from the talent content_style so each side customises separately.
  const saveHiringNichesField = async (values: string[]): Promise<boolean> => {
    const updated = await patchProfile({ hiring_niches: values }, "Could not save niches. Try again.");
    return Boolean(updated);
  };
  const saveHiringGenresField = async (values: string[]): Promise<boolean> => {
    const updated = await patchProfile({ hiring_genres: values }, "Could not save genres. Try again.");
    return Boolean(updated);
  };
  const saveHiringFormatsField = async (values: string[]): Promise<boolean> => {
    const updated = await patchProfile({ hiring_formats: values }, "Could not save formats. Try again.");
    return Boolean(updated);
  };
  // Talent publishing platforms persist to creator_platforms, separate from the
  // recruiter hiring_platforms.
  const saveCreatorPlatformsField = async (values: string[]): Promise<boolean> => {
    const updated = await patchProfile({ creator_platforms: values }, "Could not save platforms. Try again.");
    return Boolean(updated);
  };
  const saveHiringCollaborationField = async (values: string[]): Promise<boolean> => {
    const updated = await patchProfile(
      { collaboration_styles: values },
      "Could not save collaboration style. Try again."
    );
    return Boolean(updated);
  };
  const saveHiringTagsField = async (values: string[]): Promise<boolean> => {
    const updated = await patchProfile(
      { hiring_channels_or_pages_managed: values.join(", ") || null },
      "Could not save tags. Try again."
    );
    return Boolean(updated);
  };
  const resetHiringWorkModelDraft = () => {
    resetLocationDraft();
    setDraftWorkMode(profile?.collaboration_preferences?.work_mode || "");
    const parsedWorkingHours = parseWorkingHours(
      profile?.collaboration_preferences?.working_hours,
      profile?.timezone
    );
    setWorkingHoursMode(parsedWorkingHours.mode);
    setWorkingHoursStart(parsedWorkingHours.start);
    setWorkingHoursEnd(parsedWorkingHours.end);
    setWorkingHoursTimezone(parsedWorkingHours.timezone);
  };
  const openHiringWorkModelEditor = () => {
    resetHiringWorkModelDraft();
    setActiveOwnerInlineEditor("hiring-work-model");
  };
  const cancelHiringWorkModelEditor = () => {
    resetHiringWorkModelDraft();
    closeOwnerInlineEditor();
  };
  const saveHiringWorkModel = async (): Promise<boolean> => {
    // A city only makes sense for Hybrid / On-site work. Remote (or no mode chosen
    // yet) has no city, so we skip location validation and clear any stale value
    // instead of asking "where" for work that happens anywhere.
    const requiresLocation = draftWorkMode === "Hybrid" || draftWorkMode === "On-site";
    let locationValue = "";
    if (requiresLocation) {
      const locationError = validateLocationDraft();
      if (locationError) {
        setLocationDraftError(locationError);
        setError(locationError);
        return false;
      }
      const resolvedLocation = resolveLocationDraftForSave({
        draftLocation,
        currentLocation: profile?.location,
        selectedLocation: draftLocationSelection,
      });
      locationValue = resolvedLocation.displayName ?? draftLocation.trim();
    }
    const updated = await patchProfile(
      {
        location: locationValue,
        timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : "",
        work_mode: draftWorkMode || null,
        collaboration_working_hours: formatWorkingHours({
          mode: workingHoursMode,
          start: workingHoursStart,
          end: workingHoursEnd,
          timezone: workingHoursTimezone,
        }),
      },
      "Could not save work model. Try again."
    );
    return Boolean(updated);
  };
  const pastOwnerJobs = jobs.filter((job) => PAST_JOB_STATUSES.has(String(job.status || "").toLowerCase()));
  const ownerJobsSorted = [...activeJobs, ...pastOwnerJobs].sort((a, b) => {
    const aActive = !PAST_JOB_STATUSES.has(String(a.status || "").toLowerCase());
    const bActive = !PAST_JOB_STATUSES.has(String(b.status || "").toLowerCase());
    if (aActive !== bActive) return aActive ? -1 : 1;
    return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  });
  const ownerPortfolioPreview = [...publishedPortfolio]
    .sort((a, b) => {
      const featuredDelta = Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured));
      if (featuredDelta !== 0) return featuredDelta;
      return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
    })
    .slice(0, 3);
  const ownerJobsPreview = ownerJobsSorted.slice(0, 3);
  const ownerHiringExperiencePreview = pastOwnerJobs.slice(0, 3);
  const ownerToolsEditor = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <ToolPicker value={selectedTools} onChange={setSelectedTools} />
      <OwnerInlineEditorActions
        onCancel={() => {
          resetToolsDraft();
          closeOwnerInlineEditor();
        }}
        onSave={() => void handleSaveToolsInline()}
        saving={inlineSavingField === "skills"}
        saveLabel="Save tools"
      />
    </div>
  );
  const ownerAvailabilityEditor = (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <label className="space-y-1">
        <span className="text-xs text-white/55">Availability</span>
        <select
          value={draftAvailabilityStatus || "selective"}
          onChange={(event) => setDraftAvailabilityStatus(event.target.value as BackendProfileResponse["availability_status"])}
          className="h-10 w-full cursor-pointer rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
        >
          <option value="available">Available</option>
          <option value="selective">Selective</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </label>
      <OwnerInlineEditorActions
        onCancel={() => {
          setDraftAvailabilityStatus(profile?.availability_status || "selective");
          closeOwnerInlineEditor();
        }}
        onSave={() => void handleSaveAvailabilityInline()}
        saving={inlineSavingField === "availability_status"}
        saveLabel="Save availability"
      />
    </div>
  );
  const ownerWorkPreferencesEditor = (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
      <SingleChoiceChips
        label="Project type"
        options={PROJECT_TYPE_OPTIONS}
        value={draftPreferenceProjectType}
        onChange={(value) => {
          setPreferenceDraftError(null);
          setDraftPreferenceProjectType(value as ProjectTypePreference | "");
        }}
      />
      <SingleChoiceChips
        label="Typical turnaround"
        options={TURNAROUND_SUGGESTIONS}
        value={draftPreferenceTurnaround}
        onChange={(value) => {
          setPreferenceDraftError(null);
          setDraftPreferenceTurnaround(value);
        }}
        allowCustom
        customPlaceholder="Custom, e.g. 5 days or about 2 weeks"
      />
      <SingleChoiceChips
        label="Revisions included"
        options={REVISIONS_SUGGESTIONS}
        value={draftPreferenceRevisions}
        onChange={(value) => {
          setPreferenceDraftError(null);
          setDraftPreferenceRevisions(value);
        }}
        allowCustom
        customPlaceholder="Custom, e.g. 5 rounds"
      />
      <WorkingHoursField
        mode={workingHoursMode}
        start={workingHoursStart}
        end={workingHoursEnd}
        timezone={workingHoursTimezone}
        onModeChange={setWorkingHoursMode}
        onStartChange={setWorkingHoursStart}
        onEndChange={setWorkingHoursEnd}
        onTimezoneChange={setWorkingHoursTimezone}
      />
      {preferenceDraftError ? (
        <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-xs leading-5 text-rose-100">
          {preferenceDraftError}
        </p>
      ) : null}
      <OwnerInlineEditorActions
        onCancel={() => {
          resetPreferencesDraft();
          closeOwnerInlineEditor();
        }}
        onSave={() => void handleSavePreferencesInline()}
        saving={inlineSavingField === "preferences"}
        saveLabel="Save work preferences"
      />
    </div>
  );
  const ownerRoleEditor = (
    <ChipSelectEditor
      title="Specialization"
      suggestions={rolesCatalog.map((role) => role.name)}
      initialSelected={ownerRoleNames}
      allowCustom
      searchable
      customPlaceholder="Type your specialization, e.g. Director"
      maxSelected={12}
      saving={rolesSaving}
      panelId="owner-editor-specialization"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) => void handleSaveRolesByName(values)}
    />
  );
  // --- Recruiter/hiring field-specific inline editors -----------------------
  // One dedicated editor per row. Each ChipSelectEditor owns an isolated draft
  // (seeded from the saved value on mount) so opening one never bleeds into
  // another, and persists only its slice on Save.
  const ownerHiringNichesEditor = (
    <ChipSelectEditor
      title="Content niches"
      suggestions={HIRING_NICHE_SUGGESTIONS}
      initialSelected={ownerHiringNicheValues}
      allowCustom
      customPlaceholder="Type to add a niche, e.g. Personal finance"
      reuseSource={
        ownerTalentNicheValues.length
          ? { label: "Copy from your Talent profile", values: ownerTalentNicheValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-hiring-niches-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringNichesField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerHiringGenresEditor = (
    <ChipSelectEditor
      title="Genres"
      suggestions={HIRING_GENRE_SUGGESTIONS}
      initialSelected={ownerHiringGenreValues}
      allowCustom
      customPlaceholder="Type to add a genre, e.g. Explainers"
      reuseSource={
        ownerToneNames.length
          ? { label: "Copy from your Talent profile", values: ownerToneNames }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-hiring-genres-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringGenresField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerHiringFormatsEditor = (
    <ChipSelectEditor
      title="Formats hired for"
      suggestions={HIRING_FORMAT_SUGGESTIONS}
      initialSelected={ownerHiringFormatValues}
      allowCustom
      customPlaceholder="Type to add a format, e.g. Long-form video"
      reuseSource={
        ownerFormatNames.length
          ? { label: "Copy from your Talent profile", values: ownerFormatNames }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-hiring-formats-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringFormatsField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerHiringPlatformsEditor = (
    <ChipSelectEditor
      title="Platforms"
      suggestions={HIRING_PLATFORM_SUGGESTIONS}
      initialSelected={ownerHiringPlatformValues}
      allowCustom
      customPlaceholder="Type to add a platform"
      reuseSource={
        ownerCreatorPlatformValues.length
          ? { label: "Copy from your Talent profile", values: ownerCreatorPlatformValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-hiring-platforms-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringPlatformsField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerHiringCollaborationEditor = (
    <ChipSelectEditor
      title="Collaboration style"
      suggestions={COLLABORATION_STYLE_SUGGESTIONS}
      initialSelected={ownerCollaborationStyleValues}
      allowCustom
      customPlaceholder="Add a style, e.g. Retainer"
      saving={profileSaving}
      panelId="owner-hiring-collaboration-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringCollaborationField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerHiringTagsEditor = (
    <ChipSelectEditor
      title="Tags"
      suggestions={HIRING_TAG_SUGGESTIONS}
      initialSelected={ownerHiringTagValues}
      allowCustom
      customPlaceholder="Type to add a tag, e.g. Fast turnaround"
      reuseSource={
        ownerTalentTagValues.length
          ? { label: "Copy from your Talent profile", values: ownerTalentTagValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-hiring-tags-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringTagsField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerHiringWorkModelEditor = (
    <div
      id="owner-hiring-work-model-panel"
      role="group"
      aria-label="Work model"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancelHiringWorkModelEditor();
        }
      }}
      className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3"
    >
      <SingleChoiceChips
        label="Work mode"
        options={WORK_MODE_OPTIONS}
        value={draftWorkMode}
        onChange={setDraftWorkMode}
      />
      {draftWorkMode === "Hybrid" || draftWorkMode === "On-site" ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-white/70">City</p>
          <LocationAutocompleteField
            value={draftLocation}
            selectedLocation={draftLocationSelection}
            onValueChange={updateDraftLocationValue}
            onSelectionChange={updateDraftLocationSelection}
            error={locationDraftError}
            onErrorChange={setLocationDraftError}
            size="compact"
          />
        </div>
      ) : draftWorkMode === "Remote" ? (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-4 text-white/45">
          Remote — talent can work from anywhere, so no city is needed. Set your timezone below so
          they know your overlap.
        </p>
      ) : null}
      <WorkingHoursField
        mode={workingHoursMode}
        start={workingHoursStart}
        end={workingHoursEnd}
        timezone={workingHoursTimezone}
        onModeChange={setWorkingHoursMode}
        onStartChange={setWorkingHoursStart}
        onEndChange={setWorkingHoursEnd}
        onTimezoneChange={setWorkingHoursTimezone}
      />
      <OwnerInlineEditorActions
        onCancel={cancelHiringWorkModelEditor}
        onSave={() =>
          void (async () => {
            if (await saveHiringWorkModel()) closeOwnerInlineEditor();
          })()
        }
        saving={profileSaving}
        saveLabel="Save work model"
      />
    </div>
  );
  // --- Talent profile field-specific inline editors -------------------------
  // Same isolated-draft, per-field pattern as the recruiter editors, phrased for
  // a creator describing their own work. Niches/genres/formats/tags persist to
  // the shared content_style; platforms reuse the multi-value platform list.
  const ownerTalentNichesEditor = (
    <ChipSelectEditor
      title="Niches"
      suggestions={HIRING_NICHE_SUGGESTIONS}
      initialSelected={ownerTalentNicheValues}
      allowCustom
      customPlaceholder="Type to add a niche, e.g. Personal finance"
      reuseSource={
        ownerHiringNicheValues.length
          ? { label: "Copy from your Recruiter profile", values: ownerHiringNicheValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-talent-niches-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringContentStyleField("primary_niche", values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerTalentGenresEditor = (
    <ChipSelectEditor
      title="Genres"
      suggestions={HIRING_GENRE_SUGGESTIONS}
      initialSelected={ownerToneNames}
      allowCustom
      customPlaceholder="Type to add a genre, e.g. Explainers"
      reuseSource={
        ownerHiringGenreValues.length
          ? { label: "Copy from your Recruiter profile", values: ownerHiringGenreValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-talent-genres-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringContentStyleField("tone", values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerTalentFormatsEditor = (
    <ChipSelectEditor
      title="Content formats"
      suggestions={HIRING_FORMAT_SUGGESTIONS}
      initialSelected={ownerFormatNames}
      allowCustom
      customPlaceholder="Type to add a format, e.g. Long-form video"
      reuseSource={
        ownerHiringFormatValues.length
          ? { label: "Copy from your Recruiter profile", values: ownerHiringFormatValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-talent-formats-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringContentStyleField("format", values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerTalentPlatformsEditor = (
    <ChipSelectEditor
      title="Platforms"
      suggestions={HIRING_PLATFORM_SUGGESTIONS}
      initialSelected={ownerCreatorPlatformValues}
      allowCustom
      customPlaceholder="Type to add a platform"
      reuseSource={
        ownerHiringPlatformValues.length
          ? { label: "Copy from your Recruiter profile", values: ownerHiringPlatformValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-talent-platforms-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveCreatorPlatformsField(values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerTalentTagsEditor = (
    <ChipSelectEditor
      title="Tags"
      suggestions={HIRING_TAG_SUGGESTIONS}
      initialSelected={ownerTalentTagValues}
      allowCustom
      customPlaceholder="Type to add a tag, e.g. Retention editing"
      normalizeValue={normalizeProfileTag}
      validateValue={validateProfileTag}
      reuseSource={
        ownerHiringTagValues.length
          ? { label: "Copy from your Recruiter profile", values: ownerHiringTagValues }
          : undefined
      }
      saving={profileSaving}
      panelId="owner-talent-tags-panel"
      onCancel={closeOwnerInlineEditor}
      onSave={(values) =>
        void (async () => {
          if (await saveHiringContentStyleField("target_audience", values)) closeOwnerInlineEditor();
        })()
      }
    />
  );
  const ownerTalentMetadataGroups = [
    {
      key: "specialization",
      label: "Specialization",
      values: normalizeList(ownerRoleNames),
      emptyLabel: "Add specialization",
      actions: <OwnerInlineActionButton label={ownerRoleNames.length ? "Edit" : "Add"} onClick={() => setActiveOwnerInlineEditor("specialization")} />,
      editor: activeOwnerInlineEditor === "specialization" ? ownerRoleEditor : null,
    },
    {
      key: "preferences",
      label: "Work preferences",
      values: cleanOwnerList([
        formatOwnerProjectType(profile?.collaboration_preferences?.project_type_preference),
        formatTurnaroundPreference(profile?.collaboration_preferences?.turnaround),
        formatRevisionsPreference(profile?.collaboration_preferences?.revisions),
        formatWorkingHoursPreference(profile?.collaboration_preferences?.working_hours),
      ]).filter((value) => value !== "–"),
      emptyLabel: "Add work preferences",
      actions: <OwnerInlineActionButton label="Edit" onClick={() => setActiveOwnerInlineEditor("work-preferences")} />,
      editor: activeOwnerInlineEditor === "work-preferences" ? ownerWorkPreferencesEditor : null,
    },
    {
      key: "niches",
      label: "Niches",
      values: splitOwnerValues(contentStyleDraft.primary_niche),
      emptyLabel: "Add niches",
      actions: (
        <OwnerInlineActionButton
          label={splitOwnerValues(contentStyleDraft.primary_niche).length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("talent-niches")}
          expanded={activeOwnerInlineEditor === "talent-niches"}
          controlsId="owner-talent-niches-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "talent-niches" ? ownerTalentNichesEditor : null,
    },
    {
      key: "genres",
      label: "Genres",
      values: ownerToneNames,
      emptyLabel: "Add genres",
      actions: (
        <OwnerInlineActionButton
          label={ownerToneNames.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("talent-genres")}
          expanded={activeOwnerInlineEditor === "talent-genres"}
          controlsId="owner-talent-genres-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "talent-genres" ? ownerTalentGenresEditor : null,
    },
    {
      key: "formats",
      label: "Content formats",
      values: ownerFormatNames,
      emptyLabel: "Add content formats",
      actions: (
        <OwnerInlineActionButton
          label={ownerFormatNames.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("talent-formats")}
          expanded={activeOwnerInlineEditor === "talent-formats"}
          controlsId="owner-talent-formats-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "talent-formats" ? ownerTalentFormatsEditor : null,
    },
    {
      key: "platforms",
      label: "Platforms",
      values: ownerCreatorPlatformValues,
      emptyLabel: "Add platforms",
      actions: (
        <OwnerInlineActionButton
          label={ownerCreatorPlatformValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("talent-platforms")}
          expanded={activeOwnerInlineEditor === "talent-platforms"}
          controlsId="owner-talent-platforms-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "talent-platforms" ? ownerTalentPlatformsEditor : null,
    },
    {
      key: "tools",
      label: "Tools",
      values: normalizeList([...selectedTools, ...splitOwnerValues(profile?.collaboration_preferences?.tools)]),
      emptyLabel: "Add tools",
      actions: <OwnerInlineActionButton label={selectedTools.length ? "Edit" : "Add"} onClick={() => setActiveOwnerInlineEditor("tools")} />,
      editor: activeOwnerInlineEditor === "tools" ? ownerToolsEditor : null,
    },
    {
      key: "availability",
      label: "Availability",
      values: profile?.availability_status ? [profile.availability_status] : [],
      emptyLabel: "Add availability",
      actions: <OwnerInlineActionButton label="Edit" onClick={() => setActiveOwnerInlineEditor("availability")} />,
      editor: activeOwnerInlineEditor === "availability" ? ownerAvailabilityEditor : null,
    },
    {
      key: "tags",
      label: "Tags",
      values: ownerTalentTagValues,
      emptyLabel: "Add tags",
      actions: (
        <OwnerInlineActionButton
          label={ownerTalentTagValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("talent-tags")}
          expanded={activeOwnerInlineEditor === "talent-tags"}
          controlsId="owner-talent-tags-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "talent-tags" ? ownerTalentTagsEditor : null,
    },
  ];
  const ownerRecruiterMetadataGroups = [
    {
      key: "hiring-focus",
      label: "Hiring focus",
      values: normalizeList([...activeJobs.map((job) => job.category), ...pastOwnerJobs.map((job) => job.category)]).slice(0, 6),
      emptyLabel: "Post jobs to build hiring focus",
      actions: (
        <OwnerInlineActionButton
          label={jobs.length ? "Manage" : "Post job"}
          icon={jobs.length ? "pencil" : "plus"}
          onClick={() => (jobs.length ? setTab("jobs") : router.push("/post-job"))}
        />
      ),
    },
    {
      key: "work-model",
      label: "Work model",
      values: cleanOwnerList([
        profile?.location,
        profile?.collaboration_preferences?.work_mode,
        profile?.timezone,
        profile?.collaboration_preferences?.working_hours,
      ]),
      emptyLabel: "Add work model",
      actions: (
        <OwnerInlineActionButton
          label={
            cleanOwnerList([
              profile?.location,
              profile?.collaboration_preferences?.work_mode,
              profile?.timezone,
              profile?.collaboration_preferences?.working_hours,
            ]).length
              ? "Edit"
              : "Add"
          }
          onClick={openHiringWorkModelEditor}
          expanded={activeOwnerInlineEditor === "hiring-work-model"}
          controlsId="owner-hiring-work-model-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-work-model" ? ownerHiringWorkModelEditor : null,
    },
    {
      key: "content-niches",
      label: "Content niches",
      values: ownerHiringNicheValues,
      emptyLabel: "Add content niches",
      actions: (
        <OwnerInlineActionButton
          label={ownerHiringNicheValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("hiring-niches")}
          expanded={activeOwnerInlineEditor === "hiring-niches"}
          controlsId="owner-hiring-niches-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-niches" ? ownerHiringNichesEditor : null,
    },
    {
      key: "genres",
      label: "Genres",
      values: ownerHiringGenreValues,
      emptyLabel: "Add genres",
      actions: (
        <OwnerInlineActionButton
          label={ownerHiringGenreValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("hiring-genres")}
          expanded={activeOwnerInlineEditor === "hiring-genres"}
          controlsId="owner-hiring-genres-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-genres" ? ownerHiringGenresEditor : null,
    },
    {
      key: "formats",
      label: "Formats hired for",
      values: ownerHiringFormatValues,
      emptyLabel: "Add formats hired for",
      actions: (
        <OwnerInlineActionButton
          label={ownerHiringFormatValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("hiring-formats")}
          expanded={activeOwnerInlineEditor === "hiring-formats"}
          controlsId="owner-hiring-formats-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-formats" ? ownerHiringFormatsEditor : null,
    },
    {
      key: "platforms",
      label: "Platforms",
      values: ownerHiringPlatformValues,
      emptyLabel: "Add platforms",
      actions: (
        <OwnerInlineActionButton
          label={ownerHiringPlatformValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("hiring-platforms")}
          expanded={activeOwnerInlineEditor === "hiring-platforms"}
          controlsId="owner-hiring-platforms-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-platforms" ? ownerHiringPlatformsEditor : null,
    },
    {
      key: "collaboration-style",
      label: "Collaboration style",
      values: ownerCollaborationStyleValues,
      emptyLabel: "Add collaboration style",
      actions: (
        <OwnerInlineActionButton
          label={ownerCollaborationStyleValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("hiring-collaboration")}
          expanded={activeOwnerInlineEditor === "hiring-collaboration"}
          controlsId="owner-hiring-collaboration-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-collaboration" ? ownerHiringCollaborationEditor : null,
    },
    {
      key: "tags",
      label: "Tags",
      values: ownerHiringTagValues,
      emptyLabel: "Add tags",
      actions: (
        <OwnerInlineActionButton
          label={ownerHiringTagValues.length ? "Edit" : "Add"}
          onClick={() => setActiveOwnerInlineEditor("hiring-tags")}
          expanded={activeOwnerInlineEditor === "hiring-tags"}
          controlsId="owner-hiring-tags-panel"
        />
      ),
      editor: activeOwnerInlineEditor === "hiring-tags" ? ownerHiringTagsEditor : null,
    },
  ];

  const visibleOwnerTab =
    !isEditMode && effectiveOwnerProfileMode === "talent" && activeTab === "jobs"
      ? "overview"
      : !isEditMode && effectiveOwnerProfileMode === "hiring" && activeTab === "portfolio"
        ? "overview"
        : activeTab;

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
  // Unified, mode-aware "complete your profile" checklist. Single source of truth
  // for both the inline ProfileCompletionCard and the floating setup bubble.
  const talentChecklistSignals = {
    hasAvatar: Boolean(profile?.avatar_url) || avatarMode !== "generic",
    hasHeadline: Boolean(profile?.headline?.trim()),
    hasWorkSample: publishedPortfolio.length > 0,
    hasRole: selectedRoles.length > 0,
    hasTools: selectedTools.length > 0,
    hasBio: Boolean(ownerBioText),
    hasNiche: ownerTalentNicheValues.length > 0,
    hasExperience: ownerExperienceItems.length > 0,
    hasAvailabilityDetails: Boolean(
      profile?.collaboration_preferences?.working_hours ||
        profile?.collaboration_preferences?.turnaround ||
        profile?.location ||
        profile?.timezone
    ),
  };
  const recruiterChecklistSignals = {
    hasAvatar: Boolean(profile?.avatar_url) || avatarMode !== "generic",
    hasHeadline: Boolean(profile?.headline?.trim()),
    hasJob: jobs.length > 0,
    hasBio: Boolean(ownerBioText),
    hasHiringFocus:
      ownerHiringNicheValues.length > 0 ||
      ownerHiringGenreValues.length > 0 ||
      ownerHiringFormatValues.length > 0 ||
      ownerHiringPlatformValues.length > 0 ||
      Boolean(profile?.hiring_info?.primary_platform) ||
      hasContentStyleData,
    hasCollaborationDetails: Boolean(
      profile?.collaboration_preferences?.turnaround ||
        profile?.collaboration_preferences?.revisions ||
        profile?.collaboration_preferences?.working_hours ||
        profile?.location ||
        profile?.timezone
    ),
  };
  const profileChecklist =
    effectiveOwnerProfileMode === "hiring"
      ? buildRecruiterChecklist(recruiterChecklistSignals)
      : buildTalentChecklist(talentChecklistSignals);
  const profileChecklistProgress = checklistProgress(profileChecklist);

  const handleChecklistItemClick = (key: string) => {
    // Editing happens inline on the overview tab now — there is no separate
    // /you/edit page. Switch to overview, then open the matching inline editor.
    const openInline = (editor: OwnerInlineEditorId) => {
      setTab("overview");
      setActiveOwnerInlineEditor(editor);
    };
    switch (key) {
      case "work_sample":
        if (portfolio.length) {
          setTab("portfolio");
        } else {
          setWorkSampleChooserOpen(true);
        }
        return;
      case "post_job":
        router.push("/post-job");
        return;
      case "role":
        openInline("specialization");
        return;
      case "niche":
        openInline("talent-niches");
        return;
      case "hiring_focus":
        // Recruiter "what you hire for" lives in the hiring niche/genre/format rows.
        openInline("hiring-niches");
        return;
      case "tools":
        openInline("tools");
        return;
      case "availability":
        openInline("work-preferences");
        return;
      case "collaboration":
        // Recruiter collaboration/work-model fields (location, timezone, hours).
        openInline("hiring-work-model");
        return;
      case "bio":
        openInline("bio");
        return;
      case "experience":
        setTab("overview");
        startAddExperience();
        return;
      default:
        // avatar, headline → the profile-header basics editor
        setTab("overview");
        openBasicsEditor();
        return;
    }
  };

  const setupTasks = profileChecklist.map((item) => ({
    key: item.key,
    label: item.label,
    done: item.done,
    onClick: () => handleChecklistItemClick(item.key),
  }));
  const setupCompletionCount = setupTasks.filter((item) => item.done).length;
  const setupWidgetPercent = setupTasks.length
    ? Math.round((setupCompletionCount / setupTasks.length) * 100)
    : 100;
  // Show every task (incomplete first) and let the list scroll — nothing is hidden,
  // so the user can always reach the remaining setup steps.
  const visibleSetupTasks = [...setupTasks].sort((a, b) => Number(a.done) - Number(b.done));
  const activeContributionOptions = contributionOptionsForRole(portfolioRole);
  const activeYouTubeContributionOptions = contributionOptionsForRole(portfolioRoleInProject);
  const saveHiringInfo = useCallback(async () => {
    setHiringSaving(true);
    setError(null);
    try {
      await persistProfileUpdate({
        hiring_type: draftHiringType || null,
        hiring_website_or_social_url: draftHiringWebsiteOrSocialUrl.trim() || null,
        hiring_primary_platform: draftHiringPrimaryPlatform || null,
        hiring_channels_or_pages_managed: draftHiringChannelsOrPagesManaged.trim() || null,
      });
      await refreshProfileCompletion();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save hiring info.");
      return false;
    } finally {
      setHiringSaving(false);
    }
  }, [
    draftHiringChannelsOrPagesManaged,
    draftHiringPrimaryPlatform,
    draftHiringType,
    draftHiringWebsiteOrSocialUrl,
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
    const locationError = validateLocationDraft();
    if (locationError) {
      setLocationDraftError(locationError);
      setError(locationError);
      return false;
    }
    if (!validatePreferencesDraft()) {
      return false;
    }

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
    if (!validatePreferencesDraft()) return;
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
                    data-testid="avatar-upload-input"
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
                <LocationAutocompleteField
                  value={draftLocation}
                  selectedLocation={draftLocationSelection}
                  onValueChange={updateDraftLocationValue}
                  onSelectionChange={updateDraftLocationSelection}
                  error={locationDraftError}
                  onErrorChange={setLocationDraftError}
                  size="compact"
                />
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
              <div className="max-w-2xl space-y-1">
                <h2 className="text-xl font-semibold text-white">Work preferences</h2>
                <p className="text-sm leading-6 text-white/55">
                  Add the working details recruiters need to understand scope, turnaround, and review process.
                </p>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <SingleChoiceChips
                    label="Project type"
                    options={PROJECT_TYPE_OPTIONS}
                    value={draftPreferenceProjectType}
                    onChange={(value) => {
                      setPreferenceDraftError(null);
                      setDraftPreferenceProjectType(value as ProjectTypePreference | "");
                    }}
                  />
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <SingleChoiceChips
                    label="Typical turnaround"
                    options={TURNAROUND_SUGGESTIONS}
                    value={draftPreferenceTurnaround}
                    onChange={(value) => {
                      setPreferenceDraftError(null);
                      setDraftPreferenceTurnaround(value);
                    }}
                    allowCustom
                    customPlaceholder="Custom, e.g. 5 days or about 2 weeks"
                  />
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <SingleChoiceChips
                    label="Revisions included"
                    options={REVISIONS_SUGGESTIONS}
                    value={draftPreferenceRevisions}
                    onChange={(value) => {
                      setPreferenceDraftError(null);
                      setDraftPreferenceRevisions(value);
                    }}
                    allowCustom
                    customPlaceholder="Custom, e.g. 5 rounds"
                  />
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <WorkingHoursField
                    mode={workingHoursMode}
                    start={workingHoursStart}
                    end={workingHoursEnd}
                    timezone={workingHoursTimezone}
                    onModeChange={setWorkingHoursMode}
                    onStartChange={setWorkingHoursStart}
                    onEndChange={setWorkingHoursEnd}
                    onTimezoneChange={setWorkingHoursTimezone}
                  />
                </div>
              </div>
              {preferenceDraftError ? (
                <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-xs leading-5 text-rose-100">
                  {preferenceDraftError}
                </p>
              ) : null}
              <div className="mt-5 flex justify-end">
                <SaveIconButton
                  onClick={() => void handleSavePreferencesInline()}
                  disabled={inlineSavingField === "preferences" || !isFieldDirty("preferences")}
                  saving={inlineSavingField === "preferences"}
                  ariaLabel="Save work preferences"
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
          {bannerPreviewUrl ? (
            <img
              src={bannerPreviewUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.16),transparent_30%),radial-gradient(circle_at_78%_6%,rgba(255,255,255,0.08),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.018)_48%,rgba(0,0,0,0.28))]" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#141519] to-transparent" />
          {isOwnerView ? (
            <>
              <input
                ref={bannerFileInputRef}
                type="file"
                accept="image/*"
                data-testid="banner-upload-input"
                className="sr-only"
                onChange={(event) => void handleBannerFileChange(event)}
              />
              <button
                type="button"
                onClick={() => bannerFileInputRef.current?.click()}
                disabled={bannerSaving}
                aria-label={bannerPreviewUrl ? "Change banner image" : "Add banner image"}
                className="group/bannerbtn absolute inset-0 z-10 flex cursor-pointer items-center justify-center text-center opacity-0 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100 focus:outline-none disabled:cursor-not-allowed"
              >
                <span className="rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-white/72 backdrop-blur-sm transition-colors group-hover/bannerbtn:bg-black/40 group-hover/bannerbtn:text-white/90">
                  <Icon name="image" className="mx-auto h-7 w-7" />
                  <span className="mt-2 block text-sm font-semibold">
                    {bannerSaving
                      ? "Uploading…"
                      : bannerPreviewUrl
                        ? "Change banner image"
                        : "Add banner image"}
                  </span>
                  <span className="mt-1 block text-xs text-white/42">Recommended 3200 × 410px</span>
                </span>
              </button>
            </>
          ) : null}
        </div>

        <div className="px-5 pb-6 sm:px-8 sm:pb-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div ref={avatarMenuRef} className="group/avatarwrap relative z-10 -mt-8 shrink-0 sm:-mt-12">
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  data-testid="owner-avatar-upload-input"
                  className="sr-only"
                  onChange={(event) => void handleAvatarFileChange(event)}
                />
                <button
                  type="button"
                  onClick={() => setAvatarMenuOpen((prev) => !prev)}
                  className="group/avatar relative h-28 w-28 aspect-square overflow-hidden rounded-[28px] border border-white/20 bg-[#2a2b30] shadow-[0_24px_70px_-34px_rgba(0,0,0,1)] inline-flex items-center justify-center transition-[border-color,box-shadow,background-color] hover:border-white/30 hover:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-white/18 sm:h-[136px] sm:w-[136px] cursor-pointer"
                  aria-label="Change profile photo"
                >
                  {avatarPreviewUrl ? (
                    <img
                      src={avatarPreviewUrl}
                      alt={profile.display_name || profile.username || "Profile avatar"}
                      className="h-full w-full object-cover transition duration-200 group-hover/avatar:brightness-[0.72] group-focus-visible/avatar:brightness-[0.72]"
                    />
                  ) : (
                    <GenericAvatar />
                  )}
                  <span className="pointer-events-none absolute inset-0 bg-black/0 opacity-0 transition-[background-color,opacity] duration-200 group-hover/avatar:bg-black/24 group-hover/avatar:opacity-100 group-focus-visible/avatar:bg-black/24 group-focus-visible/avatar:opacity-100" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-[opacity,transform] duration-200 group-hover/avatar:scale-100 group-hover/avatar:opacity-100 group-focus-visible/avatar:scale-100 group-focus-visible/avatar:opacity-100">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/18 bg-black/42 text-white/88 shadow-[0_14px_30px_-18px_rgba(0,0,0,1)] backdrop-blur-md">
                      <Icon name="image" className="h-4 w-4" />
                    </span>
                  </span>
                </button>

                {avatarMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-72 rounded-2xl border border-white/15 bg-[#111216] p-3 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.95)]">
                    <p className="text-xs text-white/55">Avatar source</p>
                    <button
                      type="button"
                      onClick={() => avatarFileInputRef.current?.click()}
                      disabled={avatarSaving || profileSaving}
                      className="mt-2 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-between"
                    >
                      <span>{avatarSaving ? "Uploading photo..." : "Upload image"}</span>
                      <Icon name="image" className="h-4 w-4 text-white/58" />
                    </button>
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
                  <button
                    type="button"
                    onClick={openBasicsEditor}
                    aria-label="Edit profile"
                    className="group/action relative mt-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.045] hover:text-white/86 focus:outline-none focus:ring-2 focus:ring-white/15"
                  >
                    <Icon name="pencil" className="h-4 w-4" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111216] px-2 py-1 text-[11px] font-semibold text-white/72 opacity-0 shadow-[0_14px_35px_-22px_rgba(0,0,0,1)] transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
                      Edit basics
                    </span>
                  </button>
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

                <SocialIconRow links={ownerSocialIconLinks} />

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
          {basicsEditorOpen ? (
            <div
              ref={basicsEditorRef}
              data-testid="owner-basics-inline-editor"
              aria-label="Edit profile basics"
              className={[
                "mt-6 rounded-2xl border bg-white/[0.035] p-4 transition-[border-color,box-shadow,background-color] duration-500 sm:p-5",
                basicsEditorHighlighted
                  ? "border-white/24 bg-white/[0.05] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_24px_60px_-38px_rgba(255,255,255,0.28)]"
                  : "border-white/10",
              ].join(" ")}
            >
              <span className="sr-only">Edit profile basics</span>

              {basicsError ? (
                <p className="rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
                  {basicsError}
                </p>
              ) : null}

              <div className={[basicsError ? "mt-4" : "mt-0", "grid gap-4 md:grid-cols-2"].join(" ")}>
                <label className="space-y-2">
                  <span className="text-xs font-semibold text-white/55">Display name</span>
                  <input
                    value={draftDisplayName}
                    onChange={(event) => setDraftDisplayName(event.target.value)}
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/24"
                    placeholder="Your name or brand"
                    maxLength={80}
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-semibold text-white/55">Username</span>
                  <div className="flex h-11 items-center rounded-xl border border-white/10 bg-black/18 px-3 transition-colors focus-within:border-white/24">
                    <span className="text-sm text-white/38">@</span>
                    <input
                      value={draftUsername}
                      onChange={(event) => setDraftUsername(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-white/28"
                      placeholder="your_profile"
                      maxLength={30}
                    />
                  </div>
                </label>

                <LocationAutocompleteField
                  value={draftLocation}
                  selectedLocation={draftLocationSelection}
                  onValueChange={updateDraftLocationValue}
                  onSelectionChange={updateDraftLocationSelection}
                  error={locationDraftError}
                  onErrorChange={setLocationDraftError}
                  size="spacious"
                />

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-white/55">Working hours</span>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["flexible", "Flexible"],
                      ["fixed", "Set hours"],
                    ] as const).map(([nextMode, label]) => (
                      <button
                        key={`basics-working-hours-${nextMode}`}
                        type="button"
                        aria-pressed={workingHoursMode === nextMode}
                        onClick={() => setWorkingHoursMode(nextMode)}
                        className={[
                          "h-9 cursor-pointer rounded-xl border px-3 text-xs font-semibold transition-colors",
                          workingHoursMode === nextMode
                            ? "border-white bg-white text-black"
                            : "border-white/10 bg-white/[0.03] text-white/58 hover:bg-white/[0.07] hover:text-white",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {workingHoursMode === "fixed" ? (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="time"
                        value={workingHoursStart}
                        onChange={(event) => setWorkingHoursStart(event.target.value)}
                        className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none focus:border-white/24"
                      />
                      <input
                        type="time"
                        value={workingHoursEnd}
                        onChange={(event) => setWorkingHoursEnd(event.target.value)}
                        className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none focus:border-white/24"
                      />
                      <input
                        value={workingHoursTimezone}
                        onChange={(event) => setWorkingHoursTimezone(event.target.value)}
                        className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/24"
                        placeholder="IST"
                      />
                    </div>
                  ) : null}
                </div>

                <label className="space-y-2 md:col-span-2">
                  <span className="flex items-center gap-2 text-xs font-semibold text-white/55">
                    <span>Headline</span>
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        aria-label="Headline help"
                        aria-describedby="headline-help-tooltip"
                        className="peer inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-white/12 text-white/45 transition-colors hover:border-white/22 hover:text-white/74 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 focus-visible:text-white/74"
                      >
                        <Icon name="help" className="h-3.5 w-3.5" />
                      </button>
                      <span
                        id="headline-help-tooltip"
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-white/10 bg-[#111216] px-3 py-2 text-[11px] font-medium leading-5 text-white/76 opacity-0 shadow-[0_18px_40px_-24px_rgba(0,0,0,1)] transition-opacity duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100"
                      >
                        {HEADLINE_HELP_TOOLTIP}
                      </span>
                    </span>
                  </span>
                  <div className="relative">
                    <input
                      value={draftHeadline}
                      onChange={(event) => setDraftHeadline(event.target.value)}
                      className="h-11 w-full rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/24"
                      placeholder=""
                      maxLength={160}
                    />
                    {!draftHeadline.trim() ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-3 right-3 flex items-center overflow-hidden whitespace-nowrap text-sm text-white/28"
                      >
                        <span className="truncate">{headlineGhostText}</span>
                        <span className="ml-0.5 h-4 border-l border-white/35 motion-safe:animate-pulse" />
                      </span>
                    ) : null}
                  </div>
                </label>

                <div className="space-y-2 md:col-span-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-white/55">
                    <Icon name="sliders-horizontal" className="h-4 w-4 text-white/55" />
                    Tools
                  </span>
                  <ToolPicker value={selectedTools} onChange={setSelectedTools} />
                </div>

                <div className="space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-white/55">Social links</span>
                    <button
                      type="button"
                      onClick={addBasicsSocialLink}
                      className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-white/54 transition-colors hover:text-white"
                    >
                      <Icon name="plus" className="h-3.5 w-3.5" />
                      Add another link
                    </button>
                  </div>
                  <div className="space-y-2">
                    {draftSocialLinks.map((link) => {
                      const normalized = normalizeSocialProfileUrl(link.value);
                      const detection = normalized.ok ? normalized.detection : null;
                      return (
                        <div key={link.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                          <input
                            value={link.value}
                            onChange={(event) => updateBasicsSocialLink(link.id, event.target.value)}
                            className="h-11 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/24"
                            placeholder="https://instagram.com/yourhandle"
                          />
                          <div className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 text-xs font-semibold text-white/58">
                            <Icon name={detection?.icon || "globe"} className="h-3.5 w-3.5" />
                            <span className="truncate">
                              {detection ? `${platformDisplayName(detection.platform)} detected` : "Platform detected"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBasicsSocialLink(link.id)}
                            aria-label="Remove social link"
                            className="h-11 cursor-pointer rounded-xl border border-white/10 bg-white/[0.025] px-3 text-xs font-semibold text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={cancelBasicsEditor}
                  disabled={basicsSaving}
                  className="h-9 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveBasicsEditor()}
                  disabled={basicsSaving || profileSaving || backendPersistenceUnavailable}
                  className="h-9 cursor-pointer rounded-xl bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {basicsSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      <nav className="overflow-x-auto border-b border-white/[0.08] px-5 pt-1 sm:px-8">
        <div className="flex min-w-max items-end gap-8">
          {[
            { key: "overview" as TopTab, label: "Overview" },
            ...(effectiveOwnerProfileMode === "talent" ? [{ key: "portfolio" as TopTab, label: "Portfolio" }] : []),
            ...(effectiveOwnerProfileMode === "hiring" ? [{ key: "jobs" as TopTab, label: "Jobs" }] : []),
            { key: "reviews" as TopTab, label: "Reviews" },
            { key: "saved" as TopTab, label: "Saved" },
          ].map((item) => (
            <ProfileNavButton
              key={`profile-nav-${item.key}`}
              label={item.label}
              active={visibleOwnerTab === item.key}
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
          {visibleOwnerTab === "overview" ? (
            <div className="grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
              <div className="min-w-0">
                {!isEditMode ? (
                  <OnboardingNextSteps
                    className="mb-6 max-w-3xl"
                    intentChosen={onboardingChosen}
                    mode={effectiveOwnerProfileMode}
                    hasJob={jobs.length > 0}
                    profileComplete={profileChecklistProgress.percent >= 100}
                    saving={onboardingIntentSaving}
                    onChooseIntent={handleChooseOnboardingIntent}
                  />
                ) : null}
                {onboardingChosen && profileChecklistProgress.percent < 100 ? (
                  <div className="mb-6 max-w-3xl">
                    <ProfileCompletionCard
                      title={effectiveOwnerProfileMode === "hiring" ? "Complete your recruiter profile" : "Complete your talent profile"}
                      percentage={profileChecklistProgress.percent}
                      helperText="The most important items are first — they make you easier to trust and hire."
                      items={profileChecklist.map((item) => ({
                        key: item.key,
                        title: item.label,
                        done: item.done,
                      }))}
                      recommendedKey={profileChecklist.find((item) => !item.done)?.key ?? null}
                      expanded={false}
                      hiddenCount={0}
                      onToggleExpanded={() => {}}
                      onTaskClick={(key) => handleChecklistItemClick(key)}
                    />
                  </div>
                ) : null}
                <OwnerProfileInfoSection
                  title={
                    <InlineHelpTooltip
                      label="Bio"
                      tooltip={ownerBioTooltip}
                      tooltipId={`owner-bio-help-${effectiveOwnerProfileMode}`}
                    />
                  }
                  actions={
                    <OwnerInlineActionButton
                      label={ownerBioText ? "Edit" : "Add"}
                      icon={ownerBioText ? "pencil" : "plus"}
                      onClick={() => setActiveOwnerInlineEditor("bio")}
                    />
                  }
                >
                  {activeOwnerInlineEditor === "bio" ? (
                    <div className="max-w-3xl rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <textarea
                        value={draftBio}
                        onChange={(event) => setDraftBio(event.target.value)}
                        autoFocus
                        className="min-h-[124px] w-full rounded-xl border border-white/15 bg-white/[0.04] px-3 py-3 text-sm leading-6 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/15"
                        placeholder={OWNER_BIO_EMPTY_STATE}
                        maxLength={1200}
                      />
                      <OwnerInlineEditorActions
                        onCancel={() => {
                          setDraftBio(profile?.bio || "");
                          closeOwnerInlineEditor();
                        }}
                        onSave={() => void handleSaveBioInline()}
                        saving={inlineSavingField === "bio"}
                        saveLabel="Save bio"
                      />
                    </div>
                  ) : ownerBioText ? (
                    <p className="max-w-3xl text-sm leading-6 text-white/68 sm:text-[15px]">{ownerBioText}</p>
                  ) : (
                    <p className="max-w-3xl text-sm leading-6 text-white/46 sm:text-[15px]">
                      {OWNER_BIO_EMPTY_STATE}
                    </p>
                  )}
                </OwnerProfileInfoSection>

                {effectiveOwnerProfileMode === "talent" ? (
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

                    <OwnerProfileInfoSection
                      title="Portfolio"
                      actions={
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <OwnerInlineActionButton label="Add item" icon="plus" onClick={openPortfolioManager} />
                          <button
                            type="button"
                            aria-label="View Full Portfolio"
                            onClick={() => setTab("portfolio")}
                            className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
                          >
                            <span className="inline-flex items-center gap-1">
                              <span>View Full Portfolio</span>
                              <span aria-hidden="true">→</span>
                            </span>
                          </button>
                        </div>
                      }
                    >
                      {ownerPortfolioPreview.length ? (
                        <OwnerPortfolioPreviewList items={ownerPortfolioPreview} />
                      ) : (
                        <p className="text-sm leading-6 text-white/46">
                          Add a few strong projects so visitors can see the work exactly as it will appear publicly.
                        </p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection
                      title="Reviews"
                      actions={
                        <button
                          type="button"
                          onClick={() => setTab("reviews")}
                          className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
                        >
                          View All Reviews <span aria-hidden="true">→</span>
                        </button>
                      }
                    >
                      {ownerReviewItems.length ? (
                        <ProfileReviewsPreviewRail items={ownerReviewItems} />
                      ) : (
                        <p className="text-sm leading-6 text-white/46">
                          Reviews will appear here after collaborators leave feedback. They cannot be added from your profile.
                        </p>
                      )}
                    </OwnerProfileInfoSection>
                  </>
                ) : (
                  <>
                    <OwnerProfileInfoSection
                      title="Recent Hires"
                      actions={
                        jobs.length ? (
                          <OwnerInlineActionButton label="Manage jobs" onClick={() => setTab("jobs")} />
                        ) : (
                          <OwnerInlineGhostLink label="Post job" href="/post-job" />
                        )
                      }
                    >
                      {ownerHiringExperiencePreview.length ? (
                        <OwnerHiringExperienceList items={ownerHiringExperiencePreview} />
                      ) : (
                        <p className="text-sm leading-6 text-white/46">
                          Closed or completed jobs will show up here once you have recruiter-side hiring history.
                        </p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection
                      title="Jobs"
                      actions={
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <OwnerInlineGhostLink label="Post job" href="/post-job" />
                          <button
                            type="button"
                            onClick={() => setTab("jobs")}
                            className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
                          >
                            View All Jobs <span aria-hidden="true">→</span>
                          </button>
                        </div>
                      }
                    >
                      {ownerJobsPreview.length ? (
                        <OwnerJobsPreviewList
                          items={ownerJobsPreview}
                          token={backendToken ?? undefined}
                          onJobDeleted={handleJobDeleted}
                        />
                      ) : (
                        <p className="text-sm leading-6 text-white/46">
                          Posted jobs will appear here. Use your existing job posting flow to add or manage them.
                        </p>
                      )}
                    </OwnerProfileInfoSection>

                    <OwnerProfileInfoSection
                      title="Reviews"
                      actions={
                        <button
                          type="button"
                          onClick={() => setTab("reviews")}
                          className="shrink-0 cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white"
                        >
                          View All Reviews <span aria-hidden="true">→</span>
                        </button>
                      }
                    >
                      {ownerReviewItems.length ? (
                        <ProfileReviewsPreviewRail items={ownerReviewItems} />
                      ) : (
                        <p className="text-sm leading-6 text-white/46">
                          Reviews will appear here after talent leave feedback. They cannot be added from your profile.
                        </p>
                      )}
                    </OwnerProfileInfoSection>
                  </>
                )}
              </div>

              <OwnerMetadataSidebar
                groups={effectiveOwnerProfileMode === "hiring" ? ownerRecruiterMetadataGroups : ownerTalentMetadataGroups}
              />
            </div>
          ) : null}

          {effectiveOwnerProfileMode === "hiring" && visibleOwnerTab === "jobs" ? (
            <div className="space-y-5">
              {ownerJobsSorted.length ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {ownerJobsSorted.map((job) => (
                    <OwnerJobCard
                      key={job.id}
                      job={job}
                      token={backendToken ?? undefined}
                      onDeleted={handleJobDeleted}
                    />
                  ))}
                </div>
              ) : (
                <JobsEmptyState owner />
              )}
            </div>
          ) : null}

          {visibleOwnerTab === "reviews" ? (
            <ProfileReviewsTabContent
              items={ownerReviewItems}
              averageRating={profile?.reviews?.avg_rating || 0}
              reviewCount={profile?.reviews?.review_count || 0}
            />
          ) : null}

          {effectiveOwnerProfileMode === "talent" && visibleOwnerTab === "portfolio" ? (
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

          {showLegacyPortfolioEditor && effectiveOwnerProfileMode === "talent" && visibleOwnerTab === "portfolio" ? (
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
                            <label className="inline-flex items-center gap-2 text-xs text-white/60">
                              <Icon name="sliders-horizontal" className="h-3.5 w-3.5 text-white/55" />
                              Tools used
                            </label>
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

          {visibleOwnerTab === "saved" ? (
            <OwnerSavedTab backendAccessToken={resolvedBackendAccessToken} />
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
              <div className="mt-3 max-h-[min(360px,calc(100vh-180px))] space-y-1 overflow-y-auto pr-0.5">
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
