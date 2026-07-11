import type {
  ActivitySummary,
  BackendJobApplication,
  BackendTalentInterest,
  BackendTalentListing,
} from "./backendClient";
import type { FirstMessageAnswers } from "./firstMessageRequirements";
import { formatTalentListingExperience, formatTalentRate } from "./talentListing";
import type { Job } from "./types";

export type InteractionMode = "talent" | "hiring";
export type InteractionDirection = "sent" | "received";
export type InteractionKind = "application" | "hiring_request";

export type InteractionStatus =
  | "new"
  | "pending"
  | "viewed"
  | "responded"
  | "shortlisted"
  | "accepted"
  | "hired"
  | "declined"
  | "withdrawn"
  | "closed";

export type InteractionTimelineEvent = {
  id: string;
  label: string;
  at: string;
};

export type InteractionThreadMessage = {
  from: string;
  body: string;
  atLabel: string;
  /** "status" marks a platform-generated stage update rendered apart from bubbles. */
  kind?: "status";
};

export type InteractionJobSnapshot = {
  jobId?: string | null;
  title: string;
  /** Omitted for the owner's own job listings, where repeating it is noise. */
  channelName?: string | null;
  channelLogoUrl?: string | null;
  channelProfileSlug?: string | null;
  budget: string;
  workMode: string;
  location?: string | null;
  experience?: string | null;
  tags: string[];
  listingStatus?: string | null;
};

export type InteractionTalentSnapshot = {
  profileSlug?: string | null;
  name: string;
  avatarUrl?: string | null;
  headline: string;
  /** Human rate label (e.g. "₹2,000–₹3,500 per video"); the talent mirror of a job's budget. */
  rate?: string | null;
  /** Talent experience as exact whole years (e.g. "3 years") — never a range or level label. */
  experience?: string | null;
  location?: string | null;
  availability?: string | null;
  bio?: string | null;
  tools: string[];
  niches: string[];
  experienceNote?: string | null;
  portfolioHighlights: Array<{ title: string; detail: string }>;
  /**
   * True when the snapshot is the viewer's *own* talent listing (a received hiring
   * request). The context card then genericises the identity to "Your listing" —
   * mirroring how the job card omits the channel for the owner's own job postings.
   */
  isOwnListing?: boolean;
};

export type InteractionRecruiterSnapshot = {
  profileSlug?: string | null;
  name: string;
  avatarUrl?: string | null;
  channelName?: string | null;
  audienceLabel?: string | null;
  platform?: string | null;
  hiringFor?: string | null;
};

export type OwnerInteraction = {
  id: string;
  mode: InteractionMode;
  direction: InteractionDirection;
  kind: InteractionKind;
  status: InteractionStatus;
  /**
   * Raw backend status (pipeline vocabulary). Present on live items; mock/demo
   * items derive it via applicationPipeline.backendStatusOf's reverse map.
   */
  backendStatus?: string | null;
  /** The manager's private note on a received item. Never present on sent items. */
  managerNote?: string | null;
  /**
   * Seed notes for the private-notes stack on a received item (demo/mock only).
   * The panel is local-first (localStorage per conversation); these seed it so the
   * stacked-note experience has believable history before the user adds their own.
   * Newest first.
   */
  privateNotes?: Array<{ id: string; body: string; createdAt: string }>;
  title: string;
  /** Short subject line for rows where the title is a person's name. */
  contextLabel?: string | null;
  counterpartyName: string;
  counterpartyAvatarUrl?: string | null;
  createdAtLabel: string;
  updatedAtLabel: string;
    unread?: boolean;
  message: string;
  /**
   * Structured answers the requester gave to the owner's first-message
   * requirements. Context is implied by {@link kind}: an "application" carries
   * job-context answers; a "hiring_request" carries talent-context answers.
   * Absent/empty for legacy interactions, so the inbox stays backward compatible.
   */
  firstMessageAnswers?: FirstMessageAnswers | null;
  proposedTerms?: string | null;
  attachments?: Array<{ label: string; url?: string | null }>;
  response?: InteractionThreadMessage | null;
  /** Local demo replies composed from the workspace; not persisted. */
  replies?: InteractionThreadMessage[];
  job?: InteractionJobSnapshot | null;
  talent?: InteractionTalentSnapshot | null;
  recruiter?: InteractionRecruiterSnapshot | null;
  sourceListingTitle?: string | null;
  timeline: InteractionTimelineEvent[];
};

export const ARCHIVED_INTERACTION_STATUSES: InteractionStatus[] = [
  "accepted",
  "hired",
  "declined",
  "withdrawn",
  "closed",
];

export function isArchivedInteraction(item: OwnerInteraction): boolean {
  return ARCHIVED_INTERACTION_STATUSES.includes(item.status);
}

export function interactionStatusLabel(status: InteractionStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "pending":
      return "Pending";
    case "viewed":
      return "Viewed";
    case "responded":
      return "Responded";
    case "shortlisted":
      return "Shortlisted";
    case "accepted":
      return "Accepted";
    case "hired":
      return "Hired";
    case "declined":
      return "Declined";
    case "withdrawn":
      return "Withdrawn";
    case "closed":
      return "Closed";
  }
}

export function interactionKindLabel(item: Pick<OwnerInteraction, "direction" | "kind">): string {
  if (item.kind === "application") {
    return item.direction === "sent" ? "Sent application" : "Received application";
  }
  return item.direction === "sent" ? "Sent hiring request" : "Received hiring request";
}

/**
 * The viewer's own talent listing, shown as the context card for every received
 * hiring request (a recruiter is interested in this listing). One listing is
 * reused across the demo requests, matching their shared sourceListingTitle.
 */
const OWN_TALENT_LISTING_SNAPSHOT: InteractionTalentSnapshot = {
  profileSlug: "demo-owner",
  name: "Your listing",
  headline: "Retention-focused long-form and shorts editing",
  rate: "₹2,000–₹3,500 per video",
  experience: "Less than 1 year",
  location: "Remote",
  availability: "Available · 2 retainer slots",
  tools: ["Premiere Pro", "After Effects"],
  niches: ["Finance", "Education", "Shorts"],
  experienceNote: "4 yrs editing for creator-led finance and education channels",
  portfolioHighlights: [],
  isOwnListing: true,
};

export const MOCK_OWNER_INTERACTIONS: OwnerInteraction[] = [
  // ---- Talent mode: applications this user sent to jobs ----
  {
    id: "t-app-sent-1",
    mode: "talent",
    direction: "sent",
    kind: "application",
    status: "pending",
    title: "Video editor for YouTube (long-form, retention-focused)",
    counterpartyName: "Finance Channel",
    counterpartyAvatarUrl: "https://picsum.photos/seed/finance/96/96",
    createdAtLabel: "2h ago",
    updatedAtLabel: "2h ago",
    message:
      "Hi — I edit long-form finance and education videos with a focus on retention pacing. I rebuilt the structure for two explainer channels last quarter and can match your captions and sound style from the references. Happy to do a paid test edit on one of your recent uploads.",
    firstMessageAnswers: {
      expected_rate: { amount: "2,800", unit: "per project" },
      relevant_portfolio: [
        {
          id: "t-app-sent-1-portfolio-1",
          title: "Retention edit — Finance explainer",
          url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
          type: "Long-form edit",
          platform: "YouTube",
          description:
            "Edited a 14-minute personal-finance explainer: hook rewrite, pacing restructure, captions, B-roll, and final export.",
          role: "End-to-end edit, caption pass, sound cleanup",
          metrics: ["42% average retention lift", "1.8M views", "Edited end-to-end"],
          tags: ["Retention", "Finance", "YouTube"],
          tools: ["Premiere Pro", "After Effects", "DaVinci Resolve"],
          timestampNotes: [
            { time: "0:00", seconds: 0, title: "Rewritten hook", description: "New cold-open that reframes the question in the first 8 seconds." },
            { time: "3:42", seconds: 222, title: "Pacing restructure", description: "Cut two minutes of setup and tightened the middle third." },
            { time: "9:15", seconds: 555, title: "B-roll + callouts", description: "Motion callouts over the data section for retention." },
          ],
        },
        {
          id: "t-app-sent-1-portfolio-2",
          title: "Captions + sound style reel",
          url: "https://portfolio.example.com/reels/caption-sound-style",
          type: "Shorts reel",
          platform: "Instagram",
          description:
            "A compilation of caption-heavy short-form edits with music ducking and punch-in timing.",
          role: "Caption design, sound design",
          tags: ["Captions", "Sound design"],
          tools: ["Premiere Pro", "CapCut"],
        },
        {
          id: "t-app-sent-1-portfolio-3",
          title: "Education series — 8-video pack",
          url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
          type: "Channel package",
          platform: "YouTube",
          description:
            "Full-season edit for a beginner-investing series with a repeatable template and consistent lower-thirds.",
          role: "Series lead editor",
          metrics: ["8-video series", "Delivered in 6 weeks"],
          tags: ["Education", "Explainer"],
          tools: ["Premiere Pro", "After Effects"],
          timestampNotes: [
            { time: "0:05", seconds: 5, title: "Series intro template", description: "Reusable animated intro built once and re-timed per episode." },
            { time: "6:30", seconds: 390, title: "Lower-thirds system", description: "Consistent lower-thirds and chapter cards across the pack." },
          ],
        },
      ],
      turnaround: { value: "3", unit: "days" },
      working_hours: "Evenings IST",
      relevant_experience: "2 finance explainers and 1 education series edited end to end last quarter.",
      tools_workflow: ["Premiere Pro", "After Effects", "Frame.io"],
      start_availability: "Within 1 week",
      fit_note: "I already edit finance and education videos with a retention-first workflow.",
      custom_instruction: {
        prompt: "Share one similar explainer you worked on and what you personally handled.",
        response: "I handled the pacing restructure, caption pass, sound cleanup, and final upload-ready export.",
        links: ["https://www.youtube.com/watch?v=jNQXAC9IVRw"],
      },
    },
    attachments: [
      { label: "Retention edit — Finance explainer", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
      { label: "Captions + sound style reel", url: "https://portfolio.example.com/reels/caption-sound-style" },
    ],
    job: {
      jobId: "1",
      title: "Video editor for YouTube (long-form, retention-focused)",
      channelName: "Finance Channel",
      channelLogoUrl: "https://picsum.photos/seed/finance/96/96",
      channelProfileSlug: "finance-creator",
      budget: "₹350–₹3,500 per project",
      workMode: "One-time · Remote",
      location: "Remote",
      experience: "1–3 years",
      tags: ["Premiere", "Story pace", "SFX", "Captions"],
      listingStatus: "Open",
    },
    timeline: [{ id: "t-app-sent-1-applied", label: "Application sent", at: "2h ago" }],
  },
  {
    id: "t-app-sent-2",
    mode: "talent",
    direction: "sent",
    kind: "application",
    status: "responded",
    title: "Shorts editor for daily YouTube Shorts (fast paced, captions)",
    counterpartyName: "Motivation Shorts",
    counterpartyAvatarUrl: "https://picsum.photos/seed/motivation/96/96",
    createdAtLabel: "3d ago",
    updatedAtLabel: "5h ago",
    unread: true,
    message:
      "I can run a daily shorts pipeline and keep your caption style consistent across editors.",
    firstMessageAnswers: {
      expected_rate: { amount: "1,200", unit: "per month" },
      turnaround: { value: "24", unit: "hours" },
      working_hours: "Mornings IST",
      relevant_experience: "Daily shorts pipeline for two faceless channels.",
      tools_workflow: ["CapCut", "Premiere Pro"],
      start_availability: "Immediately",
      fit_note: "I can run a daily shorts pipeline and keep your caption style consistent across editors.",
    },
    attachments: [{ label: "Shorts pacing reel", url: "https://portfolio.example.com/sample/shorts-reel" }],
    response: {
      from: "Motivation Shorts",
      body: "Your pacing reel is close to what we want. Can you start with a one-week trial batch of 5 shorts using next week's scripts?",
      atLabel: "5h ago",
    },
    replies: [
      {
        from: "You",
        body: "Happy to. I can pull next week's scripts from the shared drive and deliver the first batch of 5 within three days, captions in your house style.",
        atLabel: "4h ago",
      },
      {
        from: "Motivation Shorts",
        body: "Perfect. What's your availability for a 15-minute kickoff call this week to walk through the caption presets?",
        atLabel: "3h ago",
      },
    ],
    job: {
      jobId: "4",
      title: "Shorts editor for daily YouTube Shorts (fast paced, captions)",
      channelName: "Motivation Shorts",
      channelLogoUrl: "https://picsum.photos/seed/motivation/96/96",
      channelProfileSlug: "motivation-shorts",
      budget: "₹800–₹1,600 per month",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "1–2 years",
      tags: ["CapCut", "Captions", "Beat sync", "Hooks"],
      listingStatus: "Open",
    },
    timeline: [
      { id: "t-app-sent-2-applied", label: "Application sent", at: "3d ago" },
      { id: "t-app-sent-2-viewed", label: "Viewed by Motivation Shorts", at: "2d ago" },
      { id: "t-app-sent-2-responded", label: "Response received", at: "5h ago" },
    ],
  },
  {
    id: "t-app-sent-3",
    mode: "talent",
    direction: "sent",
    kind: "application",
    status: "declined",
    title: "Thumbnail designer (CTR-focused, 2–3 concepts)",
    counterpartyName: "Tech Channel",
    counterpartyAvatarUrl: "https://picsum.photos/seed/tech/96/96",
    createdAtLabel: "1w ago",
    updatedAtLabel: "4d ago",
    message:
      "I design high-contrast thumbnail concepts with fast iteration — usually 3 directions within 24 hours. Sharing a packaging set I did for a hardware review channel in a similar niche.",
    proposedTerms: "₹900 per month · 8 thumbnails",
    response: {
      from: "Tech Channel",
      body: "Thanks for the samples — your work is strong. We went with someone who had more long-form documentary packaging experience for this batch. We'll keep your profile for the next round.",
      atLabel: "4d ago",
    },
    job: {
      jobId: "2",
      title: "Thumbnail designer (CTR-focused, 2–3 concepts)",
      channelName: "Tech Channel",
      channelLogoUrl: "https://picsum.photos/seed/tech/96/96",
      channelProfileSlug: "tech-channel",
      budget: "₹600–₹1,200 per month",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "1–3 years",
      tags: ["Photoshop", "CTR", "Packaging"],
      listingStatus: "Open",
    },
    timeline: [
      { id: "t-app-sent-3-applied", label: "Application sent", at: "1w ago" },
      { id: "t-app-sent-3-viewed", label: "Viewed by Tech Channel", at: "6d ago" },
      { id: "t-app-sent-3-declined", label: "Declined by Tech Channel", at: "4d ago" },
    ],
  },
  {
    id: "t-app-sent-4",
    mode: "talent",
    direction: "sent",
    kind: "application",
    status: "viewed",
    title: "Script writer for Hindi explainers (8–10 mins)",
    counterpartyName: "Gyaan Express",
    counterpartyAvatarUrl: "https://picsum.photos/seed/gyaan/96/96",
    createdAtLabel: "2d ago",
    updatedAtLabel: "1d ago",
    message:
      "I write Hindi explainer scripts with a clear hook, simple analogies, and a tight 8–10 minute structure. I can match your conversational tone and include on-screen cue notes for the editor.",
    firstMessageAnswers: {
      relevant_experience: "Wrote 18 Hindi explainers across education and current-affairs channels.",
      start_availability: "Within 2 weeks",
      custom_instruction: {
        prompt: "Share a tight opening hook for a phone review video.",
        response:
          "Most phone reviews answer specs. I would open by showing the one everyday moment where the phone either saves you time or annoys you immediately.",
        links: [],
      },
    },
    job: {
      jobId: "5",
      title: "Script writer for Hindi explainers (8–10 mins)",
      channelName: "Gyaan Express",
      channelLogoUrl: "https://picsum.photos/seed/gyaan/96/96",
      channelProfileSlug: "gyaan-express",
      budget: "₹1,200–₹2,000 per script",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "1–3 years",
      tags: ["Hindi", "Scripts", "Explainers", "Hooks"],
      listingStatus: "Open",
    },
    timeline: [
      { id: "t-app-sent-4-applied", label: "Application sent", at: "2d ago" },
      { id: "t-app-sent-4-viewed", label: "Viewed by Gyaan Express", at: "1d ago" },
    ],
  },
  {
    id: "t-app-sent-5",
    mode: "talent",
    direction: "sent",
    kind: "application",
    status: "shortlisted",
    title: "Long-form editor for documentary-style finance deep dives",
    counterpartyName: "Moneywise India",
    counterpartyAvatarUrl: "https://picsum.photos/seed/moneywise/96/96",
    createdAtLabel: "6d ago",
    updatedAtLabel: "1d ago",
    unread: true,
    message:
      "I edit documentary-style finance videos — narrative pacing, archival overlays, and clean sound design. I've linked two deep dives I cut end to end and can adapt to your reference style.",
    firstMessageAnswers: {
      expected_rate: { amount: "3,500", unit: "per video" },
      relevant_portfolio: [
        {
          id: "t-app-sent-5-portfolio-1",
          title: "Deep dive — market crash explainer",
          url: "https://portfolio.example.com/docs/market-crash-deep-dive",
          type: "Documentary edit",
          platform: "YouTube",
          description:
            "22-minute documentary-style breakdown with archival overlays, narration timing, and layered sound design.",
          role: "Narrative edit, archival research, sound design",
          metrics: ["Avg view duration 11:04", "94% of runtime is original edit"],
          tags: ["Documentary", "Finance", "Sound design"],
        },
        {
          id: "t-app-sent-5-portfolio-2",
          title: "Deep dive — startup story",
          url: "https://portfolio.example.com/docs/startup-story",
          type: "Documentary edit",
          platform: "YouTube",
          description: "Founder-story cut with interview weaving, B-roll pacing, and a cold-open hook.",
          role: "Lead editor",
          tags: ["Documentary", "Retention"],
        },
      ],
      turnaround: { value: "5", unit: "days" },
      tools_workflow: ["Premiere Pro", "After Effects", "Audition"],
      fit_note: "Your documentary-style finance brief matches the pacing and archival work I already do.",
    },
    attachments: [
      { label: "Deep dive — market crash explainer", url: "https://portfolio.example.com/docs/market-crash-deep-dive" },
      { label: "Deep dive — startup story", url: "https://portfolio.example.com/docs/startup-story" },
    ],
    response: {
      from: "Moneywise India",
      body: "We liked your explainers work and shortlisted you. Can you share two more samples with heavier archival/B-roll use?",
      atLabel: "1d ago",
    },
    job: {
      jobId: "6",
      title: "Long-form editor for documentary-style finance deep dives",
      channelName: "Moneywise India",
      channelLogoUrl: "https://picsum.photos/seed/moneywise/96/96",
      channelProfileSlug: "moneywise-india",
      budget: "₹3,000–₹4,500 per video",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "3–5 years",
      tags: ["Premiere", "Documentary", "B-roll", "Sound design"],
      listingStatus: "Open",
    },
    timeline: [
      { id: "t-app-sent-5-applied", label: "Application sent", at: "6d ago" },
      { id: "t-app-sent-5-viewed", label: "Viewed by Moneywise India", at: "3d ago" },
      { id: "t-app-sent-5-shortlisted", label: "Shortlisted by Moneywise India", at: "1d ago" },
    ],
  },

  // ---- Talent mode: hiring requests this user received on their talent listing ----
  {
    id: "t-req-recv-1",
    mode: "talent",
    direction: "received",
    kind: "hiring_request",
    status: "new",
    managerNote: "Daily channel — confirm the Monday handoff works before accepting.",
    title: "Shorts editing package — 15 shorts per month",
    counterpartyName: "Motivation Shorts",
    counterpartyAvatarUrl: "https://picsum.photos/seed/motivation/96/96",
    createdAtLabel: "1d ago",
    updatedAtLabel: "1d ago",
    unread: true,
    message:
      "Hi, I came across your listing and would like to discuss a monthly Shorts package.",
    // Structured answers to the talent's first-message requirements (talent context).
    firstMessageAnswers: {
      project_budget: { amount: "1,400", unit: "per month" },
      project_brief:
        "15 Shorts per month in our house caption style. Scripts and raw clips are ready every Monday; 2 revision rounds per short.",
      turnaround: { value: "2", unit: "days" },
      working_hours: "Weekly delivery",
      channel_or_brand_link: "https://youtube.com/@motivationshorts",
      reference_links: [
        {
          url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
          title: "Fast-paced motivation short",
          note: "Match the pacing, punch-in captions, and quick motivational payoff.",
          timestampNotes: [
            { time: "0:03", seconds: 3, title: "Hook", description: "Opens on the payoff line, not a slow build." },
            { time: "0:18", seconds: 18, title: "Caption density", description: "Two-word punch-in captions synced to the beat." },
          ],
        },
        {
          url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
          title: "Caption + sound benchmark",
          note: "Use this as the sound-design and music-ducking benchmark.",
          timestampNotes: [
            { time: "0:24", seconds: 24, title: "Music duck", description: "Music dips under the voice line — match this feel." },
          ],
        },
      ],
      start_availability: "Immediately",
      fit_note: "Your retention work fits our daily channel and we already have a steady content pipeline.",
      custom_instruction: {
        prompt: "Share the channel context, one reference to match, and what success would look like in the first month.",
        response:
          "This is for a daily motivation Shorts channel. We want pacing close to the two references and success means 15 on-brand shorts delivered without daily hand-holding.",
        links: ["https://www.youtube.com/watch?v=9bZkp7q19f0"],
      },
    },
    recruiter: {
      profileSlug: "motivation-shorts",
      name: "Motivation Shorts",
      avatarUrl: "https://picsum.photos/seed/motivation/96/96",
      channelName: "Motivation Shorts",
      audienceLabel: "412K subscribers",
      platform: "YouTube",
      hiringFor: "Daily faceless shorts channel",
    },
    sourceListingTitle: "Retention-focused long-form and shorts editing",
    talent: OWN_TALENT_LISTING_SNAPSHOT,
    timeline: [{ id: "t-req-recv-1-sent", label: "Request received", at: "1d ago" }],
  },
  {
    id: "t-req-recv-2",
    mode: "talent",
    direction: "received",
    kind: "hiring_request",
    status: "accepted",
    title: "Monthly retainer — 4 long-form edits",
    counterpartyName: "Finance Channel",
    counterpartyAvatarUrl: "https://picsum.photos/seed/finance/96/96",
    createdAtLabel: "3d ago",
    updatedAtLabel: "2d ago",
    message:
      "We publish one long-form explainer a week and want a single editor who owns pacing, captions, and sound. Your listing matches the brief — open to a monthly retainer starting next cycle.",
    firstMessageAnswers: {
      project_budget: { amount: "3,200", unit: "per month" },
      project_brief:
        "4 long-form finance explainers per month. Scripts and references are ready before kickoff; you own pacing, captions, and sound cleanup.",
      turnaround: { value: "5", unit: "days" },
      working_hours: "Weekly delivery",
      channel_or_brand_link: "https://youtube.com/@financecreator",
      start_availability: "Within 2 weeks",
    },
    response: {
      from: "Finance Channel",
      body: "Great to have you on board. I'll share the first month's scripts and our brand kit on Monday so you can plan the batch.",
      atLabel: "2d ago",
    },
    recruiter: {
      profileSlug: "finance-creator",
      name: "Finance Channel",
      avatarUrl: "https://picsum.photos/seed/finance/96/96",
      channelName: "Finance Channel",
      audienceLabel: "128K subscribers",
      platform: "YouTube",
      hiringFor: "Weekly finance explainers",
    },
    sourceListingTitle: "Retention-focused long-form and shorts editing",
    talent: OWN_TALENT_LISTING_SNAPSHOT,
    timeline: [
      { id: "t-req-recv-2-sent", label: "Request received", at: "3d ago" },
      { id: "t-req-recv-2-accepted", label: "Accepted by you", at: "2d ago" },
    ],
  },
  {
    id: "t-req-recv-3",
    mode: "talent",
    direction: "received",
    kind: "hiring_request",
    status: "declined",
    title: "Documentary research + assembly edit",
    counterpartyName: "History Deep Dives",
    counterpartyAvatarUrl: "https://picsum.photos/seed/history/96/96",
    createdAtLabel: "1w ago",
    updatedAtLabel: "6d ago",
    message:
      "Looking for one person to handle source pulls and a first assembly cut for a 25-minute documentary. Timeline is six weeks with weekly check-ins.",
    firstMessageAnswers: {
      project_budget: { amount: "6,000", unit: "per project" },
      project_brief:
        "Source pulls, research board, and first assembly cut for a 25-minute documentary episode.",
      turnaround: { value: "6", unit: "weeks" },
      reference_links: [
        {
          url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
          title: "Archival-heavy documentary",
          note: "Reference for archival overlay density and narration pacing — not the exact visual style.",
          timestampNotes: [
            { time: "1:12", seconds: 72, title: "Archival overlay", description: "Layered stills with subtle motion under the VO." },
            { time: "4:30", seconds: 270, title: "Chapter transition", description: "Clean act break with a title card and music swell." },
          ],
        },
        {
          url: "https://vimeo.com/76979871",
          title: "Assembly pacing reference",
          note: "Use this only for the first-assembly rhythm — how scenes are ordered before polish.",
        },
      ],
      fit_note: "Your long-form structure work looks aligned with documentary research-heavy edits.",
    },
    recruiter: {
      profileSlug: "history-deep-dives",
      name: "History Deep Dives",
      avatarUrl: "https://picsum.photos/seed/history/96/96",
      channelName: "History Deep Dives",
      audienceLabel: "208K subscribers",
      platform: "YouTube",
      hiringFor: "Documentary-style deep dives",
    },
    sourceListingTitle: "Retention-focused long-form and shorts editing",
    talent: OWN_TALENT_LISTING_SNAPSHOT,
    timeline: [
      { id: "t-req-recv-3-sent", label: "Request received", at: "1w ago" },
      { id: "t-req-recv-3-declined", label: "Declined by you", at: "6d ago" },
    ],
  },
  {
    id: "t-req-recv-4",
    mode: "talent",
    direction: "received",
    kind: "hiring_request",
    status: "pending",
    title: "Thumbnail + packaging help for gaming channel",
    counterpartyName: "Pixel Rush",
    counterpartyAvatarUrl: "https://picsum.photos/seed/pixelrush/96/96",
    createdAtLabel: "10h ago",
    updatedAtLabel: "10h ago",
    unread: true,
    message: "",
    firstMessageAnswers: {
      project_budget: { amount: "1,000", unit: "per month" },
      project_brief: "10 gaming thumbnails per month with two concept directions for each main upload.",
      turnaround: { value: "2", unit: "days" },
      channel_or_brand_link: "https://youtube.com/@pixelrush",
      fit_note: "Your retention and packaging work seems close to the style we need for our gaming channel.",
    },
    recruiter: {
      profileSlug: "pixel-rush",
      name: "Pixel Rush",
      avatarUrl: "https://picsum.photos/seed/pixelrush/96/96",
      channelName: "Pixel Rush",
      audienceLabel: "76K subscribers",
      platform: "YouTube",
      hiringFor: "Gaming highlights channel",
    },
    sourceListingTitle: "Retention-focused long-form and shorts editing",
    talent: OWN_TALENT_LISTING_SNAPSHOT,
    timeline: [{ id: "t-req-recv-4-sent", label: "Request received", at: "10h ago" }],
  },

  // ---- Recruiter mode: applications received on this user's job listings ----
  {
    id: "r-app-recv-1",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "new",
    title: "Aarav Mehta",
    counterpartyName: "Aarav Mehta",
    createdAtLabel: "4h ago",
    updatedAtLabel: "4h ago",
    unread: true,
    message:
      "Hi, I came across the listing and would love to be considered for the long-form editor role.",
    attachments: [
      { label: "Retention case study", url: "https://portfolio.example.com/aarav/case-study" },
    ],
    // Structured answers to the recruiter's first-message requirements (job context).
    firstMessageAnswers: {
      expected_rate: { amount: "2,500", unit: "per video" },
      relevant_portfolio: [
        {
          id: "demo-portfolio-1",
          title: "Retention rebuild — market explainer",
          url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
          type: "Retention edit",
          platform: "YouTube",
          description:
            "Re-cut of a finance explainer that was losing viewers at the intro — new hook, tighter pacing, on-screen callouts.",
          role: "Edit rebuild, hook rewrite, motion callouts",
          metrics: ["Retention 38% → 54%", "1.2M views"],
          tags: ["Retention", "Finance", "Explainer"],
          tools: ["Premiere Pro", "After Effects"],
          timestampNotes: [
            { time: "0:00", seconds: 0, title: "New hook", description: "Original opened on a logo sting; replaced with a question hook." },
            { time: "2:10", seconds: 130, title: "Tightened setup", description: "Removed ~40s of repetition before the first payoff." },
            { time: "5:48", seconds: 348, title: "Motion callouts", description: "On-screen numbers to hold attention through the data." },
          ],
        },
        {
          id: "demo-portfolio-2",
          title: "Series packaging — education channel",
          url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
          type: "Channel package",
          platform: "YouTube",
          description: "Built a reusable intro, lower-thirds, and end-screen system for a 12-video education series.",
          role: "Motion graphics, template system",
          metrics: ["12-video series", "Motion graphics"],
          tags: ["Motion graphics", "Education"],
          tools: ["After Effects", "Illustrator"],
          timestampNotes: [
            { time: "0:03", seconds: 3, title: "Animated intro", description: "Template intro that re-times to each episode's title." },
            { time: "8:20", seconds: 500, title: "End-screen system", description: "Consistent end-screen with next-video + subscribe." },
          ],
        },
      ],
      turnaround: { value: "4", unit: "days" },
      working_hours: "Evenings IST",
      relevant_experience: "3 years editing weekly finance explainers for two creator-led channels.",
      tools_workflow: ["Premiere Pro", "After Effects", "Audition"],
      start_availability: "Within 1 week",
      fit_note: "I already edit in your niche, so I can match the channel’s pacing from day one.",
    },
    job: {
      jobId: null,
      title: "Long-form editor for weekly finance explainers",
      budget: "₹2,000–₹3,500 per video",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "2–4 years",
      tags: ["Long-form", "Retention", "Captions"],
      listingStatus: "Open",
    },
    talent: {
      profileSlug: "aarav-mehta",
      name: "Aarav Mehta",
      headline: "Retention editor for creator-led YouTube channels",
      location: "Mumbai, India",
      availability: "Available · 2 slots this month",
      bio: "I edit long-form videos for finance and education creators, with retention-first structure, tight pacing, and clean caption systems.",
      tools: ["Premiere Pro", "After Effects", "Audition"],
      niches: ["Finance", "Education", "Explainers"],
      experienceNote: "3 yrs editing for creator teams · most recently a weekly finance explainer channel",
      portfolioHighlights: [
        { title: "Retention rebuild — market explainer", detail: "Long-form edit · pacing + caption system" },
        { title: "Series packaging — education channel", detail: "4-video series · structure + sound design" },
      ],
    },
    privateNotes: [
      {
        id: "r-app-recv-1-note-3",
        body: "Portfolio retention numbers check out. Shortlist for a paid test edit on last week's upload.",
        createdAt: "Today, 9:12 AM",
      },
      {
        id: "r-app-recv-1-note-2",
        body: "Asked for the finance A/B board — waiting to see CTR variations before an interview.",
        createdAt: "Yesterday, 6:40 PM",
      },
      {
        id: "r-app-recv-1-note-1",
        body: "Rate is ₹2,500/video, a bit above budget. Worth it if the retention rebuild is real.",
        createdAt: "2 days ago",
      },
    ],
    timeline: [{ id: "r-app-recv-1-applied", label: "Application received", at: "4h ago" }],
  },
  {
    id: "r-app-recv-2",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "shortlisted",
    managerNote: "Strong packaging systems — ask for the finance A/B board before an interview.",
    title: "Mira Shah",
    counterpartyName: "Mira Shah",
    createdAtLabel: "1d ago",
    updatedAtLabel: "8h ago",
    message:
      "I design CTR-focused thumbnails for tech and finance channels — 3 concepts per video with mobile-size legibility checks. I can slot into your weekly publish schedule and keep a shared concept board for fast approvals.",
    firstMessageAnswers: {
      expected_rate: { amount: "1,000", unit: "per month" },
      relevant_portfolio: [
        {
          id: "mira-packaging-board",
          title: "Finance thumbnail A/B set",
          url: "https://portfolio.example.com/thumbnails/finance-ab-test",
          type: "Thumbnail set",
          platform: "YouTube",
          description: "12 thumbnail concepts for a finance channel with CTR-oriented layout variations tested over 4 weeks.",
          role: "Concepting, design, A/B testing",
          metrics: ["12 thumbnails tested", "CTR 4.1% → 6.8%"],
          tags: ["CTR", "Finance", "YouTube"],
          tools: ["Photoshop", "Figma", "Midjourney"],
        },
        {
          id: "mira-tech-packaging",
          title: "Packaging refresh — tech reviews",
          url: "https://portfolio.example.com/thumbnails/tech-packaging",
          type: "Thumbnail set",
          platform: "YouTube",
          description: "Rebuilt title + thumbnail system for a tech-review channel to improve mobile legibility.",
          role: "Design system, mobile legibility pass",
          tags: ["CTR", "Tech"],
          tools: ["Photoshop", "Illustrator"],
        },
      ],
      relevant_experience: "Packaging systems for 6 channels, usually 3 concepts per video within 24 hours.",
      tools_workflow: ["Photoshop", "Figma", "Illustrator"],
      fit_note: "Your weekly explainer cadence matches how I run thumbnail boards for retainers.",
    },
    job: {
      jobId: null,
      title: "Thumbnail designer for weekly explainers",
      budget: "₹800–₹1,400 per month",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "1–3 years",
      tags: ["Thumbnails", "CTR", "Packaging"],
      listingStatus: "Open",
    },
    talent: {
      profileSlug: "mira-shah",
      name: "Mira Shah",
      headline: "CTR-focused thumbnail designer for tech and finance",
      location: "Pune, India",
      availability: "Selective · taking 1 retainer",
      bio: "Thumbnail systems with strong visual hierarchy, fast concept iteration, and consistent packaging across a channel.",
      tools: ["Photoshop", "Figma", "Illustrator"],
      niches: ["Tech", "Finance", "Productivity"],
      experienceNote: "Packaging for 6 channels · concept-to-approval in 24h",
      portfolioHighlights: [
        { title: "Packaging refresh — tech reviews", detail: "Channel-wide thumbnail system" },
        { title: "A/B concept board — finance series", detail: "3 concepts per video · weekly cadence" },
      ],
    },
    timeline: [
      { id: "r-app-recv-2-applied", label: "Application received", at: "1d ago" },
      { id: "r-app-recv-2-viewed", label: "Viewed by you", at: "1d ago" },
      { id: "r-app-recv-2-shortlisted", label: "Shortlisted by you", at: "8h ago" },
    ],
  },
  {
    id: "r-app-recv-3",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "declined",
    title: "Dev Patel",
    counterpartyName: "Dev Patel",
    createdAtLabel: "5d ago",
    updatedAtLabel: "3d ago",
    message:
      "I manage uploads, analytics reviews, and a content calendar for two channels. I can take over your publishing ops end to end, including QA before every upload and a weekly metrics summary.",
    proposedTerms: "₹2,400 per month · part-time",
    job: {
      jobId: null,
      title: "Channel ops manager (part-time)",
      budget: "₹2,000–₹3,000 per month",
      workMode: "Part-time · Remote",
      location: "Remote",
      experience: "2–4 years",
      tags: ["Channel ops", "Analytics", "Calendar"],
      listingStatus: "Closed",
    },
    talent: {
      profileSlug: "dev-patel",
      name: "Dev Patel",
      headline: "Channel manager for uploads, analytics, and content calendar",
      location: "Ahmedabad, India",
      availability: "Available",
      bio: "I keep publishing pipelines on schedule — upload QA, metadata, analytics reviews, and team coordination.",
      tools: ["YouTube Studio", "Notion", "Sheets"],
      niches: ["Education", "Business"],
      experienceNote: "2 yrs running ops for multi-editor channels",
      portfolioHighlights: [
        { title: "Publishing pipeline — weekly channel", detail: "Upload QA + metadata system" },
      ],
    },
    timeline: [
      { id: "r-app-recv-3-applied", label: "Application received", at: "5d ago" },
      { id: "r-app-recv-3-viewed", label: "Viewed by you", at: "4d ago" },
      { id: "r-app-recv-3-declined", label: "Declined by you", at: "3d ago" },
    ],
  },
  {
    id: "r-app-recv-4",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "responded",
    title: "Rhea Kapoor",
    counterpartyName: "Rhea Kapoor",
    createdAtLabel: "2d ago",
    updatedAtLabel: "6h ago",
    unread: true,
    message:
      "I edit shorts and long-form for education channels and can own your weekly batch. I've attached a before/after where I lifted average view duration by reworking the first 30 seconds.",
    firstMessageAnswers: {
      expected_rate: { amount: "2,200", unit: "per video" },
      relevant_portfolio: [
        {
          id: "rhea-before-after",
          title: "Retention rework — first 30 seconds",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          type: "Retention edit",
          platform: "YouTube",
          description:
            "Before/after of an education video's opening: rewrote the hook, cut dead air, and added a cold-open payoff.",
          role: "Re-edit, hook rewrite",
          metrics: ["Avg view duration +34%", "Before/after included"],
          tags: ["Retention", "Education", "Hook"],
          tools: ["Final Cut Pro", "Motion"],
          timestampNotes: [
            { time: "0:00", seconds: 0, title: "Before", description: "Original opening — slow logo intro and a soft question." },
            { time: "0:32", seconds: 32, title: "After", description: "Reworked cold open with a payoff promise in the first line." },
          ],
        },
      ],
      turnaround: { value: "4", unit: "days" },
      working_hours: "Flexible hours",
      start_availability: "Next Monday",
    },
    job: {
      jobId: null,
      title: "Long-form editor for weekly finance explainers",
      budget: "₹2,000–₹3,500 per video",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "2–4 years",
      tags: ["Long-form", "Retention", "Captions"],
      listingStatus: "Open",
    },
    response: {
      from: "You",
      body: "Thanks Rhea — the before/after is strong. Can you share two shorts examples with the before/after edits?",
      atLabel: "1d ago",
    },
    replies: [
      {
        from: "Rhea Kapoor",
        body: "Sent — here are two shorts with the raw and final side by side. I'm available from next Monday and can take 3 videos per week.",
        atLabel: "6h ago",
      },
    ],
    talent: {
      profileSlug: "rhea-kapoor",
      name: "Rhea Kapoor",
      headline: "Retention editor for education and finance channels",
      location: "Delhi, India",
      availability: "Available from next Monday",
      bio: "I focus on the first 30 seconds and pacing structure to lift average view duration, with clean captions and mixed audio.",
      tools: ["Premiere Pro", "After Effects", "DaVinci Resolve"],
      niches: ["Education", "Finance"],
      experienceNote: "3 yrs editing weekly batches for creator channels",
      portfolioHighlights: [
        { title: "Retention rework — intro 30s", detail: "Before/after · +18% AVD" },
      ],
    },
    timeline: [
      { id: "r-app-recv-4-applied", label: "Application received", at: "2d ago" },
      { id: "r-app-recv-4-viewed", label: "Viewed by you", at: "2d ago" },
      { id: "r-app-recv-4-responded", label: "Reply sent", at: "1d ago" },
      { id: "r-app-recv-4-candidate", label: "Candidate responded", at: "6h ago" },
    ],
  },
  {
    id: "r-app-recv-5",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "new",
    title: "Ishaan Verma",
    counterpartyName: "Ishaan Verma",
    createdAtLabel: "8h ago",
    updatedAtLabel: "8h ago",
    unread: true,
    message:
      "I've spent three years on creator-led finance and tech channels doing long-form edits, motion callouts, and thumbnail packaging. I work hook-first, keep a shared review board, and can deliver a paid test edit on a recent upload before you commit to anything.",
    firstMessageAnswers: {
      expected_rate: { amount: "3,000", unit: "per video" },
      relevant_portfolio: [
        {
          id: "ishaan-showreel",
          title: "Showreel — finance long-form",
          url: "https://portfolio.example.com/ishaan/showreel",
        },
        {
          id: "ishaan-thumbnails",
          title: "Thumbnail packaging set",
          url: "https://portfolio.example.com/ishaan/thumbnails",
        },
      ],
      turnaround: { value: "3", unit: "days" },
      relevant_experience: "3 years on creator-led finance and tech channels from 80K to 1.2M subscribers.",
      tools_workflow: ["Premiere Pro", "After Effects", "Photoshop", "Figma"],
      custom_instruction: {
        prompt: "Share how you would improve the first 30 seconds of a finance explainer.",
        response:
          "I would isolate the core viewer question, open on the consequence, then use a fast proof clip before the first chart so the video earns the analytical section.",
        links: ["https://portfolio.example.com/ishaan/showreel"],
      },
    },
    attachments: [
      { label: "Showreel — finance long-form", url: "https://portfolio.example.com/ishaan/showreel" },
      { label: "Thumbnail packaging set", url: "https://portfolio.example.com/ishaan/thumbnails" },
    ],
    job: {
      jobId: null,
      title: "Long-form editor for weekly finance explainers",
      budget: "₹2,000–₹3,500 per video",
      workMode: "Monthly · Remote",
      location: "Remote",
      experience: "2–4 years",
      tags: ["Long-form", "Retention", "Captions"],
      listingStatus: "Open",
    },
    talent: {
      profileSlug: "ishaan-verma",
      name: "Ishaan Verma",
      headline: "Senior editor + packaging for finance and tech creators",
      location: "Bengaluru, India · IST",
      availability: "Available · 2 slots this month",
      bio: "Long-form editing with retention-first structure, motion callouts, and CTR-focused thumbnail packaging. I run a shared review board so approvals stay fast across a channel team.",
      tools: ["Premiere Pro", "After Effects", "Photoshop", "Figma"],
      niches: ["Finance", "Tech", "Explainers"],
      experienceNote: "3 yrs · creator-led channels from 80K to 1.2M subs",
      portfolioHighlights: [
        { title: "Retention rebuild — market explainer", detail: "Long-form edit · pacing + caption system" },
        { title: "Motion callout system — tech reviews", detail: "Reusable AE templates" },
        { title: "Packaging refresh — finance series", detail: "Channel-wide thumbnail system" },
      ],
    },
    timeline: [{ id: "r-app-recv-5-applied", label: "Application received", at: "8h ago" }],
  },
  {
    id: "r-app-recv-6",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "closed",
    title: "Sana Khan",
    counterpartyName: "Sana Khan",
    createdAtLabel: "1mo ago",
    updatedAtLabel: "3w ago",
    message: "",
    job: {
      jobId: null,
      title: "Channel ops manager (part-time)",
      budget: "₹2,000–₹3,000 per month",
      workMode: "Part-time · Remote",
      location: "Remote",
      experience: "1–2 years",
      tags: ["Channel ops", "Scheduling"],
      listingStatus: "Closed",
    },
    talent: {
      profileSlug: "sana-khan",
      name: "Sana Khan",
      headline: "Channel coordinator — scheduling and uploads",
      location: "Hyderabad, India",
      availability: null,
      bio: null,
      tools: ["YouTube Studio", "Notion"],
      niches: ["Education"],
      experienceNote: null,
      portfolioHighlights: [],
    },
    timeline: [
      { id: "r-app-recv-6-applied", label: "Application received", at: "1mo ago" },
      { id: "r-app-recv-6-archived", label: "Archived", at: "3w ago" },
    ],
  },

  // ---- Recruiter mode: hiring requests this user sent to talent ----
  {
    id: "r-req-sent-1",
    mode: "hiring",
    direction: "sent",
    kind: "hiring_request",
    status: "pending",
    title: "Anika Rao",
    contextLabel: "Shorts editing package — 15 shorts per month",
    counterpartyName: "Anika Rao",
    createdAtLabel: "1d ago",
    updatedAtLabel: "1d ago",
    message:
      "Your shorts work fits our daily channel. We need 15 shorts a month in a consistent caption style — raw clips and scripts arrive every Monday. Are you open to a trial month?",
    firstMessageAnswers: {
      project_budget: { amount: "1,400", unit: "per month" },
      project_brief:
        "15 Shorts per month in a consistent caption style. Raw clips and scripts arrive every Monday.",
      turnaround: { value: "2", unit: "days" },
      working_hours: "Weekly delivery",
      channel_or_brand_link: "https://youtube.com/@motivationshorts",
      reference_links: [
        {
          url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
          title: "Caption style to match",
          note: "Match this caption density and the punch-in timing on the beat.",
          timestampNotes: [
            { time: "0:06", seconds: 6, title: "Caption rhythm", description: "Captions land on stressed words, not every word." },
          ],
        },
      ],
      start_availability: "Immediately",
      fit_note: "Your daily shorts systems are close to the workflow we need.",
      custom_instruction: {
        prompt: "Share the channel context, one reference to match, and what success would look like in the first month.",
        response:
          "This is a daily faceless motivation channel. We want the captions and pacing matched to the reference, with the first month measured by consistent delivery and stable retention.",
        links: ["https://www.youtube.com/watch?v=jNQXAC9IVRw"],
      },
    },
    talent: {
      profileSlug: "anika-rao",
      name: "Anika Rao",
      headline: "Shorts editor for daily faceless channels",
      rate: "₹15,000 per month",
      experience: "3 years",
      location: "Bengaluru, India",
      availability: "Available · evenings IST",
      tools: ["CapCut", "Premiere Pro"],
      niches: ["Fitness", "Motivation", "Shorts"],
      experienceNote: "Daily shorts pipelines for 3 faceless channels",
      portfolioHighlights: [
        { title: "Daily shorts system — fitness channel", detail: "Hook-first cuts · caption templates" },
      ],
    },
    timeline: [{ id: "r-req-sent-1-sent", label: "Request sent", at: "1d ago" }],
  },
  {
    id: "r-req-sent-2",
    mode: "hiring",
    direction: "sent",
    kind: "hiring_request",
    status: "responded",
    title: "Kabir Sen",
    contextLabel: "Scriptwriting — 6-part explainer series",
    counterpartyName: "Kabir Sen",
    createdAtLabel: "2d ago",
    updatedAtLabel: "9h ago",
    unread: true,
    message:
      "We're planning a 6-part explainer series and need outlines plus full scripts with sourced claims. Two scripts a month, research notes included. Would this fit your current load?",
    firstMessageAnswers: {
      project_budget: { amount: "1,800", unit: "per video" },
      project_brief:
        "A 6-part explainer series: outlines, full scripts, sourced claims, and research notes for two scripts per month.",
      turnaround: { value: "2", unit: "weeks" },
      working_hours: "Flexible hours",
      channel_or_brand_link: "https://youtube.com/@contentbusiness",
      reference_links: [
        {
          url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
          title: "Explainer intro structure",
          note: "Use the intro structure only — question, stakes, then roadmap.",
          timestampNotes: [
            { time: "0:00", seconds: 0, title: "Question first", description: "States the viewer question before any branding." },
            { time: "0:40", seconds: 40, title: "Roadmap", description: "Previews the three sections to set expectations." },
          ],
        },
        {
          url: "https://drive.google.com/file/d/1mock-broll-density/view",
          title: "B-roll density doc",
          note: "Our target B-roll density per minute — reference only, not pacing.",
        },
      ],
      start_availability: "Within 1 week",
    },
    response: {
      from: "Kabir Sen",
      body: "This fits my schedule from next month. I can send a sample outline for your first topic this week so you can check structure and sourcing style.",
      atLabel: "9h ago",
    },
    replies: [
      {
        from: "You",
        body: "That works. Let's start with the AI-regulation explainer — I'll drop the brief and reference links in a shared doc today.",
        atLabel: "7h ago",
      },
      {
        from: "Kabir Sen",
        body: "Got the brief, thanks. I'll have the outline and sourced notes back to you within two days.",
        atLabel: "5h ago",
      },
    ],
    talent: {
      profileSlug: "kabir-sen",
      name: "Kabir Sen",
      headline: "Scriptwriter for explainers, documentary hooks, and outlines",
      rate: "₹8,000 per script",
      experience: "4 years",
      location: "Kolkata, India",
      availability: "Selective · 2 scripts per month",
      tools: ["Notion", "Google Docs"],
      niches: ["Documentary", "Explainers", "History"],
      experienceNote: "Scripts and outlines for deep-dive channels with sourced research",
      portfolioHighlights: [
        { title: "6-part series outline — history channel", detail: "Structure + sourced research notes" },
      ],
    },
    timeline: [
      { id: "r-req-sent-2-sent", label: "Request sent", at: "2d ago" },
      { id: "r-req-sent-2-viewed", label: "Viewed by Kabir Sen", at: "1d ago" },
      { id: "r-req-sent-2-responded", label: "Response received", at: "9h ago" },
    ],
  },
  {
    id: "r-req-sent-3",
    mode: "hiring",
    direction: "sent",
    kind: "hiring_request",
    status: "declined",
    title: "Nora Chen",
    contextLabel: "Motion graphics — callouts + kinetic text",
    counterpartyName: "Nora Chen",
    createdAtLabel: "1w ago",
    updatedAtLabel: "5d ago",
    message:
      "We want animated callouts and kinetic text for two videos a month — your lower-thirds style matches our brand. Open to a per-video arrangement?",
    firstMessageAnswers: {
      project_budget: { amount: "900", unit: "per video" },
      project_brief: "Animated callouts and kinetic text for two explainers per month.",
      reference_links: [
        {
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Lower-thirds + kinetic text",
          note: "Reference for lower-thirds motion and kinetic-text timing.",
          timestampNotes: [
            { time: "0:14", seconds: 14, title: "Lower-third in", description: "Ease-in with a subtle blur — match this weight." },
            { time: "1:02", seconds: 62, title: "Kinetic emphasis", description: "Key words scale up on beat without feeling busy." },
          ],
        },
      ],
      fit_note: "Your lower-thirds style matches the visual language we want.",
    },
    response: {
      from: "Nora Chen",
      body: "Thanks for thinking of me — your channel looks great. I'm fully booked through next quarter, but I'd be glad to revisit after that.",
      atLabel: "5d ago",
    },
    talent: {
      profileSlug: "nora-chen",
      name: "Nora Chen",
      headline: "Motion designer for callouts, lower thirds, and kinetic text",
      rate: "₹12,000 per project",
      experience: "5 years",
      location: "Singapore",
      availability: "Unavailable until next quarter",
      tools: ["After Effects", "Illustrator"],
      niches: ["Science", "Education"],
      experienceNote: "Motion systems for explainer channels",
      portfolioHighlights: [
        { title: "Callout system — science channel", detail: "Reusable AE templates" },
      ],
    },
    timeline: [
      { id: "r-req-sent-3-sent", label: "Request sent", at: "1w ago" },
      { id: "r-req-sent-3-viewed", label: "Viewed by Nora Chen", at: "6d ago" },
      { id: "r-req-sent-3-declined", label: "Declined by Nora Chen", at: "5d ago" },
    ],
  },
  {
    id: "r-req-sent-4",
    mode: "hiring",
    direction: "sent",
    kind: "hiring_request",
    status: "accepted",
    title: "Tara Iyer",
    contextLabel: "Thumbnail packaging — weekly retainer",
    counterpartyName: "Tara Iyer",
    createdAtLabel: "4d ago",
    updatedAtLabel: "2d ago",
    message:
      "Your packaging board for tech channels is exactly our style. We publish twice a week and want 8 thumbnails a month with a shared concept board for fast approvals. Open to a retainer?",
    firstMessageAnswers: {
      project_budget: { amount: "1,200", unit: "per month" },
      project_brief:
        "8 thumbnails per month with a shared concept board and fast approvals for two uploads per week.",
      working_hours: "Mornings IST",
      channel_or_brand_link: "https://youtube.com/@techchannel",
      start_availability: "Within 1 week",
      fit_note: "Your packaging board for tech channels is exactly our style.",
    },
    response: {
      from: "Tara Iyer",
      body: "Yes, I'd love to. I can start this week — I'll set up a shared board and send the first two concepts for your next upload.",
      atLabel: "2d ago",
    },
    talent: {
      profileSlug: "tara-iyer",
      name: "Tara Iyer",
      headline: "Thumbnail designer + packaging for tech and finance channels",
      rate: "₹1,500 per thumbnail",
      experience: "4 years",
      location: "Chennai, India",
      availability: "Available · 1 retainer slot",
      tools: ["Photoshop", "Figma"],
      niches: ["Tech", "Finance", "Productivity"],
      experienceNote: "Packaging systems with A/B concept boards",
      portfolioHighlights: [
        { title: "Concept board — tech reviews", detail: "3 concepts per video · weekly cadence" },
      ],
    },
    timeline: [
      { id: "r-req-sent-4-sent", label: "Request sent", at: "4d ago" },
      { id: "r-req-sent-4-viewed", label: "Viewed by Tara Iyer", at: "3d ago" },
      { id: "r-req-sent-4-accepted", label: "Accepted by Tara Iyer", at: "2d ago" },
    ],
  },
  {
    id: "r-req-sent-5",
    mode: "hiring",
    direction: "sent",
    kind: "hiring_request",
    status: "withdrawn",
    title: "Arjun Nair",
    contextLabel: "Voice over — horror stories narration",
    counterpartyName: "Arjun Nair",
    createdAtLabel: "3w ago",
    updatedAtLabel: "2w ago",
    message:
      "We're starting a horror-stories channel and need a deep, measured narration voice for weekly 10-minute episodes. Your demo fits the mood — would you be open to a per-episode rate?",
    firstMessageAnswers: {
      project_budget: { amount: "1,500", unit: "per video" },
      project_brief: "Weekly 10-minute horror story narration with a deep, measured tone.",
      turnaround: { value: "3", unit: "days" },
      channel_or_brand_link: "https://youtube.com/@nightstories",
    },
    talent: {
      profileSlug: "arjun-nair",
      name: "Arjun Nair",
      headline: "Voice over artist — narration for horror and documentary",
      rate: "₹2,500 per episode",
      experience: "5 years",
      location: "Kochi, India",
      availability: "Selective",
      tools: ["Audition", "Home studio"],
      niches: ["Horror", "Documentary", "Narration"],
      experienceNote: "Narration for story-driven channels",
      portfolioHighlights: [],
    },
    timeline: [
      { id: "r-req-sent-5-sent", label: "Request sent", at: "3w ago" },
      { id: "r-req-sent-5-withdrawn", label: "Request withdrawn by you", at: "2w ago" },
    ],
  },
];

// ---- Live backend mapping ----
// Maps the authenticated activity summary into the same OwnerInteraction shape
// the Applications workspace renders, using only fields the backend actually
// returns — no fabricated names, timestamps, or read states.

export function relativeTimeLabel(iso?: string | null): string {
  if (!iso) return "";
  // Backend timestamps are UTC but may arrive without a timezone designator;
  // parsing those as local time would shift every label by the UTC offset.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  const time = Date.parse(hasTimezone ? iso : `${iso}Z`);
  if (!Number.isFinite(time)) return "";
  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function applicationStatusToInteraction(
  status: BackendJobApplication["status"],
  direction: InteractionDirection
): InteractionStatus {
  switch (status) {
    case "new":
      return direction === "sent" ? "pending" : "new";
    case "reviewing":
      return "viewed";
    case "shortlisted":
      return "shortlisted";
    case "interviewing":
      return "responded";
    case "hired":
      return "hired";
    case "rejected":
      return "declined";
    case "archived":
      return "closed";
    case "withdrawn":
      return "withdrawn";
  }
}

/**
 * Map a raw backend status to the inbox display vocabulary — used when a
 * pipeline stage move commits locally after the backend confirms.
 */
export function interactionStatusFromBackend(
  kind: InteractionKind,
  direction: InteractionDirection,
  backendStatus: string
): InteractionStatus {
  if (kind === "application") {
    return applicationStatusToInteraction(backendStatus as BackendJobApplication["status"], direction);
  }
  return interestStatusToInteraction(backendStatus as BackendTalentInterest["status"], direction);
}

function interestStatusToInteraction(
  status: BackendTalentInterest["status"],
  direction: InteractionDirection
): InteractionStatus {
  switch (status) {
    case "new":
      return direction === "sent" ? "pending" : "new";
    case "reviewing":
      return "viewed";
    case "contacted":
      return "accepted";
    case "declined":
      return "declined";
    case "archived":
      return "closed";
    case "withdrawn":
      return "withdrawn";
  }
}

function liveTimeline(
  id: string,
  createdLabel: string,
  createdAt: string,
  updatedAt: string,
  status: InteractionStatus
): InteractionTimelineEvent[] {
  const events: InteractionTimelineEvent[] = [
    { id: `${id}-created`, label: createdLabel, at: relativeTimeLabel(createdAt) },
  ];
  const settledStatuses: InteractionStatus[] = ["new", "pending"];
  if (!settledStatuses.includes(status) && updatedAt && updatedAt !== createdAt) {
    events.push({ id: `${id}-status`, label: interactionStatusLabel(status), at: relativeTimeLabel(updatedAt) });
  }
  return events;
}

function jobSnapshotFromJob(job: Job): InteractionJobSnapshot {
  return {
    jobId: String(job.id),
    title: job.title,
    channelName: job.channel?.name || null,
    channelLogoUrl: job.channel?.logoUrl || null,
    channelProfileSlug: job.channelProfileSlug || null,
    budget: job.budget,
    workMode: [job.type, job.workMode].filter(Boolean).join(" · ") || "—",
    location: job.location || null,
    experience: job.experience || null,
    tags: job.tags || [],
    listingStatus: null,
  };
}

const AVAILABILITY_LABELS: Record<BackendTalentListing["availability_status"], string> = {
  available: "Available",
  selective: "Selective",
  unavailable: "Unavailable",
};

function talentSnapshotFromListing(listing: BackendTalentListing): InteractionTalentSnapshot {
  return {
    profileSlug: listing.owner_username || null,
    name: listing.owner_display_name || listing.owner_username || "Talent",
    avatarUrl: listing.owner_avatar_url || null,
    headline: listing.primary_role || listing.title,
    // Mirror the job card's metadata: rate → numeric experience → location/work mode.
    rate: formatTalentRate(listing) || null,
    experience: formatTalentListingExperience(listing) || null,
    // Location, or the work-mode equivalent when no place is set — same as the public talent card.
    location: listing.location || listing.work_mode || null,
    availability: AVAILABILITY_LABELS[listing.availability_status] || null,
    bio: listing.description || null,
    tools: listing.tools || [],
    niches: [listing.niche, ...(listing.formats || [])].filter((value): value is string => Boolean(value)),
    experienceNote: listing.experience_level || null,
    portfolioHighlights: [],
  };
}

function asSnapshotString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asSnapshotStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Coerce a loosely-typed backend answers blob into structured answers, or null. */
function coerceAnswers(value: Record<string, unknown> | undefined | null): FirstMessageAnswers | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length ? (value as FirstMessageAnswers) : null;
}

export function mapActivityToOwnerInteractions(summary: ActivitySummary): OwnerInteraction[] {
  const relatedJobsById = new Map(summary.relatedJobs.map((job) => [String(job.id), job]));
  const myJobsById = new Map(summary.myJobs.map((job) => [String(job.id), job]));
  const myListingsById = new Map(summary.myTalentListings.map((listing) => [listing.id, listing]));
  const relatedListingsById = new Map(summary.relatedTalentListings.map((listing) => [listing.id, listing]));

  const entries: Array<{ sortKey: number; item: OwnerInteraction }> = [];
  const sortKeyOf = (iso: string) => {
    const time = Date.parse(iso);
    return Number.isFinite(time) ? time : 0;
  };

  for (const application of summary.sentApplications) {
    const job = relatedJobsById.get(String(application.job_id)) || null;
    const status = applicationStatusToInteraction(application.status, "sent");
    entries.push({
      sortKey: sortKeyOf(application.updated_at || application.created_at),
      item: {
        id: application.id,
        mode: "talent",
        direction: "sent",
        kind: "application",
        status,
        backendStatus: application.status,
        title: job?.title || "Job application",
        counterpartyName: job?.channel?.name || "Recruiter",
        counterpartyAvatarUrl: job?.channel?.logoUrl || null,
        createdAtLabel: relativeTimeLabel(application.created_at),
        updatedAtLabel: relativeTimeLabel(application.updated_at || application.created_at),
        message: application.cover_note || "",
        firstMessageAnswers: coerceAnswers(application.first_message_answers),
        job: job ? jobSnapshotFromJob(job) : null,
        timeline: liveTimeline(
          application.id,
          "Application sent",
          application.created_at,
          application.updated_at,
          status
        ),
      },
    });
  }

  for (const application of summary.receivedApplications) {
    const snapshot = application.applicant_snapshot || {};
    const applicantName =
      asSnapshotString(snapshot["display_name"]) || asSnapshotString(snapshot["username"]) || "Applicant";
    const username = asSnapshotString(snapshot["username"]);
    const job = myJobsById.get(String(application.job_id)) || null;
    const status = applicationStatusToInteraction(application.status, "received");
    entries.push({
      sortKey: sortKeyOf(application.updated_at || application.created_at),
      item: {
        id: application.id,
        mode: "hiring",
        direction: "received",
        kind: "application",
        status,
        backendStatus: application.status,
        managerNote: application.manager_note || null,
        title: applicantName,
        counterpartyName: applicantName,
        createdAtLabel: relativeTimeLabel(application.created_at),
        updatedAtLabel: relativeTimeLabel(application.updated_at || application.created_at),
        message: application.cover_note || "",
        firstMessageAnswers: coerceAnswers(application.first_message_answers),
        job: job ? { ...jobSnapshotFromJob(job), channelName: null, channelLogoUrl: null } : null,
        talent: {
          profileSlug: username,
          name: applicantName,
          headline: asSnapshotString(snapshot["headline"]) || "",
          location:
            [asSnapshotString(snapshot["location"]), asSnapshotString(snapshot["timezone"])]
              .filter(Boolean)
              .join(" · ") || null,
          availability: null,
          bio: null,
          tools: asSnapshotStringList(snapshot["skills"]),
          niches: [],
          experienceNote: null,
          portfolioHighlights: [],
        },
        timeline: liveTimeline(
          application.id,
          "Application received",
          application.created_at,
          application.updated_at,
          status
        ),
      },
    });
  }

  for (const interest of summary.sentInterests) {
    const listing = relatedListingsById.get(interest.talent_listing_id) || null;
    const talentName = listing?.owner_display_name || listing?.owner_username || "Talent";
    const status = interestStatusToInteraction(interest.status, "sent");
    entries.push({
      sortKey: sortKeyOf(interest.updated_at || interest.created_at),
      item: {
        id: interest.id,
        mode: "hiring",
        direction: "sent",
        kind: "hiring_request",
        status,
        backendStatus: interest.status,
        title: talentName,
        contextLabel: listing?.title || null,
        counterpartyName: talentName,
        counterpartyAvatarUrl: listing?.owner_avatar_url || null,
        createdAtLabel: relativeTimeLabel(interest.created_at),
        updatedAtLabel: relativeTimeLabel(interest.updated_at || interest.created_at),
        message: interest.note || "",
        firstMessageAnswers: coerceAnswers(interest.first_message_answers),
        talent: listing ? talentSnapshotFromListing(listing) : null,
        timeline: liveTimeline(interest.id, "Request sent", interest.created_at, interest.updated_at, status),
      },
    });
  }

  for (const interest of summary.receivedInterests) {
    const listing = myListingsById.get(interest.talent_listing_id) || null;
    const relatedJob = interest.job_id ? relatedJobsById.get(String(interest.job_id)) || null : null;
    const recruiterName =
      interest.recruiter_display_name ||
      interest.recruiter_username ||
      relatedJob?.channel?.name ||
      "Recruiter";
    const status = interestStatusToInteraction(interest.status, "received");
    entries.push({
      sortKey: sortKeyOf(interest.updated_at || interest.created_at),
      item: {
        id: interest.id,
        mode: "talent",
        direction: "received",
        kind: "hiring_request",
        status,
        backendStatus: interest.status,
        managerNote: interest.manager_note || null,
        title: relatedJob?.title || "Hiring request",
        counterpartyName: recruiterName,
        counterpartyAvatarUrl: interest.recruiter_avatar_url || relatedJob?.channel?.logoUrl || null,
        createdAtLabel: relativeTimeLabel(interest.created_at),
        updatedAtLabel: relativeTimeLabel(interest.updated_at || interest.created_at),
        message: interest.note || "",
        firstMessageAnswers: coerceAnswers(interest.first_message_answers),
        recruiter: relatedJob || interest.recruiter_username
          ? {
              profileSlug: interest.recruiter_username || relatedJob?.channelProfileSlug || null,
              name: recruiterName,
              avatarUrl: interest.recruiter_avatar_url || relatedJob?.channel?.logoUrl || null,
              channelName: relatedJob?.channel?.name || null,
              audienceLabel: null,
              platform: relatedJob?.platform || null,
              hiringFor: relatedJob?.title || listing?.title || null,
            }
          : null,
        // The context card is the viewer's own listing the recruiter is interested in.
        talent: listing ? { ...talentSnapshotFromListing(listing), isOwnListing: true } : null,
        sourceListingTitle: listing?.title || null,
        timeline: liveTimeline(interest.id, "Request received", interest.created_at, interest.updated_at, status),
      },
    });
  }

  return entries.sort((a, b) => b.sortKey - a.sortKey).map((entry) => entry.item);
}
