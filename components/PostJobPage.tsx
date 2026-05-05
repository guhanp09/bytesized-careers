"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendCreateJobPayload,
  BackendMeYouTubeChannel,
  createJob,
  isLocalMocksEnabled,
  listMyYouTubeChannels,
  refreshMyYouTubeChannels,
  upsertGoogleOAuthForMe,
} from "../lib/backendClient";
import { Job, ReferenceVideo, StartTimeframe } from "../lib/types";
import { formatBudgetPreview, formatExperiencePreview, formatSubsInput } from "../lib/format";
import { INDIA_CITIES } from "../lib/indiaCities";
import PostJobForm from "./post-job/PostJobForm";
import PreviewCard from "./post-job/PreviewCard";
import PostJobSafety from "./post-job/PostJobSafety";
import { IdentityPlatform, VerifiedIdentity } from "../lib/identity/types";

const SECONDARY_BTN_BRIGHTNESS = 0.88; // 👈 tweak anytime (0.75–0.95)

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
  const autoConnectHandledRef = useRef(false);
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
  const [basicsErrors, setBasicsErrors] = useState<
    Array<"title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform">
  >([]);
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
  const oauthProviderAccountId = session?.user?.providerAccountId;
  const oauthAccessToken = session?.user?.accessToken;
  const oauthRefreshToken = session?.user?.refreshToken;
  const oauthExpiresAt = session?.user?.oauthExpiresAt;
  const oauthScope = session?.user?.oauthScope;

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
    if (requiresYouTubeChannel && !identity) errors.push("identity");
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
      if (key === "identity") return requiresYouTubeChannel && !identity;
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
    [title, requiresYouTubeChannel, identity, platform, isCityRequired, city, matchedCity, budgetMin, budgetMax]
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
    setVerified(Boolean(identity) && platform === "youtube");
  }, [identity, platform]);

  const loadLinkedYouTubeChannels = useCallback(async () => {
    if (!backendAccessToken) {
      setIdentityOptions([]);
      setIdentity(null);
      return;
    }

    setIdentityLoading(true);
    setIdentityError(null);
    try {
      const data = await listMyYouTubeChannels(backendAccessToken);
      applyVerifiedChannels(data.channels);
    } catch (err) {
      setIdentityOptions([]);
      setIdentity(null);
      setIdentityError(err instanceof Error ? err.message : "Failed to load verified channels.");
    } finally {
      setIdentityLoading(false);
    }
  }, [applyVerifiedChannels, backendAccessToken]);

  const refreshYouTubeVerification = useCallback(async () => {
    if (sessionStatus !== "authenticated") {
      await signIn("google", {
        callbackUrl: "/post-job?yt_connect=1",
        prompt: "select_account",
      });
      return;
    }

    if (!backendAccessToken) {
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
      await upsertGoogleOAuthForMe(backendAccessToken, {
        provider_account_id: oauthProviderAccountId,
        access_token: oauthAccessToken,
        refresh_token: oauthRefreshToken || null,
        expires_at: typeof oauthExpiresAt === "number" ? oauthExpiresAt : null,
        scope: typeof oauthScope === "string" ? oauthScope : null,
      });
      const refreshed = await refreshMyYouTubeChannels(backendAccessToken);
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
    backendAccessToken,
    oauthAccessToken,
    oauthExpiresAt,
    oauthProviderAccountId,
    oauthRefreshToken,
    oauthScope,
    sessionStatus,
  ]);

  React.useEffect(() => {
    if (!requiresYouTubeChannel) {
      return;
    }
    if (sessionStatus !== "authenticated" || !backendAccessToken) {
      setIdentityOptions([]);
      setIdentity(null);
      return;
    }
    void loadLinkedYouTubeChannels();
  }, [backendAccessToken, loadLinkedYouTubeChannels, requiresYouTubeChannel, sessionStatus]);

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
    const selectedYouTubeChannelId = requiresYouTubeChannel ? identity?.brandId : undefined;
    const normalizedChannelName =
      identity?.name ||
      platformName.trim() ||
      session?.user?.name ||
      session?.user?.username ||
      "Creator";
    const normalizedChannelSubscribers =
      identity?.followersCount ?? parseWholeNumber(platformAudience);
    const normalizedChannelLogoUrl = identity?.imageUrl || null;
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
      status: "published",
    };

    if (!isLocalMocksEnabled()) {
      if (sessionStatus !== "authenticated" || !backendAccessToken) {
        setSubmitError("Sign in before posting a job.");
        return;
      }

      setIsSubmitting(true);
      try {
        const created = await createJob(backendPayload, { accessToken: backendAccessToken });
        if (created?.id) {
          window.location.assign("/?posted=1");
          return;
        }
        setSubmitError("The job was created, but the response was incomplete.");
        return;
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Failed to post job to backend.");
        console.error("External backend create failed", error);
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: jobToCreate }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setSubmitError(payload?.error || "Failed to create job.");
        return;
      }
      const data = (await res.json()) as { id?: string };
      if (data?.id) {
        window.location.assign("/?posted=1");
        return;
      }
      setSubmitError("The local job store did not return a created id.");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create job.");
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

  return (
    <main className="min-h-screen text-white bg-[#0b0b0f]">
      <div className="px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-6xl grid gap-6 lg:grid-cols-[1fr_420px] items-start">
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
            secondaryBtnBrightness={SECONDARY_BTN_BRIGHTNESS}
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

          <div className="space-y-6">
            <PreviewCard
              title={title}
              channelName={identity?.name || platformName || "Creator"}
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
