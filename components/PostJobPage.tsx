"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendCreateJobPayload,
  BackendHiringIdentity,
  BackendHiringIdentityPlatform,
  BackendHiringIdentityVerificationResponse,
  BackendMeYouTubeChannel,
  checkMyHiringIdentityVerification,
  completeLaunchFreeCheckout,
  createMyHiringIdentity,
  createJob,
  deleteMyHiringIdentity,
  exchangeGoogleOAuthForBackend,
  listMyBackendJobs,
  isBackendAuthError,
  isLocalMocksEnabled,
  listMyHiringIdentities,
  listMyYouTubeChannels,
  refreshMyYouTubeChannels,
  requestMyHiringIdentityVerification,
  updateJob,
  upsertGoogleOAuthForMe,
} from "../lib/backendClient";
import { Job, ReferenceTimestampNote, ReferenceVideo, StartTimeframe } from "../lib/types";
import { formatBudgetPreview, formatExperiencePreview, formatSubsInput } from "../lib/format";
import { getJobDraftCompletion } from "../lib/draftCompletion";
import { INDIA_CITIES } from "../lib/indiaCities";
import PostJobForm from "./post-job/PostJobForm";
import PreviewCard from "./post-job/PreviewCard";
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

type WorkMode = "" | "Remote" | "Hybrid" | "On-site";
type TurnaroundUnit = "hours" | "days" | "weeks";
type Turnaround = { value: number; unit: TurnaroundUnit } | null;
type BudgetIntent = "" | "range" | "flexible";
type JobPlatform = IdentityPlatform | "";

type Step =
  | "basics"
  | "details"
  | "creatorContext"
  | "toolsTags"
  | "about"
  | "applicationRequirements"
  | "referenceVideos";

const STEPS: Step[] = [
  "basics",
  "details",
  "about",
  "creatorContext",
  "toolsTags",
  "applicationRequirements",
  "referenceVideos",
];

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

type SavedBasics = {
  title: string;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: "per project" | "per month";
  budgetIntent: BudgetIntent;
  workMode: WorkMode;
  city: string;
  expMin: string;
  expMax: string;
  startWithin: StartTimeframe | "";
  platform: JobPlatform;
  platforms: IdentityPlatform[];
  platformName: string;
  platformAudience: string;
  contentNiches: string[];
  contentGenres: string[];
  formatsHiredFor: string[];
  turnaround: Turnaround;
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
        <img src={imageUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
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
    <div className="ui-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hiring-identity-modal-title"
        className="ui-modal-panel w-full max-w-[620px] overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#101014] shadow-[0_34px_90px_-36px_rgba(0,0,0,1)]"
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
                    <div
                      key={`${item.choice.source}-${item.choice.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDraftChoice(item.choice)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setDraftChoice(item.choice);
                        }
                      }}
                      className={tileClass(active)}
                    >
                      {item.removable ? (
                        <span className="absolute right-3 top-3 z-10">
                          <button
                            type="button"
                            aria-label={`Remove ${item.name}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void removeSavedIdentity(item.choice.id);
                            }}
                            disabled={removingIdentityId === item.choice.id}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/44 transition-colors hover:border-white/18 hover:bg-black/45 hover:text-white/72 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <Icon name="x" className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : null}
                      {active ? (
                        <span className="absolute left-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/18 bg-white text-black">
                          <Icon name="check" className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                      <HiringIdentityAvatar name={item.name} imageUrl={item.imageUrl} platform={item.platform} />
                      <span className="max-w-full">
                        <span className="line-clamp-2 text-sm font-semibold leading-snug text-white/88">{item.name}</span>
                        {item.subline ? <span className="mt-1 block truncate text-xs text-white/48">{item.subline}</span> : null}
                        {item.status ? <span className="mt-1 block text-[11px] text-white/42">{item.status}</span> : null}
                      </span>
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
                <p className="mt-4 text-sm text-white/48">Connect or add the channel/page this job represents.</p>
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
                  className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/36"
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
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition-colors placeholder:text-white/32 focus:border-white/28 focus:bg-black/24"
              />
              {urlError ? <p className="mt-2 text-sm text-amber-100/82">{urlError}</p> : null}
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
                  className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/36"
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
                {resolved.followersText ? <p className="mt-1 text-sm text-white/44">{resolved.followersText}</p> : null}
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
                    <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
                      Coming soon
                    </span>
                  </div>
                  <span className="mt-1 block text-sm text-white/45">
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
                        className="shrink-0 text-base leading-none text-white/35 transition-transform group-hover/code:translate-x-0.5"
                      >
                        →
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-1 block text-sm text-white/52">
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
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-white/38">Your public code</p>
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
                    <p className="mt-1 text-xs text-white/38">Expires {verificationExpiresText}</p>
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
                      className="ui-press h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/36"
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
              {verificationError ? <p className="mt-4 text-sm leading-6 text-amber-100/82">{verificationError}</p> : null}
              <p className="mt-4 text-sm leading-6 text-white/58">
                You can proceed with the job listing. It will go live after access to this channel is confirmed.
              </p>
              {urlError ? <p className="mt-2 text-sm text-amber-100/82">{urlError}</p> : null}
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
                  className="ui-press h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/36"
                >
                  {createLoading ? "Saving…" : "Continue to job post"}
                </button>
              </div>
              {sessionDisplayName ? (
                <p className="mt-3 text-right text-[11px] text-white/34">Posting as {sessionDisplayName}</p>
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
  basics: { step: "basics" },
  budget: { step: "basics" },
  identity: { step: "basics" },
  tools: { step: "toolsTags", target: "job-tools" },
  creatorContext: { step: "creatorContext", target: "job-content-niches" },
  contentNiches: { step: "creatorContext", target: "job-content-niches" },
  contentGenres: { step: "creatorContext", target: "job-content-genres" },
  formatsHiredFor: { step: "creatorContext", target: "job-formats-hired-for" },
  experience: { step: "basics", target: "job-experience" },
  timeline: { step: "details" },
  start: { step: "details" },
  turnaround: { step: "details" },
  responsibilities: { step: "about", target: "job-responsibilities" },
  requirements: { step: "about", target: "job-requirements" },
  about: { step: "about", target: "job-description" },
  tags: { step: "toolsTags", target: "job-tags" },
  media: { step: "referenceVideos", target: "job-reference-video" },
  referenceVideos: { step: "referenceVideos", target: "job-reference-video" },
  howToApply: { step: "applicationRequirements", target: "job-first-message" },
  "job-first-message": { step: "applicationRequirements", target: "job-first-message" },
  applyReferences: { step: "applicationRequirements", target: "job-first-message" },
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
  if (!open) return null;

  return (
    <div className="ui-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-publish-ready-title"
        className="ui-modal-panel w-full max-w-[520px] rounded-[28px] border border-white/[0.1] bg-[#101014] p-6 shadow-[0_34px_90px_-36px_rgba(0,0,0,1)]"
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
                <Icon name="plus" className="h-3.5 w-3.5 text-white/35" />
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
  const { data: session, status: sessionStatus } = useSession();
  const connectParam = searchParams.get("yt_connect");
  const draftId = searchParams.get("draftId") || "";
  const autoConnectHandledRef = useRef(false);
  const tokenRecoveryPromiseRef = useRef<Promise<string | null> | null>(null);
  const [step, setStep] = useState<Step>("basics");
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const [title, setTitle] = useState("");

  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [budgetUnit, setBudgetUnit] = useState<"per project" | "per month">("per project");
  const [budgetIntent, setBudgetIntent] = useState<BudgetIntent>("");

  const [workMode, setWorkMode] = useState<WorkMode>("");
  const [city, setCity] = useState("");

  const [expMin, setExpMin] = useState("");
  const [expMax, setExpMax] = useState("");

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
  const [tools, setTools] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);

  const [verified, setVerified] = useState(false);

  const [about, setAbout] = useState("");
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
    budgetUnit: "per project",
    budgetIntent: "",
    workMode: "",
    city: "",
    expMin: "",
    expMax: "",
    startWithin: "",
    platform: "",
    platforms: [],
    platformName: "",
    platformAudience: "",
    contentNiches: [],
    contentGenres: [],
    formatsHiredFor: [],
    turnaround: null,
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
    Array<"title" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode">
  >([]);
  const [hiringIdentities, setHiringIdentities] = useState<BackendHiringIdentity[]>([]);
  const [selectedHiringIdentityId, setSelectedHiringIdentityId] = useState<string>("");
  const [localPendingHiringIdentity, setLocalPendingHiringIdentity] =
    useState<LocalPendingHiringIdentity | null>(null);
  const [contentNiches, setContentNiches] = useState<string[]>([]);
  const [contentGenres, setContentGenres] = useState<string[]>([]);
  const [formatsHiredFor, setFormatsHiredFor] = useState<string[]>([]);
  const [hiringIdentityModalOpen, setHiringIdentityModalOpen] = useState(!draftId);
  const [resolvedBackendAccessToken, setResolvedBackendAccessToken] = useState<string | undefined>();
  const [previewBudgetText, setPreviewBudgetText] = useState("");
  const [previewExperienceText, setPreviewExperienceText] = useState("");
  const [previewLocationText, setPreviewLocationText] = useState("");

  const subsText = useMemo(() => {
    if (identity?.followersCount != null) return formatSubsInput(String(identity.followersCount));
    return formatSubsInput(platformAudience);
  }, [identity?.followersCount, platformAudience]);

  const budgetText = useMemo(() => {
    return formatBudgetPreview(budgetMin, budgetMax, budgetUnit);
  }, [budgetMin, budgetMax, budgetUnit]);

  const experienceText = useMemo(() => {
    const min = expMin ? Number(expMin) : NaN;
    const max = expMax ? Number(expMax) : NaN;
    if (!expMin || !expMax || Number.isNaN(min) || Number.isNaN(max)) return "";
    if (max < min) return formatExperiencePreview(expMin, expMin);
    return formatExperiencePreview(expMin, expMax);
  }, [expMin, expMax]);

  const locationText = useMemo(() => {
    if (!workMode) return "";
    if (workMode === "Remote") return "Remote";
    const c = city.trim();
    return c ? `${workMode} - ${c}` : workMode;
  }, [workMode, city]);

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
  const hasFlexibleBudgetIntent = budgetIntent === "flexible" && !hasAnyBudgetInput;
  const hasCompensationIntent = hasValidBudgetRange || hasFlexibleBudgetIntent;
  const backendAccessToken = session?.backendAccessToken;
  const activeBackendAccessToken = resolvedBackendAccessToken || backendAccessToken;
  const oauthProviderAccountId = session?.user?.providerAccountId;
  const oauthAccessToken = session?.user?.accessToken;
  const oauthRefreshToken = session?.user?.refreshToken;
  const oauthExpiresAt = session?.user?.oauthExpiresAt;
  const oauthScope = session?.user?.oauthScope;
  const oauthEmail =
    session?.user?.email ||
    (typeof session?.user?.profile?.email === "string" ? session.user.profile.email : undefined);

  React.useEffect(() => {
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
    if (!draftId || sessionStatus !== "authenticated") return;
    let cancelled = false;
    const wholeNumberString = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value));
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? String(Math.round(parsed)) : "";
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
    const experienceParts = (value: unknown) => {
      const normalized = typeof value === "string" ? value : "";
      const match = normalized.match(/(\d+)\s*[–-]\s*(\d+)/);
      if (match) return { min: match[1], max: match[2] };
      const single = normalized.match(/(\d+)\+?/);
      if (single) return { min: single[1], max: single[1] };
      return { min: "", max: "" };
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
        const budgetMinValue = wholeNumberString(draft.budget_amount ?? draft.budget_min);
        const budgetMaxValue = wholeNumberString(draft.budget_max);
        const nextBudgetIntent: BudgetIntent = budgetMinValue && budgetMaxValue ? "range" : "";
        const experience = experienceParts(draft.experience_level);
        const nextWorkMode = normalizeWorkMode(draft.work_mode);
        const nextLocation = typeof draft.location === "string" ? draft.location : "";
        const nextPlatforms = normalizeJobPlatforms([
          ...(Array.isArray(draft.platforms) ? draft.platforms : []),
          draft.posted_platform,
        ]);
        const nextPlatform: JobPlatform = nextPlatforms[0] || "";

        setTitle(draft.title || "");
        setBudgetMin(budgetMinValue);
        setBudgetMax(budgetMaxValue);
        setBudgetUnit(draft.budget_unit === "per month" ? "per month" : "per project");
        setBudgetIntent(nextBudgetIntent);
        setWorkMode(nextWorkMode);
        setCity(nextWorkMode === "Remote" ? "" : nextLocation);
        setExpMin(experience.min);
        setExpMax(experience.max);
        setStartWithin((draft.start_timeframe as StartTimeframe) || "");
        setPlatform(nextPlatform);
        setPlatforms(nextPlatforms);
        setPlatformName(draft.channel_name || "");
        setPlatformAudience(draft.channel_subscribers != null ? String(draft.channel_subscribers) : "");
        setVerified(Boolean(draft.is_verified));
        setAbout(draft.about_channel || "");
        setResponsibilities((draft.responsibilities || []).join("\n"));
        setRequirements((draft.requirements || []).join("\n"));
        const restoredHowToApply = draft.how_to_apply || "";
        setHowToApply(restoredHowToApply);
        const restoredRequirements = sanitizeRequirementKeys(
          restoredHowToApply.trim()
            ? [...(draft.application_requirements || []), CUSTOM_INSTRUCTION_REQUIREMENT_KEY]
            : draft.application_requirements,
          "job"
        );
        setApplicationRequirements(restoredRequirements);
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
        setLanguages(
          Array.isArray(draft.languages)
            ? draft.languages.filter((lang): lang is string => typeof lang === "string" && lang.trim().length > 0)
            : []
        );
        setRefVideos(refsFrom(draft.reference_videos));
        setSelectedHiringIdentityId(typeof draft.hiring_identity_id === "string" ? draft.hiring_identity_id : "");
        setPreviewBudgetText(
          nextBudgetIntent === "range"
            ? formatBudgetPreview(budgetMinValue, budgetMaxValue, draft.budget_unit === "per month" ? "per month" : "per project")
            : ""
        );
        setPreviewLocationText(nextWorkMode === "Remote" ? "Remote" : nextWorkMode && nextLocation ? `${nextWorkMode} - ${nextLocation}` : "");
        setPreviewExperienceText(
          experience.min && experience.max ? formatExperiencePreview(experience.min, experience.max) : draft.experience_level || ""
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
          setVerified(preferred.verification_status === "VERIFIED");
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
    setVerified(nextIdentity.verification_status === "VERIFIED");
    setIdentity({
      platform: nextIdentity.platform === "INSTAGRAM" ? "instagram" : "youtube",
      brandId: nextIdentity.id,
      name: nextIdentity.display_name,
      imageUrl: nextIdentity.avatar_url || null,
      followersCount: null,
      handle: nextIdentity.handle || null,
      verifiedAt: nextIdentity.verified_at || new Date().toISOString(),
    });
  }, []);

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
      setVerified(true);
      setIdentityError(null);
    },
    [connectedHiringIdentityOptions, hiringIdentities, selectHiringIdentity]
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
        setVerified(false);
        setIdentity({
          platform: nextIdentity.platform === "INSTAGRAM" ? "instagram" : "youtube",
          brandId: localIdentity.id,
          name: nextIdentity.name,
          imageUrl: nextIdentity.logoUrl,
          followersCount: null,
          handle: nextIdentity.handle,
          verifiedAt: "",
        });
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
        setVerified(Boolean(identity) && platform === "youtube");
        setIdentityError(null);
      }
    },
    [identity, platform, selectedHiringIdentityId, sessionStatus, withFreshBackendToken]
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
    const errors: Array<"title" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode"> = [];
    if (!hasHiringForIdentity) errors.push("identity");
    if (title.trim().length < 3) errors.push("title");
    if (selectedJobPlatforms.length === 0) errors.push("platform");
    if (!workMode) errors.push("workMode");
    if (isCityRequired && !city.trim()) errors.push("city");
    if (isCityRequired && city.trim() && !matchedCity) errors.push("cityInvalid");
    if (!hasCompensationIntent && !hasAnyBudgetInput) {
      errors.push("budgetMissing");
    }
    if (hasAnyBudgetInput && !hasValidBudgetRange) {
      errors.push("budgetRange");
    }
    return errors;
  };

  const isBasicsErrorActive = useCallback(
    (key: "title" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode") => {
      if (key === "title") return title.trim().length < 3;
      if (key === "identity") return !hasHiringForIdentity;
      if (key === "platform") return selectedJobPlatforms.length === 0;
      if (key === "workMode") return !workMode;
      if (key === "city") return isCityRequired && !city.trim();
      if (key === "cityInvalid") return isCityRequired && city.trim() && !matchedCity;
      if (key === "budgetMissing") return !hasCompensationIntent && !hasAnyBudgetInput;
      if (key === "budgetRange") return hasAnyBudgetInput && !hasValidBudgetRange;
      return false;
    },
    [
      title,
      hasHiringForIdentity,
      selectedJobPlatforms,
      workMode,
      isCityRequired,
      city,
      matchedCity,
      hasCompensationIntent,
      hasAnyBudgetInput,
      hasValidBudgetRange,
    ]
  );

  const getBasicsErrorMessage = (
    key: "title" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode"
  ) => {
    switch (key) {
      case "title":
        return title.trim() ? "Job title must be at least 3 characters." : "Job title can't be empty.";
      case "platform":
        return "Platform is required.";
      case "workMode":
        return "Choose a work mode.";
      case "city":
        return "Add a city for hybrid or on-site work.";
      case "cityInvalid":
        return "Incorrect city name.";
      case "budgetMissing":
        return "Add a budget range or choose Flexible.";
      case "budgetRange":
        return "Add both min and max budget, with max at least min.";
      case "identity":
        return "Choose who you’re hiring for before posting.";
    }
  };

  const basicsErrorMap = (() => {
    const next: Partial<
      Record<"title" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode", string>
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
      setVerified(false);
      return;
    }
    if (selectedHiringIdentity) {
      setVerified(selectedHiringIdentity.verification_status === "VERIFIED");
      return;
    }
    setVerified(Boolean(identity) && platform === "youtube");
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
        prompt: "select_account",
      });
      return;
    }

    if (!activeBackendAccessToken) {
      setIdentityError("Your session is missing backend auth. Log in again.");
      return;
    }

    if (!oauthProviderAccountId || !oauthAccessToken) {
      await signIn("google", {
        callbackUrl: "/post-job?yt_connect=1",
        prompt: "consent",
      });
      return;
    }

    setIdentityLoading(true);
    setIdentityError(null);
    try {
      await withFreshBackendToken((token) => upsertGoogleOAuthForMe(token, {
        provider_account_id: oauthProviderAccountId,
        access_token: oauthAccessToken,
        refresh_token: oauthRefreshToken || null,
        expires_at: typeof oauthExpiresAt === "number" ? oauthExpiresAt : null,
        scope: typeof oauthScope === "string" ? oauthScope : null,
      }));
      const refreshed = await withFreshBackendToken((token) => refreshMyYouTubeChannels(token));
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
          prompt: "consent",
        });
        return;
      }
      setIdentityError(errorMessage);
    } finally {
      setIdentityLoading(false);
    }
  }, [
    applyVerifiedChannels,
    activeBackendAccessToken,
    oauthAccessToken,
    oauthExpiresAt,
    oauthProviderAccountId,
    oauthRefreshToken,
    oauthScope,
    sessionStatus,
    withFreshBackendToken,
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
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  const togglePlatformSelection = (next: IdentityPlatform) => {
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
    setRefTitle("");
    setRefUrl("");
    setRefWhatToReference("");
    setRefTimestampNotes([]);
  };

  const removeRefVideo = (idx: number) => {
    setRefVideos((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRefVideo = (idx: number, next: ReferenceVideo) => {
    setRefVideos((prev) => prev.map((video, i) => (i === idx ? next : video)));
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
    Boolean(expMin.trim() && expMax.trim()) ||
    Boolean(previewExperienceText.trim() && previewExperienceText.trim().toLowerCase() !== "any");

  const jobQualityItems: JobQualityItem[] = getJobDraftCompletion({
    title,
    platform: platform || selectedJobPlatforms[0] || "",
    hiringDisplayName: activeHiringDisplayName,
    hiringIdentityId: selectedHiringIdentityId || undefined,
    hiringVerificationStatus: activeHiringVerificationStatus || undefined,
    workMode,
    budget: previewBudgetText || (budgetIntent === "flexible" ? "Flexible" : budgetText),
    about,
    responsibilities,
    requirements,
    tools,
    contentNiches,
    contentGenres,
    formatsHiredFor,
    experience: hasExperienceQuality ? previewExperienceText || experienceText : "",
    weeklyHours: turnaround ? `${turnaround.value} ${turnaround.unit}` : "",
    startTimeframe: startWithin || undefined,
    referenceVideos: referenceVideosForPayload,
    draftCompletion: {
      hasTitle: Boolean(title.trim()),
      hasBudget: Boolean(budgetMin.trim() && budgetMax.trim()),
      hasPlatform: selectedJobPlatforms.length > 0,
      hasWorkMode: Boolean(workMode),
      hasChannel: hasHiringForIdentity,
      hasExperience: hasExperienceQuality,
      hasTimeline: Boolean(turnaround || startWithin),
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

  const focusQualityTarget = (targetId?: string) => {
    if (!targetId) return;
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-quality-target="${targetId}"]`);
      if (!target) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      const focusable = target.matches("input, textarea, select, button, [tabindex]")
        ? target
        : target.querySelector<HTMLElement>("input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex='-1'])");
      window.setTimeout(() => focusable?.focus({ preventScroll: true }), reducedMotion ? 0 : 180);
      if (reducedMotion) return;
      target.animate(
        [
          { boxShadow: "0 0 0 0 rgba(255,255,255,0)", backgroundColor: "rgba(255,255,255,0)" },
          { boxShadow: "0 0 0 1px rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.045)" },
          { boxShadow: "0 0 0 0 rgba(255,255,255,0)", backgroundColor: "rgba(255,255,255,0)" },
        ],
        { duration: 1100, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
      );
    }, 90);
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

  const createLocalJob = async (job: Job) => {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Failed to create job.");
    }
    const data = (await res.json()) as { id?: string };
    if (!data?.id) {
      throw new Error("The local job store did not return a created id.");
    }
    return data.id;
  };

  const publishJob = async () => {
    if (isSubmitting) return;

    setSubmitError(null);
    const normalizedTitle = title.trim();
    const normalizedAbout = about.trim();
    const normalizedResponsibilities = responsibilities.trim();
    const normalizedRequirements = requirements.trim();
    const normalizedHowToApply = howToApply.trim();
    const sanitizedApplicationRequirements = normalizeJobApplicationRequirementsForPayload(
      applicationRequirements,
      normalizedHowToApply,
      noFirstMessageRequirements
    );
    const normalizedCustomInstruction = sanitizedApplicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
      ? normalizedHowToApply
      : "";
    const normalizedLocation = previewLocationText || locationText || "Remote";
    const normalizedExperience = previewExperienceText || experienceText || "Any";
    const normalizedBudgetText =
      previewBudgetText || (budgetIntent === "flexible" ? "Flexible" : budgetText);
    const selectedYouTubeChannelId =
      requiresYouTubeChannel && !selectedHiringIdentity && !localPendingHiringIdentity ? identity?.brandId : undefined;
    const normalizedChannelName = activeHiringDisplayName;
    const normalizedChannelSubscribers =
      localPendingHiringIdentity ? null : identity?.followersCount ?? parseWholeNumber(platformAudience);
    const normalizedChannelLogoUrl = activeHiringAvatarUrl;
    const budgetAmountValue = parseWholeNumber(budgetMin);
    const budgetMaxValue = parseWholeNumber(budgetMax);
    const hasPersistedBudget =
      budgetAmountValue != null &&
      budgetMaxValue != null &&
      budgetMaxValue >= budgetAmountValue;
    const selectedPlatform: IdentityPlatform = platform || selectedJobPlatforms[0] || "youtube";
    const normalizedSelectedPlatforms = selectedJobPlatforms.length ? selectedJobPlatforms : [selectedPlatform];
    const normalizedContentNiches = normalizeCreatorContextList(contentNiches);
    const normalizedContentGenres = normalizeCreatorContextList(contentGenres);
    const normalizedFormatsHiredFor = normalizeCreatorContextList(formatsHiredFor);

    const jobToCreate: Job = {
      id: "",
      title: normalizedTitle,
      category: "Editing",
      budget: normalizedBudgetText,
      experience: normalizedExperience,
      location: normalizedLocation,
      postedShort: "",
      views: 0,
      applicants: 0,
      responseRate: 0,
      channel: {
        name: normalizedChannelName,
        subscribers: normalizedChannelSubscribers,
        verified,
        logoUrl: normalizedChannelLogoUrl || "https://picsum.photos/seed/new/96/96",
      },
      channelExternalUrl: activeHiringIdentity?.url || undefined,
      tags,
      tools,
      contentNiches: normalizedContentNiches,
      contentGenres: normalizedContentGenres,
      formatsHiredFor: normalizedFormatsHiredFor,
      startTimeframe: startWithin || "Flexible",
      platform: selectedPlatform,
      platforms: normalizedSelectedPlatforms,
      referenceVideos: referenceVideosForPayload,
      about: normalizedAbout,
      responsibilities: normalizedResponsibilities,
      requirements: normalizedRequirements,
      applicationRequirements: sanitizedApplicationRequirements,
      howToApply: normalizedCustomInstruction,
      postedPlatform: selectedPlatform,
      postedYoutubeChannelId: selectedYouTubeChannelId,
      hiringIdentityId: selectedHiringIdentityId || undefined,
      hiringDisplayName: activeHiringIdentity?.display_name,
      hiringPlatform: activeHiringPlatform,
      hiringVerificationStatus: activeHiringVerificationStatus || undefined,
      managedByAgencyName: activeHiringIdentity?.managed_by_agency_name || undefined,
    };

    const backendPayload: BackendCreateJobPayload = {
      title: normalizedTitle,
      category: "Editing",
      location: normalizedLocation,
      budget_amount: hasPersistedBudget ? budgetAmountValue : null,
      budget_max: hasPersistedBudget ? budgetMaxValue : null,
      budget_currency: "INR",
      budget_unit: budgetUnit,
      experience_level: normalizedExperience,
      platforms: normalizedSelectedPlatforms,
      start_timeframe: startWithin || "Flexible",
      work_mode: workMode.toLowerCase().replace("on-site", "onsite"),
      contract_type: budgetUnit === "per month" ? "Monthly" : "Project-based",
      timezone_overlap: null,
      weekly_hours: turnaround ? `${turnaround.value} ${turnaround.unit}` : null,
      application_mode: "internal",
      about_channel: normalizedAbout,
      responsibilities: splitLines(normalizedResponsibilities),
      requirements: splitLines(normalizedRequirements),
      application_requirements: sanitizedApplicationRequirements,
      how_to_apply: normalizedCustomInstruction || null,
      tools,
      languages,
      content_niches: normalizedContentNiches,
      content_genres: normalizedContentGenres,
      formats_hired_for: normalizedFormatsHiredFor,
      reference_videos: referenceVideosForPayload.map(serializeReferenceVideo),
      tags,
      youtube_channel_id: selectedYouTubeChannelId || null,
      is_verified: verified,
      channel_name: normalizedChannelName,
      channel_logo_url: normalizedChannelLogoUrl,
      channel_subscribers: normalizedChannelSubscribers,
      posted_platform: selectedPlatform,
      posted_youtube_channel_id: selectedYouTubeChannelId || null,
      hiring_identity_id: selectedHiringIdentityId || null,
      status: "published",
    };

    if (!isLocalMocksEnabled()) {
      if (sessionStatus !== "authenticated") {
        setSubmitError("Sign in before posting a job.");
        return;
      }

      setIsSubmitting(true);
      try {
        const created = await withFreshBackendToken(async (token) => {
          await completeLaunchFreeCheckout(token, { kind: "job_post", target_type: "job" });
          return draftId ? updateJob(token, draftId, backendPayload) : createJob(backendPayload, { accessToken: token });
        });
        if (created?.id) {
          window.location.assign("/jobs?posted=1");
          return;
        }
        setSubmitError("The job was created, but the response was incomplete.");
        return;
      } catch (error) {
        if (isBackendUnavailable(error)) {
          try {
            await createLocalJob(jobToCreate);
            window.location.assign("/jobs?posted=1");
            return;
          } catch (localError) {
            setSubmitError(localError instanceof Error ? localError.message : "Failed to create job.");
            return;
          }
        }
        setSubmitError(error instanceof Error ? error.message : "Failed to post job to backend.");
        console.error("External backend create failed", error);
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

    setIsSubmitting(true);
    try {
      await createLocalJob(jobToCreate);
      window.location.assign("/jobs?posted=1");
      return;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create job.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // After publish validation jumps to a step, pinpoint the problem by scrolling
  // the first invalid field into view and focusing it (the step must render first).
  const focusFirstInvalidField = () => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }, 60);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setSubmitError(null);
    const basicsErrs = getBasicsErrors();
    if (basicsErrs.includes("identity")) {
      setBasicsErrors(basicsErrs);
      setDirection(STEPS.indexOf("basics") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("basics");
      setHiringIdentityModalOpen(true);
      setSubmitError("Fix the highlighted fields before publishing.");
      focusFirstInvalidField();
      return;
    }
    const basicsFieldErrs = basicsErrs.filter((key) => key !== "identity");
    if (basicsFieldErrs.length) {
      setBasicsErrors(basicsFieldErrs);
      setDirection(STEPS.indexOf("basics") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("basics");
      setSubmitError("Fix the highlighted fields before publishing.");
      focusFirstInvalidField();
      return;
    }
    setBasicsErrors([]);
    if (about.trim().length < 20) {
      setContentErrors({ about: "Add at least 20 characters about the brand." });
      setDirection(STEPS.indexOf("about") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("about");
      setSubmitError("Add the missing details before publishing.");
      focusFirstInvalidField();
      return;
    }
    const referenceError = getRefUrlError();
    if (referenceError) {
      setRefUrlError(referenceError);
      setDirection(STEPS.indexOf("referenceVideos") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("referenceVideos");
      setSubmitError("Fix the highlighted fields before publishing.");
      focusFirstInvalidField();
      return;
    }
    setRefUrlError(null);
    if (!noFirstMessageRequirements && applicationRequirements.length === 0) {
      setFirstMessageError(
        "Choose what applicants must include with their first message, or select “No specific first-message requirements.”"
      );
      setDirection(STEPS.indexOf("applicationRequirements") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("applicationRequirements");
      return;
    }
    if (
      !noFirstMessageRequirements &&
      applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) &&
      !howToApply.trim()
    ) {
      setFirstMessageError("Add the custom instruction or remove it.");
      setDirection(STEPS.indexOf("applicationRequirements") < STEPS.indexOf(step) ? "back" : "forward");
      setStep("applicationRequirements");
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

    const normalizedTitle = title.trim() || "Untitled job draft";
    const normalizedLocation =
      workMode === "Remote" ? "Remote" : workMode && city.trim() ? city.trim() : null;
    const selectedYouTubeChannelId =
      requiresYouTubeChannel && !selectedHiringIdentity && !localPendingHiringIdentity ? identity?.brandId : undefined;
    const hasExplicitHiringIdentity = Boolean(selectedHiringIdentityId || localPendingHiringIdentity || identity);
    const normalizedChannelName = hasExplicitHiringIdentity ? activeHiringDisplayName : null;
    const normalizedChannelSubscribers =
      localPendingHiringIdentity ? null : identity?.followersCount ?? parseWholeNumber(platformAudience);
    const normalizedChannelLogoUrl = activeHiringAvatarUrl;
    const budgetAmountValue = parseWholeNumber(budgetMin);
    const budgetMaxValue = parseWholeNumber(budgetMax);
    const hasPersistedBudget =
      budgetAmountValue != null &&
      budgetMaxValue != null &&
      budgetMaxValue >= budgetAmountValue;
    const normalizedContentNiches = normalizeCreatorContextList(contentNiches);
    const normalizedContentGenres = normalizeCreatorContextList(contentGenres);
    const normalizedFormatsHiredFor = normalizeCreatorContextList(formatsHiredFor);
    const normalizedHowToApply = howToApply.trim();
    const sanitizedApplicationRequirements = normalizeJobApplicationRequirementsForPayload(
      applicationRequirements,
      normalizedHowToApply,
      noFirstMessageRequirements
    );
    const normalizedCustomInstruction = sanitizedApplicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
      ? normalizedHowToApply
      : "";

    const backendPayload: BackendCreateJobPayload = {
      title: normalizedTitle,
      category: "Editing",
      location: normalizedLocation,
      budget_amount: hasPersistedBudget ? budgetAmountValue : null,
      budget_max: hasPersistedBudget ? budgetMaxValue : null,
      budget_currency: "INR",
      budget_unit: budgetUnit,
      experience_level: experienceText || null,
      platforms: selectedJobPlatforms,
      start_timeframe: startWithin || null,
      work_mode: workMode ? workMode.toLowerCase().replace("on-site", "onsite") : null,
      contract_type: budgetUnit === "per month" ? "Monthly" : "Project-based",
      weekly_hours: turnaround ? `${turnaround.value} ${turnaround.unit}` : null,
      application_mode: "internal",
      about_channel: about.trim() || null,
      responsibilities: splitLines(responsibilities),
      requirements: splitLines(requirements),
      application_requirements: sanitizedApplicationRequirements,
      how_to_apply: normalizedCustomInstruction || null,
      tools,
      languages,
      content_niches: normalizedContentNiches,
      content_genres: normalizedContentGenres,
      formats_hired_for: normalizedFormatsHiredFor,
      reference_videos: referenceVideosForPayload.map(serializeReferenceVideo),
      tags,
      youtube_channel_id: selectedYouTubeChannelId || null,
      is_verified: verified,
      channel_name: normalizedChannelName,
      channel_logo_url: normalizedChannelLogoUrl,
      channel_subscribers: normalizedChannelSubscribers,
      posted_platform: platform || selectedJobPlatforms[0] || null,
      posted_youtube_channel_id: selectedYouTubeChannelId || null,
      hiring_identity_id: selectedHiringIdentityId || null,
      status: "draft",
    };

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const saved = await withFreshBackendToken((token) =>
        draftId ? updateJob(token, draftId, backendPayload) : createJob(backendPayload, { accessToken: token })
      );
      const savedId = saved?.id || draftId;
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
    let nextBudget = previewBudgetText;
    const hasBudgetMin = budgetMin.trim().length > 0;
    const hasBudgetMax = budgetMax.trim().length > 0;
    const minNum = Number(budgetMin);
    const maxNum = Number(budgetMax);
    const budgetValid =
      hasBudgetMin && hasBudgetMax && !Number.isNaN(minNum) && !Number.isNaN(maxNum) && maxNum >= minNum;

    if (!hasBudgetMin && !hasBudgetMax) {
      nextBudget = budgetIntent === "flexible" ? "Flexible" : "";
    } else if (budgetValid) {
      nextBudget = formatBudgetPreview(budgetMin, budgetMax, budgetUnit);
    }

    let nextExperience = previewExperienceText;
    const hasExpMin = expMin.trim().length > 0;
    const hasExpMax = expMax.trim().length > 0;
    const expMinNum = Number(expMin);
    const expMaxNum = Number(expMax);
    const expValid =
      hasExpMin && hasExpMax && !Number.isNaN(expMinNum) && !Number.isNaN(expMaxNum);

    if (!hasExpMin && !hasExpMax) {
      nextExperience = "Any";
    } else if (expValid) {
      if (expMaxNum < expMinNum) {
        nextExperience = formatExperiencePreview(expMin, expMin);
      } else {
        nextExperience = formatExperiencePreview(expMin, expMax);
      }
    }

    let nextLocation = previewLocationText;
    if (workMode === "Remote") {
      nextLocation = "Remote";
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
      workMode,
      city,
      expMin,
      expMax,
      startWithin,
      platform,
      platforms: selectedJobPlatforms,
      platformName,
      platformAudience,
      contentNiches,
      contentGenres,
      formatsHiredFor,
      turnaround,
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
    workMode !== savedBasics.workMode ||
    city !== savedBasics.city ||
    expMin !== savedBasics.expMin ||
    expMax !== savedBasics.expMax ||
    platform !== savedBasics.platform ||
    JSON.stringify(selectedJobPlatforms) !== JSON.stringify(savedBasics.platforms) ||
    platformName !== savedBasics.platformName ||
    platformAudience !== savedBasics.platformAudience;

  const canSaveDetails =
    startWithin !== savedBasics.startWithin ||
    turnaround?.value !== savedBasics.turnaround?.value ||
    turnaround?.unit !== savedBasics.turnaround?.unit ||
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
    if (current === "basics") {
      const errs = getBasicsErrors();
      if (errs.length) {
        setBasicsErrors(errs);
        if (errs.includes("identity")) {
          setHiringIdentityModalOpen(true);
        }
        updateBasicsPreview();
        return;
      }
      setBasicsErrors([]);
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
      current === "applicationRequirements" &&
      applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) &&
      !howToApply.trim()
    ) {
      setFirstMessageError("Add the custom instruction or remove it.");
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

  const hiringIdentityPanel = (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <HiringIdentityAvatar
            name={activeHiringDisplayName}
            imageUrl={activeHiringAvatarUrl}
            platform={activeHiringPlatform}
            className="h-10 w-10"
          />
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-white/36">
              <Icon name="briefcase" className="h-3.5 w-3.5 text-white/38" />
              <span>Hiring for</span>
            </p>
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-sm font-semibold text-white/86">
              <span className="truncate">{activeHiringDisplayName}</span>
              <span
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
              <p className="mt-1 text-xs text-white/42">Editing job draft.</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHiringIdentityModalOpen(true)}
            className="h-9 w-fit rounded-xl border border-white/[0.1] px-3 text-xs font-semibold text-white/74 transition-colors hover:bg-white/[0.07] hover:text-white cursor-pointer"
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

  return (
    <main className="min-h-screen text-white bg-[#0b0b0f]">
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
      <div className="px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-6xl grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] items-start">
          <div className="min-w-0 space-y-6">
            {hiringIdentityPanel}

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
              onTitleChange={setTitle}
              workMode={workMode}
              onWorkModeChange={setWorkMode}
              city={city}
              onCityChange={setCity}
              budgetMin={budgetMin}
              budgetMax={budgetMax}
              budgetIntent={budgetIntent}
              budgetUnit={budgetUnit}
              onBudgetMinChange={(next) => {
                setBudgetMin(next);
                if (!next && !budgetMax) setBudgetIntent("");
              }}
              onBudgetMaxChange={(next) => {
                setBudgetMax(next);
                if (!budgetMin && !next) setBudgetIntent("");
              }}
              onBudgetIntentChange={setBudgetIntent}
              onBudgetUnitChange={setBudgetUnit}
              expMin={expMin}
              expMax={expMax}
              onExpMinChange={setExpMin}
              onExpMaxChange={setExpMax}
              startWithin={startWithin}
              onStartWithinChange={setStartWithin}
              platforms={selectedJobPlatforms}
              onPlatformToggle={togglePlatformSelection}
              contentNiches={contentNiches}
              onContentNichesChange={(next) => setContentNiches(normalizeCreatorContextList(next))}
              contentGenres={contentGenres}
              onContentGenresChange={(next) => setContentGenres(normalizeCreatorContextList(next))}
              formatsHiredFor={formatsHiredFor}
              onFormatsHiredForChange={(next) => setFormatsHiredFor(normalizeCreatorContextList(next))}
              turnaround={turnaround}
              onTurnaroundChange={setTurnaround}
              tools={tools}
              onToolsChange={setTools}
              languages={languages}
              onLanguagesChange={setLanguages}
              about={about}
              responsibilities={responsibilities}
              requirements={requirements}
              howToApply={howToApply}
              onAboutChange={setAbout}
              onResponsibilitiesChange={setResponsibilities}
              onRequirementsChange={setRequirements}
              onHowToApplyChange={setHowToApply}
              applicationRequirements={applicationRequirements}
              onApplicationRequirementsChange={setApplicationRequirements}
              noFirstMessageRequirements={noFirstMessageRequirements}
              onNoFirstMessageRequirementsChange={setNoFirstMessageRequirements}
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
              onRefTitleChange={setRefTitle}
              onRefUrlChange={setRefUrl}
              onRefWhatToReferenceChange={setRefWhatToReference}
              onRefTimestampNotesChange={setRefTimestampNotes}
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
            />
          </div>

          <div className="space-y-6">
            <PreviewCard
              title={title}
              channelName={activeHiringDisplayName}
              subsText={subsText}
              budgetText={previewBudgetText}
              experienceText={previewExperienceText}
              locationText={previewLocationText}
              tags={tags}
              contentNiches={contentNiches}
              contentGenres={contentGenres}
              formatsHiredFor={formatsHiredFor}
              platform={platform}
              profileImageUrl={activeHiringAvatarUrl}
            />

            <PostJobSafety />
          </div>
        </div>
      </div>
      <RecommendedChecklistPopup
        items={jobQualityItems}
        onSelect={goToJobQualityItem}
        ariaLabel="Recommended job listing details"
      />
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
