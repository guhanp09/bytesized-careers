"use client";

import Link from "next/link";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendCreateJobPayload,
  BackendHiringIdentity,
  BackendMeYouTubeChannel,
  completeLaunchFreeCheckout,
  createJob,
  exchangeGoogleOAuthForBackend,
  listMyBackendJobs,
  isBackendAuthError,
  isLocalMocksEnabled,
  listMyHiringIdentities,
  listMyYouTubeChannels,
  refreshMyYouTubeChannels,
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

const mapBackendChannelToIdentity = (channel: BackendMeYouTubeChannel): VerifiedIdentity => ({
  platform: "youtube",
  brandId: channel.channel_id,
  name: channel.title || "YouTube Channel",
  imageUrl: channel.thumbnail_url || null,
  followersCount: null,
  handle: null,
  verifiedAt: new Date().toISOString(),
});

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
        if (preferred && !selectedHiringIdentityId) {
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
  }, [selectedHiringIdentityId, sessionStatus, withFreshBackendToken]);

  const selectedHiringIdentity = useMemo(
    () => hiringIdentities.find((item) => item.id === selectedHiringIdentityId) || null,
    [hiringIdentities, selectedHiringIdentityId]
  );

  const selectHiringIdentity = useCallback((nextIdentity: BackendHiringIdentity) => {
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
    if (selectedHiringIdentity) {
      setVerified(selectedHiringIdentity.verification_status === "VERIFIED");
      return;
    }
    setVerified(Boolean(identity) && platform === "youtube");
  }, [identity, platform, selectedHiringIdentity]);

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

    const normalizedTitle = title.trim();
    const normalizedAbout = about.trim();
    const normalizedResponsibilities = responsibilities.trim();
    const normalizedRequirements = requirements.trim();
    const normalizedHowToApply = howToApply.trim();
    const normalizedLocation = previewLocationText || locationText || "Remote";
    const normalizedExperience = previewExperienceText || experienceText || "Any";
    const normalizedBudgetText = previewBudgetText || budgetText || "Flexible";
    const selectedYouTubeChannelId =
      requiresYouTubeChannel && !selectedHiringIdentity ? identity?.brandId : undefined;
    const normalizedChannelName =
      selectedHiringIdentity?.display_name ||
      identity?.name ||
      platformName.trim() ||
      session?.user?.name ||
      session?.user?.username ||
      "Content creator";
    const normalizedChannelSubscribers =
      identity?.followersCount ?? parseWholeNumber(platformAudience);
    const normalizedChannelLogoUrl = selectedHiringIdentity?.avatar_url || identity?.imageUrl || null;
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
      hiringDisplayName: selectedHiringIdentity?.display_name,
      hiringPlatform: selectedHiringIdentity?.platform,
      hiringVerificationStatus: selectedHiringIdentity?.verification_status,
      managedByAgencyName: selectedHiringIdentity?.managed_by_agency_name || undefined,
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
      requiresYouTubeChannel && !selectedHiringIdentity ? identity?.brandId : undefined;
    const normalizedChannelName =
      selectedHiringIdentity?.display_name ||
      identity?.name ||
      platformName.trim() ||
      session?.user?.name ||
      session?.user?.username ||
      "Content creator";
    const normalizedChannelSubscribers =
      identity?.followersCount ?? parseWholeNumber(platformAudience);
    const normalizedChannelLogoUrl = selectedHiringIdentity?.avatar_url || identity?.imageUrl || null;
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
      <div className="px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-6xl grid gap-6 lg:grid-cols-[1fr_420px] items-start">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-5 shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)] sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                    Hiring identity
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">Who are you hiring for?</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    Select the channel or page this job represents. Talent will see the verification status on the job.
                  </p>
                  {draftId ? <p className="mt-2 text-xs text-white/42">You are editing a saved job draft.</p> : null}
                </div>
                <Link
                  href="/you?tab=overview&section=hiring-info&returnTo=/post-job"
                  className="inline-flex h-9 w-fit items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.08]"
                >
                  Add new channel/page
                </Link>
              </div>

              {hiringIdentities.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {hiringIdentities.map((item) => {
                    const selected = item.id === selectedHiringIdentityId;
                    const badgeClass =
                      item.verification_status === "VERIFIED"
                        ? "border-emerald-200/25 bg-emerald-200/10 text-emerald-100"
                        : item.verification_status === "PENDING"
                          ? "border-amber-200/25 bg-amber-200/10 text-amber-100"
                          : item.verification_status === "REJECTED"
                            ? "border-red-200/25 bg-red-200/10 text-red-100"
                            : "border-white/15 bg-white/[0.05] text-white/65";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectHiringIdentity(item)}
                        className={[
                          "rounded-2xl border p-4 text-left transition-colors cursor-pointer",
                          selected
                            ? "border-white/35 bg-white/[0.1]"
                            : "border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08]",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white/90">
                              {item.display_name}
                            </p>
                            <p className="mt-1 text-xs text-white/55">
                              {item.platform === "YOUTUBE" ? "YouTube channel" : "Instagram page"}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass}`}>
                            {item.verification_status === "VERIFIED"
                              ? "Verified"
                              : item.verification_status === "PENDING"
                                ? "Pending"
                                : item.verification_status === "REJECTED"
                                  ? "Rejected"
                                  : "Not verified yet"}
                          </span>
                        </div>
                        {item.is_agency_represented ? (
                          <p className="mt-3 text-xs text-white/60">
                            Managed by {item.managed_by_agency_name || session?.user?.name || "your profile"}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                  <p className="text-sm font-semibold text-white/85">
                    Hiring identity is optional.
                  </p>
                  <p className="mt-1 text-sm text-white/58">
                    You can publish now and add a channel or Instagram page later.
                  </p>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white/84">
                  {draftId ? "Editing a saved job draft" : "Need to finish later?"}
                </p>
                <p className="mt-1 text-xs leading-5 text-white/50">
                  Save a draft now and resume it later from Activity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onSaveDraft()}
                disabled={isSubmitting || draftLoading}
                className="h-10 w-fit cursor-pointer rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/76 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Saving..." : "Save draft"}
              </button>
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
            />
          </div>

          <div className="space-y-6">
            <PreviewCard
              title={title}
              channelName={identity?.name || platformName || "Content creator team"}
              verified={verified}
              subsText={subsText}
              budgetText={previewBudgetText}
              experienceText={previewExperienceText}
              locationText={previewLocationText}
              tags={tags}
              startWithin={startWithin || undefined}
              platform={platform}
              profileImageUrl={identity?.imageUrl || null}
            />

            <PostJobSafety />
          </div>
        </div>
      </div>
    </main>
  );
}
