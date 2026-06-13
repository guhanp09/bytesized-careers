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
  location?: string | null;
  availability?: string | null;
  bio?: string | null;
  tools: string[];
  niches: string[];
  experienceNote?: string | null;
  portfolioHighlights: Array<{ title: string; detail: string }>;
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
  title: string;
  /** Short subject line for rows where the title is a person's name. */
  contextLabel?: string | null;
  counterpartyName: string;
  counterpartyAvatarUrl?: string | null;
  createdAtLabel: string;
  updatedAtLabel: string;
  unread?: boolean;
  message: string;
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
    proposedTerms: "₹2,800 per project · 3-day turnaround",
    attachments: [
      { label: "Retention edit sample", url: "https://portfolio.example.com/sample/retention-edit" },
      { label: "Captions + sound style reel", url: "https://portfolio.example.com/sample/captions-reel" },
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
      "I run a daily shorts pipeline for two faceless channels — hook-first cuts, beat-synced captions, and same-day delivery. I can take on 20–25 shorts a month and keep your caption style consistent across editors.",
    proposedTerms: "₹1,200 per month · 20 shorts",
    attachments: [{ label: "Shorts pacing reel", url: "https://portfolio.example.com/sample/shorts-reel" }],
    response: {
      from: "Motivation Shorts",
      body: "Your pacing reel is close to what we want. Can you start with a one-week trial batch of 5 shorts using next week's scripts?",
      atLabel: "5h ago",
    },
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

  // ---- Talent mode: hiring requests this user received on their talent listing ----
  {
    id: "t-req-recv-1",
    mode: "talent",
    direction: "received",
    kind: "hiring_request",
    status: "new",
    title: "Shorts editing package — 15 shorts per month",
    counterpartyName: "Motivation Shorts",
    counterpartyAvatarUrl: "https://picsum.photos/seed/motivation/96/96",
    createdAtLabel: "1d ago",
    updatedAtLabel: "1d ago",
    unread: true,
    message:
      "Saw your listing and your retention work fits our daily channel. We need 15 shorts a month with captions in our house style — scripts and raw clips are ready every Monday. Could you share your availability for a kickoff call this week?",
    proposedTerms: "₹1,400 per month · 15 shorts · 2 revision rounds",
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
    proposedTerms: "₹3,200 per month · 4 videos",
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
    proposedTerms: "₹6,000 per project · 6 weeks",
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
    timeline: [
      { id: "t-req-recv-3-sent", label: "Request received", at: "1w ago" },
      { id: "t-req-recv-3-declined", label: "Declined by you", at: "6d ago" },
    ],
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
      "Your job matches the channels I already edit for — creator-led finance and education. I work hook-first, rebuild pacing around retention dips, and deliver with clean captions and mixed audio. I can share a test edit on one of your published videos before you commit.",
    proposedTerms: "₹2,500 per video · 4-day turnaround",
    attachments: [
      { label: "Retention case study", url: "https://portfolio.example.com/aarav/case-study" },
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
    timeline: [{ id: "r-app-recv-1-applied", label: "Application received", at: "4h ago" }],
  },
  {
    id: "r-app-recv-2",
    mode: "hiring",
    direction: "received",
    kind: "application",
    status: "shortlisted",
    title: "Mira Shah",
    counterpartyName: "Mira Shah",
    createdAtLabel: "1d ago",
    updatedAtLabel: "8h ago",
    message:
      "I design CTR-focused thumbnails for tech and finance channels — 3 concepts per video with mobile-size legibility checks. I can slot into your weekly publish schedule and keep a shared concept board for fast approvals.",
    proposedTerms: "₹1,000 per month · 8 thumbnails",
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
    proposedTerms: "₹1,400 per month · 15 shorts",
    talent: {
      profileSlug: "anika-rao",
      name: "Anika Rao",
      headline: "Shorts editor for daily faceless channels",
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
    proposedTerms: "₹1,800 per script · 2 per month",
    response: {
      from: "Kabir Sen",
      body: "This fits my schedule from next month. I can send a sample outline for your first topic this week so you can check structure and sourcing style.",
      atLabel: "9h ago",
    },
    talent: {
      profileSlug: "kabir-sen",
      name: "Kabir Sen",
      headline: "Scriptwriter for explainers, documentary hooks, and outlines",
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
    proposedTerms: "₹900 per video · 2 per month",
    talent: {
      profileSlug: "nora-chen",
      name: "Nora Chen",
      headline: "Motion designer for callouts, lower thirds, and kinetic text",
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
];
