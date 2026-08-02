/**
 * Role-aware contextual guidance for the draft assistant.
 *
 * A Thumbnail Designer and a Scriptwriter do not need the same explanation for
 * "how many revisions?" — the workload that number describes is different, and
 * so is the reason a candidate cares. This module holds that difference.
 *
 * It is deterministic and derived entirely from data the product already
 * validated: the job title, resolved role, specialization, platforms, formats,
 * niches, tools, engagement, and the current canonical values. It makes no
 * provider call. Adding a role means adding a profile here, not widening a
 * prompt.
 *
 * Nothing in this module decides what is required or valid. It supplies prose
 * for a turn whose existence, priority, and field membership were already
 * settled by lib/jobImportConversation and the authoritative field policy.
 */

export type RoleGuidanceContext = {
  jobTitle?: string | null;
  roleName?: string | null;
  specialization?: string | null;
  platforms?: readonly string[];
  formats?: readonly string[];
  niches?: readonly string[];
  tools?: readonly string[];
  engagementType?: string | null;
  workMode?: string | null;
  compensationUnit?: string | null;
  /** How the source is referred to in prose, e.g. "the public post". */
  sourceLabel: string;
  /** True when the source said nothing about the field group. */
  omitted: boolean;
  /** True when the source said two contradictory things. */
  conflicted: boolean;
};

export type RoleGuidanceCopy = {
  heading: string;
  explanation: string;
  question: string;
  candidateImpact: string;
};

export type CreatorRoleKey =
  | "video-editor"
  | "thumbnail-designer"
  | "scriptwriter"
  | "podcast-editor"
  | "creator-strategist";

type GroupCopyBuilder = (context: RoleGuidanceContext) => RoleGuidanceCopy;

type RoleProfile = {
  key: CreatorRoleKey;
  /** Human noun used in prose: "this editor", "this designer". */
  practitioner: string;
  /** Matched against the lowercased title + role name + specialization. */
  matcher: RegExp;
  groups: Readonly<Record<string, GroupCopyBuilder>>;
};

// ---------------------------------------------------------------------------
// Shared prose helpers
// ---------------------------------------------------------------------------

const clean = (value: string | null | undefined): string => (value ?? "").trim();

const list = (values: readonly string[] | undefined, limit = 2): string => {
  const items = (values ?? []).map(clean).filter(Boolean).slice(0, limit);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  twitch: "Twitch",
  linkedin: "LinkedIn",
  spotify: "Spotify",
};

const platformPhrase = (context: RoleGuidanceContext): string => {
  const named = (context.platforms ?? [])
    .map((platform) => PLATFORM_LABELS[clean(platform).toLowerCase()] ?? clean(platform))
    .filter(Boolean);
  return list(named);
};

/** "a YouTube channel" / "this channel" — never an empty fragment. */
const channelPhrase = (context: RoleGuidanceContext): string => {
  const platform = platformPhrase(context);
  return platform ? `a ${platform} channel` : "this channel";
};

const nichePhrase = (context: RoleGuidanceContext): string => {
  const niche = list(context.niches, 1);
  return niche ? ` in ${niche}` : "";
};

const isRecurring = (context: RoleGuidanceContext): boolean =>
  ["ongoing_freelance", "retainer", "part_time", "full_time"].includes(
    clean(context.engagementType)
  );

/** "recurring" vs "one-off" framing, which changes why workload matters. */
const cadenceWord = (context: RoleGuidanceContext): string =>
  isRecurring(context) ? "recurring" : "one-off";

/** Source labels read mid-sentence ("the public post"), so opening with one
 *  needs a capital. Only the first character changes; the label is untouched. */
const openSentence = (sentence: string): string =>
  sentence.charAt(0).toUpperCase() + sentence.slice(1);

/** Opening clause stating what the source did or did not establish. */
const finding = (context: RoleGuidanceContext, subject: string): string => {
  if (context.conflicted) {
    return openSentence(`${context.sourceLabel} gives two different answers about ${subject}.`);
  }
  if (context.omitted) {
    return openSentence(
      `${context.sourceLabel} describes the work but does not say ${subject}.`
    );
  }
  return `I found ${subject} in ${context.sourceLabel}, and it is worth confirming.`;
};

// ---------------------------------------------------------------------------
// Role profiles
// ---------------------------------------------------------------------------

const VIDEO_EDITOR: RoleProfile = {
  key: "video-editor",
  practitioner: "editors",
  matcher: /\bvideo\s*editor|\beditor\b(?!.*(podcast|audio))|video editing|shorts editor|reels editor/,
  groups: {
    deliverables: (context) => ({
      heading: "How much finished video is this?",
      explanation: `${finding(context, "how many finished videos are expected, or how long they run")} Editors price and schedule by finished minutes, so a ten-minute explainer and a sixty-second short are very different jobs even at the same count.`,
      question: "How many videos, and roughly how long is each one?",
      candidateImpact:
        "Editors can judge whether the workload fits alongside their other clients before they apply.",
    }),
    "source-inputs": (context) => ({
      heading: "What footage will the editor start from?",
      explanation: `${finding(context, "what raw material the editor receives")} Whether they get organised, labelled footage or hours of unsorted recording — and whether B-roll, music and motion graphics are supplied or expected from them — changes the real length of every edit.`,
      question: "What will you provide, and what should the editor create?",
      candidateImpact:
        "Editors can tell whether the timeline you have in mind is realistic for the material they are given.",
    }),
    turnaround: (context) => ({
      heading: "How fast does each edit need to come back?",
      explanation: `${finding(context, "how quickly a finished edit is expected")} For ${cadenceWord(context)} work on ${channelPhrase(context)}, turnaround is what decides whether an editor can hold this alongside their other commitments.`,
      question: "How long should the editor have for each video?",
      candidateImpact:
        "Editors can check the deadline against their existing schedule instead of discovering a clash later.",
    }),
    revisions: (context) => ({
      heading: "How many rounds of changes are included?",
      explanation: `${finding(context, "how many revision rounds are included")} Editing feedback arrives in passes, and without a limit a single video can absorb several extra days of unpaid re-cuts.`,
      question: "How many revision rounds should be included?",
      candidateImpact:
        "Editors know where a video is finished, which keeps the agreed rate honest for both of you.",
    }),
    references: (context) => ({
      heading: "Is there an edit style to match?",
      explanation: `${finding(context, "what the finished edit should feel like")} Pacing, caption style and cut rhythm are far easier to show than to describe, and a single reference video removes most of the first-round guesswork.`,
      question: "Are there videos whose style this role should match?",
      candidateImpact:
        "Editors can judge whether your style suits them before investing time in an application.",
    }),
  },
};

const THUMBNAIL_DESIGNER: RoleProfile = {
  key: "thumbnail-designer",
  practitioner: "designers",
  matcher: /thumbnail|cover art|\bgraphic designer\b|packaging designer/,
  groups: {
    deliverables: (context) => ({
      heading: "How many thumbnails, and how often?",
      explanation: `${finding(context, "how many thumbnails are needed, or how often")} Thumbnail work is priced by volume and cadence, so "a few a month" and "three every week" are different jobs for ${channelPhrase(context)}.`,
      question: "How many thumbnails should the designer produce, and how often?",
      candidateImpact:
        "Designers can tell whether this is a steady retainer or occasional work before applying.",
    }),
    "source-inputs": (context) => ({
      heading: "What will the designer be given to work from?",
      explanation: `${finding(context, "what the designer starts from")} A title and a rough concept produce a very different amount of work than raw frames the designer has to pull and clean up themselves.`,
      question: "Will you supply titles, concepts and source images?",
      candidateImpact:
        "Designers can see how much of the concept work sits with them rather than with you.",
    }),
    revisions: (context) => ({
      heading: "How many rounds of changes are included?",
      explanation: `${finding(context, "how many revision rounds are included")} This is ${cadenceWord(context)} thumbnail production${nichePhrase(context)}, and thumbnails attract opinions — without a limit, approval can run on indefinitely for a fixed fee.`,
      question: "How many revision rounds should be included?",
      candidateImpact:
        "Designers can estimate the real weekly workload rather than an open-ended approval cycle.",
    }),
    references: (context) => ({
      heading: "Is there a visual style to match?",
      explanation: `${finding(context, "what the thumbnails should look like")} Thumbnail style is a channel's signature, and a handful of examples communicates more than a paragraph of description.`,
      question: "Are there thumbnails or channels whose style this should match?",
      candidateImpact:
        "Designers can tell immediately whether your visual direction plays to their strengths.",
    }),
    turnaround: (context) => ({
      heading: "How soon is each thumbnail needed?",
      explanation: `${finding(context, "how quickly each thumbnail is needed")} Thumbnails are usually the last thing finished before a video goes live, so the deadline is tied to your publishing schedule rather than to the design itself.`,
      question: "How long will the designer have before publication?",
      candidateImpact:
        "Designers can check whether your publishing rhythm fits the way they work.",
    }),
  },
};

const SCRIPTWRITER: RoleProfile = {
  key: "scriptwriter",
  practitioner: "writers",
  matcher: /script|screenwriter|\bwriter\b|copywriter|narrative/,
  groups: {
    deliverables: (context) => ({
      heading: "How long should each script be?",
      explanation: `${finding(context, "how long each script should be, in words or finished runtime")} A three-minute script and a twenty-minute one are different commissions, and writers quote on length rather than on the number of files.`,
      question: "What runtime or word count should each script target?",
      candidateImpact:
        "Writers can judge the size of each assignment instead of guessing at it.",
    }),
    "source-inputs": (context) => ({
      heading: "Who does the research?",
      explanation: `${finding(context, "whether you supply the topic, outline and source material")} Research is usually the largest part of a script${nichePhrase(context)}, so whether the writer receives an outline or starts from a blank page changes the size of the job more than the word count does.`,
      question: "Will you provide topics, outlines and source material?",
      candidateImpact:
        "Writers can tell how much research is included in each assignment before they quote.",
    }),
    revisions: (context) => ({
      heading: "How many drafts are included?",
      explanation: `${finding(context, "how many drafts are included")} Scripts usually move from outline to draft to final, and naming the number of passes prevents a rewrite cycle that neither of you planned for.`,
      question: "How many drafts should be included?",
      candidateImpact:
        "Writers know when a script is signed off, which keeps the agreed fee accurate.",
    }),
    references: (context) => ({
      heading: "Is there a voice to write in?",
      explanation: `${finding(context, "what tone the scripts should take")} Tone carries a channel more than structure does, and one example script or video conveys it faster than any brief.`,
      question: "Are there examples whose tone and voice this should match?",
      candidateImpact:
        "Writers can tell whether they can write convincingly in your voice before applying.",
    }),
    turnaround: (context) => ({
      heading: "When is each script due?",
      explanation: `${finding(context, "when each script is due")} Scripts sit at the front of production, so the deadline usually has to clear well before filming rather than before publishing.`,
      question: "How long should the writer have for each script?",
      candidateImpact:
        "Writers can fit your deadlines around the research each piece will need.",
    }),
  },
};

const PODCAST_EDITOR: RoleProfile = {
  key: "podcast-editor",
  practitioner: "podcast editors",
  matcher: /podcast|audio engineer|audio editor|sound (design|engineer)/,
  groups: {
    deliverables: (context) => ({
      heading: "What comes out of each episode?",
      explanation: `${finding(context, "what each episode should produce")} A cleaned audio master, a video cut, short clips and show notes are four separate pieces of work, and podcast roles often quietly assume all of them.`,
      question: "What should each episode deliver, and how long are episodes?",
      candidateImpact:
        "Podcast editors can price the full scope rather than the audio edit alone.",
    }),
    "source-inputs": (context) => ({
      heading: "What condition does the recording arrive in?",
      explanation: `${finding(context, "how the raw recordings arrive")} Separate clean tracks per speaker and a single noisy room recording need very different amounts of repair, and that difference dominates the time each episode takes.`,
      question: "How is the audio recorded, and what will you supply?",
      candidateImpact:
        "Podcast editors can tell how much cleanup each episode realistically needs.",
    }),
    turnaround: (context) => ({
      heading: "How soon does each episode need to be ready?",
      explanation: `${finding(context, "how quickly each episode must be finished")} Podcasts publish to a fixed rhythm, so the turnaround is set by your release day rather than by the length of the edit.`,
      question: "How long should the editor have after each recording?",
      candidateImpact:
        "Podcast editors can check your release schedule against their own week.",
    }),
    revisions: (context) => ({
      heading: "How many rounds of changes are included?",
      explanation: `${finding(context, "how many revision rounds are included")} Audio notes tend to arrive in scattered timestamps, and without a limit a finished episode can be reopened repeatedly.`,
      question: "How many revision rounds should be included?",
      candidateImpact:
        "Podcast editors know when an episode is signed off and can plan the next one.",
    }),
  },
};

const CREATOR_STRATEGIST: RoleProfile = {
  key: "creator-strategist",
  practitioner: "strategists",
  matcher: /strateg|growth|channel manager|content manager|community manager|marketing|ugc/,
  groups: {
    deliverables: (context) => ({
      heading: "What should the strategist actually produce?",
      explanation: `${finding(context, "what the strategist is expected to hand over")} Strategy work is easy to describe and hard to pin down — a content calendar, a research document and a monthly performance review are concrete, "grow the channel" is not.`,
      question: "What should this person deliver, and how often?",
      candidateImpact:
        "Strategists can tell what success looks like here instead of guessing at the remit.",
    }),
    "source-inputs": (context) => ({
      heading: "What analytics will they be able to see?",
      explanation: `${finding(context, "what analytics access the strategist will have")} A strategist working on ${channelPhrase(context)} can only make evidence-based recommendations if they can see retention and traffic sources; without access the role becomes guesswork.`,
      question: "What analytics or account access will you provide?",
      candidateImpact:
        "Candidates can judge whether they can measure results and justify their recommendations.",
    }),
    "creative-autonomy": (context) => ({
      heading: "How much can they decide on their own?",
      explanation: `${finding(context, "how much the strategist decides independently")} Strategy roles fail most often over ownership: whether this person sets direction or executes decisions you have already made is the difference between two very different jobs.`,
      question: "How much creative and strategic latitude will this person have?",
      candidateImpact:
        "Strategists can tell whether the role matches the level of ownership they want.",
    }),
    "hiring-process": (context) => ({
      heading: "How will you assess candidates?",
      explanation: `${finding(context, "how candidates will be assessed")} Strategy is hard to judge from a portfolio alone, so saying up front whether there is a call or a short exercise sets expectations for experienced candidates.`,
      question: "What steps should candidates expect?",
      candidateImpact:
        "Candidates can decide whether they have time for your process before starting it.",
    }),
  },
};

const PROFILES: readonly RoleProfile[] = [
  // Order matters: the more specific matcher must win. "Podcast editor" and
  // "thumbnail designer" both contain words the broader profiles also match.
  PODCAST_EDITOR,
  THUMBNAIL_DESIGNER,
  SCRIPTWRITER,
  CREATOR_STRATEGIST,
  VIDEO_EDITOR,
];

/**
 * The role this job most resembles, or null when nothing matches confidently.
 *
 * Matching reads the title, resolved role name and specialization together,
 * because a job titled "Packaging" with the Thumbnail Designer role resolved is
 * still thumbnail work.
 */
export function detectCreatorRole(
  context: Pick<RoleGuidanceContext, "jobTitle" | "roleName" | "specialization">
): CreatorRoleKey | null {
  const haystack = [context.roleName, context.jobTitle, context.specialization]
    .map(clean)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return null;
  return PROFILES.find((profile) => profile.matcher.test(haystack))?.key ?? null;
}

/**
 * Role-specific copy for a guidance group, or null to use the generic wording.
 *
 * Returning null is a normal outcome: most groups (compensation, work mode,
 * application routing) mean the same thing for every role, and inventing a
 * role-flavoured variant of them would be noise rather than context.
 */
export function roleGuidanceCopy(
  groupId: string,
  context: RoleGuidanceContext
): RoleGuidanceCopy | null {
  const key = detectCreatorRole(context);
  if (!key) return null;
  const profile = PROFILES.find((candidate) => candidate.key === key);
  const builder = profile?.groups[groupId];
  return builder ? builder(context) : null;
}

/**
 * Fallback for a creative role we do not have a profile for.
 *
 * This is not the same as the group's generic copy: it still names the role and
 * still explains why the field matters for creative work, so an unrecognised
 * role gets a useful explanation rather than "This field is required".
 */
export function genericCreativeGuidance(
  groupId: string,
  context: RoleGuidanceContext
): RoleGuidanceCopy | null {
  const subject = clean(context.roleName) || clean(context.jobTitle) || "this creator role";
  const tools = list(context.tools, 2);

  switch (groupId) {
    case "deliverables":
      return {
        heading: "What should this person produce?",
        explanation: `${finding(context, "how much work is expected")} Naming the concrete output for ${subject} is what lets a candidate estimate the commitment rather than guess at it.`,
        question: "What should this person deliver, and how often?",
        candidateImpact:
          "Candidates can weigh the workload against the rate before they apply.",
      };
    case "source-inputs":
      return {
        heading: "What will you provide to work from?",
        explanation: `${finding(context, "what material this person starts from")} For ${subject}, what you supply versus what they create themselves usually decides how long each piece of work takes.`,
        question: "What will you provide, and what should they create?",
        candidateImpact:
          "Candidates can judge whether your timeline is realistic for the material provided.",
      };
    case "revisions":
      return {
        heading: "How many rounds of changes are included?",
        explanation: `${finding(context, "how many revision rounds are included")} For ${cadenceWord(context)} work like ${subject}, an unstated revision limit is the most common source of disagreement after work begins.`,
        question: "How many revision rounds should be included?",
        candidateImpact:
          "Candidates know when work is finished, which keeps the agreed rate honest.",
      };
    case "turnaround":
      return {
        heading: "How quickly is each piece needed?",
        explanation: `${finding(context, "how quickly work must be returned")} Turnaround is what decides whether ${subject} fits alongside a candidate's existing commitments.`,
        question: "How long should they have for each piece of work?",
        candidateImpact:
          "Candidates can check your deadlines against their current schedule.",
      };
    case "references":
      return {
        heading: "Is there a style to match?",
        explanation: `${finding(context, "what the finished work should feel like")} For ${subject}, style is far easier to show than to describe, and one example removes most of the first-round guesswork.`,
        question: "Are there examples whose style this should match?",
        candidateImpact:
          "Candidates can tell whether your direction suits their strengths before applying.",
      };
    case "tools":
      return {
        heading: "Which tools matter here?",
        explanation: `${finding(context, "which tools this person needs")} ${
          tools ? `You already mentioned ${tools}. ` : ""
        }Naming the tools that are genuinely required, rather than every tool you use, keeps capable candidates from ruling themselves out.`,
        question: "Which tools are genuinely required?",
        candidateImpact:
          "Candidates can tell whether their existing setup fits without having to ask.",
      };
    default:
      return null;
  }
}

/**
 * The contextual copy for a group: role-specific where we have it, an informed
 * creative fallback otherwise, and null when the caller should use its own
 * generic wording.
 */
export function contextualGuidance(
  groupId: string,
  context: RoleGuidanceContext
): RoleGuidanceCopy | null {
  return roleGuidanceCopy(groupId, context) ?? genericCreativeGuidance(groupId, context);
}
