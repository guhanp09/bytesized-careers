"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendCreateJobPayload,
  BackendJob,
  BackendRequestError,
  BackendHiringIdentity,
  BackendHiringIdentityPlatform,
  BackendHiringIdentityVerificationResponse,
  BackendRole,
  BackendMeYouTubeChannel,
  checkMyHiringIdentityVerification,
  createMyHiringIdentity,
  createJob,
  deleteMyHiringIdentity,
  describeActionError,
  listMyBackendJobs,
  isBackendAuthError,
  isLocalMocksEnabled,
  listMyHiringIdentities,
  listMyYouTubeChannels,
  listRoles,
  requestMyHiringIdentityVerification,
  getBrandAboutState,
  updateJob,
} from "../lib/backendClient";
import { refreshYouTubeConnection } from "../lib/identity/youtubeConnection";
import { googleYouTubeAuthorizationParams } from "../lib/googleOAuthPolicy";
import { findToolCatalogEntry } from "../lib/toolCatalog";
import { ReferenceTimestampNote, ReferenceVideo, StartTimeframe } from "../lib/types";
import { getJobDraftCompletion } from "../lib/draftCompletion";
import { INDIA_CITIES } from "../lib/indiaCities";
import PostJobForm from "./post-job/PostJobForm";
import RecruiterJobPreview from "./post-job/RecruiterJobPreview";
import PostJobSafety from "./post-job/PostJobSafety";
import RecommendedChecklistPopup, { RecommendedChecklistItem } from "./RecommendedChecklistPopup";
import { IdentityPlatform, VerifiedIdentity } from "../lib/identity/types";
import { PageLoading } from "./ui";
import { Icon } from "./Icons";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  sanitizeRequirementKeys,
} from "../lib/firstMessageRequirements";
import { normalizeCreatorContextList } from "../lib/jobCreatorContext";
import { normalizeReferenceTimestampNote, normalizeReferenceVideo, serializeReferenceVideo } from "../lib/referenceVideos";
import {
  attachJobImportDraft,
  getJobImportContextForNativeJob,
  getJobImportDraft,
  getJobImportSource,
  type JobImportDraftContext,
} from "../lib/jobImportReadiness";
import { nativeFieldForImport } from "../lib/importedDraftGuidance";
import {
  jobImportValueWasRemoved,
  trackJobImportEvent,
} from "../lib/jobImportAnalytics";
import {
  COMPENSATION_UNITS,
  ENGAGEMENT_TYPES,
  CompensationMode,
  CompensationUnit,
  EngagementType,
  TurnaroundBasis,
  TurnaroundUnit,
  splitRequiredTools,
  compensationUnitLabel,
} from "../lib/jobContract";
import {
  backendJobFieldStep,
  emptyJobPostingDomainState,
  firstScreenForGroup,
  hydrateJobPostingDomain,
  RECRUITER_JOB_SCREENS,
  serializeJobPostingDomain,
  validateJobPostingDomainForPublication,
  validateRepeatableDomainRows,
  type JobPostingDomainState,
  type RecruiterJobScreen,
} from "../lib/jobPostingForm";
import { screenForField, type JobFieldName } from "../lib/jobFieldRegistry";

type WorkMode = "" | "Remote" | "Hybrid" | "On-site";
type Turnaround = { value: number; unit: TurnaroundUnit | ""; basis: TurnaroundBasis | "" } | null;
type BudgetIntent = "" | "range" | "flexible" | "contact";
type JobPlatform = IdentityPlatform | "";

const budgetIntentLabel = (intent: BudgetIntent) =>
  intent === "contact" ? "Contact for pricing" : intent === "flexible" ? "Flexible" : "";

type Step = RecruiterJobScreen;

const STEPS: Step[] = RECRUITER_JOB_SCREENS.map((item) => item.id);

/** Route a backend/publication field error to the exact screen that owns it. */
const screenForFieldError = (field: string): Step =>
  screenForField(field as JobFieldName) ?? firstScreenForGroup(backendJobFieldStep(field));

/** Route a basics-level validation key (from getBasicsErrors) to its owning screen. */
const BASICS_ERROR_SCREEN: Record<string, Step> = {
  title: "role",
  role: "role",
  platform: "role",
  identity: "role",
  workMode: "arrangement",
  city: "arrangement",
  cityInvalid: "arrangement",
  budgetMissing: "pay",
  budgetRange: "pay",
};
const screenForBasicsError = (key: string): Step => BASICS_ERROR_SCREEN[key] ?? "role";

/** Which basics-level validation keys gate leaving each basics-derived screen. */
const SCREEN_BASICS_GATE: Partial<Record<Step, string[]>> = {
  role: ["identity", "title", "role", "platform"],
  arrangement: ["workMode", "city", "cityInvalid"],
  pay: ["budgetMissing", "budgetRange"],
};

const MAX_REFERENCE_VIDEOS = 3;

const normalizeJobApplicationRequirementsForPayload = (
  keys: readonly string[],
  customInstruction: string,
  noRequirements: boolean
) => {
  if (noRequirements) return [];
  const normalized = sanitizeRequirementKeys(keys, "job");
  if (!normalized.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)) return normalized;
  return customInstruction.trim()
    ? normalized
    : normalized.filter((key) => key !== CUSTOM_INSTRUCTION_REQUIREMENT_KEY);
};

const normalizeJobPlatforms = (values: Array<string | null | undefined>): IdentityPlatform[] => {
  const normalized: IdentityPlatform[] = [];
  values.forEach((value) => {
    const next = value?.toLowerCase();
    if ((next === "youtube" || next === "instagram") && !normalized.includes(next)) {
      normalized.push(next);
    }
  });
  return normalized;
};

const comparableImportValue = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (Array.isArray(value)) return value.map(comparableImportValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, comparableImportValue(nested)])
    );
  }
  return value;
};

const importValuesMatch = (left: unknown, right: unknown): boolean =>
  JSON.stringify(comparableImportValue(left)) === JSON.stringify(comparableImportValue(right));

type SavedBasics = {
  title: string;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: CompensationUnit | "";
  budgetCurrency: string;
  compensationMode: CompensationMode | "";
  budgetNote: string;
  budgetUnitCustom: string;
  budgetIntent: BudgetIntent;
  workMode: WorkMode;
  city: string;
  experienceLevel: string;
  startWithin: StartTimeframe | "";
  platform: JobPlatform;
  platforms: IdentityPlatform[];
  platformName: string;
  platformAudience: string;
  contentNiches: string[];
  contentGenres: string[];
  formatsHiredFor: string[];
  turnaround: Turnaround;
  engagementType: EngagementType | "";
  expectedWeeklyHoursMin: string;
  expectedWeeklyHoursMax: string;
  primaryRoleId: string;
  roleSpecialization: string;
  tools: string[];
  languages: string[];
};

type SavedContent = {
  about: string;
  responsibilities: string;
  requirements: string;
  howToApply: string;
  applicationRequirements: string[];
  noFirstMessageRequirements: boolean;
};

type SavedTags = {
  tags: string[];
};

type SavedRefs = {
  refVideos: ReferenceVideo[];
  refTitle: string;
  refUrl: string;
  refWhatToReference: string;
  refTimestampNotes: ReferenceVideo["timestampNotes"];
};

type HiringIdentityChoice =
  | { source: "backend"; id: string }
  | { source: "connected"; id: string };

type ResolvedHiringIdentity = {
  normalizedUrl: string;
  platform: BackendHiringIdentityPlatform;
  platformLabel: string;
  name: string;
  logoUrl: string | null;
  handle: string | null;
  followersText: string | null;
};

type LocalPendingHiringIdentity = {
  id: string;
  display_name: string;
  platform: BackendHiringIdentityPlatform;
  handle?: string | null;
  url?: string | null;
  avatar_url?: string | null;
  verification_status: "PENDING";
  verification_method?: "NONE" | "VERIFICATION_CODE" | "INSTAGRAM_LINK_IN_BIO";
  verification_code?: string | null;
  verification_code_expires_at?: string | null;
  verification_last_error?: string | null;
  is_agency_represented: true;
  managed_by_agency_name?: string | null;
};

type RepresentedHiringIdentityResult = BackendHiringIdentity | LocalPendingHiringIdentity;

const mapBackendChannelToIdentity = (channel: BackendMeYouTubeChannel): VerifiedIdentity => ({
  platform: "youtube",
  brandId: channel.channel_id,
  name: channel.title || "YouTube Channel",
  imageUrl: channel.thumbnail_url || null,
  followersCount: null,
  handle: null,
  verifiedAt: new Date().toISOString(),
});

const formatHiringPlatform = (platform?: string | null) =>
  platform === "INSTAGRAM" || platform?.toLowerCase() === "instagram" ? "Instagram" : "YouTube";

const initialsForIdentity = (value?: string | null) =>
  (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

const normalizeIdentityMatchKey = (value?: string | null) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "");

const inferHiringPlatform = (value?: string | null): BackendHiringIdentityPlatform | null => {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("youtube")) return "YOUTUBE";
  if (normalized.includes("instagram")) return "INSTAGRAM";
  return null;
};

const mapBackendIdentityToResolved = (identity: BackendHiringIdentity): ResolvedHiringIdentity => ({
  normalizedUrl: identity.url || "",
  platform: identity.platform,
  platformLabel: formatHiringPlatform(identity.platform),
  name: identity.display_name,
  logoUrl: identity.avatar_url || null,
  handle: identity.handle || null,
  followersText: null,
});

function HiringIdentityAvatar({
  name,
  imageUrl,
  platform,
  className = "h-14 w-14",
}: {
  name: string;
  imageUrl?: string | null;
  platform?: string | null;
  className?: string;
}) {
  const initials = initialsForIdentity(name);
  return (
    <span
      className={`${className} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/12 bg-white/[0.055] text-sm font-semibold text-white/72`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <Icon name={formatHiringPlatform(platform) === "Instagram" ? "instagram" : "youtube"} className="h-5 w-5" />
      )}
    </span>
  );
}

const splitLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);

const isBackendUnavailable = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes("Could not reach backend") ||
    error.message.includes("missing backend auth") ||
    error.message.includes("Failed to fetch") ||
    error.message.includes("fetch failed"));

const parseWholeNumber = (value: string) => {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const formatCompensationSummary = ({
  mode,
  minimum,
  maximum,
  currency,
  unit,
  customUnit,
  note,
}: {
  mode: CompensationMode | "";
  minimum: string;
  maximum: string;
  currency: string;
  unit: CompensationUnit | "";
  customUnit: string;
  note: string;
}) => {
  const unitText = unit === "custom" ? customUnit.trim() : unit ? compensationUnitLabel(unit) : "";
  const suffix = unitText ? ` ${unitText}` : "";
  if (mode === "negotiable") return ["Negotiable", unitText, note.trim()].filter(Boolean).join(" · ");
  if (!minimum.trim()) return note.trim();
  const prefix = currency.trim() ? `${currency.trim().toUpperCase()} ` : "";
  const amount = mode === "range" && maximum.trim()
    ? `${prefix}${minimum.trim()}–${prefix}${maximum.trim()}`
    : `${prefix}${minimum.trim()}`;
  return `${amount}${suffix}${note.trim() ? ` · ${note.trim()}` : ""}`;
};

function useDialogFocusTrap(
  open: boolean,
  onClose: () => void,
  initialFocusRef?: React.RefObject<HTMLElement | null>,
  focusScopeKey?: string
) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusInitial = () => {
      const preferred = initialFocusRef?.current;
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (preferred || first || dialogRef.current)?.focus();
    };
    const frame = window.requestAnimationFrame(focusInitial);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [focusScopeKey, initialFocusRef, onClose, open]);

  return dialogRef;
}

function HiringIdentityModal({
  open,
  onClose,
  backendIdentities,
  connectedIdentities,
  selectedChoice,
  onConfirmExisting,
  onCreateRepresentedIdentity,
  onRemoveBackendIdentity,
  onCheckRepresentedIdentityVerification,
  sessionDisplayName,
}: {
  open: boolean;
  onClose: () => void;
  backendIdentities: BackendHiringIdentity[];
  connectedIdentities: VerifiedIdentity[];
  selectedChoice: HiringIdentityChoice | null;
  onConfirmExisting: (choice: HiringIdentityChoice) => void;
  onCreateRepresentedIdentity: (
    identity: ResolvedHiringIdentity,
    requestVerification?: boolean
  ) => Promise<RepresentedHiringIdentityResult>;
  onRemoveBackendIdentity: (identityId: string) => Promise<void>;
  onCheckRepresentedIdentityVerification: (
    identityId: string
  ) => Promise<BackendHiringIdentityVerificationResponse>;
  sessionDisplayName?: string | null;
}) {
  const [step, setStep] = useState<"select" | "url" | "confirm" | "verify">("select");
  const [draftChoice, setDraftChoice] = useState<HiringIdentityChoice | null>(selectedChoice);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolved, setResolved] = useState<ResolvedHiringIdentity | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [removingIdentityId, setRemovingIdentityId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationIdentity, setVerificationIdentity] =
    useState<RepresentedHiringIdentityResult | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const hasInitializedOpenState = React.useRef(false);
  const dialogRef = useDialogFocusTrap(open, onClose, undefined, step);

  React.useEffect(() => {
    if (!open) {
      hasInitializedOpenState.current = false;
      return;
    }
    if (hasInitializedOpenState.current) return;
    hasInitializedOpenState.current = true;
    setStep("select");
    setDraftChoice(selectedChoice);
    setUrl("");
    setUrlError(null);
    setResolveLoading(false);
    setResolved(null);
    setCreateLoading(false);
    setCheckLoading(false);
    setRemovingIdentityId(null);
    setNotice(null);
    setVerificationIdentity(null);
    setVerificationMessage(null);
    setVerificationError(null);
  }, [open, selectedChoice]);

  if (!open) return null;

  const identityAlreadyExists = (candidate: ResolvedHiringIdentity) => {
    const candidateKeys = [
      normalizeIdentityMatchKey(candidate.normalizedUrl),
      normalizeIdentityMatchKey(candidate.handle),
      normalizeIdentityMatchKey(candidate.name),
    ].filter(Boolean);
    return backendIdentities.find((item) =>
      [item.url, item.handle, item.display_name]
        .map(normalizeIdentityMatchKey)
        .filter(Boolean)
        .some((key) => candidateKeys.includes(key))
    );
  };

  const resolveUrl = async () => {
    const trimmed = url.trim();
    setNotice(null);
    setResolved(null);
    if (!trimmed) {
      setUrlError("Enter a channel or page URL.");
      return;
    }
    setResolveLoading(true);
    setUrlError(null);
    try {
      const response = await fetch("/api/profile/organization-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string | null;
        normalizedUrl?: string | null;
        canonicalUrl?: string | null;
        platform?: string | null;
        inferredName?: string | null;
        logoUrl?: string | null;
        faviconUrl?: string | null;
        handle?: string | null;
      } | null;

      if (!response.ok || payload?.error) {
        setUrlError(payload?.error || "We could not resolve that URL.");
        return;
      }

      const platformValue = inferHiringPlatform(payload?.platform || payload?.normalizedUrl || payload?.canonicalUrl);
      if (!platformValue) {
        setUrlError("Use a YouTube channel or Instagram page URL.");
        return;
      }

      const normalizedUrl = payload?.canonicalUrl || payload?.normalizedUrl || trimmed;
      const name = payload?.inferredName?.trim() || payload?.handle?.trim() || "Channel/page";
      const nextResolved: ResolvedHiringIdentity = {
        normalizedUrl,
        platform: platformValue,
        platformLabel: formatHiringPlatform(platformValue),
        name,
        logoUrl: payload?.logoUrl || payload?.faviconUrl || null,
        handle: payload?.handle || null,
        followersText: null,
      };
      const duplicate = identityAlreadyExists(nextResolved);
      if (duplicate) {
        setDraftChoice({ source: "backend", id: duplicate.id });
        setNotice("This channel/page is already saved. Select Confirm to use it.");
        setStep("select");
        return;
      }
      setResolved(nextResolved);
      setStep("confirm");
    } catch {
      setUrlError("We could not resolve that URL. Check it and try again.");
    } finally {
      setResolveLoading(false);
    }
  };

  const confirmExisting = () => {
    if (!draftChoice) return;
    if (draftChoice.source === "backend") {
      const existing = backendIdentities.find((item) => item.id === draftChoice.id);
      if (existing?.is_agency_represented && existing.verification_status !== "VERIFIED") {
        setResolved(mapBackendIdentityToResolved(existing));
        setVerificationIdentity(existing);
        setVerificationMessage(
          existing.verification_code
            ? "Add this code to the public bio/about section, then check verification."
            : null
        );
        setVerificationError(null);
        setStep("verify");
        onConfirmExisting(draftChoice);
        return;
      }
    }
    onConfirmExisting(draftChoice);
    onClose();
  };

  const continueDrafting = async () => {
    if (!resolved || createLoading) return;
    if (verificationIdentity) {
      onClose();
      return;
    }
    setCreateLoading(true);
    setUrlError(null);
    try {
      await onCreateRepresentedIdentity(resolved, false);
      onClose();
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : "Could not save this hiring identity.");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCopyCode = async () => {
    const code = verificationIdentity?.verification_code;
    if (!code) return;
    try {
      await navigator.clipboard?.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1600);
    } catch {
      // Clipboard unavailable; the code remains selectable for manual copy.
    }
  };

  const startBioVerification = async () => {
    if (!resolved || createLoading) return;
    setCreateLoading(true);
    setUrlError(null);
    setVerificationError(null);
    setVerificationMessage(null);
    try {
      const saved = await onCreateRepresentedIdentity(resolved, true);
      setVerificationIdentity(saved);
      if (saved.verification_code) {
        setVerificationMessage("Add this code to the public bio/about section, then check verification.");
      } else if (saved.verification_status === "VERIFIED") {
        setVerificationMessage("Authorization verified. You can now publish jobs for this channel/page.");
      } else {
        setVerificationError("Verification requires backend sign-in. You can continue drafting for now.");
      }
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "Could not generate a verification code.");
    } finally {
      setCreateLoading(false);
    }
  };

  const checkBioVerification = async () => {
    if (!verificationIdentity || checkLoading) return;
    if (!verificationIdentity.verification_code) {
      setVerificationError("Generate a verification code before checking.");
      return;
    }
    setCheckLoading(true);
    setVerificationError(null);
    setVerificationMessage(null);
    try {
      const response = await onCheckRepresentedIdentityVerification(verificationIdentity.id);
      setVerificationIdentity(response.identity);
      setVerificationMessage(response.message);
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "Could not check verification.");
    } finally {
      setCheckLoading(false);
    }
  };

  const tileClass = (active: boolean) =>
    [
      "relative flex min-h-[156px] flex-col items-center justify-center gap-3 rounded-3xl border p-4 text-center transition-colors",
      active
        ? "border-white/38 bg-white/[0.1]"
        : "border-white/[0.09] bg-white/[0.045] hover:border-white/18 hover:bg-white/[0.07]",
      "cursor-pointer",
    ].join(" ");

  const removeSavedIdentity = async (identityId: string) => {
    if (removingIdentityId) return;
    setNotice(null);
    setUrlError(null);
    setRemovingIdentityId(identityId);
    try {
      await onRemoveBackendIdentity(identityId);
      if (draftChoice?.source === "backend" && draftChoice.id === identityId) {
        setDraftChoice(null);
      }
      setNotice("Channel/page removed.");
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : "Could not remove this channel/page.");
    } finally {
      setRemovingIdentityId(null);
    }
  };

  const savedTiles = backendIdentities.map((item) => ({
    choice: { source: "backend", id: item.id } as HiringIdentityChoice,
    name: item.display_name,
    subline: [formatHiringPlatform(item.platform), item.handle].filter(Boolean).join(" · "),
    imageUrl: item.avatar_url || null,
    platform: item.platform,
    removable: true,
    status:
      item.verification_status === "VERIFIED"
        ? "Verified"
        : item.verification_status === "PENDING"
          ? "Authorization pending"
          : item.verification_status === "REJECTED"
            ? "Rejected"
            : item.is_agency_represented
              ? "Not verified yet"
              : null,
  }));

  const connectedTiles = connectedIdentities
    .filter((item) => !backendIdentities.some((saved) => saved.id === item.brandId))
    .map((item) => ({
      choice: { source: "connected", id: item.brandId } as HiringIdentityChoice,
      name: item.name,
      subline: [formatHiringPlatform(item.platform), item.handle].filter(Boolean).join(" · "),
      imageUrl: item.imageUrl || null,
      platform: item.platform,
      removable: false,
      status: "Connected",
    }));

  const verificationCode = verificationIdentity?.verification_code || null;
  const verificationExpiresAt = verificationIdentity?.verification_code_expires_at
    ? new Date(verificationIdentity.verification_code_expires_at)
    : null;
  const verificationExpiresText =
    verificationExpiresAt && Number.isFinite(verificationExpiresAt.getTime())
      ? verificationExpiresAt.toLocaleString()
      : null;
  const verificationSucceeded = verificationIdentity?.verification_status === "VERIFIED";

  return (
    <div
      className="ui-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/72 px-0 pt-6 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hiring-identity-modal-title"
        className="ui-modal-panel max-h-[92dvh] w-full max-w-[620px] overflow-y-auto rounded-t-[28px] border border-white/[0.1] bg-[#101014] shadow-[0_34px_90px_-36px_rgba(0,0,0,1)] sm:rounded-[28px]"
      >
        <div className="p-5 sm:p-6">
          {step === "select" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="hiring-identity-modal-title" className="text-xl font-semibold tracking-tight text-white">
                    Who are you hiring for?
                  </h2>
                  <p className="mt-1 text-sm text-white/58">Choose the channel or page this job represents.</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              {notice ? <p className="mt-4 text-sm text-amber-100/82">{notice}</p> : null}

              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[...savedTiles, ...connectedTiles].map((item) => {
                  const active = draftChoice?.source === item.choice.source && draftChoice.id === item.choice.id;
                  return (
                    <div key={`${item.choice.source}-${item.choice.id}`} className="relative">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setDraftChoice(item.choice)}
                        className={`${tileClass(active)} w-full`}
                      >
                        {active ? (
                          <span className="absolute left-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/18 bg-white text-black">
                            <Icon name="check" className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                        <HiringIdentityAvatar name={item.name} imageUrl={item.imageUrl} platform={item.platform} />
                        <span className="max-w-full">
                          <span className="line-clamp-2 text-sm font-semibold leading-snug text-white/88">{item.name}</span>
                          {item.subline ? <span className="mt-1 block truncate text-xs text-muted">{item.subline}</span> : null}
                          {item.status ? <span className="mt-1 block text-[11px] text-subtle">{item.status}</span> : null}
                        </span>
                      </button>
                      {item.removable ? (
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => void removeSavedIdentity(item.choice.id)}
                          disabled={removingIdentityId === item.choice.id}
                          className="absolute right-3 top-3 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/30 text-muted transition-colors hover:border-white/18 hover:bg-black/45 hover:text-white/72 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setStep("url");
                    setUrlError(null);
                    setNotice(null);
                  }}
                  className={tileClass(false)}
                >
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-white/[0.055] text-white/75">
                    <Icon name="plus" className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-semibold text-white/82">Add channel/page</span>
                </button>
              </div>

              {!savedTiles.length && !connectedTiles.length ? (
                <p className="mt-4 text-sm text-muted">Connect or add the channel/page this job represents.</p>
              ) : null}

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmExisting}
                  disabled={!draftChoice}
                  className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-subtle"
                >
                  Confirm
                </button>
              </div>
            </>
          ) : step === "url" ? (
            <>
              <button
                type="button"
                onClick={() => setStep("select")}
                className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white/64 transition-colors hover:text-white cursor-pointer"
              >
                <span aria-hidden="true">←</span>
                <span>Who are you hiring for?</span>
              </button>
              <h2 id="hiring-identity-modal-title" className="text-xl font-semibold tracking-tight text-white">
                Add channel or page
              </h2>
              <p className="text-sm text-white/58">Enter the channel or page this job represents.</p>
              <label className="mt-6 block text-xs font-semibold text-white/72" htmlFor="represented-channel-url">
                Channel/page URL
              </label>
              <input
                id="represented-channel-url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void resolveUrl();
                  }
                }}
                placeholder="youtube.com/@channel, instagram.com/page..."
                aria-invalid={Boolean(urlError)}
                aria-describedby={urlError ? "represented-channel-url-error" : undefined}
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/28 focus:bg-black/24"
              />
              {urlError ? <p id="represented-channel-url-error" role="alert" className="mt-2 text-sm text-amber-100/82">{urlError}</p> : null}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep("select")}
                  className="h-10 rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void resolveUrl()}
                  disabled={resolveLoading || !url.trim()}
                  className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-subtle"
                >
                  {resolveLoading ? "Resolving..." : "Continue"}
                </button>
              </div>
            </>
          ) : step === "confirm" && resolved ? (
            <>
              <h2 id="hiring-identity-modal-title" className="text-xl font-semibold tracking-tight text-white">
                Confirm channel/page
              </h2>
              <div className="mt-7 flex flex-col items-center text-center">
                <HiringIdentityAvatar
                  name={resolved.name}
                  imageUrl={resolved.logoUrl}
                  platform={resolved.platform}
                  className="h-20 w-20"
                />
                <p className="mt-4 text-lg font-semibold text-white">{resolved.name}</p>
                <p className="mt-1 text-sm text-white/54">
                  {[resolved.platformLabel, resolved.handle || resolved.normalizedUrl].filter(Boolean).join(" · ")}
                </p>
                {resolved.followersText ? <p className="mt-1 text-sm text-muted">{resolved.followersText}</p> : null}
                <p className="mt-6 text-sm font-medium text-white/76">Are you hiring for this channel?</p>
              </div>
              <div className="mt-7 flex justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setStep("url")}
                  className="ui-press inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-semibold text-white/72 transition-colors hover:bg-white/[0.06] hover:text-white cursor-pointer"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                  No, go back
                </button>
                <button
                  type="button"
                  onClick={() => setStep("verify")}
                  className="ui-press inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90 cursor-pointer"
                >
                  <Icon name="check" className="h-3.5 w-3.5" />
                  Yes, continue
                </button>
              </div>
            </>
          ) : step === "verify" && resolved ? (
            <>
              <h2 id="hiring-identity-modal-title" className="text-xl font-semibold tracking-tight text-white">
                Confirm access
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/62">
                To publish jobs for {resolved.name}, confirm access to this channel/page.
              </p>
              <div className="mt-5 space-y-3">
                <div className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 opacity-70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white/72">Sign in as this channel/page</span>
                    <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                      Coming soon
                    </span>
                  </div>
                  <span className="mt-1 block text-sm text-muted">
                    Connect the account that owns this channel/page.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void startBioVerification()}
                  disabled={createLoading || checkLoading || verificationSucceeded}
                  className="ui-press group/code w-full rounded-2xl border border-white/[0.1] bg-white/[0.045] p-4 text-left transition-colors hover:border-white/18 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-55 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white/90">Confirm with public code</span>
                    {!verificationCode ? (
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-base leading-none text-subtle transition-transform group-hover/code:translate-x-0.5"
                      >
                        →
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-1 block text-sm text-muted">
                    {createLoading && !verificationCode
                      ? "Generating your code…"
                      : verificationCode
                        ? "Code ready below — place it publicly, then check."
                        : "Place a temporary code in the channel/page bio or About section."}
                  </span>
                </button>
              </div>
              {verificationCode ? (
                <div className="mt-5 rounded-2xl border border-white/[0.1] bg-black/24 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-subtle">Your public code</p>
                  <div className="mt-2 flex items-stretch gap-2">
                    <p className="flex-1 select-all rounded-xl border border-white/[0.08] bg-white/[0.055] px-3 py-2 font-mono text-lg font-semibold tracking-[0.08em] text-white">
                      {verificationCode}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode()}
                      className="ui-press inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 text-xs font-semibold text-white/78 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer"
                    >
                      <Icon name={copiedCode ? "check" : "share"} className="h-3.5 w-3.5" />
                      {copiedCode ? "Copied" : "Copy code"}
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/56">
                    Add this code to the channel/page bio or About section, then come back and check.
                  </p>
                  {verificationExpiresText ? (
                    <p className="mt-1 text-xs text-subtle">Expires {verificationExpiresText}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void startBioVerification()}
                      disabled={createLoading || checkLoading}
                      className="ui-press h-10 rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/64 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      Generate new code
                    </button>
                    <button
                      type="button"
                      onClick={() => void checkBioVerification()}
                      disabled={checkLoading || createLoading || verificationSucceeded}
                      className="ui-press h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-subtle"
                    >
                      {checkLoading ? "Checking…" : verificationSucceeded ? "Confirmed" : "Check code"}
                    </button>
                  </div>
                </div>
              ) : null}
              {verificationSucceeded ? (
                <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.08] px-4 py-3 text-sm leading-6 text-emerald-100/86">
                  Access confirmed. This channel can now be used for job listings.
                </p>
              ) : null}
              {verificationMessage && verificationMessage !== "Add this code to the public bio/about section, then check verification." ? (
                <p className="mt-4 text-sm leading-6 text-white/62">{verificationMessage}</p>
              ) : null}
              {verificationError ? <p role="alert" className="mt-4 text-sm leading-6 text-amber-100/82">{verificationError}</p> : null}
              <p className="mt-4 text-sm leading-6 text-white/58">
                You can proceed with the job listing. It will go live after access to this channel is confirmed.
              </p>
              {urlError ? <p role="alert" className="mt-2 text-sm text-amber-100/82">{urlError}</p> : null}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep("confirm")}
                  className="ui-press h-10 rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void continueDrafting()}
                  disabled={createLoading}
                  className="ui-press h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-subtle"
                >
                  {createLoading ? "Saving…" : "Continue to job post"}
                </button>
              </div>
              {sessionDisplayName ? (
                <p className="mt-3 text-right text-[11px] text-subtle">Posting as {sessionDisplayName}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type JobQualityItem = RecommendedChecklistItem<Step>;

const JOB_COMPLETION_TARGETS: Record<string, { step: Step; target?: string }> = {
  basics: { step: "role" },
  budget: { step: "pay", target: "job-budget" },
  identity: { step: "role" },
  tools: { step: "toolsLanguages", target: "job-tools" },
  creatorContext: { step: "creatorContext", target: "job-content-niches" },
  contentNiches: { step: "creatorContext", target: "job-content-niches" },
  contentGenres: { step: "creatorContext", target: "job-content-genres" },
  formatsHiredFor: { step: "creatorContext", target: "job-formats-hired-for" },
  experience: { step: "pay", target: "job-experience" },
  timeline: { step: "arrangement" },
  start: { step: "arrangement" },
  turnaround: { step: "arrangement" },
  responsibilities: { step: "about", target: "job-responsibilities" },
  requirements: { step: "about", target: "job-requirements" },
  about: { step: "about", target: "job-description" },
  tags: { step: "toolsLanguages", target: "job-tags" },
  media: { step: "references", target: "job-reference-video" },
  referenceVideos: { step: "references", target: "job-reference-video" },
  howToApply: { step: "apply", target: "job-first-message" },
  "job-first-message": { step: "apply", target: "job-first-message" },
  applyReferences: { step: "apply", target: "job-first-message" },
  trial: { step: "trial" },
  evaluation: { step: "process" },
  screening: { step: "process" },
  hiringProcess: { step: "process" },
  skills: { step: "skills" },
  workflow: { step: "workflow" },
  deliverables: { step: "deliverables", target: "job-deliverables" },
  pay: { step: "pay", target: "job-budget" },
  arrangement: { step: "arrangement" },
};

function PublishReadyDialog({
  open,
  missing,
  onAddDetails,
  onPublishAnyway,
  onClose,
  publishButtonRef,
}: {
  open: boolean;
  missing: JobQualityItem[];
  onAddDetails: () => void;
  onPublishAnyway: () => void;
  onClose: () => void;
  publishButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useDialogFocusTrap(open, onClose, publishButtonRef);
  if (!open) return null;

  return (
    <div
      className="ui-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/72 px-0 pt-6 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-publish-ready-title"
        className="ui-modal-panel max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] border border-white/[0.1] bg-[#101014] p-6 shadow-[0_34px_90px_-36px_rgba(0,0,0,1)] sm:rounded-[28px]"
      >
        <h2 id="job-publish-ready-title" className="text-xl font-semibold tracking-tight text-white">
          Your listing is ready to publish
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/62">
          A few extra details could help the right people decide faster. You can add them now, or publish and update the listing later.
        </p>
        {missing.length ? (
          <ul className="mt-4 space-y-2 text-sm text-white/58">
            {missing.slice(0, 4).map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <Icon name="plus" className="h-3.5 w-3.5 text-subtle" />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onAddDetails}
            className="h-10 rounded-xl border border-white/12 px-4 text-sm font-semibold text-white/76 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Add details
          </button>
          <button
            ref={publishButtonRef}
            type="button"
            onClick={onPublishAnyway}
            className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Publish anyway
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PostJobPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus, update: updateSession } = useSession();
  const connectParam = searchParams.get("yt_connect");
  const draftId = searchParams.get("draftId") || "";
  const partialImportDraftId = !draftId ? searchParams.get("importDraftId") || "" : "";
  const autoConnectHandledRef = useRef(false);
  const tokenRecoveryPromiseRef = useRef<Promise<string | null> | null>(null);
  const loadedJobRef = useRef<BackendJob | null>(null);
  const partialImportAppliedRef = useRef<string | null>(null);
  const partialImportTargetJobRef = useRef<string | null>(null);
  const dirtyPayloadKeysRef = useRef<Set<keyof BackendCreateJobPayload>>(new Set());
  const focusRequestRef = useRef(0);
  const [step, setStep] = useState<Step>("role");
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const [title, setTitle] = useState("");

  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [budgetUnit, setBudgetUnit] = useState<CompensationUnit | "">("");
  const [legacyBudgetUnit, setLegacyBudgetUnit] = useState<string | null>(null);
  const [budgetCurrency, setBudgetCurrency] = useState("");
  const [compensationMode, setCompensationMode] = useState<CompensationMode | "">("");
  const [budgetNote, setBudgetNote] = useState("");
  const [budgetUnitCustom, setBudgetUnitCustom] = useState("");
  const [budgetIntent, setBudgetIntent] = useState<BudgetIntent>("");

  const [workMode, setWorkMode] = useState<WorkMode>("");
  const [city, setCity] = useState("");

  // One free-form string, because that is exactly what the field is: the API
  // and the column both take a plain string. It was two numeric selects, which
  // could not hold "25 years" or "Experience preferred" and silently dropped
  // anything the pair could not express.
  const [experienceLevel, setExperienceLevel] = useState("");

  const [startWithin, setStartWithin] = useState<StartTimeframe | "">("");

  const [platform, setPlatform] = useState<JobPlatform>("");
  const [platforms, setPlatforms] = useState<IdentityPlatform[]>([]);
  const [platformName, setPlatformName] = useState("");
  const [platformAudience, setPlatformAudience] = useState("");
  const [identity, setIdentity] = useState<VerifiedIdentity | null>(null);
  const [, setIdentityLoading] = useState(false);
  const [, setIdentityError] = useState<string | null>(null);
  const [identityOptions, setIdentityOptions] = useState<VerifiedIdentity[]>([]);
  const [turnaround, setTurnaround] = useState<Turnaround>(null);
  const [engagementType, setEngagementType] = useState<EngagementType | "">("");
  const [expectedWeeklyHoursMin, setExpectedWeeklyHoursMin] = useState("");
  const [expectedWeeklyHoursMax, setExpectedWeeklyHoursMax] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolsConfirmed, setToolsConfirmed] = useState(false);
  const [legacyToolsNotCaptured, setLegacyToolsNotCaptured] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [domain, setDomain] = useState<JobPostingDomainState>(() => emptyJobPostingDomainState());
  const [domainErrors, setDomainErrors] = useState<Record<string, string>>({});
  const [loadedJobStatus, setLoadedJobStatus] = useState<string | null>(null);
  const [loadedSchemaVersion, setLoadedSchemaVersion] = useState<number | null>(null);

  const [about, setAbout] = useState("");
  const aboutValueRef = useRef("");
  const [responsibilities, setResponsibilities] = useState("");
  const [requirements, setRequirements] = useState("");
  const [howToApply, setHowToApply] = useState("");
  const [applicationRequirements, setApplicationRequirements] = useState<string[]>([]);
  const [noFirstMessageRequirements, setNoFirstMessageRequirements] = useState(false);
  const [firstMessageError, setFirstMessageError] = useState<string | null>(null);

  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const [refTitle, setRefTitle] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [refWhatToReference, setRefWhatToReference] = useState("");
  const [refTimestampNotes, setRefTimestampNotes] = useState<ReferenceVideo["timestampNotes"]>([]);
  const [refVideos, setRefVideos] = useState<ReferenceVideo[]>([]);
  const [refUrlError, setRefUrlError] = useState<string | null>(null);

  const [savedBasics, setSavedBasics] = useState<SavedBasics>({
    title: "",
    budgetMin: "",
    budgetMax: "",
    budgetUnit: "",
    budgetCurrency: "",
    compensationMode: "",
    budgetNote: "",
    budgetUnitCustom: "",
    budgetIntent: "",
    workMode: "",
    city: "",
    experienceLevel: "",
    startWithin: "",
    platform: "",
    platforms: [],
    platformName: "",
    platformAudience: "",
    contentNiches: [],
    contentGenres: [],
    formatsHiredFor: [],
    turnaround: null,
    engagementType: "",
    expectedWeeklyHoursMin: "",
    expectedWeeklyHoursMax: "",
    primaryRoleId: "",
    roleSpecialization: "",
    tools: [],
    languages: [],
  });
  const [savedContent, setSavedContent] = useState<SavedContent>({
    about: "",
    responsibilities: "",
    requirements: "",
    howToApply: "",
    applicationRequirements: [],
    noFirstMessageRequirements: false,
  });
  const [savedTags, setSavedTags] = useState<SavedTags>({ tags: [] });
  const [savedRefs, setSavedRefs] = useState<SavedRefs>({
    refVideos: [],
    refTitle: "",
    refUrl: "",
    refWhatToReference: "",
    refTimestampNotes: [],
  });
  const [contentErrors, setContentErrors] = useState<{ about?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publishReadyOpen, setPublishReadyOpen] = useState(false);
  const publishAnywayButtonRef = useRef<HTMLButtonElement | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [basicsErrors, setBasicsErrors] = useState<
    Array<"title" | "role" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode">
  >([]);
  const [hiringIdentities, setHiringIdentities] = useState<BackendHiringIdentity[]>([]);
  const [selectedHiringIdentityId, setSelectedHiringIdentityId] = useState<string>("");
  const [localPendingHiringIdentity, setLocalPendingHiringIdentity] =
    useState<LocalPendingHiringIdentity | null>(null);
  const [contentNiches, setContentNiches] = useState<string[]>([]);
  const [contentGenres, setContentGenres] = useState<string[]>([]);
  const [formatsHiredFor, setFormatsHiredFor] = useState<string[]>([]);
  const [roles, setRoles] = useState<BackendRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [primaryRoleId, setPrimaryRoleId] = useState("");
  const [roleSpecialization, setRoleSpecialization] = useState("");
  const [importContext, setImportContext] = useState<JobImportDraftContext | null>(null);
  const [manuallyChangedImportFields, setManuallyChangedImportFields] = useState<Set<string>>(
    () => new Set()
  );
  const importEditAnalyticsRef = useRef<Set<string>>(new Set());
  const [hiringIdentityModalOpen, setHiringIdentityModalOpen] = useState(
    !draftId && !partialImportDraftId
  );
  const [resolvedBackendAccessToken, setResolvedBackendAccessToken] = useState<string | undefined>();
  const [previewBudgetText, setPreviewBudgetText] = useState("");
  const [previewExperienceText, setPreviewExperienceText] = useState("");
  const [previewLocationText, setPreviewLocationText] = useState("");
  const mobilePreviewRef = useRef<HTMLDetailsElement | null>(null);
  const desktopPreviewRef = useRef<HTMLDivElement | null>(null);

  const softlyHighlightCandidatePreview = useCallback(() => {
    if (typeof window === "undefined") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    [mobilePreviewRef.current, desktopPreviewRef.current].forEach((target) => {
      if (!target || typeof target.animate !== "function") return;
      target.animate(
        [
          { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
          { boxShadow: "0 0 0 1px rgba(255,255,255,0.18)" },
          { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        ],
        { duration: reducedMotion ? 1 : 520, easing: "ease-out" }
      );
    });
  }, []);

  const markPayloadDirty = useCallback((...keys: Array<keyof BackendCreateJobPayload>) => {
    keys.forEach((key) => dirtyPayloadKeysRef.current.add(key));
    if (importContext) {
      softlyHighlightCandidatePreview();
      setManuallyChangedImportFields((previous) => {
        const next = new Set(previous);
        keys.forEach((key) => next.add(String(key)));
        return next;
      });
    }
  }, [importContext, softlyHighlightCandidatePreview]);

  const updateDomain = useCallback(
    (
      patch: Partial<JobPostingDomainState>,
      payloadKeys: Array<keyof BackendCreateJobPayload> = []
    ) => {
      setDomain((previous) => ({ ...previous, ...patch }));
      markPayloadDirty(...payloadKeys);
      if (Object.prototype.hasOwnProperty.call(patch, "startTiming")) {
        markPayloadDirty("start_timeframe", "start_date");
      }
      if (Object.prototype.hasOwnProperty.call(patch, "revisionPolicy")) {
        markPayloadDirty("revision_rounds");
      }
      if (Object.prototype.hasOwnProperty.call(patch, "durationType")) {
        markPayloadDirty("duration_value", "duration_unit", "engagement_end_date");
      }
      if (Object.prototype.hasOwnProperty.call(patch, "trialStatus")) {
        markPayloadDirty(
          "trial_scope",
          "trial_effort_value",
          "trial_effort_unit",
          "trial_compensation_amount",
          "trial_compensation_currency",
          "trial_compensation_basis",
          "trial_work_usage",
          "trial_portfolio_permission",
          "trial_attribution",
          "unpaid_trial_confirmed",
          "trial_notes"
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "applicationMode")) {
        markPayloadDirty("external_apply_url");
      }
      if (payloadKeys.length) {
        setDomainErrors((previous) => {
          const next = { ...previous };
          payloadKeys.forEach((key) => delete next[key]);
          return next;
        });
      }
    },
    [markPayloadDirty]
  );

  const loadCreatorRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const response = await listRoles();
      setRoles(response.items);
      if (!response.items.length) setRolesError("No creator roles are available right now.");
    } catch {
      setRoles([]);
      setRolesError("Creator roles could not be loaded.");
    } finally {
      setRolesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCreatorRoles();
  }, [loadCreatorRoles]);

  const budgetText = useMemo(() => {
    return formatCompensationSummary({
      mode: compensationMode,
      minimum: budgetMin,
      maximum: budgetMax,
      currency: budgetCurrency,
      unit: budgetUnit,
      customUnit: budgetUnitCustom,
      note: budgetNote,
    });
  }, [budgetCurrency, budgetMax, budgetMin, budgetNote, budgetUnit, budgetUnitCustom, compensationMode]);

  const experienceText = experienceLevel.trim();

  React.useEffect(() => {
    if (!platform) return;
    setPlatforms((prev) => (prev.includes(platform) ? prev : [...prev, platform]));
  }, [platform]);

  const selectedJobPlatforms = useMemo(
    () => (platforms.length ? platforms : platform ? [platform] : []),
    [platform, platforms]
  );

  const normalizeCity = (value: string) => value.trim().toLowerCase();
  const matchedCity = INDIA_CITIES.find((c) => normalizeCity(c) === normalizeCity(city));
  const isCityRequired = workMode === "Hybrid" || workMode === "On-site";
  const requiresYouTubeChannel = selectedJobPlatforms.includes("youtube");
  const hasHiringForIdentity = Boolean(selectedHiringIdentityId || localPendingHiringIdentity || identity);
  const hasBudgetMin = budgetMin.trim().length > 0;
  const hasBudgetMax = budgetMax.trim().length > 0;
  const budgetMinNumber = Number(budgetMin);
  const budgetMaxNumber = Number(budgetMax);
  const hasValidBudgetRange =
    hasBudgetMin &&
    hasBudgetMax &&
    !Number.isNaN(budgetMinNumber) &&
    !Number.isNaN(budgetMaxNumber) &&
    budgetMaxNumber >= budgetMinNumber;
  const hasAnyBudgetInput = hasBudgetMin || hasBudgetMax;
  const hasPositiveBudgetMin = hasBudgetMin && Number.isFinite(budgetMinNumber) && budgetMinNumber > 0;
  const hasValidCompensationUnit =
    !legacyBudgetUnit && Boolean(budgetUnit) && (budgetUnit !== "custom" || Boolean(budgetUnitCustom.trim()));
  const hasRequiredCompensationNote =
    !["commission", "mixed"].includes(budgetUnit) || Boolean(budgetNote.trim());
  const negotiableCurrencyValid =
    Boolean(budgetCurrency) ||
    ((budgetUnit === "commission" || budgetUnit === "mixed") && Boolean(budgetNote.trim()));
  const hasCompensationIntent =
    // `approximate` carries one figure, like fixed, and differs only in what it
    // claims about precision — so it validates identically and is never asked
    // for a second end.
    ((compensationMode === "fixed" || compensationMode === "approximate") &&
      hasPositiveBudgetMin && !hasBudgetMax && Boolean(budgetCurrency) &&
      hasValidCompensationUnit && hasRequiredCompensationNote) ||
    // A range may state one end. Job pages routinely offer "Up to ₹20,000 a
    // month" or "₹20,000+/month", and requiring both ends left an imported
    // listing that said one of those with no way to be saved as what it said —
    // so the figure was dropped and the recruiter was asked for it again.
    // Both ends together must still be ordered; one end alone is complete.
    (compensationMode === "range" &&
      hasAnyBudgetInput &&
      (hasBudgetMin && hasBudgetMax ? hasValidBudgetRange : true) &&
      (hasBudgetMin ? hasPositiveBudgetMin : true) &&
      Boolean(budgetCurrency) &&
      hasValidCompensationUnit &&
      hasRequiredCompensationNote) ||
    (compensationMode === "negotiable" &&
      !hasAnyBudgetInput &&
      negotiableCurrencyValid &&
      hasValidCompensationUnit &&
      hasRequiredCompensationNote);
  const selectedRoleForValidation = roles.find((role) => role.id === primaryRoleId);
  const requiresRoleSpecialization = Boolean(
    primaryRoleId &&
      (selectedRoleForValidation?.slug === "other-creator-role" ||
        selectedRoleForValidation?.name === "Other Creator Role" ||
        (!selectedRoleForValidation &&
          loadedJobRef.current?.primary_role_name_snapshot === "Other Creator Role"))
  );
  const backendAccessToken = session?.backendAccessToken;
  const activeBackendAccessToken = resolvedBackendAccessToken || backendAccessToken;
  React.useEffect(() => {
    if (backendAccessToken) {
      setResolvedBackendAccessToken(backendAccessToken);
    }
  }, [backendAccessToken]);

  const exchangeBackendTokenFromOAuth = useCallback(async (): Promise<string | null> => {
    if (tokenRecoveryPromiseRef.current) {
      return tokenRecoveryPromiseRef.current;
    }
    if (sessionStatus !== "authenticated") {
      return null;
    }

    const recoveryPromise = (async () => {
      try {
        const refreshedSession = await updateSession();
        const nextToken = refreshedSession?.backendAccessToken?.trim();
        if (!nextToken) {
          return null;
        }
        setResolvedBackendAccessToken(nextToken);
        return nextToken;
      } catch {
        return null;
      } finally {
        tokenRecoveryPromiseRef.current = null;
      }
    })();

    tokenRecoveryPromiseRef.current = recoveryPromise;
    return recoveryPromise;
  }, [
    sessionStatus,
    updateSession,
  ]);

  const withFreshBackendToken = useCallback(
    async <T,>(request: (token: string) => Promise<T>): Promise<T> => {
      let token: string | null | undefined = activeBackendAccessToken;
      if (!token) {
        token = await exchangeBackendTokenFromOAuth();
      }
      if (!token) {
        throw new Error("Your session is missing backend auth. Log in again.");
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
    [activeBackendAccessToken, exchangeBackendTokenFromOAuth]
  );

  React.useEffect(() => {
    aboutValueRef.current = about;
  }, [about]);

  React.useEffect(() => {
    if (!draftId || sessionStatus !== "authenticated") return;
    let cancelled = false;
    const numericString = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? value.trim() : "";
      }
      return "";
    };
    const normalizeWorkMode = (value: unknown): WorkMode => {
      const normalized = typeof value === "string" ? value.toLowerCase() : "";
      if (normalized.includes("hybrid")) return "Hybrid";
      if (normalized.includes("onsite") || normalized.includes("on-site")) return "On-site";
      if (normalized.includes("remote")) return "Remote";
      return "";
    };
    const refsFrom = (value: unknown): ReferenceVideo[] => {
      if (!Array.isArray(value)) return [];
      return value
        .map((entry) => normalizeReferenceVideo(entry))
        .filter((entry): entry is ReferenceVideo => Boolean(entry));
    };

    setDraftLoading(true);
    void withFreshBackendToken((token) => listMyBackendJobs(token))
      .then((jobs) => {
        if (cancelled) return;
        const draft = jobs.find((job) => String(job.id) === draftId);
        if (!draft) {
          setSubmitError("This job draft could not be found.");
          return;
        }
        loadedJobRef.current = draft;
        dirtyPayloadKeysRef.current.clear();
        setLoadedJobStatus(typeof draft.status === "string" ? draft.status : "draft");
        setLoadedSchemaVersion(
          typeof draft.listing_schema_version === "number" ? draft.listing_schema_version : 1
        );
        const budgetMinValue = numericString(draft.budget_amount ?? draft.budget_min);
        const budgetMaxValue = numericString(draft.budget_max);
        const budgetNote = typeof draft.budget_note === "string" ? draft.budget_note.trim().toLowerCase() : "";
        const nextBudgetIntent: BudgetIntent =
          budgetMinValue && budgetMaxValue
            ? "range"
            : budgetNote === "contact for pricing"
              ? "contact"
              : budgetNote === "flexible"
                ? "flexible"
                : "";
        const nextExperience =
          typeof draft.experience_level === "string" ? draft.experience_level : "";
        const nextWorkMode = normalizeWorkMode(draft.work_mode);
        const nextLocation = typeof draft.location === "string" ? draft.location : "";
        const nextPlatforms = normalizeJobPlatforms([
          ...(Array.isArray(draft.platforms) ? draft.platforms : []),
          draft.posted_platform,
        ]);
        const nextPlatform: JobPlatform = nextPlatforms[0] || "";

        setTitle(draft.title || "");
        setPrimaryRoleId(typeof draft.primary_role_id === "string" ? draft.primary_role_id : "");
        setRoleSpecialization(typeof draft.role_specialization === "string" ? draft.role_specialization : "");
        setBudgetMin(budgetMinValue);
        setBudgetMax(budgetMaxValue);
        const hasSupportedBudgetUnit = COMPENSATION_UNITS.includes(draft.budget_unit as CompensationUnit);
        const nextBudgetUnit: CompensationUnit | "" = hasSupportedBudgetUnit
          ? (draft.budget_unit as CompensationUnit)
          : "";
        setLegacyBudgetUnit(
          !hasSupportedBudgetUnit && typeof draft.budget_unit === "string" && draft.budget_unit.trim()
            ? draft.budget_unit
            : null
        );
        const nextBudgetCurrency = typeof draft.budget_currency === "string" ? draft.budget_currency : "";
        const nextCompensationMode =
          draft.compensation_mode === "fixed" || draft.compensation_mode === "range" || draft.compensation_mode === "negotiable"
            ? draft.compensation_mode
            : "";
        const nextBudgetNote = typeof draft.budget_note === "string" ? draft.budget_note : "";
        const nextBudgetUnitCustom = typeof draft.budget_unit_custom === "string" ? draft.budget_unit_custom : "";
        setBudgetUnit(nextBudgetUnit);
        setBudgetCurrency(nextBudgetCurrency);
        setCompensationMode(nextCompensationMode);
        setBudgetNote(nextBudgetNote);
        setBudgetUnitCustom(nextBudgetUnitCustom);
        setBudgetIntent(nextBudgetIntent);
        setWorkMode(nextWorkMode);
        // `location` can still be material for remote work (for example,
        // "Remote, India"). Keep it in the frontend model instead of throwing
        // it away merely because the work mode is remote.
        //
        // The bare string "Remote" is the exception: the payload writes it as a
        // sentinel when a remote job has no geographic restriction, so reading
        // it back into the candidate-location input would show storage
        // bookkeeping as though the recruiter had typed it — and then persist it
        // as a real restriction on the next save.
        setCity(nextWorkMode === "Remote" && nextLocation.trim() === "Remote" ? "" : nextLocation);
        setExperienceLevel(nextExperience);
        setStartWithin((draft.start_timeframe as StartTimeframe) || "");
        setEngagementType(
          ENGAGEMENT_TYPES.includes(draft.engagement_type as EngagementType)
            ? (draft.engagement_type as EngagementType)
            : ""
        );
        setExpectedWeeklyHoursMin(numericString(draft.expected_weekly_hours_min));
        setExpectedWeeklyHoursMax(numericString(draft.expected_weekly_hours_max));
        if (
          typeof draft.turnaround_value === "number" &&
          (draft.turnaround_unit === "hours" ||
            draft.turnaround_unit === "business_days" ||
            draft.turnaround_unit === "calendar_days" ||
            draft.turnaround_unit === "weeks")
        ) {
          setTurnaround({
            value: draft.turnaround_value,
            unit: draft.turnaround_unit,
            basis:
              draft.turnaround_basis === "per_deliverable" ||
              draft.turnaround_basis === "batch" ||
              draft.turnaround_basis === "first_draft" ||
              draft.turnaround_basis === "final_delivery"
                ? draft.turnaround_basis
                : "",
          });
        } else {
          setTurnaround(null);
        }
        setPlatform(nextPlatform);
        setPlatforms(nextPlatforms);
        setPlatformName(draft.channel_name || "");
        setPlatformAudience(draft.channel_subscribers != null ? String(draft.channel_subscribers) : "");
        setAbout(draft.about_channel || "");
        setResponsibilities((draft.responsibilities || []).join("\n"));
        setRequirements((draft.requirements || []).join("\n"));
        const restoredHowToApply = draft.how_to_apply || "";
        const legacyCustomInstruction = (draft.application_requirements || []).includes(
          CUSTOM_INSTRUCTION_REQUIREMENT_KEY
        );
        setHowToApply(legacyCustomInstruction ? restoredHowToApply : "");
        const restoredRequirements = sanitizeRequirementKeys(
          draft.application_requirements,
          "job"
        );
        setApplicationRequirements(restoredRequirements);
        const hydratedDomain = hydrateJobPostingDomain(draft);
        setDomain(
          legacyCustomInstruction
            ? { ...hydratedDomain, howToApply: "" }
            : hydratedDomain
        );
        // Resuming restores the chosen requirements; the explicit "none" choice is
        // a publish-time gate, so the owner re-confirms it intentionally.
        setNoFirstMessageRequirements(false);
        setTags(draft.tags || []);
        setContentNiches(normalizeCreatorContextList(draft.content_niches || []));
        setContentGenres(normalizeCreatorContextList(draft.content_genres || []));
        setFormatsHiredFor(normalizeCreatorContextList(draft.formats_hired_for || []));
        setTools(
          Array.isArray(draft.tools)
            ? draft.tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
            : []
        );
        setLegacyToolsNotCaptured(draft.required_tool_keys == null && draft.other_required_tools == null && draft.tools == null);
        setToolsConfirmed(
          draft.required_tool_keys != null || draft.other_required_tools != null || draft.tools != null
        );
        setLanguages(
          Array.isArray(draft.languages)
            ? draft.languages.filter((lang): lang is string => typeof lang === "string" && lang.trim().length > 0)
            : []
        );
        setRefVideos(refsFrom(draft.reference_videos));
        setSelectedHiringIdentityId(typeof draft.hiring_identity_id === "string" ? draft.hiring_identity_id : "");
        setPreviewBudgetText(
          formatCompensationSummary({
            mode: nextCompensationMode,
            minimum: budgetMinValue,
            maximum: budgetMaxValue,
            currency: nextBudgetCurrency,
            unit: nextBudgetUnit,
            customUnit: nextBudgetUnitCustom,
            note: nextBudgetNote,
          }) || budgetIntentLabel(nextBudgetIntent)
        );
        setPreviewLocationText(nextWorkMode === "Remote" ? "Remote" : nextWorkMode && nextLocation ? `${nextWorkMode} - ${nextLocation}` : "");
        setPreviewExperienceText(
          nextExperience
        );
      })
      .catch(() => {
        if (!cancelled) setSubmitError("Couldn’t load this job draft.");
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, sessionStatus, withFreshBackendToken]);

  React.useEffect(() => {
    if (
      !draftId ||
      draftLoading ||
      sessionStatus !== "authenticated" ||
      dirtyPayloadKeysRef.current.has("about_channel") ||
      dirtyPayloadKeysRef.current.has("hiring_identity_id") ||
      String(loadedJobRef.current?.about_channel || "").trim()
    ) {
      return;
    }

    // The server starts enrichment when persisted identity/draft state becomes
    // eligible. The editor only reads that background result and never initiates
    // search, fetch, or model work from mount, refresh, or textarea visibility.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const startedAt = Date.now();
    const terminal = new Set([
      "success",
      "skipped_existing_content",
      "no_reliable_identity",
      "no_official_source",
      "insufficient_evidence",
      "failed",
      "recruiter_owned",
    ]);

    const poll = async () => {
      if (
        cancelled ||
        dirtyPayloadKeysRef.current.has("about_channel") ||
        dirtyPayloadKeysRef.current.has("hiring_identity_id") ||
        aboutValueRef.current.trim()
      ) {
        return;
      }
      attempts += 1;
      try {
        const state = await withFreshBackendToken((token) =>
          getBrandAboutState(token, draftId)
        );
        if (
          cancelled ||
          dirtyPayloadKeysRef.current.has("about_channel") ||
          dirtyPayloadKeysRef.current.has("hiring_identity_id")
        ) return;
        const generated = String(state.about_channel || "").trim();
        if (generated && !aboutValueRef.current.trim()) {
          aboutValueRef.current = generated;
          setAbout(generated);
          if (loadedJobRef.current) {
            loadedJobRef.current = {
              ...loadedJobRef.current,
              about_channel: generated,
            };
          }
          return;
        }
        if (terminal.has(state.status)) return;
      } catch {
        // Optional automation has no recruiter-facing failure mode. The field
        // remains immediately editable and Save remains unchanged. A transient
        // read failure does not abandon a background attempt that may still be
        // running successfully.
      }
      if (cancelled || Date.now() - startedAt >= 95_000) return;
      const delay = attempts < 5 ? 750 : attempts < 15 ? 1_500 : 3_000;
      timer = setTimeout(() => void poll(), delay);
    };

    timer = setTimeout(() => void poll(), 350);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, draftLoading, sessionStatus, withFreshBackendToken]);

  React.useEffect(() => {
    const job = loadedJobRef.current;
    if (!importContext || !job || draftLoading) return;
    const jobRecord = job as unknown as Record<string, unknown>;
    const jobUpdatedAt = Date.parse(String(job.updated_at || ""));
    const importAppliedAt = Date.parse(String(importContext.draft.applied_at || ""));
    const nativeDraftWasSavedAfterImport =
      Number.isFinite(jobUpdatedAt) &&
      Number.isFinite(importAppliedAt) &&
      jobUpdatedAt > importAppliedAt;
    const changed = new Set<string>();
    importContext.draft.fields.forEach((field) => {
      const nativeField = nativeFieldForImport(field.field_path);
      if (!nativeField) return;
      const currentValue =
        field.field_path === "primary_role_key"
          ? roles.find((role) => role.id === job.primary_role_id)?.slug
          : jobRecord[nativeField];
      if (field.effective_value === null || field.effective_value === undefined) {
        // Database defaults written during conversion are not recruiter answers.
        // A later canonical save is authoritative and suppresses stale guidance.
        const untouchedApplicationDefault =
          field.field_path === "application_mode" &&
          field.review_status === "pending" &&
          currentValue === "internal";
        if (
          nativeDraftWasSavedAfterImport &&
          !untouchedApplicationDefault &&
          !jobImportValueWasRemoved(currentValue)
        ) {
          changed.add(nativeField);
        }
        return;
      }
      if (!importValuesMatch(field.effective_value, currentValue)) {
        changed.add(nativeField);
      }
    });
    if (!changed.size) return;
    setManuallyChangedImportFields((previous) => new Set([...previous, ...changed]));
    // Deliberately no step jump. An imported draft opens exactly like any other
    // draft — at the beginning — so the recruiter reviews what was filled in
    // rather than being dropped into the middle of their own job post.
  }, [draftLoading, importContext, roles]);

  React.useEffect(() => {
    if (!draftId || sessionStatus !== "authenticated") return;
    let cancelled = false;
    void withFreshBackendToken((token) =>
      getJobImportContextForNativeJob(token, draftId)
    )
      .then((context) => {
        if (cancelled) return;
        setImportContext(context);
        setManuallyChangedImportFields(new Set());
        importEditAnalyticsRef.current.clear();
      })
      .catch(() => {
        // Ordinary manually-created drafts do not have import context.
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, sessionStatus, withFreshBackendToken]);

  React.useEffect(() => {
    if (
      !partialImportDraftId ||
      sessionStatus !== "authenticated" ||
      rolesLoading ||
      partialImportAppliedRef.current === partialImportDraftId
    ) {
      return;
    }
    partialImportAppliedRef.current = partialImportDraftId;
    let cancelled = false;
    void withFreshBackendToken(async (token) => {
      const importDraft = await getJobImportDraft(token, partialImportDraftId);
      const importSource = await getJobImportSource(token, importDraft.source_id);
      return { importDraft, importSource };
    })
      .then(({ importDraft, importSource }) => {
        if (cancelled) return;
        const values = Object.fromEntries(
          importDraft.fields
            .filter(
              (field) =>
                field.effective_value !== null && field.effective_value !== undefined
            )
            .map((field) => [field.field_path, field.effective_value])
        ) as Record<string, unknown>;
        const numericString = (value: unknown) =>
          typeof value === "number" ||
          (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
            ? String(value)
            : "";
        const workMode =
          values.work_mode === "hybrid"
            ? "Hybrid"
            : values.work_mode === "onsite"
              ? "On-site"
              : values.work_mode === "remote"
                ? "Remote"
                : "";
        const platforms = normalizeJobPlatforms(
          Array.isArray(values.platforms) ? (values.platforms as string[]) : []
        );
        const roleKey = typeof values.primary_role_key === "string" ? values.primary_role_key : "";
        const role = roles.find((item) => item.slug === roleKey);
        const budgetMode = ["fixed", "range", "negotiable"].includes(
          String(values.compensation_mode)
        )
          ? (values.compensation_mode as CompensationMode)
          : "";
        const supportedUnit = COMPENSATION_UNITS.includes(
          values.budget_unit as CompensationUnit
        )
          ? (values.budget_unit as CompensationUnit)
          : "";
        setTitle(typeof values.title === "string" ? values.title : "");
        setPrimaryRoleId(role?.id ?? "");
        setRoleSpecialization(
          typeof values.role_specialization === "string" ? values.role_specialization : ""
        );
        setCompensationMode(budgetMode);
        setBudgetMin(numericString(values.budget_amount));
        setBudgetMax(numericString(values.budget_max));
        setBudgetCurrency(
          typeof values.budget_currency === "string" ? values.budget_currency : ""
        );
        setBudgetUnit(supportedUnit);
        setBudgetUnitCustom(
          typeof values.budget_unit_custom === "string" ? values.budget_unit_custom : ""
        );
        setBudgetNote(typeof values.budget_note === "string" ? values.budget_note : "");
        setWorkMode(workMode);
        setCity(typeof values.location === "string" ? values.location : "");
        setPlatforms(platforms);
        setPlatform(platforms[0] ?? "");
        setExperienceLevel(
          typeof values.experience_level === "string" ? values.experience_level : ""
        );
        setStartWithin((values.start_timeframe as StartTimeframe) || "");
        setEngagementType(
          ENGAGEMENT_TYPES.includes(values.engagement_type as EngagementType)
            ? (values.engagement_type as EngagementType)
            : ""
        );
        setExpectedWeeklyHoursMin(numericString(values.expected_weekly_hours_min));
        setExpectedWeeklyHoursMax(numericString(values.expected_weekly_hours_max));
        setTurnaround(
          typeof values.turnaround_value === "number" &&
            ["hours", "business_days", "calendar_days", "weeks"].includes(
              String(values.turnaround_unit)
            )
            ? {
                value: values.turnaround_value,
                unit: values.turnaround_unit as TurnaroundUnit,
                basis: ["per_deliverable", "batch", "first_draft", "final_delivery"].includes(
                  String(values.turnaround_basis)
                )
                  ? (values.turnaround_basis as TurnaroundBasis)
                  : "",
              }
            : null
        );
        setAbout(typeof values.about_channel === "string" ? values.about_channel : "");
        setResponsibilities(
          Array.isArray(values.responsibilities)
            ? values.responsibilities.filter((item) => typeof item === "string").join("\n")
            : ""
        );
        setRequirements(
          Array.isArray(values.requirements)
            ? values.requirements.filter((item) => typeof item === "string").join("\n")
            : ""
        );
        setApplicationRequirements(
          sanitizeRequirementKeys(
            Array.isArray(values.application_requirements)
              ? values.application_requirements.filter(
                  (item): item is string => typeof item === "string"
                )
              : [],
            "job"
          )
        );
        setHowToApply(typeof values.how_to_apply === "string" ? values.how_to_apply : "");
        setNoFirstMessageRequirements(false);
        setTags(
          Array.isArray(values.tags)
            ? values.tags.filter((item): item is string => typeof item === "string")
            : []
        );
        setContentNiches(
          normalizeCreatorContextList(
            Array.isArray(values.content_niches) ? (values.content_niches as string[]) : []
          )
        );
        setContentGenres(
          normalizeCreatorContextList(
            Array.isArray(values.content_genres) ? (values.content_genres as string[]) : []
          )
        );
        setFormatsHiredFor(
          normalizeCreatorContextList(
            Array.isArray(values.formats_hired_for)
              ? (values.formats_hired_for as string[])
              : []
          )
        );
        setRefVideos(
          Array.isArray(values.reference_videos)
            ? values.reference_videos
                .map((entry) => normalizeReferenceVideo(entry))
                .filter((entry): entry is ReferenceVideo => Boolean(entry))
            : []
        );
        const requiredToolKeys = Array.isArray(values.required_tool_keys)
          ? values.required_tool_keys.filter((item): item is string => typeof item === "string")
          : [];
        const customTools = Array.isArray(values.other_required_tools)
          ? values.other_required_tools.filter((item): item is string => typeof item === "string")
          : [];
        setTools([
          ...requiredToolKeys.map(
            (key) => findToolCatalogEntry(key)?.name ?? key
          ),
          ...customTools,
        ]);
        setToolsConfirmed(
          "required_tool_keys" in values || "other_required_tools" in values
        );
        setDomain(hydrateJobPostingDomain(values as unknown as BackendJob));
        setImportContext({
          draft: importDraft,
          source_type: importSource.source_type,
          source_label:
            importSource.source_title ||
            (importSource.source_type === "public_url" ? "Public job post" : "Pasted job post"),
          source_url: importSource.final_source_url || importSource.source_url,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          partialImportAppliedRef.current = null;
          setSubmitError(
            describeActionError(error, "This partial imported draft could not be loaded.")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [partialImportDraftId, roles, rolesLoading, sessionStatus, withFreshBackendToken]);

  React.useEffect(() => {
    if (sessionStatus !== "authenticated") {
      setHiringIdentities([]);
      return;
    }

    let cancelled = false;
    void withFreshBackendToken((token) => listMyHiringIdentities(token))
      .then((identities) => {
        if (cancelled) return;
        const items = identities.items || [];
        setHiringIdentities(items);
        const preferred = items[0];
        if (preferred && !selectedHiringIdentityId && !localPendingHiringIdentity) {
          setSelectedHiringIdentityId(preferred.id);
          setPlatform(preferred.platform === "INSTAGRAM" ? "instagram" : "youtube");
          setPlatformName(preferred.display_name);
          setIdentity({
            platform: preferred.platform === "INSTAGRAM" ? "instagram" : "youtube",
            brandId: preferred.id,
            name: preferred.display_name,
            imageUrl: preferred.avatar_url || null,
            followersCount: null,
            handle: preferred.handle || null,
            verifiedAt: preferred.verified_at || new Date().toISOString(),
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHiringIdentities([]);
      });

    return () => {
      cancelled = true;
    };
  }, [localPendingHiringIdentity, selectedHiringIdentityId, sessionStatus, withFreshBackendToken]);

  const selectedHiringIdentity = useMemo(
    () => hiringIdentities.find((item) => item.id === selectedHiringIdentityId) || null,
    [hiringIdentities, selectedHiringIdentityId]
  );

  const connectedHiringIdentityOptions = useMemo(() => {
    const options = [...identityOptions];
    if (identity && !options.some((item) => item.brandId === identity.brandId)) {
      options.unshift(identity);
    }
    return options;
  }, [identity, identityOptions]);

  const selectedHiringChoice = useMemo<HiringIdentityChoice | null>(() => {
    if (selectedHiringIdentityId) return { source: "backend", id: selectedHiringIdentityId };
    if (identity?.brandId) return { source: "connected", id: identity.brandId };
    return null;
  }, [identity?.brandId, selectedHiringIdentityId]);

  const selectHiringIdentity = useCallback((nextIdentity: BackendHiringIdentity) => {
    setLocalPendingHiringIdentity(null);
    setSelectedHiringIdentityId(nextIdentity.id);
    setPlatform(nextIdentity.platform === "INSTAGRAM" ? "instagram" : "youtube");
    setPlatformName(nextIdentity.display_name);
    setIdentity({
      platform: nextIdentity.platform === "INSTAGRAM" ? "instagram" : "youtube",
      brandId: nextIdentity.id,
      name: nextIdentity.display_name,
      imageUrl: nextIdentity.avatar_url || null,
      followersCount: null,
      handle: nextIdentity.handle || null,
      verifiedAt: nextIdentity.verified_at || new Date().toISOString(),
    });
    markPayloadDirty(
      "hiring_identity_id",
      "platforms",
      "posted_platform",
      "channel_name",
      "channel_logo_url"
    );
  }, [markPayloadDirty]);

  const confirmHiringIdentityChoice = useCallback(
    (choice: HiringIdentityChoice) => {
      if (choice.source === "backend") {
        const next = hiringIdentities.find((item) => item.id === choice.id);
        if (next) selectHiringIdentity(next);
        return;
      }
      const next = connectedHiringIdentityOptions.find((item) => item.brandId === choice.id);
      if (!next) return;
      setLocalPendingHiringIdentity(null);
      setSelectedHiringIdentityId("");
      setPlatform(next.platform);
      setIdentity(next);
      setIdentityError(null);
      markPayloadDirty(
        "hiring_identity_id",
        "platforms",
        "posted_platform",
        "channel_name",
        "channel_logo_url"
      );
    },
    [connectedHiringIdentityOptions, hiringIdentities, markPayloadDirty, selectHiringIdentity]
  );

  const createRepresentedHiringIdentity = useCallback(
    async (
      nextIdentity: ResolvedHiringIdentity,
      requestVerification = false
    ): Promise<RepresentedHiringIdentityResult> => {
      const localIdentity: LocalPendingHiringIdentity = {
        id: `local-represented-${Date.now()}`,
        display_name: nextIdentity.name,
        platform: nextIdentity.platform,
        handle: nextIdentity.handle,
        url: nextIdentity.normalizedUrl,
        avatar_url: nextIdentity.logoUrl,
        verification_status: "PENDING",
        is_agency_represented: true,
        managed_by_agency_name: session?.user?.name || session?.user?.username || null,
      };

      const applyLocalPending = (): LocalPendingHiringIdentity => {
        setLocalPendingHiringIdentity(localIdentity);
        setSelectedHiringIdentityId("");
        setPlatform(nextIdentity.platform === "INSTAGRAM" ? "instagram" : "youtube");
        setPlatformName(nextIdentity.name);
        setPlatformAudience("");
        setIdentity({
          platform: nextIdentity.platform === "INSTAGRAM" ? "instagram" : "youtube",
          brandId: localIdentity.id,
          name: nextIdentity.name,
          imageUrl: nextIdentity.logoUrl,
          followersCount: null,
          handle: nextIdentity.handle,
          verifiedAt: "",
        });
        markPayloadDirty(
          "hiring_identity_id",
          "platforms",
          "posted_platform",
          "channel_name",
          "channel_logo_url"
        );
        return localIdentity;
      };

      if (sessionStatus !== "authenticated" || isLocalMocksEnabled()) {
        if (requestVerification) {
          if (sessionStatus !== "authenticated") {
            void signIn("google", { callbackUrl: "/post-job" });
            throw new Error("Sign in to generate a verification code.");
          }
          throw new Error("Bio-code verification requires the backend. Disable local mock mode and try again.");
        }
        return applyLocalPending();
      }

      try {
        const existing = hiringIdentities.find((item) =>
          [item.url, item.handle, item.display_name]
            .map(normalizeIdentityMatchKey)
            .filter(Boolean)
            .some((key) =>
              [
                normalizeIdentityMatchKey(nextIdentity.normalizedUrl),
                normalizeIdentityMatchKey(nextIdentity.handle),
                normalizeIdentityMatchKey(nextIdentity.name),
              ]
                .filter(Boolean)
                .includes(key)
            )
        );
        const saved = await withFreshBackendToken(async (token) => {
          if (existing) {
            if (!requestVerification) return existing;
            const verification = await requestMyHiringIdentityVerification(token, existing.id, nextIdentity.normalizedUrl);
            return verification.identity;
          }
          const created = await createMyHiringIdentity(token, {
            type: "AGENCY_REPRESENTED_CHANNEL",
            platform: nextIdentity.platform,
            display_name: nextIdentity.name,
            handle: nextIdentity.handle,
            url: nextIdentity.normalizedUrl,
            avatar_url: nextIdentity.logoUrl,
            managed_by_agency_name: session?.user?.name || session?.user?.username || null,
            is_agency_represented: true,
          });
          if (!requestVerification) return created;
          const verification = await requestMyHiringIdentityVerification(token, created.id, nextIdentity.normalizedUrl);
          return verification.identity;
        });
        setHiringIdentities((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
        selectHiringIdentity(saved);
        return saved;
      } catch (error) {
        if (isBackendUnavailable(error)) {
          if (requestVerification) {
            throw new Error("Could not reach the backend to generate a verification code. Start the backend and try again.");
          }
          return applyLocalPending();
        }
        throw error;
      }
    },
    [
      hiringIdentities,
      markPayloadDirty,
      selectHiringIdentity,
      session?.user?.name,
      session?.user?.username,
      sessionStatus,
      withFreshBackendToken,
    ]
  );

  const removeBackendHiringIdentity = useCallback(
    async (identityId: string) => {
      if (sessionStatus !== "authenticated" || isLocalMocksEnabled()) {
        throw new Error("Sign in with backend access to remove saved channels/pages.");
      }
      await withFreshBackendToken((token) => deleteMyHiringIdentity(token, identityId));
      setHiringIdentities((prev) => prev.filter((item) => item.id !== identityId));
      if (selectedHiringIdentityId === identityId) {
        setSelectedHiringIdentityId("");
        setIdentityError(null);
      }
    },
    [selectedHiringIdentityId, sessionStatus, withFreshBackendToken]
  );

  const checkRepresentedHiringIdentityVerification = useCallback(
    async (identityId: string): Promise<BackendHiringIdentityVerificationResponse> => {
      const response = await withFreshBackendToken((token) =>
        checkMyHiringIdentityVerification(token, identityId)
      );
      const saved = response.identity;
      setHiringIdentities((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
      selectHiringIdentity(saved);
      return response;
    },
    [selectHiringIdentity, withFreshBackendToken]
  );

  const applyVerifiedChannels = useCallback(
    (channels: BackendMeYouTubeChannel[], preferredChannelId?: string | null) => {
      const nextOptions = channels.map(mapBackendChannelToIdentity);
      setIdentityOptions(nextOptions);
      if (!nextOptions.length) {
        setIdentity(null);
        return;
      }

      const currentOrPreferredId = preferredChannelId || identity?.brandId;
      const selected = currentOrPreferredId
        ? nextOptions.find((item) => item.brandId === currentOrPreferredId)
        : null;
      setIdentity(selected || null);
    },
    [identity?.brandId]
  );

  const getBasicsErrors = () => {
    const errors: Array<"title" | "role" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode"> = [];
    if (!hasHiringForIdentity) errors.push("identity");
    if (title.trim().length < 3) errors.push("title");
    if (!primaryRoleId || (requiresRoleSpecialization && !roleSpecialization.trim())) {
      errors.push("role");
    }
    if (selectedJobPlatforms.length === 0) errors.push("platform");
    if (!workMode) errors.push("workMode");
    if (isCityRequired && !city.trim()) errors.push("city");
    if (isCityRequired && city.trim() && !matchedCity) errors.push("cityInvalid");
    if (!hasCompensationIntent && !hasAnyBudgetInput) {
      errors.push("budgetMissing");
    }
    if (hasAnyBudgetInput && !hasCompensationIntent) {
      errors.push("budgetRange");
    }
    return errors;
  };

  const isBasicsErrorActive = useCallback(
    (key: "title" | "role" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode") => {
      if (key === "title") return title.trim().length < 3;
      if (key === "role") {
        return !primaryRoleId || (requiresRoleSpecialization && !roleSpecialization.trim());
      }
      if (key === "identity") return !hasHiringForIdentity;
      if (key === "platform") return selectedJobPlatforms.length === 0;
      if (key === "workMode") return !workMode;
      if (key === "city") return isCityRequired && !city.trim();
      if (key === "cityInvalid") return isCityRequired && city.trim() && !matchedCity;
      if (key === "budgetMissing") return !hasCompensationIntent && !hasAnyBudgetInput;
      if (key === "budgetRange") return hasAnyBudgetInput && !hasCompensationIntent;
      return false;
    },
    [
      title,
      primaryRoleId,
      requiresRoleSpecialization,
      roleSpecialization,
      hasHiringForIdentity,
      selectedJobPlatforms,
      workMode,
      isCityRequired,
      city,
      matchedCity,
      hasCompensationIntent,
      hasAnyBudgetInput,
    ]
  );

  const getBasicsErrorMessage = (
    key: "title" | "role" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode"
  ) => {
    switch (key) {
      case "title":
        return title.trim() ? "Job title must be at least 3 characters." : "Job title can't be empty.";
      case "role":
        return requiresRoleSpecialization && primaryRoleId
          ? "Describe the creator role."
          : "Choose a creator role.";
      case "platform":
        return "Platform is required.";
      case "workMode":
        return "Choose a work mode.";
      case "city":
        return "Add a city for hybrid or on-site work.";
      case "cityInvalid":
        return "Incorrect city name.";
      case "budgetMissing":
        return "Choose a compensation mode, currency, and rate.";
      case "budgetRange":
        return "Check the amount, currency, and range for the selected compensation mode.";
      case "identity":
        return "Choose who you’re hiring for before posting.";
    }
  };

  const basicsErrorMap = (() => {
    const next: Partial<
      Record<"title" | "role" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode", string>
    > = {};
    basicsErrors.forEach((key) => {
      next[key] = getBasicsErrorMessage(key);
    });
    return next;
  })();

  React.useEffect(() => {
    if (basicsErrors.length === 0) return;
    setBasicsErrors((prev) => prev.filter((key) => isBasicsErrorActive(key)));
  }, [basicsErrors.length, isBasicsErrorActive]);

  React.useEffect(() => {
    if (about.trim().length >= 20) {
      setContentErrors((prev) => ({ ...prev, about: undefined }));
    }
  }, [about]);

  React.useEffect(() => {
    const hasCustomInstruction = applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY);
    if (noFirstMessageRequirements || (applicationRequirements.length && (!hasCustomInstruction || howToApply.trim()))) {
      setFirstMessageError(null);
    }
  }, [noFirstMessageRequirements, applicationRequirements, howToApply]);

  React.useEffect(() => {
    if (!hasHiringForIdentity) return;
    setBasicsErrors((prev) => prev.filter((key) => key !== "identity"));
  }, [hasHiringForIdentity]);

  React.useEffect(() => {
    if (!identity) {
      setPlatformName("");
      setPlatformAudience("");
      return;
    }
    setPlatformName(identity.name);
    setPlatformAudience(identity.followersCount != null ? String(identity.followersCount) : "");
  }, [identity]);

  React.useEffect(() => {
    if (localPendingHiringIdentity) {
      return;
    }
    if (selectedHiringIdentity) {
      return;
    }
  }, [identity, localPendingHiringIdentity, platform, selectedHiringIdentity]);

  const loadLinkedYouTubeChannels = useCallback(async () => {
    if (!activeBackendAccessToken) {
      setIdentityOptions([]);
      setIdentity(null);
      return;
    }

    setIdentityLoading(true);
    setIdentityError(null);
    try {
      const data = await withFreshBackendToken((token) => listMyYouTubeChannels(token));
      applyVerifiedChannels(data.channels);
    } catch (err) {
      setIdentityOptions([]);
      setIdentity(null);
      setIdentityError(err instanceof Error ? err.message : "Failed to load verified channels.");
    } finally {
      setIdentityLoading(false);
    }
  }, [activeBackendAccessToken, applyVerifiedChannels, withFreshBackendToken]);

  const refreshYouTubeVerification = useCallback(async () => {
    if (sessionStatus !== "authenticated") {
      await signIn("google", {
        callbackUrl: "/post-job?yt_connect=1",
      }, googleYouTubeAuthorizationParams({ selectAccount: true }));
      return;
    }

    if (!activeBackendAccessToken) {
      setIdentityError("Your session is missing backend auth. Log in again.");
      return;
    }

    setIdentityLoading(true);
    setIdentityError(null);
    try {
      const refreshed = await refreshYouTubeConnection();
      applyVerifiedChannels(refreshed.channels);
      if (!refreshed.channels.length) {
        setIdentityError("No YouTube channels were returned for this Google account.");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to refresh YouTube channels.";
      if (errorMessage.includes("youtube_reauth_required")) {
        await signIn("google", {
          callbackUrl: "/post-job?yt_connect=1",
        }, googleYouTubeAuthorizationParams());
        return;
      }
      setIdentityError(errorMessage);
    } finally {
      setIdentityLoading(false);
    }
  }, [
    applyVerifiedChannels,
    activeBackendAccessToken,
    sessionStatus,
  ]);

  React.useEffect(() => {
    if (selectedHiringIdentity) {
      return;
    }
    if (!requiresYouTubeChannel) {
      return;
    }
    if (sessionStatus !== "authenticated" || !activeBackendAccessToken) {
      setIdentityOptions([]);
      setIdentity(null);
      return;
    }
    void loadLinkedYouTubeChannels();
  }, [activeBackendAccessToken, loadLinkedYouTubeChannels, requiresYouTubeChannel, selectedHiringIdentity, sessionStatus]);

  React.useEffect(() => {
    if (connectParam !== "1") {
      autoConnectHandledRef.current = false;
      return;
    }
    if (sessionStatus !== "authenticated" || autoConnectHandledRef.current) {
      return;
    }
    autoConnectHandledRef.current = true;
    void (async () => {
      await refreshYouTubeVerification();
      router.replace("/post-job");
    })();
  }, [connectParam, refreshYouTubeVerification, router, sessionStatus]);

  React.useEffect(() => {
    if (!refUrlError) return;
    if (!refUrl.trim() || isValidYouTubeUrl(refUrl.trim())) {
      setRefUrlError(null);
    }
  }, [refUrl, refUrlError]);

  React.useEffect(() => {
    if (!workMode) {
      setPreviewLocationText("");
      return;
    }
    if (workMode === "Remote") {
      setPreviewLocationText("Remote");
      return;
    }
    setPreviewLocationText(workMode);
  }, [workMode]);

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    const normalized = t.toLocaleLowerCase();
    const alreadyRepresented = [
      ...tags,
      ...tools,
      ...contentNiches,
      ...contentGenres,
      ...formatsHiredFor,
      ...(domain.otherRequiredSkills || []),
      ...(domain.otherPreferredSkills || []),
    ].some((value) => value.trim().toLocaleLowerCase() === normalized);
    if (alreadyRepresented) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, t]);
    markPayloadDirty("tags");
    setTagInput("");
  };

  const removeTag = (t: string) => {
    setTags((prev) => prev.filter((x) => x !== t));
    markPayloadDirty("tags");
  };

  const togglePlatformSelection = (next: IdentityPlatform) => {
    markPayloadDirty("platforms", "posted_platform");
    setPlatforms((prev) => {
      const updated = prev.includes(next)
        ? prev.filter((item) => item !== next)
        : [...prev, next];
      setPlatform((current) => {
        if (updated.length === 0) return "";
        if (current && updated.includes(current)) return current;
        return updated[0];
      });
      return updated;
    });
  };

  React.useEffect(() => {
    setPlatformName("");
    setPlatformAudience("");
    setIdentity((current) => {
      if (!platform || (current && current.platform !== platform)) {
        return null;
      }
      return current;
    });
    setIdentityOptions([]);
    setIdentityError(null);
  }, [platform]);

  const isValidYouTubeUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "youtube.com" || host === "m.youtube.com") {
        return url.pathname === "/watch" ? Boolean(url.searchParams.get("v")) : true;
      }
      if (host === "youtu.be") {
        return url.pathname.length > 1;
      }
      return false;
    } catch {
      return false;
    }
  };

  const getRefUrlError = () => {
    const trimmed = refUrl.trim();
    if (!trimmed) return null;
    if (!isValidYouTubeUrl(trimmed)) return "YouTube video URL must be valid.";
    return null;
  };

  const addRefVideo = () => {
    if (refVideos.length >= MAX_REFERENCE_VIDEOS) return;
    const url = refUrl.trim();
    if (!url) {
      setRefUrlError("Add a YouTube video URL first.");
      return;
    }
    if (!isValidYouTubeUrl(url)) {
      setRefUrlError("YouTube video URL must be valid.");
      return;
    }
    const timestampNotes = (refTimestampNotes || [])
      .map((note) => normalizeReferenceTimestampNote(note))
      .filter((note): note is ReferenceTimestampNote => Boolean(note));
    setRefUrlError(null);
    setRefVideos((prev) => [
      ...prev,
      {
        title: refTitle.trim() || undefined,
        url,
        platform: "YouTube",
        whatToReference: refWhatToReference.trim() || undefined,
        timestampNotes,
      },
    ].slice(0, MAX_REFERENCE_VIDEOS));
    markPayloadDirty("reference_videos");
    setRefTitle("");
    setRefUrl("");
    setRefWhatToReference("");
    setRefTimestampNotes([]);
  };

  const removeRefVideo = (idx: number) => {
    setRefVideos((prev) => prev.filter((_, i) => i !== idx));
    markPayloadDirty("reference_videos");
  };

  const updateRefVideo = (idx: number, next: ReferenceVideo) => {
    setRefVideos((prev) => prev.map((video, i) => (i === idx ? next : video)));
    markPayloadDirty("reference_videos");
  };

  const cleanReferenceVideo = (video: ReferenceVideo): ReferenceVideo => ({
    ...video,
    title: video.title?.trim() || undefined,
    whatToReference: video.whatToReference?.trim() || undefined,
    timestampNotes: (video.timestampNotes || [])
      .map((note) => normalizeReferenceTimestampNote(note))
      .filter((note): note is ReferenceTimestampNote => Boolean(note)),
  });

  const getReferenceVideosForPayload = () => {
    const videos = refVideos.map(cleanReferenceVideo).filter((video) => video.url.trim()).slice(0, MAX_REFERENCE_VIDEOS);
    const activeUrl = refUrl.trim();
    if (videos.length >= MAX_REFERENCE_VIDEOS || !activeUrl || !isValidYouTubeUrl(activeUrl)) {
      return videos;
    }
    const activeVideo = cleanReferenceVideo({
      title: refTitle.trim() || undefined,
      url: activeUrl,
      platform: "YouTube",
      whatToReference: refWhatToReference.trim() || undefined,
      timestampNotes: refTimestampNotes || [],
    });
    if (videos.some((video) => video.url.trim() === activeVideo.url.trim())) {
      return videos;
    }
    return [...videos, activeVideo].slice(0, MAX_REFERENCE_VIDEOS);
  };
  const referenceVideosForPayload = getReferenceVideosForPayload();

  const activeHiringIdentity = localPendingHiringIdentity || selectedHiringIdentity;
  const activeHiringVerificationStatus = localPendingHiringIdentity
    ? localPendingHiringIdentity.verification_status
    : selectedHiringIdentity?.verification_status || null;
  const activeHiringIsRepresented = Boolean(
    localPendingHiringIdentity || selectedHiringIdentity?.is_agency_represented
  );
  const isHiringAuthorizationBlockingPublish =
    activeHiringIsRepresented && activeHiringVerificationStatus !== "VERIFIED";
  const activeHiringDisplayName =
    activeHiringIdentity?.display_name ||
    identity?.name ||
    platformName.trim() ||
    session?.user?.name ||
    session?.user?.username ||
    "Content creator";
  const activeHiringAvatarUrl =
    activeHiringIdentity?.avatar_url ||
    identity?.imageUrl ||
    null;
  const activeHiringPlatform =
    activeHiringIdentity?.platform ||
    (platform ? (platform === "instagram" ? "INSTAGRAM" : "YOUTUBE") : undefined);
  const activeHiringStatusMeta =
    activeHiringVerificationStatus === "VERIFIED" || (identity && !activeHiringIsRepresented)
      ? {
          icon: "check" as const,
          label: "Access confirmed",
          className: "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/75",
          tooltip: "Access confirmed. Jobs for this channel can be published.",
        }
      : activeHiringVerificationStatus === "REJECTED"
        ? {
            icon: "alert" as const,
            label: "Needs access confirmation",
            className: "border-amber-200/20 bg-amber-200/[0.08] text-amber-100/80",
            tooltip: "Access could not be confirmed. Complete verification before publishing.",
          }
        : {
            icon: "clock" as const,
            label: "Waiting for access",
            className: "border-white/12 bg-white/[0.045] text-white/54",
            tooltip: "Access not confirmed yet. This job will stay in drafts until confirmed.",
          };

  const hasExperienceQuality =
    Boolean(experienceLevel.trim()) ||
    Boolean(previewExperienceText.trim() && previewExperienceText.trim().toLowerCase() !== "any");

  const jobQualityItems: JobQualityItem[] = getJobDraftCompletion({
    title,
    platform: platform || selectedJobPlatforms[0] || "",
    hiringDisplayName: activeHiringDisplayName,
    hiringIdentityId: selectedHiringIdentityId || undefined,
    hiringVerificationStatus: activeHiringVerificationStatus || undefined,
    workMode,
    budget: previewBudgetText || budgetIntentLabel(budgetIntent) || budgetText,
    about,
    responsibilities,
    requirements,
    tools,
    contentNiches,
    contentGenres,
    formatsHiredFor,
    experience: hasExperienceQuality ? previewExperienceText || experienceText : "",
    weeklyHours: expectedWeeklyHoursMin
      ? `${expectedWeeklyHoursMin}${expectedWeeklyHoursMax ? `–${expectedWeeklyHoursMax}` : ""} hours / week`
      : "",
    startTimeframe: startWithin || undefined,
    referenceVideos: referenceVideosForPayload,
    draftCompletion: {
      hasTitle: Boolean(title.trim()),
      hasBudget: Boolean(budgetMin.trim() && budgetMax.trim()),
      hasPlatform: selectedJobPlatforms.length > 0,
      hasWorkMode: Boolean(workMode),
      hasChannel: hasHiringForIdentity,
      hasExperience: hasExperienceQuality,
      hasTimeline: Boolean(turnaround || startWithin || domain.startTiming || expectedWeeklyHoursMin),
    },
  })
    .recommendedItems.map((item) => {
      const target = JOB_COMPLETION_TARGETS[item.target] || JOB_COMPLETION_TARGETS[item.jump] || JOB_COMPLETION_TARGETS.basics;
      return {
        id: item.id,
        label: item.actionLabel,
        complete: item.done,
        step: target.step,
        targetId: target.target,
      };
    });
  const missingJobQualityItems = jobQualityItems.filter((item) => !item.complete);

  React.useEffect(() => {
    if (!publishReadyOpen) return;
    window.setTimeout(() => publishAnywayButtonRef.current?.focus(), 0);
  }, [publishReadyOpen]);

  // Coordinated attention for a missing/invalid field: scroll it into a comfortable
  // focal position, move focus to its primary control, apply a brief amber highlight,
  // and (unless the user prefers reduced motion) a single restrained horizontal shake.
  const emphasizeField = (target: HTMLElement) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    const focusable = target.matches("input, textarea, select, button, [tabindex]")
      ? target
      : target.querySelector<HTMLElement>(
          "input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex='-1'])"
        );
    window.setTimeout(() => focusable?.focus({ preventScroll: true }), reducedMotion ? 0 : 180);
    // Temporary highlight in the error/amber token — runs in both motion modes.
    target.animate(
      [
        { boxShadow: "0 0 0 0 rgba(251,191,36,0)", backgroundColor: "rgba(251,191,36,0)" },
        { boxShadow: "0 0 0 2px rgba(251,191,36,0.5)", backgroundColor: "rgba(251,191,36,0.08)" },
        { boxShadow: "0 0 0 0 rgba(251,191,36,0)", backgroundColor: "rgba(251,191,36,0)" },
      ],
      { duration: reducedMotion ? 900 : 1100, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
    );
    if (reducedMotion) return;
    // A single, subtle shake — three small horizontal movements, no loop, no layout shift.
    target.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 320, easing: "ease-in-out" }
    );
  };

  const focusQualityTarget = (targetId?: string) => {
    if (!targetId) return;
    const requestId = ++focusRequestRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delays = reducedMotion ? [0, 60, 180] : [90, 380, 700];
    const tryFocus = (attempt: number) => {
      if (focusRequestRef.current !== requestId) return;
      const exactTarget =
        document.querySelector<HTMLElement>(`[data-quality-target="${targetId}"]`) ||
        document.getElementById(targetId);
      const target =
        exactTarget ||
        (attempt === delays.length - 1
          ? document.querySelector<HTMLElement>('form [aria-invalid="true"], form [role="alert"]')
          : null);
      if (!target) {
        if (attempt < delays.length - 1) {
          window.setTimeout(() => tryFocus(attempt + 1), delays[attempt + 1] - delays[attempt]);
        }
        return;
      }
      emphasizeField(target);
    };
    window.setTimeout(() => tryFocus(0), delays[0]);
  };

  const goToJobQualityItem = (item: JobQualityItem) => {
    setPublishReadyOpen(false);
    setDirection(STEPS.indexOf(item.step) < STEPS.indexOf(step) ? "back" : "forward");
    setStep(item.step);
    focusQualityTarget(item.targetId);
  };

  // Deep-link from the /drafts "Jump to …" links: ?section=<key> opens the right
  // step and focuses the relevant field once the draft has finished hydrating.
  const sectionParam = searchParams.get("section");
  const sectionAppliedRef = useRef(false);
  React.useEffect(() => {
    if (!sectionParam || sectionAppliedRef.current) return;
    if (draftId && draftLoading) return;
    const dest = JOB_COMPLETION_TARGETS[sectionParam];
    if (!dest) return;
    sectionAppliedRef.current = true;
    setStep(dest.step);
    if (dest.target) focusQualityTarget(dest.target);
  }, [sectionParam, draftId, draftLoading]);

  const buildCanonicalJobContractPayload = (
    effectiveMode: CompensationMode | null,
    { includeCompensation = true }: { includeCompensation?: boolean } = {}
  ): Partial<BackendCreateJobPayload> => {
    const normalizedTools = splitRequiredTools(tools);
    const budgetAmountValue = parseWholeNumber(budgetMin);
    const budgetMaxValue = parseWholeNumber(budgetMax);
    return {
      ...serializeJobPostingDomain(domain),
      primary_role_id: primaryRoleId || null,
      role_specialization: roleSpecialization.trim() || null,
      ...(includeCompensation
        ? {
            compensation_mode: effectiveMode,
            budget_amount:
              effectiveMode === "fixed" || effectiveMode === "range" ? budgetAmountValue : null,
            budget_max: effectiveMode === "range" ? budgetMaxValue : null,
            budget_note: budgetNote.trim() || budgetIntentLabel(budgetIntent) || null,
            budget_currency: budgetCurrency || null,
            budget_unit: effectiveMode && budgetUnit ? budgetUnit : null,
            budget_unit_custom: budgetUnit === "custom" ? budgetUnitCustom.trim() || null : null,
          }
        : {}),
      engagement_type: engagementType || null,
      expected_weekly_hours_min: parseWholeNumber(expectedWeeklyHoursMin),
      expected_weekly_hours_max: parseWholeNumber(expectedWeeklyHoursMax),
      turnaround_value: turnaround?.value || null,
      turnaround_unit: turnaround?.unit || null,
      turnaround_basis: turnaround?.basis || null,
      required_tool_keys: toolsConfirmed ? normalizedTools.requiredToolKeys : null,
      other_required_tools: toolsConfirmed ? normalizedTools.otherRequiredTools : null,
    };
  };

  const buildCompleteJobPayload = (
    status: NonNullable<BackendCreateJobPayload["status"]>,
    effectiveCompensationMode: CompensationMode | null,
    { includeCompensation = true }: { includeCompensation?: boolean } = {}
  ): BackendCreateJobPayload => {
    const selectedYouTubeChannelId =
      requiresYouTubeChannel && !selectedHiringIdentity && !localPendingHiringIdentity
        ? identity?.brandId
        : undefined;
    const hasExplicitHiringIdentity = Boolean(
      selectedHiringIdentityId || localPendingHiringIdentity || identity
    );
    const normalizedChannelName = hasExplicitHiringIdentity ? activeHiringDisplayName : null;
    const normalizedChannelSubscribers = localPendingHiringIdentity
      ? null
      : identity?.followersCount ?? parseWholeNumber(platformAudience);
    const sanitizedApplicationRequirements = normalizeJobApplicationRequirementsForPayload(
      applicationRequirements,
      howToApply,
      noFirstMessageRequirements
    );
    const selectedPlatform = platform || selectedJobPlatforms[0] || null;
    const payload: BackendCreateJobPayload = {
      title: title.trim() || (status === "published" ? "" : "Untitled job draft"),
      ...buildCanonicalJobContractPayload(effectiveCompensationMode, { includeCompensation }),
      location:
        workMode === "Remote"
          ? city.trim() || "Remote"
          : workMode && city.trim()
            ? city.trim()
            : null,
      experience_level: experienceText || null,
      platforms: selectedJobPlatforms,
      start_timeframe: startWithin || null,
      work_mode: workMode ? workMode.toLowerCase().replace("on-site", "onsite") : null,
      about_channel: about.trim() || null,
      responsibilities: splitLines(responsibilities),
      requirements: splitLines(requirements),
      application_requirements: sanitizedApplicationRequirements,
      content_niches: normalizeCreatorContextList(contentNiches),
      content_genres: normalizeCreatorContextList(contentGenres),
      formats_hired_for: normalizeCreatorContextList(formatsHiredFor),
      reference_videos: referenceVideosForPayload.map(serializeReferenceVideo),
      tags,
      youtube_channel_id: selectedYouTubeChannelId || null,
      channel_name: normalizedChannelName,
      channel_logo_url: activeHiringAvatarUrl,
      channel_subscribers: normalizedChannelSubscribers,
      posted_platform: selectedPlatform,
      posted_youtube_channel_id: selectedYouTubeChannelId || null,
      hiring_identity_id: selectedHiringIdentityId || null,
      status,
    };
    if (applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)) {
      payload.how_to_apply = howToApply.trim() || null;
    }
    if (languages.length) payload.languages = languages;
    return payload;
  };

  const trackPersistedImportEdits = (payload: BackendCreateJobPayload) => {
    if (!importContext) return;
    importContext.draft.fields.forEach((field) => {
      const nativeField = nativeFieldForImport(field.field_path);
      if (
        !nativeField ||
        !manuallyChangedImportFields.has(nativeField) ||
        !["contextual_inference", "semantic_inference"].includes(field.decision_origin)
      ) {
        return;
      }
      const removed = jobImportValueWasRemoved(payload[nativeField]);
      const eventKey = `${nativeField}:${removed ? "removed" : "changed"}`;
      if (importEditAnalyticsRef.current.has(eventKey)) return;
      importEditAnalyticsRef.current.add(eventKey);
      trackJobImportEvent("job_import.inferred_value_changed", {
        origin: field.decision_origin,
        confidence: field.decision_confidence ?? undefined,
        removed,
      });
    });
  };

  const payloadForWrite = (complete: BackendCreateJobPayload): Partial<BackendCreateJobPayload> => {
    if (!draftId) return complete;
    const partial: Partial<BackendCreateJobPayload> = { status: complete.status };
    dirtyPayloadKeysRef.current.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(complete, key)) {
        Object.assign(partial, { [key]: complete[key] });
      }
    });
    return partial;
  };

  const publishJob = async () => {
    if (isSubmitting) return;

    setSubmitError(null);
    const effectiveCompensationMode: CompensationMode | null = compensationMode || null;
    const completePayload = buildCompleteJobPayload("published", effectiveCompensationMode);
    const backendPayload = payloadForWrite(completePayload);

    if (isLocalMocksEnabled()) {
      setSubmitError("Publishing requires the CreatorJobs backend so the listing contract can be validated.");
      return;
    }
    if (sessionStatus !== "authenticated") {
      setSubmitError("Sign in before posting a job.");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await withFreshBackendToken(async (token) => {
        const existingTargetId = draftId || partialImportTargetJobRef.current;
        const saved = existingTargetId
          ? updateJob(token, existingTargetId, backendPayload)
          : createJob(backendPayload as BackendCreateJobPayload, { accessToken: token });
        const resolved = await saved;
        if (partialImportDraftId && resolved?.id) {
          partialImportTargetJobRef.current = String(resolved.id);
          await attachJobImportDraft(token, partialImportDraftId, String(resolved.id));
        }
        return resolved;
      });
      if (created?.id) {
        trackPersistedImportEdits(completePayload);
        if (importContext) {
          trackJobImportEvent("job_import.draft_published", {
            explicitCount: importContext.draft.fields.filter(
              (field) => field.decision_origin === "explicit"
            ).length,
            inferredCount: importContext.draft.fields.filter((field) =>
              ["contextual_inference", "semantic_inference"].includes(
                field.decision_origin
              )
            ).length,
            reviewCount: importContext.draft.fields.filter(
              (field) => field.needs_review
            ).length,
          });
        }
        window.location.assign("/jobs?posted=1");
        return;
      }
      setSubmitError("The job was created, but the response was incomplete.");
    } catch (error) {
      if (error instanceof BackendRequestError && error.fieldErrors) {
        const fields = Object.keys(error.fieldErrors);
        const firstField = fields[0] || "title";
        const targetStep = screenForFieldError(firstField);
        setDomainErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors).map(([field, messages]) => [field, messages[0] || error.message])
          )
        );
        if (fields.includes("primary_role_id") || fields.includes("role_specialization")) {
          setBasicsErrors((previous) => Array.from(new Set([...previous, "role"])));
        }
        setDirection(STEPS.indexOf(targetStep) < STEPS.indexOf(step) ? "back" : "forward");
        setStep(targetStep);
        focusQualityTarget(`job-${firstField.replaceAll("_", "-")}`);
        const firstMessage = Object.values(error.fieldErrors).flat()[0];
        setSubmitError(firstMessage || error.message);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Failed to post job to backend.");
      }
      console.error("External backend create failed", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // After publish validation jumps to a step, pinpoint the problem by scrolling
  // the first invalid field into view and focusing it (the step must render first).
  const focusFirstInvalidField = () => {
    if (typeof window === "undefined") return;
    const requestId = ++focusRequestRef.current;
    const delays = [60, 360, 680];
    const tryFocus = (attempt: number) => {
      if (focusRequestRef.current !== requestId) return;
      // Highest invalid field in document order.
      const el = document.querySelector<HTMLElement>('form [aria-invalid="true"], [aria-invalid="true"]');
      if (!el) {
        if (attempt < delays.length - 1) {
          window.setTimeout(() => tryFocus(attempt + 1), delays[attempt + 1] - delays[attempt]);
        }
        return;
      }
      emphasizeField(el);
    };
    window.setTimeout(() => tryFocus(0), delays[0]);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setSubmitError(null);
    const basicsErrs = getBasicsErrors();
    if (basicsErrs.includes("identity")) {
      setBasicsErrors(basicsErrs);
      setDirection(STEPS.indexOf("role") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("role");
      setHiringIdentityModalOpen(true);
      setSubmitError("Fix the highlighted fields before publishing.");
      focusFirstInvalidField();
      return;
    }
    const basicsFieldErrs = basicsErrs.filter((key) => key !== "identity");
    if (basicsFieldErrs.length) {
      setBasicsErrors(basicsFieldErrs);
      const targetScreen = screenForBasicsError(basicsFieldErrs[0]);
      setDirection(STEPS.indexOf(targetScreen) < STEPS.indexOf(step) ? "back" : "forward");
      setStep(targetScreen);
      setSubmitError("Fix the highlighted fields before publishing.");
      focusFirstInvalidField();
      return;
    }
    setBasicsErrors([]);
    const domainIssues = validateJobPostingDomainForPublication(domain, {
      budgetUnit,
      engagementType,
    }).sort(
      (left, right) =>
        STEPS.indexOf(screenForFieldError(String(left.field))) -
        STEPS.indexOf(screenForFieldError(String(right.field)))
    );
    if (domainIssues.length) {
      const firstIssue = domainIssues[0];
      const targetScreen = screenForFieldError(String(firstIssue.field));
      setDomainErrors(
        Object.fromEntries(domainIssues.map((issue) => [String(issue.field), issue.message]))
      );
      setDirection(STEPS.indexOf(targetScreen) < STEPS.indexOf(step) ? "back" : "forward");
      setStep(targetScreen);
      setSubmitError(firstIssue.message);
      focusQualityTarget(firstIssue.target);
      return;
    }
    setDomainErrors({});
    const hasCompleteTurnaround = Boolean(
      turnaround?.value && turnaround.unit && turnaround.basis
    );
    const needsWeeklyHours =
      engagementType === "part_time" ||
      engagementType === "full_time" ||
      engagementType === "fixed_term" ||
      engagementType === "internship";
    const arrangementErrors: Record<string, string> = {};
    if (!engagementType) {
      arrangementErrors.engagement_type = "Choose an engagement type.";
    }
    if (needsWeeklyHours && !expectedWeeklyHoursMin) {
      arrangementErrors.expected_weekly_hours_min = "Add the minimum expected weekly hours.";
    }
    if (engagementType === "one_time_project" && !hasCompleteTurnaround) {
      arrangementErrors.turnaround_value = "Complete the turnaround value, unit, and basis.";
    }
    if (
      (engagementType === "ongoing_freelance" || engagementType === "retainer") &&
      !expectedWeeklyHoursMin &&
      !hasCompleteTurnaround
    ) {
      arrangementErrors.expected_weekly_hours_min =
        "Add expected weekly hours or a complete turnaround expectation.";
    }
    if (Object.keys(arrangementErrors).length) {
      setDomainErrors((previous) => ({ ...previous, ...arrangementErrors }));
      setDirection(STEPS.indexOf("arrangement") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("arrangement");
      setSubmitError("Add the engagement, weekly-hours, or turnaround details required for this job.");
      focusQualityTarget("job-engagement-type");
      return;
    }
    if (about.trim().length < 20) {
      setContentErrors({ about: "Add at least 20 characters about the brand." });
      setDirection(STEPS.indexOf("about") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("about");
      setSubmitError("Add the missing details before publishing.");
      focusFirstInvalidField();
      return;
    }
    if (!splitLines(responsibilities).length || !splitLines(requirements).length) {
      setDirection(STEPS.indexOf("about") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("about");
      setSubmitError("Add at least one responsibility and one requirement before publishing.");
      return;
    }
    const referenceError = getRefUrlError();
    if (referenceError) {
      setRefUrlError(referenceError);
      setDirection(STEPS.indexOf("references") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("references");
      setSubmitError("Fix the highlighted fields before publishing.");
      focusFirstInvalidField();
      return;
    }
    setRefUrlError(null);
    if (!noFirstMessageRequirements && applicationRequirements.length === 0) {
      setFirstMessageError(
        "Choose what applicants must include with their first message, or select “No specific first-message requirements.”"
      );
      setDirection(STEPS.indexOf("apply") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("apply");
      return;
    }
    if (
      !noFirstMessageRequirements &&
      applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) &&
      !howToApply.trim()
    ) {
      setFirstMessageError("Add the screening question or remove it.");
      setDirection(STEPS.indexOf("apply") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("apply");
      return;
    }
    if (isHiringAuthorizationBlockingPublish) {
      setSubmitError("This job can be completed as a draft, but it will not go live until authorization is verified.");
      return;
    }
    if (missingJobQualityItems.length) {
      setPublishReadyOpen(true);
      return;
    }

    await publishJob();
  };

  const onSaveDraft = async () => {
    if (isSubmitting) return;
    if (isLocalMocksEnabled()) {
      setSubmitError("Job drafts require backend sign-in so they can be resumed later.");
      return;
    }
    if (sessionStatus !== "authenticated") {
      setSubmitError("Sign in before saving a job draft.");
      return;
    }

    const rowIssues = validateRepeatableDomainRows(domain);
    if (rowIssues.length) {
      const firstIssue = rowIssues[0];
      const targetScreen = screenForFieldError(String(firstIssue.field));
      setDomainErrors(
        Object.fromEntries(rowIssues.map((issue) => [String(issue.field), issue.message]))
      );
      setDirection(STEPS.indexOf(targetScreen) < STEPS.indexOf(step) ? "back" : "forward");
      setStep(targetScreen);
      setSubmitError(firstIssue.message);
      focusQualityTarget(firstIssue.target);
      return;
    }

    const existingStatus = loadedJobStatus;
    const saveStatus: NonNullable<BackendCreateJobPayload["status"]> =
      draftId &&
      (existingStatus === "published" ||
        existingStatus === "paused" ||
        existingStatus === "closed" ||
        existingStatus === "archived")
        ? existingStatus
        : "draft";
    const completePayload = buildCompleteJobPayload(saveStatus, compensationMode || null);
    const backendPayload = payloadForWrite(completePayload);

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const saved = await withFreshBackendToken(async (token) => {
        const existingTargetId = draftId || partialImportTargetJobRef.current;
        const result = await (existingTargetId
          ? updateJob(token, existingTargetId, backendPayload)
          : createJob(backendPayload as BackendCreateJobPayload, { accessToken: token }));
        if (partialImportDraftId && result?.id) {
          partialImportTargetJobRef.current = String(result.id);
          await attachJobImportDraft(token, partialImportDraftId, String(result.id));
        }
        return result;
      });
      if (saved?.id) trackPersistedImportEdits(completePayload);
      const savedId = saved?.id || draftId;

      if (saveStatus === "published") {
        window.location.assign(`/jobs?updated=1${savedId ? `&jobId=${encodeURIComponent(String(savedId))}` : ""}`);
        return;
      }
      window.location.assign(
        `/drafts?saved=1&type=job${savedId ? `&draftId=${encodeURIComponent(String(savedId))}` : ""}`
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to save job draft.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateBasicsPreview = () => {
    const nextBudget =
      formatCompensationSummary({
        mode: compensationMode,
        minimum: budgetMin,
        maximum: budgetMax,
        currency: budgetCurrency,
        unit: budgetUnit,
        customUnit: budgetUnitCustom,
        note: budgetNote,
      }) || budgetIntentLabel(budgetIntent);

    // Whatever the recruiter wrote, shown as they wrote it. Reformatting it here
    // is how the rail once claimed a narrower requirement than the field held.
    const nextExperience = experienceLevel.trim() || "Any";

    let nextLocation = previewLocationText;
    if (workMode === "Remote") {
      nextLocation = city.trim() || "Remote";
    } else if (isCityRequired) {
      nextLocation = workMode;
      if (matchedCity) nextLocation = `${workMode} - ${matchedCity}`;
    }

    setPreviewBudgetText(nextBudget);
    setPreviewExperienceText(nextExperience);
    setPreviewLocationText(nextLocation);
  };

  const onSaveBasics = () => {
    updateBasicsPreview();
    setSavedBasics({
      title,
      budgetMin,
      budgetMax,
      budgetIntent,
      budgetUnit,
      budgetCurrency,
      compensationMode,
      budgetNote,
      budgetUnitCustom,
      workMode,
      city,
      experienceLevel,
      startWithin,
      platform,
      platforms: selectedJobPlatforms,
      platformName,
      platformAudience,
      contentNiches,
      contentGenres,
      formatsHiredFor,
      turnaround,
      engagementType,
      expectedWeeklyHoursMin,
      expectedWeeklyHoursMax,
      primaryRoleId,
      roleSpecialization,
      tools,
      languages,
    });
  };

  const onSaveContent = () => {
    setSavedContent({
      about,
      responsibilities,
      requirements,
      howToApply,
      applicationRequirements,
      noFirstMessageRequirements,
    });
  };

  const onSaveTags = () => {
    setSavedTags({ tags });
  };

  const onSaveReferenceVideos = () => {
    const error = getRefUrlError();
    if (error) {
      setRefUrlError(error);
      return false;
    }
    const cleanedActiveNotes = (refTimestampNotes || [])
      .map((note) => normalizeReferenceTimestampNote(note))
      .filter((note): note is ReferenceTimestampNote => Boolean(note));
    setRefUrlError(null);
    setRefTimestampNotes(cleanedActiveNotes);
    setSavedRefs({
      refVideos: referenceVideosForPayload,
      refTitle,
      refUrl,
      refWhatToReference,
      refTimestampNotes: cleanedActiveNotes,
    });
    return true;
  };

  const canSaveContent =
    about !== savedContent.about ||
    responsibilities !== savedContent.responsibilities ||
    requirements !== savedContent.requirements ||
    howToApply !== savedContent.howToApply ||
    noFirstMessageRequirements !== savedContent.noFirstMessageRequirements ||
    JSON.stringify(applicationRequirements) !== JSON.stringify(savedContent.applicationRequirements);

  const canSaveTags = JSON.stringify(tags) !== JSON.stringify(savedTags.tags);

  const canSaveReferenceVideos =
    JSON.stringify(referenceVideosForPayload) !== JSON.stringify(savedRefs.refVideos) ||
    refTitle !== savedRefs.refTitle ||
    refUrl !== savedRefs.refUrl ||
    refWhatToReference !== savedRefs.refWhatToReference ||
    JSON.stringify(refTimestampNotes) !== JSON.stringify(savedRefs.refTimestampNotes);

  const canSaveCoreBasics =
    title !== savedBasics.title ||
    budgetMin !== savedBasics.budgetMin ||
    budgetMax !== savedBasics.budgetMax ||
    budgetIntent !== savedBasics.budgetIntent ||
    budgetUnit !== savedBasics.budgetUnit ||
    budgetCurrency !== savedBasics.budgetCurrency ||
    compensationMode !== savedBasics.compensationMode ||
    budgetNote !== savedBasics.budgetNote ||
    budgetUnitCustom !== savedBasics.budgetUnitCustom ||
    primaryRoleId !== savedBasics.primaryRoleId ||
    roleSpecialization !== savedBasics.roleSpecialization ||
    workMode !== savedBasics.workMode ||
    city !== savedBasics.city ||
    experienceLevel !== savedBasics.experienceLevel ||
    platform !== savedBasics.platform ||
    JSON.stringify(selectedJobPlatforms) !== JSON.stringify(savedBasics.platforms) ||
    platformName !== savedBasics.platformName ||
    platformAudience !== savedBasics.platformAudience;

  const canSaveDetails =
    startWithin !== savedBasics.startWithin ||
    turnaround?.value !== savedBasics.turnaround?.value ||
    turnaround?.unit !== savedBasics.turnaround?.unit ||
    turnaround?.basis !== savedBasics.turnaround?.basis ||
    engagementType !== savedBasics.engagementType ||
    expectedWeeklyHoursMin !== savedBasics.expectedWeeklyHoursMin ||
    expectedWeeklyHoursMax !== savedBasics.expectedWeeklyHoursMax ||
    JSON.stringify(languages) !== JSON.stringify(savedBasics.languages);

  const canSaveCreatorContext =
    JSON.stringify(contentNiches) !== JSON.stringify(savedBasics.contentNiches) ||
    JSON.stringify(contentGenres) !== JSON.stringify(savedBasics.contentGenres) ||
    JSON.stringify(formatsHiredFor) !== JSON.stringify(savedBasics.formatsHiredFor) ||
    JSON.stringify(tools) !== JSON.stringify(savedBasics.tools) ||
    canSaveTags;

  const canSaveAbout =
    about !== savedContent.about ||
    responsibilities !== savedContent.responsibilities ||
    requirements !== savedContent.requirements;

  const canSaveApplicationRequirements =
    howToApply !== savedContent.howToApply ||
    noFirstMessageRequirements !== savedContent.noFirstMessageRequirements ||
    JSON.stringify(applicationRequirements) !== JSON.stringify(savedContent.applicationRequirements);

  const onSaveDetails = onSaveBasics;

  const onSaveCreatorContext = () => {
    onSaveBasics();
    onSaveTags();
  };

  const onSaveAbout = onSaveContent;

  const onSaveApplicationRequirements = onSaveContent;

  const hasNext = STEPS.indexOf(step) < STEPS.length - 1;
  const hasBack = STEPS.indexOf(step) > 0;
  const stepIndex = STEPS.indexOf(step);

  const goNext = (current: Step) => {
    const idx = STEPS.indexOf(current);
    if (idx >= STEPS.length - 1) return;
    const basicsGateKeys = SCREEN_BASICS_GATE[current];
    if (basicsGateKeys) {
      const allErrs = getBasicsErrors();
      const errs = allErrs.filter((key) => basicsGateKeys.includes(key));
      if (errs.length) {
        setBasicsErrors(allErrs);
        if (errs.includes("identity")) {
          setHiringIdentityModalOpen(true);
        }
        updateBasicsPreview();
        return;
      }
      setBasicsErrors((previous) => previous.filter((key) => !basicsGateKeys.includes(key)));
      updateBasicsPreview();
    }
    if (current === "about") {
      if (about.trim().length < 20) {
        setContentErrors({ about: "Add at least 20 characters about the brand." });
        return;
      }
      setContentErrors({});
    }
    if (
      current === "apply" &&
      applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) &&
      !howToApply.trim()
    ) {
      setFirstMessageError("Add the screening question or remove it.");
      return;
    }
    setDirection("forward");
    setStep(STEPS[idx + 1]);
  };

  const goBack = (current: Step) => {
    const idx = STEPS.indexOf(current);
    if (idx <= 0) return;
    setDirection("back");
    setStep(STEPS[idx - 1]);
  };

  /* Import questions are resolved in DraftAssistantCanvas before handoff.
   * An imported native draft uses the standard Post Job editor from here. */
  const hiringIdentityPanel = (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3 elev-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <HiringIdentityAvatar
            name={activeHiringDisplayName}
            imageUrl={activeHiringAvatarUrl}
            platform={activeHiringPlatform}
            className="h-10 w-10"
          />
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-subtle">
              <Icon name="briefcase" className="h-3.5 w-3.5 text-subtle" />
              <span>Hiring for</span>
            </p>
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-sm font-semibold text-white/86">
              <span className="truncate">{activeHiringDisplayName}</span>
              <span
                role="img"
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${activeHiringStatusMeta.className}`}
                title={activeHiringStatusMeta.tooltip}
                aria-label={activeHiringStatusMeta.label}
              >
                <Icon name={activeHiringStatusMeta.icon} className="h-3 w-3" />
              </span>
            </p>
            {isHiringAuthorizationBlockingPublish ? (
              <p className="mt-1 text-xs text-amber-100/72">
                This job can be completed as a draft, but it will not go live until authorization is verified.
              </p>
            ) : draftId ? (
              <p className="mt-1 text-xs text-subtle">Editing job draft.</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHiringIdentityModalOpen(true)}
            className="ui-press h-10 w-fit cursor-pointer rounded-xl border border-line-mid bg-raised px-3 text-xs font-semibold text-secondary transition-colors hover:border-line-strong hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
          >
            Change
          </button>
        </div>
      </div>
    </section>
  );

  if (sessionStatus === "loading" || draftLoading) {
    return <PageLoading blocks={4} />;
  }

  const selectedRoleName =
    roles.find((role) => role.id === primaryRoleId)?.name ||
    loadedJobRef.current?.primary_role_name_snapshot ||
    null;
  const previewProps = {
    title,
    employerName: activeHiringDisplayName,
    employerAvatarUrl: activeHiringAvatarUrl,
    employerVerificationStatus: activeHiringVerificationStatus || null,
    roleName: selectedRoleName,
    roleSpecialization,
    employerContext: domain.employerContextType,
    platform: platform || selectedJobPlatforms[0] || null,
    compensationMode,
    budgetMin,
    budgetMax,
    budgetCurrency,
    budgetUnit: legacyBudgetUnit ? undefined : budgetUnit || undefined,
    legacyBudgetUnit,
    budgetUnitCustom,
    budgetNote,
    engagementType,
    workMode,
    location: city.trim() || (workMode === "Remote" ? "Remote" : ""),
    expectedWeeklyHoursMin,
    expectedWeeklyHoursMax,
    turnaround,
    about,
    responsibilities,
    legacyRequirements: requirements,
    tools,
    languages,
    applicationRequirements,
    howToApply: domain.howToApply,
    tags,
    contentNiches,
    contentGenres,
    formatsHiredFor,
    referenceVideos: referenceVideosForPayload,
    domain,
  } as const;

  return (
    <main className="surface-canvas min-h-screen text-ink">
      <HiringIdentityModal
        open={hiringIdentityModalOpen}
        onClose={() => setHiringIdentityModalOpen(false)}
        backendIdentities={hiringIdentities}
        connectedIdentities={connectedHiringIdentityOptions}
        selectedChoice={selectedHiringChoice}
        onConfirmExisting={confirmHiringIdentityChoice}
        onCreateRepresentedIdentity={createRepresentedHiringIdentity}
        onRemoveBackendIdentity={removeBackendHiringIdentity}
        onCheckRepresentedIdentityVerification={checkRepresentedHiringIdentityVerification}
        sessionDisplayName={session?.user?.name || session?.user?.username || null}
      />
      <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-6">
          <div className="min-w-0 space-y-6">
            {hiringIdentityPanel}

            <details ref={mobilePreviewRef} className="rounded-2xl border border-line bg-panel elev-1 xl:hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/60">
                <span className="inline-flex items-center gap-2">
                  <Icon name="eye" className="h-4 w-4 text-muted" />
                  Candidate preview
                </span>
                <span aria-hidden="true" className="text-muted">⌄</span>
              </summary>
              <div className="chat-scroll max-h-[72dvh] overflow-y-auto overscroll-contain border-t border-line p-3 sm:p-4">
                <RecruiterJobPreview {...previewProps} previewMode="full" />
              </div>
            </details>

            <PostJobForm
              step={step}
              direction={direction}
              currentStepNumber={stepIndex + 1}
              totalSteps={STEPS.length}
              hasNext={hasNext}
              hasBack={hasBack}
              onNext={goNext}
              onBack={goBack}
              basicsErrors={basicsErrorMap}
              title={title}
              onTitleChange={(next) => {
                setTitle(next);
                markPayloadDirty("title");
              }}
              roles={roles}
              rolesLoading={rolesLoading}
              rolesError={rolesError}
              onRetryRoles={() => void loadCreatorRoles()}
              primaryRoleId={primaryRoleId}
              roleSpecialization={roleSpecialization}
              onPrimaryRoleIdChange={(next) => {
                setPrimaryRoleId(next);
                const role = roles.find((item) => item.id === next);
                if (role?.slug !== "other-creator-role" && role?.name !== "Other Creator Role") {
                  setRoleSpecialization("");
                }
                markPayloadDirty("primary_role_id", "role_specialization");
              }}
              onRoleSpecializationChange={(next) => {
                setRoleSpecialization(next);
                markPayloadDirty("role_specialization");
              }}
              workMode={workMode}
              onWorkModeChange={(next) => {
                // The city input means two different things either side of
                // Remote: for On-site and Hybrid it is where the work happens,
                // and for Remote it is an optional restriction on where a
                // candidate may live. Carrying a value across that boundary
                // keeps the text and silently changes what it claims — a job
                // that moved from Hybrid in Kolkata to Remote would go on
                // telling candidates Kolkata, a city nobody now has to be in.
                // Crossing the boundary clears it; moving between On-site and
                // Hybrid does not, because there the meaning is the same.
                const crossesRemoteBoundary =
                  (next === "Remote") !== (workMode === "Remote");
                if (crossesRemoteBoundary && city) setCity("");
                setWorkMode(next);
                markPayloadDirty("work_mode", "location");
              }}
              city={city}
              onCityChange={(next) => {
                setCity(next);
                markPayloadDirty("location");
              }}
              budgetMin={budgetMin}
              budgetMax={budgetMax}
              budgetIntent={budgetIntent}
              budgetUnit={budgetUnit}
              budgetCurrency={budgetCurrency}
              compensationMode={compensationMode}
              budgetNote={budgetNote}
              budgetUnitCustom={budgetUnitCustom}
              onBudgetMinChange={(next) => {
                setBudgetMin(next);
                markPayloadDirty("budget_amount", "budget_max", "compensation_mode");
                if (!next && !budgetMax) setBudgetIntent("");
                if (next && !compensationMode) setCompensationMode("fixed");
              }}
              onBudgetMaxChange={(next) => {
                setBudgetMax(next);
                markPayloadDirty("budget_max", "compensation_mode");
                if (!budgetMin && !next) setBudgetIntent("");
                if (next) setCompensationMode("range");
              }}
              onBudgetIntentChange={(next) => {
                setBudgetIntent(next);
                markPayloadDirty("compensation_mode", "budget_note");
              }}
              onBudgetUnitChange={(next) => {
                setBudgetUnit(next);
                setLegacyBudgetUnit(null);
                markPayloadDirty("budget_unit", "budget_unit_custom");
              }}
              onBudgetCurrencyChange={(next) => {
                setBudgetCurrency(next);
                markPayloadDirty("budget_currency");
              }}
              onCompensationModeChange={(next) => {
                setCompensationMode(next);
                markPayloadDirty("compensation_mode", "budget_amount", "budget_max");
                if (next === "fixed") setBudgetMax("");
                if (next === "negotiable") {
                  setBudgetMin("");
                  setBudgetMax("");
                }
              }}
              onBudgetNoteChange={(next) => {
                setBudgetNote(next);
                markPayloadDirty("budget_note");
              }}
              onBudgetUnitCustomChange={(next) => {
                setBudgetUnitCustom(next);
                markPayloadDirty("budget_unit_custom");
              }}
              experienceLevel={experienceLevel}
              onExperienceLevelChange={(next) => {
                setExperienceLevel(next);
                markPayloadDirty("experience_level");
              }}
              startWithin={startWithin}
              onStartWithinChange={(next) => {
                setStartWithin(next);
                markPayloadDirty("start_timeframe");
              }}
              platforms={selectedJobPlatforms}
              onPlatformToggle={togglePlatformSelection}
              contentNiches={contentNiches}
              onContentNichesChange={(next) => {
                setContentNiches(normalizeCreatorContextList(next));
                markPayloadDirty("content_niches");
              }}
              contentGenres={contentGenres}
              onContentGenresChange={(next) => {
                setContentGenres(normalizeCreatorContextList(next));
                markPayloadDirty("content_genres");
              }}
              formatsHiredFor={formatsHiredFor}
              onFormatsHiredForChange={(next) => {
                setFormatsHiredFor(normalizeCreatorContextList(next));
                markPayloadDirty("formats_hired_for");
              }}
              turnaround={turnaround}
              onTurnaroundChange={(next) => {
                setTurnaround(next);
                markPayloadDirty("turnaround_value", "turnaround_unit", "turnaround_basis");
                setDomainErrors((previous) => {
                  const updated = { ...previous };
                  delete updated.turnaround_value;
                  delete updated.turnaround_unit;
                  delete updated.turnaround_basis;
                  return updated;
                });
              }}
              engagementType={engagementType}
              onEngagementTypeChange={(next) => {
                setEngagementType(next);
                markPayloadDirty("engagement_type");
                setDomainErrors((previous) => {
                  const updated = { ...previous };
                  delete updated.engagement_type;
                  return updated;
                });
              }}
              expectedWeeklyHoursMin={expectedWeeklyHoursMin}
              expectedWeeklyHoursMax={expectedWeeklyHoursMax}
              onExpectedWeeklyHoursMinChange={(next) => {
                setExpectedWeeklyHoursMin(next);
                markPayloadDirty("expected_weekly_hours_min");
                setDomainErrors((previous) => {
                  const updated = { ...previous };
                  delete updated.expected_weekly_hours_min;
                  return updated;
                });
              }}
              onExpectedWeeklyHoursMaxChange={(next) => {
                setExpectedWeeklyHoursMax(next);
                markPayloadDirty("expected_weekly_hours_max");
                setDomainErrors((previous) => {
                  const updated = { ...previous };
                  delete updated.expected_weekly_hours_max;
                  return updated;
                });
              }}
              tools={tools}
              onToolsChange={(next) => {
                setTools(next);
                setToolsConfirmed(true);
                setLegacyToolsNotCaptured(false);
                markPayloadDirty("required_tool_keys", "other_required_tools");
              }}
              languages={languages}
              onLanguagesChange={(next) => {
                setLanguages(next);
                markPayloadDirty("languages");
              }}
              about={about}
              responsibilities={responsibilities}
              requirements={requirements}
              howToApply={howToApply}
              onAboutChange={(next) => {
                setAbout(next);
                markPayloadDirty("about_channel");
              }}
              onResponsibilitiesChange={(next) => {
                setResponsibilities(next);
                markPayloadDirty("responsibilities");
              }}
              onRequirementsChange={(next) => {
                setRequirements(next);
                markPayloadDirty("requirements");
              }}
              onHowToApplyChange={(next) => {
                setHowToApply(next);
                markPayloadDirty("how_to_apply", "application_requirements");
              }}
              applicationRequirements={applicationRequirements}
              onApplicationRequirementsChange={(next) => {
                setApplicationRequirements(next);
                markPayloadDirty("application_requirements");
              }}
              noFirstMessageRequirements={noFirstMessageRequirements}
              onNoFirstMessageRequirementsChange={(next) => {
                setNoFirstMessageRequirements(next);
                markPayloadDirty("application_requirements");
              }}
              firstMessageError={firstMessageError || undefined}
              tagInput={tagInput}
              tags={tags}
              onTagInputChange={setTagInput}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              refTitle={refTitle}
              refUrl={refUrl}
              refWhatToReference={refWhatToReference}
              refTimestampNotes={refTimestampNotes || []}
              refUrlError={refUrlError || undefined}
              refVideos={refVideos}
              onRefTitleChange={(next) => {
                setRefTitle(next);
                markPayloadDirty("reference_videos");
              }}
              onRefUrlChange={(next) => {
                setRefUrl(next);
                markPayloadDirty("reference_videos");
              }}
              onRefWhatToReferenceChange={(next) => {
                setRefWhatToReference(next);
                markPayloadDirty("reference_videos");
              }}
              onRefTimestampNotesChange={(next) => {
                setRefTimestampNotes(next);
                markPayloadDirty("reference_videos");
              }}
              onAddRefVideo={addRefVideo}
              onRemoveRefVideo={removeRefVideo}
              onUpdateRefVideo={updateRefVideo}
              onSubmit={onSubmit}
              onSaveBasics={onSaveBasics}
              onSaveDetails={onSaveDetails}
              onSaveCreatorContext={onSaveCreatorContext}
              onSaveContent={onSaveContent}
              onSaveAbout={onSaveAbout}
              onSaveApplicationRequirements={onSaveApplicationRequirements}
              onSaveReferenceVideos={onSaveReferenceVideos}
              onSaveDraft={() => void onSaveDraft()}
              canSaveBasics={canSaveCoreBasics}
              canSaveDetails={canSaveDetails}
              canSaveCreatorContext={canSaveCreatorContext}
              canSaveContent={canSaveContent}
              canSaveAbout={canSaveAbout}
              canSaveApplicationRequirements={canSaveApplicationRequirements}
              canSaveReferenceVideos={canSaveReferenceVideos}
              contentErrors={contentErrors}
              submitError={submitError}
              isSubmitting={isSubmitting}
              isRepresentedHiringIdentity={activeHiringIsRepresented}
              publishDisabled={false}
              saveDraftLabel={loadedJobStatus === "published" ? "Save changes" : "Save draft"}
              publishLabel={loadedJobStatus === "published" ? "Update listing" : "Publish job"}
              domain={domain}
              onDomainChange={updateDomain}
              domainErrors={domainErrors}
              listingSchemaVersion={loadedSchemaVersion}
              selectedRoleName={selectedRoleName}
              legacyToolsNotCaptured={legacyToolsNotCaptured}
              legacyBudgetUnit={legacyBudgetUnit}
              reviewPreview={<RecruiterJobPreview {...previewProps} previewMode="full" />}
            />
          </div>

          <div ref={desktopPreviewRef} className="sticky top-6 hidden space-y-5 xl:block">
            <RecruiterJobPreview {...previewProps} previewMode="rail" />
            <PostJobSafety />
            <RecommendedChecklistPopup
              items={jobQualityItems}
              onSelect={goToJobQualityItem}
              ariaLabel="Recommended job listing details"
              layout="inline"
            />
          </div>
        </div>
      </div>
      <PublishReadyDialog
        open={publishReadyOpen}
        missing={missingJobQualityItems}
        onClose={() => setPublishReadyOpen(false)}
        onAddDetails={() => {
          const firstMissing = missingJobQualityItems[0];
          if (firstMissing) goToJobQualityItem(firstMissing);
        }}
        onPublishAnyway={() => {
          setPublishReadyOpen(false);
          void publishJob();
        }}
        publishButtonRef={publishAnywayButtonRef}
      />
    </main>
  );
}
