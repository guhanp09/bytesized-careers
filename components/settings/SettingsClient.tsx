"use client";

import React, { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";

import { Icon } from "../Icons";
import LocationAutocompleteField from "../you/LocationAutocompleteField";
import { copyTextToClipboard } from "../ui";
import {
  describeActionError,
  listMyYouTubeChannels,
  markAllNotificationsRead,
  refreshMyYouTubeChannels,
  requestPasswordReset,
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
import {
  CancelButton,
  EditButton,
  FieldLabel,
  InlinePanel,
  RowActionButton,
  SaveButton,
  SelectField,
  SettingRow,
  SettingsSection,
  StatusPill,
  TextField,
  ToggleSwitch,
  type RowFeedback,
} from "./settingsPrimitives";

type SettingsSectionId =
  | "account"
  | "profile-visibility"
  | "work-preferences"
  | "connected-accounts"
  | "notifications"
  | "security"
  | "data-support";

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
  { id: "profile-visibility", title: "Profile & visibility", icon: "globe" },
  { id: "work-preferences", title: "Work preferences", icon: "briefcase" },
  { id: "connected-accounts", title: "Connected accounts", icon: "badge-check" },
  { id: "notifications", title: "Notifications", icon: "bell" },
  { id: "security", title: "Security", icon: "shield" },
  { id: "data-support", title: "Data & support", icon: "help" },
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

const onboardingIntentLabel = (value?: BackendOnboardingIntent | null) =>
  ONBOARDING_OPTIONS.find((item) => item.value === value)?.label || "Decide later";

const signInMethodLabel = (value?: string | null) => {
  if (value === "google") return "Google";
  if (value === "credentials") return "Email & password";
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
  const [resetLinkSent, setResetLinkSent] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
  const usesPasswordSignIn = sessionUser.provider === "credentials";
  const publicProfilePath = username ? `/u/${username}` : null;

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
    await saveProfile("work-location", {
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
    await saveProfile("work-availability", {
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
    await saveProfile("work-project-preferences", {
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

  const copyProfileLink = async () => {
    const rowId = "account-public-profile";
    if (!publicProfilePath) return;
    try {
      await copyTextToClipboard(`${window.location.origin}${publicProfilePath}`);
      setFeedback(rowId, { state: "saved", message: "Link copied" });
    } catch {
      setFeedback(rowId, { state: "error", message: "Could not copy link." });
    }
  };

  const sendPasswordReset = async () => {
    const rowId = "security-password-reset";
    setFeedback(rowId, { state: "saving" });
    try {
      await requestPasswordReset(email);
      setResetLinkSent(true);
      setFeedback(rowId, { state: "saved", message: "Reset link sent" });
    } catch (error) {
      setFeedback(rowId, {
        state: "error",
        message: describeActionError(error, "Could not send reset email."),
      });
    }
  };

  const handleSignOut = () => {
    setSigningOut(true);
    void signOut({ callbackUrl: "/" });
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
            activeSection === section.id ? "bg-white/[0.08] text-white" : "text-muted hover:bg-white/[0.05] hover:text-white/80",
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
      <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-5 py-5 shadow-[0_12px_40px_-30px_rgba(0,0,0,0.8)]">
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
            className="group relative h-20 w-20 cursor-pointer overflow-hidden rounded-2xl border border-white/14 bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            aria-label="Upload profile picture"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Icon name="user" className="h-8 w-8 text-white/64" />
              </span>
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/42 group-hover:opacity-100 group-focus-visible:bg-black/42 group-focus-visible:opacity-100">
              <Icon name="image" className="h-5 w-5 text-white" />
            </span>
          </button>

          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-white">{displayName}</p>
            <p className="mt-1 truncate text-sm text-muted">{username ? `@${username}` : email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill
                label={onboardingIntentLabel(me?.onboarding_intent || profile?.onboarding_intent || sessionUser.onboardingIntent)}
                tone="active"
              />
              <StatusPill label={channels.length ? `${channels.length} YouTube linked` : "No YouTube channel"} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            {publicProfilePath ? (
              <RowActionButton icon="external-link" href={publicProfilePath} external>
                View profile
              </RowActionButton>
            ) : null}
            {loadErrors.profile ? <StatusPill label="Profile data unavailable" tone="readonly" /> : null}
            {loadErrors.me ? <StatusPill label="Account data unavailable" tone="readonly" /> : null}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-20">
          <div className="flex min-w-0 gap-2 overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.035] p-2 lg:block lg:space-y-0.5 lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0">
            {sectionButtons}
          </div>
        </nav>

        <div className="min-w-0 space-y-5 pb-24">
          <SettingsSection
            id="account"
            title="Account"
            icon="user"
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
                <RowActionButton icon="image" onClick={() => avatarFileInputRef.current?.click()}>
                  Upload
                </RowActionButton>
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
                      <span className="text-sm text-subtle">@</span>
                      <input
                        value={usernameDraft}
                        onChange={(event) => setUsernameDraft(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-subtle"
                        placeholder="your_profile"
                        maxLength={30}
                      />
                    </div>
                  </label>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="account-public-profile"
              title="Public profile"
              description="Share your public CreatorJobs page with collaborators and clients."
              status={publicProfilePath || "Set a username first"}
              statusTone={publicProfilePath ? "readonly" : "neutral"}
              feedback={rowFeedback["account-public-profile"]}
              action={
                publicProfilePath ? (
                  <>
                    <RowActionButton icon="copy" onClick={() => void copyProfileLink()}>
                      Copy link
                    </RowActionButton>
                    <RowActionButton icon="external-link" href={publicProfilePath} external>
                      Open
                    </RowActionButton>
                  </>
                ) : undefined
              }
            />

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
                        <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
                      </button>
                    ))}
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow rowId="account-email" title="Email" description="Used for login and account communication." status={email} statusTone="readonly" />
            <SettingRow
              rowId="account-plan"
              title="Plan"
              description="CreatorJobs is free during the beta — no payment method is required to post jobs or apply to them."
              status="Free beta"
              statusTone="active"
            />
          </SettingsSection>

          <SettingsSection
            id="profile-visibility"
            title="Profile & visibility"
            icon="globe"
            description="Control what parts of your public CreatorJobs presence are visible."
            headerAction={
              publicProfilePath ? (
                <RowActionButton icon="external-link" href={publicProfilePath} external>
                  View public profile
                </RowActionButton>
              ) : undefined
            }
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
          </SettingsSection>

          <SettingsSection
            id="work-preferences"
            title="Work preferences"
            icon="briefcase"
            description="Defaults that shape hiring, applying, and collaboration context."
          >
            <SettingRow
              rowId="work-location"
              title="Location and timezone"
              description="Used for profile availability and marketplace coordination."
              status={[compact(profile?.location), compact(profile?.timezone, "Timezone not set")].join(" / ")}
              feedback={rowFeedback["work-location"]}
              action={<EditButton active={activeEditor === "work-location"} onClick={() => openEditor("work-location")} />}
            >
              {activeEditor === "work-location" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["work-location"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveLocationTimezone()}
                        saving={rowFeedback["work-location"]?.state === "saving"}
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
              rowId="work-availability"
              title="Availability and work mode"
              description="Default collaboration availability, work mode, and working hours."
              status={[compact(profile?.availability_status, "Selective"), compact(profile?.collaboration_preferences?.work_mode, "Work mode not set")].join(" / ")}
              feedback={rowFeedback["work-availability"]}
              action={<EditButton active={activeEditor === "work-availability"} onClick={() => openEditor("work-availability")} />}
            >
              {activeEditor === "work-availability" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["work-availability"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveAvailabilityWorkMode()}
                        saving={rowFeedback["work-availability"]?.state === "saving"}
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
                            className="h-10 rounded-xl border border-white/10 bg-black/18 px-3 text-sm text-white outline-none placeholder:text-subtle focus:border-white/24"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </InlinePanel>
              ) : null}
            </SettingRow>

            <SettingRow
              rowId="work-project-preferences"
              title="Project preferences"
              description="Default project type, turnaround, and revision expectations."
              status={[
                PROJECT_TYPE_OPTIONS.find((option) => option.value === profile?.collaboration_preferences?.project_type_preference)?.label || "Project type not set",
                compact(profile?.collaboration_preferences?.turnaround, "Turnaround not set"),
              ].join(" / ")}
              feedback={rowFeedback["work-project-preferences"]}
              action={<EditButton active={activeEditor === "work-project-preferences"} onClick={() => openEditor("work-project-preferences")} />}
            >
              {activeEditor === "work-project-preferences" ? (
                <InlinePanel
                  error={editorError}
                  actions={
                    <>
                      <CancelButton onClick={cancelEditor} disabled={rowFeedback["work-project-preferences"]?.state === "saving"} />
                      <SaveButton
                        onClick={() => void saveProjectPreferences()}
                        saving={rowFeedback["work-project-preferences"]?.state === "saving"}
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

            <SettingRow
              rowId="work-currency"
              title="Currency"
              description="Marketplace amounts are shown in INR during the India-first beta."
              status="INR"
              statusTone="readonly"
            />
          </SettingsSection>

          <SettingsSection
            id="connected-accounts"
            title="Connected accounts"
            icon="badge-check"
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
                <RowActionButton icon="refresh" onClick={() => void refreshChannels()}>
                  Refresh
                </RowActionButton>
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
          </SettingsSection>

          <SettingsSection
            id="notifications"
            title="Notifications"
            icon="bell"
            description="Your in-app notification activity for this account."
          >
            <SettingRow
              rowId="notifications-status"
              title="Notification status"
              description="Unread in-app notification count for this account."
              status={loadErrors.notifications ? "Unavailable" : unreadCount ? `${unreadCount} unread` : "All read"}
              statusTone={unreadCount ? "active" : "readonly"}
              feedback={rowFeedback["notifications-status"]}
              action={
                <>
                  <RowActionButton
                    icon="check"
                    onClick={() => void markNotificationsRead()}
                    disabled={!unreadCount || loadErrors.notifications}
                  >
                    Mark all read
                  </RowActionButton>
                  <RowActionButton icon="bell" href="/notifications">
                    View all
                  </RowActionButton>
                </>
              }
            />
          </SettingsSection>

          <SettingsSection
            id="security"
            title="Security"
            icon="shield"
            description="How you sign in to CreatorJobs and control this session."
          >
            <SettingRow
              rowId="security-signin-method"
              title="Sign-in method"
              description={
                sessionUser.provider === "google"
                  ? "You sign in with Google. This connection also powers your verified YouTube channels."
                  : usesPasswordSignIn
                    ? "You sign in with your email and password."
                    : "The authentication method used for this session."
              }
              status={signInMethodLabel(sessionUser.provider)}
              statusTone="readonly"
            />

            {usesPasswordSignIn && email.includes("@") ? (
              <SettingRow
                rowId="security-password-reset"
                title="Password"
                description={`Send a password reset link to ${email}.`}
                feedback={rowFeedback["security-password-reset"]}
                action={
                  <RowActionButton
                    icon="mail"
                    onClick={() => void sendPasswordReset()}
                    disabled={resetLinkSent || rowFeedback["security-password-reset"]?.state === "saving"}
                  >
                    {resetLinkSent ? "Sent" : "Send reset email"}
                  </RowActionButton>
                }
              />
            ) : null}

            <SettingRow
              rowId="security-sign-out"
              title="Sign out"
              description="Sign out of CreatorJobs on this device."
              action={
                <RowActionButton icon="log-out" onClick={handleSignOut} disabled={signingOut}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </RowActionButton>
              }
            />
          </SettingsSection>

          <SettingsSection
            id="data-support"
            title="Data & support"
            icon="help"
            description="Help, policies, and account-level requests."
          >
            <SettingRow
              rowId="support-contact"
              title="Contact support"
              description="Get help with account access, verification, or reporting a problem."
              action={
                <RowActionButton icon="help" href="/support">
                  Open
                </RowActionButton>
              }
            />
            <SettingRow
              rowId="support-legal"
              title="Legal"
              description="The terms and privacy policy that govern CreatorJobs."
              action={
                <>
                  <RowActionButton href="/terms">Terms</RowActionButton>
                  <RowActionButton href="/privacy">Privacy</RowActionButton>
                </>
              }
            />
            <SettingRow
              rowId="support-delete-account"
              title="Delete account"
              description="During the beta, account deletion is handled by our support team. Contact us from your account email and we'll confirm and process it."
              danger
              action={
                <RowActionButton tone="danger" href="/support">
                  Contact support
                </RowActionButton>
              }
            />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
