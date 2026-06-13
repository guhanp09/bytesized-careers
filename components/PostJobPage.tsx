"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendCreateJobPayload,
  BackendHiringIdentity,
  BackendHiringIdentityPlatform,
  BackendMeYouTubeChannel,
  completeLaunchFreeCheckout,
  createMyHiringIdentity,
  createJob,
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
import { Job, ReferenceVideo, StartTimeframe } from "../lib/types";
import { formatBudgetPreview, formatExperiencePreview, formatSubsInput } from "../lib/format";
import { INDIA_CITIES } from "../lib/indiaCities";
import PostJobForm from "./post-job/PostJobForm";
import PreviewCard from "./post-job/PreviewCard";
import PostJobSafety from "./post-job/PostJobSafety";
import { IdentityPlatform, VerifiedIdentity } from "../lib/identity/types";
import { PageLoading } from "./ui";
import { Icon } from "./Icons";

type WorkMode = "Remote" | "Hybrid" | "On-site";
type TurnaroundUnit = "hours" | "days" | "weeks";
type Turnaround = { value: number; unit: TurnaroundUnit } | null;

type Step =
  | "basics"
  | "about"
  | "responsibilities"
  | "requirements"
  | "howToApply"
  | "referenceVideos"
  | "tags";

const STEPS: Step[] = [
  "basics",
  "about",
  "responsibilities",
  "requirements",
  "howToApply",
  "referenceVideos",
  "tags",
];

type SavedBasics = {
  title: string;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: "per project" | "per month";
  workMode: WorkMode;
  city: string;
  expMin: string;
  expMax: string;
  startWithin: StartTimeframe | "";
  platform: IdentityPlatform;
  platformName: string;
  platformAudience: string;
  styles: string[];
  turnaround: Turnaround;
  tools: string[];
};

type SavedContent = {
  about: string;
  responsibilities: string;
  requirements: string;
  howToApply: string;
};

type SavedTags = {
  tags: string[];
};

type SavedRefs = {
  refVideos: ReferenceVideo[];
  refTitle: string;
  refUrl: string;
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
  is_agency_represented: true;
  managed_by_agency_name?: string | null;
};

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
  sessionDisplayName,
}: {
  open: boolean;
  onClose: () => void;
  backendIdentities: BackendHiringIdentity[];
  connectedIdentities: VerifiedIdentity[];
  selectedChoice: HiringIdentityChoice | null;
  onConfirmExisting: (choice: HiringIdentityChoice) => void;
  onCreateRepresentedIdentity: (identity: ResolvedHiringIdentity) => Promise<void>;
  sessionDisplayName?: string | null;
}) {
  const [step, setStep] = useState<"select" | "url" | "confirm" | "verify">("select");
  const [draftChoice, setDraftChoice] = useState<HiringIdentityChoice | null>(selectedChoice);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolved, setResolved] = useState<ResolvedHiringIdentity | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep("select");
    setDraftChoice(selectedChoice);
    setUrl("");
    setUrlError(null);
    setResolveLoading(false);
    setResolved(null);
    setCreateLoading(false);
    setNotice(null);
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
    onConfirmExisting(draftChoice);
    onClose();
  };

  const continueDrafting = async () => {
    if (!resolved || createLoading) return;
    setCreateLoading(true);
    setUrlError(null);
    try {
      await onCreateRepresentedIdentity(resolved);
      onClose();
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : "Could not save this hiring identity.");
    } finally {
      setCreateLoading(false);
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

  const savedTiles = backendIdentities.map((item) => ({
    choice: { source: "backend", id: item.id } as HiringIdentityChoice,
    name: item.display_name,
    subline: [formatHiringPlatform(item.platform), item.handle].filter(Boolean).join(" · "),
    imageUrl: item.avatar_url || null,
    platform: item.platform,
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
      status: "Connected",
    }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hiring-identity-modal-title"
        className="w-full max-w-[620px] overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#101014] shadow-[0_34px_90px_-36px_rgba(0,0,0,1)]"
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
                    <button
                      key={`${item.choice.source}-${item.choice.id}`}
                      type="button"
                      onClick={() => setDraftChoice(item.choice)}
                      className={tileClass(active)}
                    >
                      {active ? (
                        <span className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/18 bg-white text-black">
                          <Icon name="check" className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                      <HiringIdentityAvatar name={item.name} imageUrl={item.imageUrl} platform={item.platform} />
                      <span className="max-w-full">
                        <span className="line-clamp-2 text-sm font-semibold leading-snug text-white/88">{item.name}</span>
                        {item.subline ? <span className="mt-1 block truncate text-xs text-white/48">{item.subline}</span> : null}
                        {item.status ? <span className="mt-1 block text-[11px] text-white/42">{item.status}</span> : null}
                      </span>
                    </button>
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
                <p className="mt-6 text-sm font-medium text-white/76">Is this who you are hiring for?</p>
              </div>
              <div className="mt-7 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep("url")}
                  className="h-10 rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep("verify")}
                  className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 cursor-pointer"
                >
                  Verify authorization
                </button>
              </div>
            </>
          ) : step === "verify" && resolved ? (
            <>
              <h2 id="hiring-identity-modal-title" className="text-xl font-semibold tracking-tight text-white">
                Verify authorization
              </h2>
              <p className="mt-4 text-sm leading-6 text-white/66">
                To post live jobs for {resolved.name}, verify that you are authorized to hire for this channel/page.
              </p>
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => void continueDrafting()}
                  disabled={createLoading}
                  className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.045] p-4 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-55 cursor-pointer"
                >
                  <span className="block text-sm font-semibold text-white/88">Continue with channel/page login</span>
                  <span className="mt-1 block text-sm text-white/52">Verify by signing in as this channel/page.</span>
                </button>
                <button
                  type="button"
                  onClick={() => void continueDrafting()}
                  disabled={createLoading}
                  className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.045] p-4 text-left transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-55 cursor-pointer"
                >
                  <span className="block text-sm font-semibold text-white/88">Add code to public bio</span>
                  <span className="mt-1 block text-sm text-white/52">We will give you a code to place temporarily.</span>
                </button>
              </div>
              <p className="mt-5 text-sm leading-6 text-white/58">
                You can continue drafting now. This job will not go live until authorization is verified.
              </p>
              {urlError ? <p className="mt-2 text-sm text-amber-100/82">{urlError}</p> : null}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep("confirm")}
                  className="h-10 rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void continueDrafting()}
                  disabled={createLoading}
                  className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/36"
                >
                  {createLoading ? "Saving..." : "Continue drafting"}
                </button>
              </div>
              {sessionDisplayName ? (
                <p className="mt-3 text-right text-[11px] text-white/34">Posting through {sessionDisplayName}</p>
              ) : null}
            </>
          ) : null}
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

  const [workMode, setWorkMode] = useState<WorkMode>("Remote");
  const [city, setCity] = useState("");

  const [expMin, setExpMin] = useState("");
  const [expMax, setExpMax] = useState("");

  const [startWithin, setStartWithin] = useState<StartTimeframe | "">("ASAP");

  const [platform, setPlatform] = useState<IdentityPlatform>("youtube");
  const [platformName, setPlatformName] = useState("");
  const [platformAudience, setPlatformAudience] = useState("");
  const [identity, setIdentity] = useState<VerifiedIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityOptions, setIdentityOptions] = useState<VerifiedIdentity[]>([]);
  const [identityPickerOpen, setIdentityPickerOpen] = useState(false);
  const [styles, setStyles] = useState<string[]>([]);
  const [turnaround, setTurnaround] = useState<Turnaround>({ value: 5, unit: "days" });
  const [tools, setTools] = useState<string[]>([]);
  const [toolInput, setToolInput] = useState("");

  const [verified, setVerified] = useState(false);

  const [about, setAbout] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [requirements, setRequirements] = useState("");
  const [howToApply, setHowToApply] = useState("");

  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const [refTitle, setRefTitle] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [refVideos, setRefVideos] = useState<ReferenceVideo[]>([]);
  const [refUrlError, setRefUrlError] = useState<string | null>(null);

  const [savedBasics, setSavedBasics] = useState<SavedBasics>({
    title: "",
    budgetMin: "",
    budgetMax: "",
    budgetUnit: "per project",
    workMode: "Remote",
    city: "",
    expMin: "",
    expMax: "",
    startWithin: "ASAP",
    platform: "youtube",
    platformName: "",
    platformAudience: "",
    styles: [],
    turnaround: { value: 5, unit: "days" },
    tools: [],
  });
  const [savedContent, setSavedContent] = useState<SavedContent>({
    about: "",
    responsibilities: "",
    requirements: "",
    howToApply: "",
  });
  const [savedTags, setSavedTags] = useState<SavedTags>({ tags: [] });
  const [savedRefs, setSavedRefs] = useState<SavedRefs>({
    refVideos: [],
    refTitle: "",
    refUrl: "",
  });
  const [contentErrors, setContentErrors] = useState<{ about?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [basicsErrors, setBasicsErrors] = useState<
    Array<"title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform">
  >([]);
  const [hiringIdentities, setHiringIdentities] = useState<BackendHiringIdentity[]>([]);
  const [selectedHiringIdentityId, setSelectedHiringIdentityId] = useState<string>("");
  const [localPendingHiringIdentity, setLocalPendingHiringIdentity] =
    useState<LocalPendingHiringIdentity | null>(null);
  const [hiringIdentityModalOpen, setHiringIdentityModalOpen] = useState(!draftId);
  const [resolvedBackendAccessToken, setResolvedBackendAccessToken] = useState<string | undefined>();
  const [previewBudgetText, setPreviewBudgetText] = useState("");
  const [previewExperienceText, setPreviewExperienceText] = useState("");
  const [previewLocationText, setPreviewLocationText] = useState("Remote");

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
    if (workMode === "Remote") return "Remote";
    const c = city.trim();
    return c ? `${workMode} - ${c}` : workMode;
  }, [workMode, city]);

  const normalizeCity = (value: string) => value.trim().toLowerCase();
  const matchedCity = INDIA_CITIES.find((c) => normalizeCity(c) === normalizeCity(city));
  const isCityRequired = workMode === "Hybrid" || workMode === "On-site";
  const requiresYouTubeChannel = platform === "youtube";
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
      return "Remote";
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
        .map((entry) => {
          if (typeof entry === "string") return { url: entry };
          if (!entry || typeof entry !== "object") return null;
          const record = entry as { title?: unknown; url?: unknown };
          return typeof record.url === "string"
            ? { title: typeof record.title === "string" ? record.title : undefined, url: record.url }
            : null;
        })
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
        const experience = experienceParts(draft.experience_level);
        const nextWorkMode = normalizeWorkMode(draft.work_mode);
        const nextLocation = typeof draft.location === "string" ? draft.location : "";
        const nextPlatform = draft.platforms?.[0] === "instagram" ? "instagram" : "youtube";

        setTitle(draft.title || "");
        setBudgetMin(budgetMinValue);
        setBudgetMax(budgetMaxValue);
        setBudgetUnit(draft.budget_unit === "per month" ? "per month" : "per project");
        setWorkMode(nextWorkMode);
        setCity(nextWorkMode === "Remote" ? "" : nextLocation);
        setExpMin(experience.min);
        setExpMax(experience.max);
        setStartWithin((draft.start_timeframe as StartTimeframe) || "Flexible");
        setPlatform(nextPlatform);
        setPlatformName(draft.channel_name || "");
        setPlatformAudience(draft.channel_subscribers != null ? String(draft.channel_subscribers) : "");
        setVerified(Boolean(draft.is_verified));
        setAbout(draft.about_channel || "");
        setResponsibilities((draft.responsibilities || []).join("\n"));
        setRequirements((draft.requirements || []).join("\n"));
        setHowToApply(draft.how_to_apply || "");
        setTags(draft.tags || []);
        setRefVideos(refsFrom(draft.reference_videos));
        setSelectedHiringIdentityId(typeof draft.hiring_identity_id === "string" ? draft.hiring_identity_id : "");
        setPreviewBudgetText(formatBudgetPreview(budgetMinValue, budgetMaxValue, draft.budget_unit === "per month" ? "per month" : "per project"));
        setPreviewExperienceText(
          experience.min && experience.max ? formatExperiencePreview(experience.min, experience.max) : draft.experience_level || ""
        );
        setPreviewLocationText(nextLocation || "Remote");
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
    async (nextIdentity: ResolvedHiringIdentity) => {
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

      const applyLocalPending = () => {
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
      };

      if (sessionStatus !== "authenticated" || isLocalMocksEnabled()) {
        applyLocalPending();
        return;
      }

      try {
        const saved = await withFreshBackendToken(async (token) => {
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
          const verification = await requestMyHiringIdentityVerification(token, created.id);
          return verification.identity;
        });
        setHiringIdentities((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
        selectHiringIdentity(saved);
      } catch (error) {
        if (isBackendUnavailable(error)) {
          applyLocalPending();
          return;
        }
        throw error;
      }
    },
    [selectHiringIdentity, session?.user?.name, session?.user?.username, sessionStatus, withFreshBackendToken]
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
      const selected =
        nextOptions.find((item) => item.brandId === currentOrPreferredId) || nextOptions[0];
      setIdentity(selected);
    },
    [identity?.brandId]
  );

  const getBasicsErrors = () => {
    const errors: Array<"title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform"> = [];
    if (title.trim().length < 3) errors.push("title");
    if (!platform) errors.push("platform");
    if (isCityRequired && !city.trim()) errors.push("city");
    if (isCityRequired && city.trim() && !matchedCity) errors.push("cityInvalid");
    const minNum = Number(budgetMin);
    const maxNum = Number(budgetMax);
    if (
      budgetMin &&
      budgetMax &&
      !Number.isNaN(minNum) &&
      !Number.isNaN(maxNum) &&
      maxNum < minNum
    ) {
      errors.push("budgetRange");
    }
    return errors;
  };

  const isBasicsErrorActive = useCallback(
    (key: "title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform") => {
      if (key === "title") return title.trim().length < 3;
      if (key === "identity") return false;
      if (key === "platform") return !platform;
      if (key === "city") return isCityRequired && !city.trim();
      if (key === "cityInvalid") return isCityRequired && city.trim() && !matchedCity;
      const minNum = Number(budgetMin);
      const maxNum = Number(budgetMax);
      return (
        budgetMin &&
        budgetMax &&
        !Number.isNaN(minNum) &&
        !Number.isNaN(maxNum) &&
        maxNum < minNum
      );
    },
    [title, platform, isCityRequired, city, matchedCity, budgetMin, budgetMax]
  );

  const getBasicsErrorMessage = (
    key: "title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform"
  ) => {
    switch (key) {
      case "title":
        return title.trim() ? "Job title must be at least 3 characters." : "Job title can't be empty.";
      case "platform":
        return "Platform is required.";
      case "city":
        return "City can't be empty.";
      case "cityInvalid":
        return "Incorrect city name.";
      case "budgetRange":
        return "Max budget can't be less than min budget.";
      case "identity":
        return "Connect and choose a YouTube channel before posting.";
    }
  };

  const basicsErrorMap = (() => {
    const next: Partial<
      Record<"title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform", string>
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
    if (about.trim()) {
      setContentErrors((prev) => ({ ...prev, about: undefined }));
    }
  }, [about]);

  React.useEffect(() => {
    if (!identity) return;
    setBasicsErrors((prev) => prev.filter((key) => key !== "identity"));
  }, [identity]);

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

  const setPlatformSelection = (next: IdentityPlatform) => {
    setPlatform(next);
  };

  React.useEffect(() => {
    setPlatformName("");
    setPlatformAudience("");
    setIdentity((current) => {
      if (current && current.platform !== platform) {
        return null;
      }
      return current;
    });
    setIdentityOptions([]);
    setIdentityPickerOpen(false);
    setIdentityError(null);
  }, [platform]);

  const addTool = (tool: string) => {
    const next = tool.trim();
    if (!next) return;
    setTools((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setToolInput("");
  };

  const removeTool = (tool: string) => {
    setTools((prev) => prev.filter((t) => t !== tool));
  };

  const startIdentityConnect = async () => {
    if (platform !== "youtube") {
      setIdentityError("Instagram verification will be available soon.");
      return;
    }
    await refreshYouTubeVerification();
  };

  const selectIdentity = async (brandId: string) => {
    const selected = identityOptions.find((option) => option.brandId === brandId) || null;
    setIdentity(selected);
    setIdentityPickerOpen(false);
    setIdentityError(null);
  };

  const disconnectIdentity = async () => {
    if (platform !== "youtube") {
      setIdentity(null);
      return;
    }
    await refreshYouTubeVerification();
  };

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
    const url = refUrl.trim();
    if (!url || !isValidYouTubeUrl(url)) return;
    setRefVideos((prev) => [...prev, { title: refTitle.trim() || undefined, url }]);
    setRefTitle("");
    setRefUrl("");
  };

  const removeRefVideo = (idx: number) => {
    setRefVideos((prev) => prev.filter((_, i) => i !== idx));
  };

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
    (platform === "instagram" ? "INSTAGRAM" : "YOUTUBE");
  const activeHiringStatusLabel = localPendingHiringIdentity
    ? "Authorization pending"
    : selectedHiringIdentity?.verification_status === "VERIFIED"
      ? selectedHiringIdentity.is_agency_represented
        ? "Representation verified"
        : "Verified"
      : selectedHiringIdentity?.verification_status === "PENDING"
        ? "Authorization pending"
        : selectedHiringIdentity?.verification_status === "REJECTED"
          ? "Authorization rejected"
          : selectedHiringIdentity?.is_agency_represented
            ? "Not verified yet"
            : identity
              ? "Connected"
              : "Not selected";

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setSubmitError(null);
    const basicsErrs = getBasicsErrors();
    if (basicsErrs.length) {
      setBasicsErrors(basicsErrs);
      setDirection("back");
      setStep("basics");
      return;
    }
    if (!about.trim()) {
      setContentErrors({ about: "About the channel can't be empty." });
      setDirection("back");
      setStep("about");
      return;
    }
    if (isHiringAuthorizationBlockingPublish) {
      setSubmitError("This job can be completed as a draft, but it will not go live until authorization is verified.");
      return;
    }

    const normalizedTitle = title.trim();
    const normalizedAbout = about.trim();
    const normalizedResponsibilities = responsibilities.trim();
    const normalizedRequirements = requirements.trim();
    const normalizedHowToApply = howToApply.trim();
    const normalizedLocation = previewLocationText || locationText || "Remote";
    const normalizedExperience = previewExperienceText || experienceText || "Any";
    const normalizedBudgetText = previewBudgetText || budgetText || "Flexible";
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

    const jobToCreate: Job = {
      id: "",
      title: normalizedTitle,
      category: "Editing",
      budget: normalizedBudgetText,
      experience: normalizedExperience,
      location: normalizedLocation,
      postedShort: "now",
      views: 0,
      applicants: 0,
      responseRate: 0,
      channel: {
        name: normalizedChannelName,
        subscribers: normalizedChannelSubscribers,
        verified,
        logoUrl: normalizedChannelLogoUrl || "https://picsum.photos/seed/new/96/96",
      },
      tags,
      startTimeframe: startWithin || "Flexible",
      platform,
      referenceVideos: refVideos,
      about: normalizedAbout,
      responsibilities: normalizedResponsibilities,
      requirements: normalizedRequirements,
      howToApply: normalizedHowToApply,
      postedPlatform: platform,
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
      platforms: [platform],
      start_timeframe: startWithin || "Flexible",
      work_mode: workMode.toLowerCase().replace("on-site", "onsite"),
      contract_type: budgetUnit === "per month" ? "Monthly" : "Project-based",
      timezone_overlap: null,
      weekly_hours: turnaround ? `${turnaround.value} ${turnaround.unit}` : null,
      application_mode: "internal",
      about_channel: normalizedAbout,
      responsibilities: splitLines(normalizedResponsibilities),
      requirements: splitLines(normalizedRequirements),
      how_to_apply: normalizedHowToApply || null,
      reference_videos: refVideos.map((video) => ({
        title: video.title?.trim() || null,
        url: video.url,
      })),
      tags,
      youtube_channel_id: selectedYouTubeChannelId || null,
      is_verified: verified,
      channel_name: normalizedChannelName,
      channel_logo_url: normalizedChannelLogoUrl,
      channel_subscribers: normalizedChannelSubscribers,
      posted_platform: platform,
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
    const normalizedLocation = previewLocationText || locationText || "Remote";
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

    const backendPayload: BackendCreateJobPayload = {
      title: normalizedTitle,
      category: "Editing",
      location: normalizedLocation,
      budget_amount: hasPersistedBudget ? budgetAmountValue : null,
      budget_max: hasPersistedBudget ? budgetMaxValue : null,
      budget_currency: "INR",
      budget_unit: budgetUnit,
      experience_level: previewExperienceText || experienceText || null,
      platforms: [platform],
      start_timeframe: startWithin || "Flexible",
      work_mode: workMode.toLowerCase().replace("on-site", "onsite"),
      contract_type: budgetUnit === "per month" ? "Monthly" : "Project-based",
      weekly_hours: turnaround ? `${turnaround.value} ${turnaround.unit}` : null,
      application_mode: "internal",
      about_channel: about.trim() || null,
      responsibilities: splitLines(responsibilities),
      requirements: splitLines(requirements),
      how_to_apply: howToApply.trim() || null,
      reference_videos: refVideos.map((video) => ({ title: video.title?.trim() || null, url: video.url })),
      tags,
      youtube_channel_id: selectedYouTubeChannelId || null,
      is_verified: verified,
      channel_name: normalizedChannelName,
      channel_logo_url: normalizedChannelLogoUrl,
      channel_subscribers: normalizedChannelSubscribers,
      posted_platform: platform,
      posted_youtube_channel_id: selectedYouTubeChannelId || null,
      hiring_identity_id: selectedHiringIdentityId || null,
      status: "draft",
    };

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await withFreshBackendToken((token) =>
        draftId ? updateJob(token, draftId, backendPayload) : createJob(backendPayload, { accessToken: token })
      );
      window.location.assign("/activity?tab=drafts");
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
      nextBudget = "Flexible";
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
    const errs = getBasicsErrors();
    if (errs.length) setBasicsErrors(errs);
    updateBasicsPreview();
    setSavedBasics({
      title,
      budgetMin,
      budgetMax,
      budgetUnit,
      workMode,
      city,
      expMin,
      expMax,
      startWithin,
      platform,
      platformName,
      platformAudience,
      styles,
      turnaround,
      tools,
    });
  };

  const onSaveContent = () => {
    setSavedContent({
      about,
      responsibilities,
      requirements,
      howToApply,
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
    setRefUrlError(null);
    setSavedRefs({ refVideos, refTitle, refUrl });
    return true;
  };

  const canSaveBasics =
    title !== savedBasics.title ||
    budgetMin !== savedBasics.budgetMin ||
    budgetMax !== savedBasics.budgetMax ||
    budgetUnit !== savedBasics.budgetUnit ||
    workMode !== savedBasics.workMode ||
    city !== savedBasics.city ||
    expMin !== savedBasics.expMin ||
    expMax !== savedBasics.expMax ||
    startWithin !== savedBasics.startWithin ||
    platformName !== savedBasics.platformName ||
    platformAudience !== savedBasics.platformAudience ||
    JSON.stringify(styles) !== JSON.stringify(savedBasics.styles) ||
    turnaround?.value !== savedBasics.turnaround?.value ||
    turnaround?.unit !== savedBasics.turnaround?.unit ||
    platform !== savedBasics.platform ||
    JSON.stringify(tools) !== JSON.stringify(savedBasics.tools);

  const canSaveContent =
    about !== savedContent.about ||
    responsibilities !== savedContent.responsibilities ||
    requirements !== savedContent.requirements ||
    howToApply !== savedContent.howToApply;

  const canSaveTags = JSON.stringify(tags) !== JSON.stringify(savedTags.tags);

  const canSaveReferenceVideos =
    JSON.stringify(refVideos) !== JSON.stringify(savedRefs.refVideos) ||
    refTitle !== savedRefs.refTitle ||
    refUrl !== savedRefs.refUrl;

  const hasNext = STEPS.indexOf(step) < STEPS.length - 1;
  const hasBack = STEPS.indexOf(step) > 0;
  const stepIndex = STEPS.indexOf(step);

  const goNext = (current: Step) => {
    const idx = STEPS.indexOf(current);
    if (idx >= STEPS.length - 1) return;
    if (current === "referenceVideos") {
      const error = getRefUrlError();
      if (error) {
        setRefUrlError(error);
        return;
      }
      setRefUrlError(null);
    }
    if (current === "basics") {
      const errs = getBasicsErrors();
      if (errs.length) {
        setBasicsErrors(errs);
        updateBasicsPreview();
        return;
      }
      setBasicsErrors([]);
      updateBasicsPreview();
    }
    if (current === "about") {
      if (!about.trim()) {
        setContentErrors({ about: "About the channel can't be empty." });
        return;
      }
      setContentErrors({});
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
        sessionDisplayName={session?.user?.name || session?.user?.username || null}
      />
      <div className="px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-6xl grid gap-6 lg:grid-cols-[1fr_420px] items-start">
          <div className="space-y-6">
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
                    <p className="text-xs font-semibold uppercase tracking-[0.13em] text-white/36">Hiring for</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-white/86">
                      {activeHiringDisplayName}
                      <span className="font-medium text-white/42"> · {activeHiringStatusLabel}</span>
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
                  {!isLocalMocksEnabled() ? (
                    <button
                      type="button"
                      onClick={() => void onSaveDraft()}
                      disabled={isSubmitting || draftLoading}
                      className="h-9 w-fit rounded-xl border border-white/[0.1] px-3 text-xs font-semibold text-white/74 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-55 cursor-pointer"
                    >
                      {isSubmitting ? "Saving..." : "Save draft"}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

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
              budgetUnit={budgetUnit}
              onBudgetMinChange={setBudgetMin}
              onBudgetMaxChange={setBudgetMax}
              onBudgetUnitChange={setBudgetUnit}
              expMin={expMin}
              expMax={expMax}
              onExpMinChange={setExpMin}
              onExpMaxChange={setExpMax}
              startWithin={startWithin}
              onStartWithinChange={setStartWithin}
              platform={platform}
              onPlatformChange={setPlatformSelection}
              identity={identity}
              identityLoading={identityLoading}
              identityError={identityError}
              identityOptions={identityOptions}
              identityPickerOpen={identityPickerOpen}
              onIdentitySelect={selectIdentity}
              onIdentityConnect={startIdentityConnect}
              onIdentityChange={disconnectIdentity}
              onIdentityPickerClose={() => setIdentityPickerOpen(false)}
              styles={styles}
              onStylesChange={setStyles}
              turnaround={turnaround}
              onTurnaroundChange={setTurnaround}
              tools={tools}
              toolInput={toolInput}
              onToolInputChange={setToolInput}
              onAddTool={addTool}
              onRemoveTool={removeTool}
              about={about}
              responsibilities={responsibilities}
              requirements={requirements}
              howToApply={howToApply}
              onAboutChange={setAbout}
              onResponsibilitiesChange={setResponsibilities}
              onRequirementsChange={setRequirements}
              onHowToApplyChange={setHowToApply}
              tagInput={tagInput}
              tags={tags}
              onTagInputChange={setTagInput}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              refTitle={refTitle}
              refUrl={refUrl}
              refUrlError={refUrlError || undefined}
              refVideos={refVideos}
              onRefTitleChange={setRefTitle}
              onRefUrlChange={setRefUrl}
              onAddRefVideo={addRefVideo}
              onRemoveRefVideo={removeRefVideo}
              onSubmit={onSubmit}
              onSaveBasics={onSaveBasics}
              onSaveContent={onSaveContent}
              onSaveTags={onSaveTags}
              onSaveReferenceVideos={onSaveReferenceVideos}
              canSaveBasics={canSaveBasics}
              canSaveContent={canSaveContent}
              canSaveTags={canSaveTags}
              canSaveReferenceVideos={canSaveReferenceVideos}
              contentErrors={contentErrors}
              submitError={submitError}
              isSubmitting={isSubmitting}
              publishDisabled={isHiringAuthorizationBlockingPublish}
            />
          </div>

          <div className="space-y-6">
            <PreviewCard
              title={title}
              channelName={activeHiringDisplayName}
              verified={verified && !isHiringAuthorizationBlockingPublish}
              subsText={subsText}
              budgetText={previewBudgetText}
              experienceText={previewExperienceText}
              locationText={previewLocationText}
              tags={tags}
              startWithin={startWithin || undefined}
              platform={platform}
              profileImageUrl={activeHiringAvatarUrl}
              authorizationStatus={activeHiringStatusLabel}
              managedByName={activeHiringIdentity?.managed_by_agency_name || undefined}
            />

            <PostJobSafety />
          </div>
        </div>
      </div>
    </main>
  );
}
