"use client";

import Link from "next/link";
import React, { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../Icons";
import LocationAutocompleteField from "../you/LocationAutocompleteField";
import {
  describeActionError,
  listMyYouTubeChannels,
  markAllNotificationsRead,
  refreshMyYouTubeChannels,
  updateMyOnboardingIntent,
  updateMyPrivacy,
  updateMyProfile,
  uploadMyAvatar,
  type BackendMeResponse,
  type BackendMeYouTubeChannel,
  type BackendNotificationListResponse,
  type BackendOnboardingIntent,
  type BackendProfileResponse,
  type BackendProfileUpdatePayload,
  type BackendPrivacySettings,
} from "../../lib/backendClient";
import { getCustomLocationValidationError, normalizeCustomLocationInput } from "../../lib/locationValidation";
import type { LocationDetails } from "../../lib/locationTypes";
import {
  cleanProfileDisplayName,
  DEFAULT_WORKING_HOURS_END,
  DEFAULT_WORKING_HOURS_START,
  DEFAULT_WORKING_HOURS_TIMEZONE,
  formatWorkingHours,
  normalizeProfileHandle,
  parseWorkingHours,
  validateProfileDisplayName,
  validateProfileUsername,
  type WorkingHoursMode,
} from "../../lib/profileSettings";
import {
  normalizeRevisionsPreferenceForSave,
  validateRevisionsPreference,
  validateTurnaroundPreference,
} from "../../lib/workPreferences";

type SettingsSectionId =
  | "account"
  | "profile-visibility"
  | "marketplace"
  | "connected-accounts"
  | "notifications"
  | "payments"
  | "privacy-data"
  | "security"
  | "preferences"
  | "support-legal";

type SettingsSessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  provider?: string;
  providerAccountId?: string;
  username?: string;
  accountType?: string;
  onboardingIntent?: BackendOnboardingIntent;
};

type LoadErrors = {
  me: boolean;
  profile: boolean;
  channels: boolean;
  notifications: boolean;
};

type RowTone = "active" | "neutral" | "readonly" | "future" | "danger";
type RowFeedback = { state: "saving" | "saved" | "error"; message?: string };

type SettingsClientProps = {
  backendAccessToken: string;
  sessionUser: SettingsSessionUser;
  initialMe: BackendMeResponse | null;
  initialProfile: BackendProfileResponse | null;
  initialChannels: BackendMeYouTubeChannel[];
  initialNotifications: BackendNotificationListResponse | null;
  loadErrors: LoadErrors;
};

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const DEFAULT_PRIVACY_SETTINGS: BackendPrivacySettings = {
  show_bio: true,
  show_links: true,
  show_skills: true,
  show_location: false,
  show_availability: false,
  show_youtube_badge: true,
};

const SECTIONS: Array<{
  id: SettingsSectionId;
  title: string;
  icon: React.ComponentProps<typeof Icon>["name"];
}> = [
  { id: "account", title: "Account", icon: "user" },
  { id: "profile-visibility", title: "Profile & Visibility", icon: "globe" },
  { id: "marketplace", title: "Marketplace Preferences", icon: "briefcase" },
  { id: "connected-accounts", title: "Connected Accounts", icon: "badge-check" },
  { id: "notifications", title: "Notifications", icon: "bell" },
  { id: "payments", title: "Payments", icon: "wallet" },
  { id: "privacy-data", title: "Privacy & Data", icon: "shield" },
  { id: "security", title: "Security", icon: "shield" },
  { id: "preferences", title: "Preferences", icon: "settings" },
  { id: "support-legal", title: "Support & Legal", icon: "help" },
];

const ONBOARDING_OPTIONS: Array<{ value: BackendOnboardingIntent; label: string; description: string }> = [
  {
    value: "BOTH",
    label: "Hiring and getting hired",
    description: "Use one profile for creator work and recruiter activity.",
  },
  {
    value: "LOOKING_FOR_WORK",
    label: "Getting hired",
    description: "Prioritize talent-side profile and applications.",
  },
  {
    value: "HIRING_CREATOR_TALENT",
    label: "Hiring creator talent",
    description: "Prioritize recruiter-side posting and applicant management.",
  },
  {
    value: "DECIDE_LATER",
    label: "Decide later",
    description: "Keep the account flexible while you set things up.",
  },
];

const AVAILABILITY_OPTIONS: Array<{ value: NonNullable<BackendProfileResponse["availability_status"]>; label: string }> = [
  { value: "available", label: "Available" },
  { value: "selective", label: "Selective" },
  { value: "unavailable", label: "Unavailable" },
];

const WORK_MODE_OPTIONS = ["Remote", "Hybrid", "On-site"] as const;
const PROJECT_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "oneOff", label: "One-off projects" },
  { value: "retainer", label: "Retainer / ongoing work" },
  { value: "either", label: "Either" },
] as const;

const TURNAROUND_OPTIONS = ["", "24 hours", "2-3 days", "about a week", "2+ weeks", "flexible"] as const;
const REVISION_OPTIONS = ["", "1 round", "2 rounds", "3 rounds", "case by case", "unlimited"] as const;

const compact = (value?: string | null, fallback = "Not set") => {
  const text = value?.trim();
  return text || fallback;
};

const accountTypeLabel = (value?: string | null) => {
  if (value === "TALENT") return "Talent";
  if (value === "EMPLOYER") return "Recruiter";
  if (value === "BOTH") return "Talent and recruiter";
  if (value === "ADMIN") return "Admin";
  return "Unified profile";
};

const onboardingIntentLabel = (value?: BackendOnboardingIntent | null) =>
  ONBOARDING_OPTIONS.find((item) => item.value === value)?.label || "Decide later";

const providerLabel = (value?: string | null) => {
  if (!value) return "Email / OAuth";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const yesNo = (value?: boolean) => (value ? "Shown" : "Hidden");

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read image file."));
    };
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: RowTone }) {
  return (
    <span
      className={[
        "inline-flex min-h-6 max-w-full items-center justify-center rounded-full border px-2.5 text-[11px] font-semibold leading-5",
        tone === "active"
          ? "border-emerald-300/16 bg-emerald-300/[0.08] text-emerald-100"
          : tone === "danger"
            ? "border-rose-300/18 bg-rose-400/[0.07] text-rose-100"
            : tone === "future"
              ? "border-white/[0.08] bg-white/[0.03] text-white/42"
              : tone === "readonly"
                ? "border-white/[0.09] bg-white/[0.04] text-white/48"
                : "border-white/[0.1] bg-white/[0.045] text-white/62",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function RowFeedbackBadge({ feedback }: { feedback?: RowFeedback }) {
  if (!feedback) return null;
  if (feedback.state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/44">
        <span className="h-3 w-3 rounded-full border border-white/16 border-t-white/70 animate-spin" />
        Saving
      </span>
    );
  }
  if (feedback.state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-100/76">
        <Icon name="check" className="h-3.5 w-3.5" />
        Saved
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[260px] items-center gap-1.5 text-[11px] font-semibold text-amber-100/86">
      <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{feedback.message || "Could not save."}</span>
    </span>
  );
}

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: SettingsSectionId;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const sectionIcon = SECTIONS.find((section) => section.id === id)?.icon;

  return (
    <section
      id={id}
      data-testid={`settings-section-${id}`}
      className="scroll-mt-24 rounded-[20px] border border-white/[0.08] bg-white/[0.035] shadow-[0_18px_60px_-46px_rgba(0,0,0,0.95)]"
    >
      <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white">
          {sectionIcon ? (
            <span aria-hidden="true" className="inline-flex shrink-0 text-white/58">
              <Icon name={sectionIcon} className="h-4 w-4" />
            </span>
          ) : null}
          <span>{title}</span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-white/48">{description}</p>
      </div>
      <div className="divide-y divide-white/[0.065]">{children}</div>
    </section>
  );
}

function SettingRow({
  rowId,
  title,
  description,
  status,
  statusTone = "neutral",
  feedback,
  action,
  children,
  danger = false,
}: {
  rowId: string;
  title: string;
  description: string;
  status?: string;
  statusTone?: RowTone;
  feedback?: RowFeedback;
  action?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div data-testid={`settings-row-${rowId}`} className="px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <h3 className={["text-sm font-semibold", danger ? "text-rose-100" : "text-white/86"].join(" ")}>
            {title}
          </h3>
          <p className="max-w-2xl text-sm leading-6 text-white/48">{description}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <RowFeedbackBadge feedback={feedback} />
          {status ? <StatusPill label={status} tone={danger ? "danger" : statusTone} /> : null}
          {action}
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function EditButton({
  active,
  onClick,
  disabled,
  label = "Edit",
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      className={[
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-white/22 bg-white/[0.1] text-white"
          : "border-white/[0.1] bg-white/[0.035] text-white/66 hover:border-white/[0.18] hover:bg-white/[0.065] hover:text-white",
      ].join(" ")}
    >
      <Icon name="pencil" className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function InlinePanel({
  children,
  error,
  actions,
}: {
  children: ReactNode;
  error?: string | null;
  actions: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-black/20 p-4">
      {error ? (
        <p className="mb-3 rounded-xl border border-amber-200/18 bg-amber-200/[0.075] px-3 py-2 text-xs text-amber-50/84">
          {error}
        </p>
      ) : null}
      {children}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
    </div>
  );
}

function CancelButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      Cancel
    </button>
  );
}

function SaveButton({ onClick, disabled, saving }: { onClick: () => void; disabled?: boolean; saving?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="h-9 cursor-pointer rounded-xl bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving ? "Saving..." : "Save"}
    </button>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-white/55">{children}</span>;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: string;
}) {
  return (
    <label className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="h-10 w-full rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-white/24"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-[#101116] px-3 text-sm text-white outline-none transition-colors focus:border-white/24"
      >
        {children}
      </select>
    </label>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-55",
        checked ? "border-white/24 bg-white text-black" : "border-white/12 bg-white/[0.055] text-white/50",
      ].join(" ")}
    >
      <span
        className={[
          "absolute h-5 w-5 rounded-full transition-transform",
          checked ? "translate-x-5 bg-black" : "translate-x-1 bg-white/58",
        ].join(" ")}
      />
    </button>
  );
}

function DisabledFutureRow({
  rowId,
  title,
  description,
  status = "Coming soon",
  danger = false,
}: {
  rowId: string;
  title: string;
  description: string;
  status?: string;
  danger?: boolean;
}) {
  return (
    <SettingRow
      rowId={rowId}
      title={title}
      description={description}
      status={status}
      statusTone="future"
      danger={danger}
      action={
        <button
          type="button"
          disabled
          className="inline-flex h-8 cursor-not-allowed items-center rounded-full border border-white/[0.07] bg-white/[0.02] px-3 text-xs font-semibold text-white/30"
          title="This setting needs backend support before it can be edited."
        >
          Disabled
        </button>
      }
    />
  );
}

export default function SettingsClient({
  backendAccessToken,
  sessionUser,
  initialMe,
  initialProfile,
  initialChannels,
  initialNotifications,
  loadErrors,
}: SettingsClientProps) {
  const [me, setMe] = useState(initialMe);
  const [profile, setProfile] = useState(initialProfile);
  const [channels, setChannels] = useState(initialChannels);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("account");
  const [activeEditor, setActiveEditor] = useState<string | null>(null);
  const [rowFeedback, setRowFeedback] = useState<Record<string, RowFeedback>>({});
  const feedbackTimers = useRef<Record<string, number>>({});
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  const [displayNameDraft, setDisplayNameDraft] = useState(
    profile?.display_name || me?.display_name || sessionUser.name || ""
  );
  const [usernameDraft, setUsernameDraft] = useState(profile?.username || me?.username || sessionUser.username || "");
  const [onboardingDraft, setOnboardingDraft] = useState<BackendOnboardingIntent>(
    me?.onboarding_intent || profile?.onboarding_intent || sessionUser.onboardingIntent || "DECIDE_LATER"
  );
  const [locationDraft, setLocationDraft] = useState(profile?.location || "");
  const [locationSelection, setLocationSelection] = useState<LocationDetails | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState(profile?.timezone || DEFAULT_WORKING_HOURS_TIMEZONE);
  const [availabilityDraft, setAvailabilityDraft] = useState<NonNullable<BackendProfileResponse["availability_status"]>>(
    profile?.availability_status || "selective"
  );
  const [workModeDraft, setWorkModeDraft] = useState(profile?.collaboration_preferences?.work_mode || "");
  const initialWorkingHours = parseWorkingHours(profile?.collaboration_preferences?.working_hours, profile?.timezone);
  const [workingHoursMode, setWorkingHoursMode] = useState<WorkingHoursMode>(initialWorkingHours.mode);
  const [workingHoursStart, setWorkingHoursStart] = useState(initialWorkingHours.start);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(initialWorkingHours.end);
  const [workingHoursTimezone, setWorkingHoursTimezone] = useState(initialWorkingHours.timezone);
  const [projectTypeDraft, setProjectTypeDraft] = useState(profile?.collaboration_preferences?.project_type_preference || "");
  const [turnaroundDraft, setTurnaroundDraft] = useState(profile?.collaboration_preferences?.turnaround || "");
  const [revisionsDraft, setRevisionsDraft] = useState(profile?.collaboration_preferences?.revisions || "");
  const [instagramHandleDraft, setInstagramHandleDraft] = useState(profile?.social_connections?.instagram?.handle || "");
  const [instagramUrlDraft, setInstagramUrlDraft] = useState(profile?.social_connections?.instagram?.url || "");
  const [editorError, setEditorError] = useState<string | null>(null);

  const privacySettings = profile?.privacy_settings || DEFAULT_PRIVACY_SETTINGS;
  const displayName = compact(profile?.display_name || me?.display_name || sessionUser.name, "CreatorJobs account");
  const username = profile?.username || me?.username || sessionUser.username || "";
  const email = profile?.email || me?.email || sessionUser.email || "Not available";
  const avatarUrl = profile?.avatar_url || sessionUser.image || null;
  const unreadCount = notifications?.unread_count || 0;

  const setFeedback = (rowId: string, feedback?: RowFeedback) => {
    window.clearTimeout(feedbackTimers.current[rowId]);
    setRowFeedback((current) => {
      const next = { ...current };
      if (feedback) next[rowId] = feedback;
      else delete next[rowId];
      return next;
    });
    if (feedback?.state === "saved") {
      feedbackTimers.current[rowId] = window.setTimeout(() => {
        setRowFeedback((current) => {
          const next = { ...current };
          delete next[rowId];
          return next;
        });
      }, 2200);
    }
  };

  useEffect(() => {
    const timers = feedbackTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target?.id) {
          setActiveSection(visible.target.id as SettingsSectionId);
        }
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: [0.08, 0.2, 0.5] }
    );
    SECTIONS.forEach((section) => {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  const hydrateProfileDrafts = (nextProfile: BackendProfileResponse) => {
    setDisplayNameDraft(nextProfile.display_name || "");
    setUsernameDraft(nextProfile.username || "");
    setLocationDraft(nextProfile.location || "");
    setLocationSelection(null);
    setLocationError(null);
    setTimezoneDraft(nextProfile.timezone || DEFAULT_WORKING_HOURS_TIMEZONE);
    setAvailabilityDraft(nextProfile.availability_status || "selective");
    setWorkModeDraft(nextProfile.collaboration_preferences?.work_mode || "");
    const parsed = parseWorkingHours(nextProfile.collaboration_preferences?.working_hours, nextProfile.timezone);
    setWorkingHoursMode(parsed.mode);
    setWorkingHoursStart(parsed.start);
    setWorkingHoursEnd(parsed.end);
    setWorkingHoursTimezone(parsed.timezone);
    setProjectTypeDraft(nextProfile.collaboration_preferences?.project_type_preference || "");
    setTurnaroundDraft(nextProfile.collaboration_preferences?.turnaround || "");
    setRevisionsDraft(nextProfile.collaboration_preferences?.revisions || "");
    setInstagramHandleDraft(nextProfile.social_connections?.instagram?.handle || "");
    setInstagramUrlDraft(nextProfile.social_connections?.instagram?.url || "");
  };

  const applyProfile = (nextProfile: BackendProfileResponse) => {
    setProfile(nextProfile);
    hydrateProfileDrafts(nextProfile);
  };

  const saveProfile = async (rowId: string, payload: BackendProfileUpdatePayload) => {
    setFeedback(rowId, { state: "saving" });
    setEditorError(null);
    try {
      const updated = await updateMyProfile(backendAccessToken, payload);
      applyProfile(updated);
      setFeedback(rowId, { state: "saved" });
      setActiveEditor(null);
      return true;
    } catch (error) {
      const message = describeActionError(error, "Could not save this setting.");
      setEditorError(message);
      setFeedback(rowId, { state: "error", message });
      return false;
    }
  };

  const saveOnboardingIntent = async () => {
    const rowId = "account-onboarding";
    setFeedback(rowId, { state: "saving" });
    setEditorError(null);
    try {
      const updated = await updateMyOnboardingIntent(backendAccessToken, onboardingDraft);
      setMe(updated);
      setFeedback(rowId, { state: "saved" });
      setActiveEditor(null);
    } catch (error) {
      const message = describeActionError(error, "Could not save account mode.");
      setEditorError(message);
      setFeedback(rowId, { state: "error", message });
    }
  };

  const togglePrivacy = async (key: keyof BackendPrivacySettings) => {
    const rowId = `privacy-${key}`;
    const previous = profile;
    const nextPrivacy = {
      ...privacySettings,
      [key]: !privacySettings[key],
    };
    if (profile) {
      setProfile({ ...profile, privacy_settings: nextPrivacy });
    }
    setFeedback(rowId, { state: "saving" });
    try {
      const updated = await updateMyPrivacy(backendAccessToken, { [key]: nextPrivacy[key] });
      applyProfile(updated);
      setFeedback(rowId, { state: "saved" });
    } catch (error) {
      if (previous) setProfile(previous);
      const message = describeActionError(error, "Could not update privacy.");
      setFeedback(rowId, { state: "error", message });
    }
  };

  const saveDisplayName = async () => {
    const error = validateProfileDisplayName(displayNameDraft);
    if (error) {
      setEditorError(error);
      return;
    }
    await saveProfile("account-display-name", { display_name: cleanProfileDisplayName(displayNameDraft) });
  };

  const saveUsername = async () => {
    const error = validateProfileUsername(usernameDraft);
    if (error) {
      setEditorError(error);
      return;
    }
    await saveProfile("account-username", { username: normalizeProfileHandle(usernameDraft) });
  };

  const saveLocationTimezone = async () => {
    const normalizedLocation = normalizeCustomLocationInput(locationDraft);
    const locationValidation = getCustomLocationValidationError(normalizedLocation);
    if (locationValidation) {
      setLocationError(locationValidation);
      setEditorError(locationValidation);
      return;
    }
    await saveProfile("marketplace-location", {
      location: locationSelection?.displayName || normalizedLocation,
      timezone: timezoneDraft.trim(),
    });
  };

  const saveAvailabilityWorkMode = async () => {
    const workingHoursValue = formatWorkingHours({
      mode: workingHoursMode,
      start: workingHoursStart,
      end: workingHoursEnd,
      timezone: workingHoursTimezone,
    });
    await saveProfile("marketplace-availability", {
      availability_status: availabilityDraft,
      work_mode: workModeDraft || null,
      timezone: workingHoursMode === "fixed" ? workingHoursTimezone.trim() : timezoneDraft.trim(),
      collaboration_working_hours: workingHoursValue,
    });
  };

  const saveProjectPreferences = async () => {
    const turnaroundError = validateTurnaroundPreference(turnaroundDraft);
    if (turnaroundError) {
      setEditorError(turnaroundError);
      return;
    }
    const revisionsError = validateRevisionsPreference(revisionsDraft);
    if (revisionsError) {
      setEditorError(revisionsError);
      return;
    }
    await saveProfile("marketplace-project-preferences", {
      project_type_preference: (projectTypeDraft || null) as BackendProfileUpdatePayload["project_type_preference"],
      collaboration_turnaround: turnaroundDraft.trim(),
      collaboration_revisions: normalizeRevisionsPreferenceForSave(revisionsDraft),
    });
  };

  const saveInstagram = async () => {
    await saveProfile("connected-instagram", {
      instagram_handle: instagramHandleDraft.trim().replace(/^@+/, ""),
      instagram_url: instagramUrlDraft.trim(),
    });
  };

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const rowId = "account-avatar";
    if (!file.type.startsWith("image/") || !ALLOWED_AVATAR_TYPES.has(file.type)) {
      const message = "Upload a PNG, JPG, or WEBP image.";
      setFeedback(rowId, { state: "error", message });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      const message = "Image must be 5 MB or smaller.";
      setFeedback(rowId, { state: "error", message });
      return;
    }
    setFeedback(rowId, { state: "saving" });
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const updated = await uploadMyAvatar(backendAccessToken, {
        file_name: file.name || "avatar",
        content_type: file.type,
        data_url: dataUrl,
      });
      applyProfile(updated);
      setFeedback(rowId, { state: "saved" });
    } catch (error) {
      setFeedback(rowId, {
        state: "error",
        message: describeActionError(error, "Could not update profile picture."),
      });
    }
  };

  const selectChannelAvatar = async (channelId: string) => {
    await saveProfile("account-avatar", {
      avatar_mode: "youtube_channel",
      avatar_youtube_channel_id: channelId,
    });
  };

  const refreshChannels = async () => {
    const rowId = "connected-youtube";
    setFeedback(rowId, { state: "saving" });
    try {
      const refreshed = await refreshMyYouTubeChannels(backendAccessToken);
      setChannels(refreshed.channels);
      setFeedback(rowId, { state: "saved" });
    } catch (error) {
      try {
        const listed = await listMyYouTubeChannels(backendAccessToken);
        setChannels(listed.channels);
        setFeedback(rowId, { state: "saved" });
      } catch {
        setFeedback(rowId, {
          state: "error",
          message: describeActionError(error, "Could not refresh YouTube channels."),
        });
      }
    }
  };

  const markNotificationsRead = async () => {
    const rowId = "notifications-status";
    setFeedback(rowId, { state: "saving" });
    try {
      await markAllNotificationsRead(backendAccessToken);
      setNotifications((current) =>
        current
          ? {
              ...current,
              unread_count: 0,
              items: current.items.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })),
            }
          : current
      );
      setFeedback(rowId, { state: "saved" });
    } catch (error) {
      setFeedback(rowId, {
        state: "error",
        message: describeActionError(error, "Could not mark notifications read."),
      });
    }
  };

  const sectionButtons = useMemo(
    () =>
      SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => {
            setActiveSection(section.id);
            document.getElementById(section.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
          className={[
            "inline-flex w-full min-w-max cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 lg:min-w-0",
            activeSection === section.id ? "bg-white/[0.09] text-white" : "text-white/52 hover:bg-white/[0.055] hover:text-white/78",
          ].join(" ")}
        >
          <Icon name={section.icon} className="h-4 w-4 shrink-0" />
          <span>{section.title}</span>
        </button>
      )),
    [activeSection]
  );

  const openEditor = (rowId: string) => {
    setEditorError(null);
    setActiveEditor((current) => (current === rowId ? null : rowId));
  };

  const cancelEditor = () => {
    if (profile) hydrateProfileDrafts(profile);
    else {
      setDisplayNameDraft(me?.display_name || sessionUser.name || "");
      setUsernameDraft(me?.username || sessionUser.username || "");
      setOnboardingDraft(me?.onboarding_intent || sessionUser.onboardingIntent || "DECIDE_LATER");
    }
    setEditorError(null);
    setActiveEditor(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.065),rgba(255,255,255,0.025))] px-4 py-4 shadow-[0_18px_70px_-50px_rgba(0,0,0,1)] sm:px-5">
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <input
            ref={avatarFileInputRef}
            type="file"
            accept="image/*"
            data-testid="settings-avatar-upload-input"
            className="sr-only"
            onChange={(event) => void handleAvatarFileChange(event)}
          />
          <button
            type="button"
            onClick={() => avatarFileInputRef.current?.click()}
            className="group relative h-16 w-16 cursor-pointer overflow-hidden rounded-2xl border border-white/14 bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            aria-label="Upload profile picture"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Icon name="user" className="h-7 w-7 text-white/64" />
              </span>
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/42 group-hover:opacity-100 group-focus-visible:bg-black/42 group-focus-visible:opacity-100">
              <Icon name="image" className="h-5 w-5 text-white" />
            </span>
          </button>

          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-white">{displayName}</p>
            <p className="mt-1 truncate text-sm text-white/48">{username ? `@${username}` : email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill label={onboardingIntentLabel(me?.onboarding_intent || profile?.onboarding_intent || sessionUser.onboardingIntent)} tone="active" />
              <StatusPill label={channels.length ? `${channels.length} YouTube linked` : "No YouTube channel"} />
              <StatusPill label={unreadCount ? `${unreadCount} unread` : "Notifications clear"} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:justify-end">
            {loadErrors.profile ? <StatusPill label="Profile data unavailable" tone="future" /> : null}
            {loadErrors.me ? <StatusPill label="Account data unavailable" tone="future" /> : null}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-20">
          <div className="flex min-w-0 gap-2 overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.035] p-2 lg:block lg:space-y-1 lg:overflow-visible">
            {sectionButtons}
          </div>
        </nav>

        <div className="min-w-0 space-y-5 pb-12">
          <SettingsSection
            id="account"
            title="Account"
            description="Identity and login details for your unified CreatorJobs account."
          >
            <SettingRow
              rowId="account-avatar"
              title="Profile picture"
              description="Upload a profile image or use a verified YouTube channel avatar."
              status={profile?.avatar_mode === "youtube_channel" ? "YouTube avatar" : avatarUrl ? "Custom image" : "Not set"}
              statusTone={avatarUrl ? "active" : "neutral"}
              feedback={rowFeedback["account-avatar"]}
              action={
                <button
                  type="button"
                  onClick={() => avatarFileInputRef.current?.click()}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-white/66 transition-colors hover:bg-white/[0.065] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <Icon name="image" className="h-3.5 w-3.5" />
                  Upload
                </button>
              }
            >
              {channels.length ? (
                <div className="flex flex-wrap gap-2">
                  {channels.map((channel) => (
                    <button
                      key={channel.channel_id}
                      type="button"
                      onClick={() => void selectChannelAvatar(channel.channel_id)}
                      className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-white/68 transition-colors hover:bg-white/[0.065] hover:text-white"
                    >
                      {channel.thumbnail_url ? (
                        <img src={channel.thumbnail_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                      ) : (
                        <Icon name="youtube" className="h-4 w-4" />
                      )}
                      <span className="truncate">{channel.title}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="account-display-name"
              title="Display name"
              description="Shown across your profile, listings, and conversations."
              status={compact(profile?.display_name || me?.display_name || sessionUser.name)}
              statusTone={profile?.display_name || me?.display_name || sessionUser.name ? "active" : "neutral"}
              feedback={rowFeedback["account-display-name"]}
              action={<EditButton active={activeEditor === "account-display-name"} onClick={() => openEditor("account-display-name")} />}
            >
              {activeEditor === "account-display-name" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["account-display-name"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveDisplayName()}
                        saving={rowFeedback["account-display-name"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <TextField label="Display name" value={displayNameDraft} onChange={setDisplayNameDraft} maxLength={80} />
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="account-username"
              title="Username"
              description="Your public handle and profile URL."
              status={username ? `@${username}` : "Not set"}
              statusTone={username ? "active" : "neutral"}
              feedback={rowFeedback["account-username"]}
              action={<EditButton active={activeEditor === "account-username"} onClick={() => openEditor("account-username")} />}
            >
              {activeEditor === "account-username" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["account-username"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveUsername()}
                        saving={rowFeedback["account-username"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <label className="space-y-2">
                    <FieldLabel>Username</FieldLabel>
                    <div className="flex h-10 items-center rounded-xl border border-white/10 bg-black/18 px-3 transition-colors focus-within:border-white/24">
                      <span className="text-sm text-white/38">@</span>
                      <input
                        value={usernameDraft}
                        onChange={(event) => setUsernameDraft(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-white/28"
                        placeholder="your_profile"
                        maxLength={30}
                      />
                    </div>
                  </label>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="account-onboarding"
              title="Account mode"
              description="Choose how CreatorJobs should orient your account experience."
              status={onboardingIntentLabel(me?.onboarding_intent || profile?.onboarding_intent || sessionUser.onboardingIntent)}
              statusTone="active"
              feedback={rowFeedback["account-onboarding"]}
              action={<EditButton active={activeEditor === "account-onboarding"} onClick={() => openEditor("account-onboarding")} />}
            >
              {activeEditor === "account-onboarding" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["account-onboarding"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveOnboardingIntent()}
                        saving={rowFeedback["account-onboarding"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    {ONBOARDING_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setOnboardingDraft(option.value)}
                        aria-pressed={onboardingDraft === option.value}
                        className={[
                          "rounded-xl border p-3 text-left transition-colors",
                          onboardingDraft === option.value
                            ? "border-white/26 bg-white/[0.095] text-white"
                            : "border-white/10 bg-white/[0.025] text-white/68 hover:bg-white/[0.055] hover:text-white",
                        ].join(" ")}
                      >
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-white/46">{option.description}</span>
                      </button>
                    ))}
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow rowId="account-email" title="Email" description="Used for login and account communication." status={email} statusTone="readonly" />
            <SettingRow
              rowId="account-type"
              title="Legacy account type"
              description="Derived from onboarding history and kept for compatibility."
              status={accountTypeLabel(profile?.account_type || me?.account_type || sessionUser.accountType)}
              statusTone="readonly"
            />
            <DisabledFutureRow rowId="account-change-email" title="Change email" description="Changing account email needs a verification flow." status="Requires backend" />
            <DisabledFutureRow rowId="account-password" title="Password" description="Password changes are not wired into this settings workspace yet." status="Requires backend" />
          </SettingsSection>

          <SettingsSection
            id="profile-visibility"
            title="Profile & Visibility"
            description="Control what parts of your public CreatorJobs presence are visible."
          >
            {([
              ["show_bio", "Bio", "Show your profile bio on the public profile."],
              ["show_links", "Links", "Show public profile social and website links."],
              ["show_skills", "Tools", "Show skills and tools on your public profile."],
              ["show_location", "Location", "Show your location publicly."],
              ["show_availability", "Availability", "Show availability and working hours publicly."],
              ["show_youtube_badge", "YouTube badge", "Show verified YouTube channel badge where available."],
            ] as const).map(([key, title, description]) => (
              <SettingRow
                key={key}
                rowId={`privacy-${key}`}
                title={title}
                description={description}
                status={yesNo(privacySettings[key])}
                statusTone={privacySettings[key] ? "active" : "neutral"}
                feedback={rowFeedback[`privacy-${key}`]}
                action={
                  <ToggleSwitch
                    checked={privacySettings[key]}
                    onChange={() => void togglePrivacy(key)}
                    disabled={rowFeedback[`privacy-${key}`]?.state === "saving"}
                    label={`Toggle ${title}`}
                  />
                }
              />
            ))}
            <DisabledFutureRow rowId="profile-discovery" title="Profile discovery" description="Search and marketplace discovery controls need backend support." status="Not wired yet" />
          </SettingsSection>

          <SettingsSection
            id="marketplace"
            title="Marketplace Preferences"
            description="Defaults that shape hiring, applying, and collaboration context."
          >
            <SettingRow
              rowId="marketplace-location"
              title="Location and timezone"
              description="Used for profile availability and marketplace coordination."
              status={[compact(profile?.location), compact(profile?.timezone, "Timezone not set")].join(" / ")}
              feedback={rowFeedback["marketplace-location"]}
              action={<EditButton active={activeEditor === "marketplace-location"} onClick={() => openEditor("marketplace-location")} />}
            >
              {activeEditor === "marketplace-location" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["marketplace-location"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveLocationTimezone()}
                        saving={rowFeedback["marketplace-location"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <LocationAutocompleteField
                      value={locationDraft}
                      selectedLocation={locationSelection}
                      onValueChange={(value) => {
                        setLocationDraft(value);
                        setLocationError(null);
                      }}
                      onSelectionChange={setLocationSelection}
                      error={locationError}
                      onErrorChange={setLocationError}
                      size="compact"
                    />
                    <TextField label="Timezone" value={timezoneDraft} onChange={setTimezoneDraft} placeholder="IST" maxLength={64} />
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="marketplace-availability"
              title="Availability and work mode"
              description="Default collaboration availability, work mode, and working hours."
              status={[compact(profile?.availability_status, "Selective"), compact(profile?.collaboration_preferences?.work_mode, "Work mode not set")].join(" / ")}
              feedback={rowFeedback["marketplace-availability"]}
              action={<EditButton active={activeEditor === "marketplace-availability"} onClick={() => openEditor("marketplace-availability")} />}
            >
              {activeEditor === "marketplace-availability" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["marketplace-availability"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveAvailabilityWorkMode()}
                        saving={rowFeedback["marketplace-availability"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectField label="Availability" value={availabilityDraft} onChange={(value) => setAvailabilityDraft(value as typeof availabilityDraft)}>
                      {AVAILABILITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField label="Work mode" value={workModeDraft} onChange={setWorkModeDraft}>
                      <option value="">Not set</option>
                      {WORK_MODE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SelectField>
                    <div className="space-y-2 md:col-span-2">
                      <FieldLabel>Working hours</FieldLabel>
                      <div className="flex flex-wrap gap-2">
                        {(["flexible", "fixed"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setWorkingHoursMode(mode)}
                            aria-pressed={workingHoursMode === mode}
                            className={[
                              "h-9 cursor-pointer rounded-xl border px-3 text-xs font-semibold transition-colors",
                              workingHoursMode === mode
                                ? "border-white bg-white text-black"
                                : "border-white/10 bg-white/[0.03] text-white/58 hover:bg-white/[0.07] hover:text-white",
                            ].join(" ")}
                          >
                            {mode === "flexible" ? "Flexible" : "Set hours"}
                          </button>
                        ))}
                      </div>
                      {workingHoursMode === "fixed" ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <input
                            type="time"
                            value={workingHoursStart}
                            onChange={(event) => setWorkingHoursStart(event.target.value || DEFAULT_WORKING_HOURS_START)}
                            className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none focus:border-white/24"
                          />
                          <input
                            type="time"
                            value={workingHoursEnd}
                            onChange={(event) => setWorkingHoursEnd(event.target.value || DEFAULT_WORKING_HOURS_END)}
                            className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none focus:border-white/24"
                          />
                          <input
                            value={workingHoursTimezone}
                            onChange={(event) => setWorkingHoursTimezone(event.target.value)}
                            placeholder={DEFAULT_WORKING_HOURS_TIMEZONE}
                            className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/24"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="marketplace-project-preferences"
              title="Project preferences"
              description="Default project type, turnaround, and revision expectations."
              status={[
                PROJECT_TYPE_OPTIONS.find((option) => option.value === profile?.collaboration_preferences?.project_type_preference)?.label || "Project type not set",
                compact(profile?.collaboration_preferences?.turnaround, "Turnaround not set"),
              ].join(" / ")}
              feedback={rowFeedback["marketplace-project-preferences"]}
              action={<EditButton active={activeEditor === "marketplace-project-preferences"} onClick={() => openEditor("marketplace-project-preferences")} />}
            >
              {activeEditor === "marketplace-project-preferences" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["marketplace-project-preferences"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveProjectPreferences()}
                        saving={rowFeedback["marketplace-project-preferences"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <div className="grid gap-4 md:grid-cols-3">
                    <SelectField label="Project type" value={projectTypeDraft} onChange={setProjectTypeDraft}>
                      {PROJECT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField label="Turnaround" value={turnaroundDraft} onChange={setTurnaroundDraft}>
                      {TURNAROUND_OPTIONS.map((option) => (
                        <option key={option || "empty"} value={option}>
                          {option || "Not set"}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField label="Revisions" value={revisionsDraft} onChange={setRevisionsDraft}>
                      {REVISION_OPTIONS.map((option) => (
                        <option key={option || "empty"} value={option}>
                          {option || "Not set"}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow rowId="marketplace-currency" title="Default currency" description="Default marketplace display currency." status="INR" statusTone="readonly" />
            <DisabledFutureRow rowId="marketplace-saved-search" title="Saved search defaults" description="Saved search and alert preferences need backend support." status="Not wired yet" />
            <DisabledFutureRow rowId="marketplace-recommendations" title="Recommendations" description="Recommendation tuning is planned for a later preference system." status="Coming soon" />
          </SettingsSection>

          <SettingsSection
            id="connected-accounts"
            title="Connected Accounts"
            description="Verified accounts used for profile trust and channel identity."
          >
            <SettingRow
              rowId="connected-youtube"
              title="Verified YouTube channels"
              description="Refresh linked channels from your current Google OAuth connection."
              status={channels.length ? `${channels.length} connected` : loadErrors.channels ? "Unavailable" : "None connected"}
              statusTone={channels.length ? "active" : "neutral"}
              feedback={rowFeedback["connected-youtube"]}
              action={
                <button
                  type="button"
                  onClick={() => void refreshChannels()}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-white/66 transition-colors hover:bg-white/[0.065] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  Refresh
                </button>
              }
            >
              {channels.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {channels.map((channel) => (
                    <div key={channel.channel_id} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
                      {channel.thumbnail_url ? (
                        <img src={channel.thumbnail_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
                          <Icon name="youtube" className="h-4 w-4 text-white/70" />
                        </span>
                      )}
                      <span className="min-w-0 truncate text-sm font-semibold text-white/78">{channel.title}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="connected-instagram"
              title="Instagram profile"
              description="Optional Instagram handle or URL shown as a connected profile link."
              status={profile?.social_connections?.instagram?.connected ? "Connected" : "Not set"}
              statusTone={profile?.social_connections?.instagram?.connected ? "active" : "neutral"}
              feedback={rowFeedback["connected-instagram"]}
              action={<EditButton active={activeEditor === "connected-instagram"} onClick={() => openEditor("connected-instagram")} />}
            >
              {activeEditor === "connected-instagram" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["connected-instagram"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveInstagram()}
                        saving={rowFeedback["connected-instagram"]?.state === "saving"}
                      />
                    </>
                  }
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField label="Instagram handle" value={instagramHandleDraft} onChange={setInstagramHandleDraft} placeholder="creatorjobs" maxLength={255} />
                    <TextField label="Instagram URL" value={instagramUrlDraft} onChange={setInstagramUrlDraft} placeholder="https://instagram.com/creatorjobs" maxLength={1024} />
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>
            <DisabledFutureRow rowId="connected-oauth-connect" title="Connect provider" description="OAuth connect and revoke controls need a dedicated backend flow." status="Requires backend" />
          </SettingsSection>

          <SettingsSection
            id="notifications"
            title="Notifications"
            description="Current notification status and future alert preferences."
          >
            <SettingRow
              rowId="notifications-status"
              title="Notification status"
              description="Unread in-app notification count for this account."
              status={loadErrors.notifications ? "Unavailable" : unreadCount ? `${unreadCount} unread` : "All read"}
              statusTone={unreadCount ? "active" : "readonly"}
              feedback={rowFeedback["notifications-status"]}
              action={
                <button
                  type="button"
                  onClick={() => void markNotificationsRead()}
                  disabled={!unreadCount || loadErrors.notifications}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-white/66 transition-colors hover:bg-white/[0.065] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name="check" className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              }
            />
            <DisabledFutureRow rowId="notifications-email" title="Email notifications" description="Email notification preferences need backend support." status="Not wired yet" />
            <DisabledFutureRow rowId="notifications-applications" title="Application updates" description="Per-event application alert controls are planned." status="Coming soon" />
            <DisabledFutureRow rowId="notifications-hiring" title="Hiring request updates" description="Hiring request alert controls are planned." status="Coming soon" />
            <DisabledFutureRow rowId="notifications-messages" title="Messages" description="Message notification preferences are not wired yet." status="Requires backend" />
            <DisabledFutureRow rowId="notifications-digest" title="Digest frequency" description="Digest emails require notification preference storage." status="Requires backend" />
          </SettingsSection>

          <SettingsSection
            id="payments"
            title="Payments, Billing & Payouts"
            description="Future payment infrastructure for paid marketplace flows."
          >
            <SettingRow rowId="payments-beta" title="Beta payment status" description="CreatorJobs beta does not require a payment method to publish right now." status="No payment required" statusTone="readonly" />
            <DisabledFutureRow rowId="payments-upi" title="UPI ID" description="Payout settings require payment infrastructure." status="Coming soon" />
            <DisabledFutureRow rowId="payments-payout" title="Payout method" description="Payout methods are not wired yet." status="Coming soon" />
            <DisabledFutureRow rowId="payments-billing" title="Billing details" description="Business name, GST, invoice address, and receipts are future billing settings." status="Not wired yet" />
            <DisabledFutureRow rowId="payments-invoices" title="Invoices and receipts" description="Billing history requires a payment provider integration." status="Requires backend" />
            <DisabledFutureRow rowId="payments-subscription" title="Subscriptions" description="Paid plans and featured placements are not active in beta." status="Coming soon" />
          </SettingsSection>

          <SettingsSection
            id="privacy-data"
            title="Privacy, Safety & Data"
            description="Data controls, safety tools, legal links, and destructive account actions."
          >
            <SettingRow rowId="privacy-policy-link" title="Privacy Policy" description="Read how CreatorJobs handles marketplace and account data." status="Legal" statusTone="readonly" action={<Link className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-white/66 hover:text-white" href="/privacy">Open</Link>} />
            <SettingRow rowId="privacy-terms-link" title="Terms" description="Review marketplace terms and safety expectations." status="Legal" statusTone="readonly" action={<Link className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-white/66 hover:text-white" href="/terms">Open</Link>} />
            <DisabledFutureRow rowId="privacy-blocked" title="Blocked and muted users" description="Block/mute management needs safety backend support." status="Requires backend" />
            <DisabledFutureRow rowId="privacy-data-export" title="Download my data" description="Data export needs an asynchronous backend export flow." status="Requires backend" />
            <DisabledFutureRow rowId="privacy-deactivate" title="Deactivate account" description="Temporary deactivation requires product and backend policy." status="Requires backend" danger />
            <DisabledFutureRow rowId="privacy-delete" title="Delete account" description="Permanent account deletion requires confirmation, retention policy, and backend deletion support." status="Requires backend" danger />
          </SettingsSection>

          <SettingsSection id="security" title="Security" description="Login methods, OAuth connections, sessions, and account protection.">
            <SettingRow rowId="security-login-method" title="Login method" description="Current authentication method for this session." status={providerLabel(sessionUser.provider)} statusTone="readonly" />
            <SettingRow rowId="security-oauth" title="Connected OAuth account" description="External account used for sign-in where available." status={sessionUser.providerAccountId ? "Connected" : "Not shown"} statusTone="readonly" />
            <DisabledFutureRow rowId="security-password" title="Password reset" description="Password controls need a dedicated account security flow." status="Requires backend" />
            <DisabledFutureRow rowId="security-2fa" title="Two-factor authentication" description="Second-factor authentication is not wired yet." status="Coming soon" />
            <DisabledFutureRow rowId="security-sessions" title="Sessions and devices" description="Device/session management requires backend session inventory." status="Requires backend" />
            <DisabledFutureRow rowId="security-revoke-oauth" title="Revoke OAuth provider" description="Provider revocation needs a safe disconnect backend flow." status="Requires backend" />
          </SettingsSection>

          <SettingsSection id="preferences" title="Preferences" description="Regional, language, currency, and appearance defaults.">
            <SettingRow rowId="preferences-theme" title="Theme" description="CreatorJobs currently uses the dark premium theme." status="Dark" statusTone="readonly" />
            <SettingRow rowId="preferences-region" title="Region" description="CreatorJobs is India-first today, with broader regional preferences planned." status="India-first beta" statusTone="readonly" />
            <SettingRow rowId="preferences-currency" title="Currency" description="Default marketplace display currency." status="INR" statusTone="readonly" />
            <DisabledFutureRow rowId="preferences-language" title="Language" description="Interface language preferences are planned." status="Coming soon" />
            <DisabledFutureRow rowId="preferences-date-time" title="Date/time format" description="Regional date and time formatting preferences need support." status="Coming soon" />
          </SettingsSection>

          <SettingsSection id="support-legal" title="Support & Legal" description="Help, policies, and support resources that can live outside settings.">
            <SettingRow rowId="support-link" title="Support" description="Get help with account access, verification, and marketplace workflows." status="Separate page" statusTone="readonly" action={<Link className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-white/66 hover:text-white" href="/support">Open</Link>} />
            <SettingRow rowId="support-terms-link" title="Terms" description="CreatorJobs marketplace terms." status="Legal" statusTone="readonly" action={<Link className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-white/66 hover:text-white" href="/terms">Open</Link>} />
            <SettingRow rowId="support-privacy-link" title="Privacy" description="Privacy policy and data handling." status="Legal" statusTone="readonly" action={<Link className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-white/66 hover:text-white" href="/privacy">Open</Link>} />
            <DisabledFutureRow rowId="support-bug-report" title="Report a problem" description="Bug-report routing needs a support backend or form target." status="Not wired yet" />
            <DisabledFutureRow rowId="support-guidelines" title="Community guidelines" description="Guidelines page is planned but not published yet." status="Coming soon" />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
