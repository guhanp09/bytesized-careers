import type { BackendTalentListing } from "./backendClient";
import { getJobDraftCompletion, getTalentDraftCompletion } from "./draftCompletion";
import { draftSortKey, type DraftItem } from "./ownerDrafts";
import type { Job } from "./types";

// ---- Demo/mock drafts ----
// Loaded by the server only for an allowed local Mock request. Private drafts
// with missing backend authority never fall into this corpus.
//
// Drafts are not part of the canonical scenario corpus: a draft is unsent work
// with no counterparty and no conversation, so it has nothing to be in parity
// *with*. This list stays local for that reason, not by omission.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

// Each spec carries a synthesized source (Partial<Job> / Partial<BackendTalentListing>)
// so the completion model — the same one used for live drafts — computes realistic
// readiness/strength for the demo set instead of duplicating the logic.
type MockSpec = Omit<DraftItem, "completion"> & {
  jobSource?: Partial<Job>;
  talentSource?: Partial<BackendTalentListing>;
};

const MOCK_SPECS: MockSpec[] = [
  // ---- Job listing drafts ----
  {
    id: "mock-job-draft-incomplete",
    kind: "job",
    title: "Video editor for weekly finance explainers",
    untitled: false,
    statusLabel: "Incomplete",
    statusKind: "incomplete",
    channelName: null,
    meta: ["Editing", "Remote"],
    missingFields: ["Budget", "About the brand", "Tools"],
    nextStep: "Add a budget, brand context, and the tools you expect, then publish.",
    resumeHref: "/post-job?draftId=mock-job-draft-incomplete",
    updatedAtIso: isoAgo(3 * HOUR_MS),
    sortKey: draftSortKey(isoAgo(3 * HOUR_MS)),
    jobSource: { title: "Video editor for weekly finance explainers", platform: "youtube", workMode: "remote" },
  },
  {
    id: "mock-job-draft-waiting",
    kind: "job",
    title: "Thumbnail designer for Instagram reels",
    untitled: false,
    statusLabel: "Waiting for access",
    statusKind: "waiting",
    channelName: "Instagram · @examplechannel",
    meta: ["Thumbnails", "₹800–₹1,200 per month", "Remote"],
    missingFields: [],
    verificationLabel: "Pending",
    nextStep:
      "Access to @examplechannel on Instagram is still being confirmed. Resume to finish confirming access, then publish.",
    resumeHref: "/post-job?draftId=mock-job-draft-waiting",
    updatedAtIso: isoAgo(DAY_MS),
    sortKey: draftSortKey(isoAgo(DAY_MS)),
    jobSource: {
      title: "Thumbnail designer for Instagram reels",
      platform: "instagram",
      hiringDisplayName: "@examplechannel",
      hiringIdentityId: "mock-waiting-identity",
      hiringVerificationStatus: "PENDING",
      workMode: "remote",
      budget: "₹800–₹1,200 per month",
      tools: ["Photoshop"],
      tags: ["thumbnails"],
    },
  },
  {
    id: "mock-job-draft-verification-failed",
    kind: "job",
    title: "Channel manager for YouTube uploads",
    untitled: false,
    statusLabel: "Verification failed",
    statusKind: "failed",
    channelName: "YouTube · @examplechannel",
    meta: ["Channel Manager", "₹2,000–₹3,000 per month", "Remote"],
    missingFields: [],
    verificationLabel: "Failed",
    failureReason: "Verification code wasn’t found on the channel — access couldn’t be confirmed.",
    nextStep:
      "We couldn’t confirm access to @examplechannel. Resume to retry verification or choose a different hiring channel.",
    resumeHref: "/post-job?draftId=mock-job-draft-verification-failed",
    updatedAtIso: isoAgo(2 * DAY_MS),
    sortKey: draftSortKey(isoAgo(2 * DAY_MS)),
    jobSource: {
      title: "Channel manager for YouTube uploads",
      platform: "youtube",
      hiringDisplayName: "@examplechannel",
      hiringIdentityId: "mock-failed-identity",
      hiringVerificationStatus: "REJECTED",
      workMode: "remote",
      budget: "₹2,000–₹3,000 per month",
    },
  },
  {
    id: "mock-job-draft-publish-failed",
    kind: "job",
    title: "Script writer for documentary-style videos",
    untitled: false,
    statusLabel: "Publish failed",
    statusKind: "failed",
    channelName: "YouTube · @historydeepdives",
    meta: ["Writing", "₹1,500 per script", "Remote"],
    missingFields: [],
    verificationLabel: "Confirmed",
    failureReason: "Publishing failed because of a network error. Your draft is safe.",
    nextStep: "Publishing didn’t go through last time. Resume to try publishing again.",
    resumeHref: "/post-job?draftId=mock-job-draft-publish-failed",
    updatedAtIso: isoAgo(3 * DAY_MS),
    sortKey: draftSortKey(isoAgo(3 * DAY_MS)),
    jobSource: {
      title: "Script writer for documentary-style videos",
      platform: "youtube",
      hiringDisplayName: "@historydeepdives",
      hiringIdentityId: "mock-publish-failed-identity",
      hiringVerificationStatus: "VERIFIED",
      workMode: "remote",
      budget: "₹1,500 per script",
      tools: ["Notion"],
      responsibilities: "Research and write documentary-style scripts.",
    },
  },
  {
    id: "mock-job-draft-ready",
    kind: "job",
    title: "Motion graphics editor for explainer channel",
    untitled: false,
    statusLabel: "Draft",
    statusKind: "draft",
    channelName: "YouTube · @explainlab",
    meta: ["Motion Graphics", "₹3,000 per video", "Remote"],
    missingFields: [],
    verificationLabel: "Confirmed",
    nextStep: "Everything required is filled in. Resume for a final review, then publish.",
    resumeHref: "/post-job?draftId=mock-job-draft-ready",
    updatedAtIso: isoAgo(5 * DAY_MS),
    sortKey: draftSortKey(isoAgo(5 * DAY_MS)),
    jobSource: {
      title: "Motion graphics editor for explainer channel",
      platform: "youtube",
      hiringDisplayName: "@explainlab",
      hiringIdentityId: "mock-ready-identity",
      hiringVerificationStatus: "VERIFIED",
      workMode: "remote",
      budget: "₹3,000 per video",
      about: "Explainer videos for a creator-led education channel.",
      tools: ["After Effects"],
      tags: ["motion-graphics"],
      responsibilities: "Animate explainer segments and lower-thirds.",
      requirements: "2+ years of motion design experience.",
      referenceVideos: [{ url: "https://www.youtube.com/watch?v=example" }],
    },
  },

  // ---- Talent listing drafts ----
  {
    id: "mock-talent-draft-incomplete",
    kind: "talent",
    title: "Retention editor for YouTube channels",
    untitled: false,
    statusLabel: "Incomplete",
    statusKind: "incomplete",
    channelName: null,
    meta: ["Video Editor", "Education"],
    missingFields: ["Rate", "Portfolio sample"],
    nextStep: "Add your rate and at least one portfolio sample to publish.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-incomplete",
    updatedAtIso: isoAgo(6 * HOUR_MS),
    sortKey: draftSortKey(isoAgo(6 * HOUR_MS)),
    talentSource: {
      title: "Retention editor for YouTube channels",
      primary_role: "Video Editor",
      work_mode: "remote",
      niche: "Education",
      tools: ["Premiere Pro"],
    },
  },
  {
    id: "mock-talent-draft-ready",
    kind: "talent",
    title: "Thumbnail designer for tech and finance channels",
    untitled: false,
    statusLabel: "Draft",
    statusKind: "draft",
    channelName: null,
    meta: ["Thumbnail Designer", "Tech", "₹1,000 per month"],
    missingFields: [],
    nextStep: "Most fields are done. Resume for a final pass, then publish your listing.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-ready",
    updatedAtIso: isoAgo(2 * DAY_MS),
    sortKey: draftSortKey(isoAgo(2 * DAY_MS)),
    talentSource: {
      title: "Thumbnail designer for tech and finance channels",
      primary_role: "Thumbnail Designer",
      work_mode: "remote",
      rate_min: 1000,
      rate_currency: "INR",
      niche: "Tech",
      tools: ["Photoshop", "Figma"],
      description: "Bold, high-CTR thumbnails for tech and finance creators.",
      experience_years: 3,
      portfolio_item_ids: ["mock-portfolio-1", "mock-portfolio-2"],
    },
  },
  {
    id: "mock-talent-draft-publish-failed",
    kind: "talent",
    title: "Shorts editor for daily faceless channels",
    untitled: false,
    statusLabel: "Publish failed",
    statusKind: "failed",
    channelName: null,
    meta: ["Shorts Editor", "Shorts", "₹1,200 per month"],
    missingFields: [],
    failureReason: "Couldn’t publish your listing — please try again.",
    nextStep: "Publishing didn’t go through. Resume to try again.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-publish-failed",
    updatedAtIso: isoAgo(4 * DAY_MS),
    sortKey: draftSortKey(isoAgo(4 * DAY_MS)),
    talentSource: {
      title: "Shorts editor for daily faceless channels",
      primary_role: "Shorts Editor",
      work_mode: "remote",
      rate_min: 1200,
      rate_currency: "INR",
      niche: "Shorts",
    },
  },
  {
    id: "mock-talent-draft-untitled",
    kind: "talent",
    title: "Untitled talent draft",
    untitled: true,
    statusLabel: "Incomplete",
    statusKind: "incomplete",
    channelName: null,
    meta: ["Voice Over"],
    missingFields: ["Title", "Rate", "Skills", "Description"],
    nextStep: "You’ve picked a role. Add a title and the remaining details to publish.",
    resumeHref: "/post-talent?draftId=mock-talent-draft-untitled",
    updatedAtIso: isoAgo(8 * DAY_MS),
    sortKey: draftSortKey(isoAgo(8 * DAY_MS)),
    talentSource: { primary_role: "Voice Over" },
  },
];

const MOCK_DRAFTS: DraftItem[] = MOCK_SPECS.map(({ jobSource, talentSource, ...item }) => ({
  ...item,
  completion: item.kind === "job" ? getJobDraftCompletion(jobSource ?? {}) : getTalentDraftCompletion(talentSource ?? {}),
  sourceJob: item.kind === "job" ? jobSource : undefined,
  sourceTalent: item.kind === "talent" ? talentSource : undefined,
}));

export const MOCK_OWNER_DRAFTS: DraftItem[] = [...MOCK_DRAFTS].sort((a, b) => b.sortKey - a.sortKey);
