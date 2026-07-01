// Single source of truth for the "complete your profile" checklist, mode-aware
// (talent vs recruiter). Pure + unit-testable: callers pass plain boolean signals
// (computed from the profile in the hub) and get back an ordered, prioritized list
// that drives BOTH the inline ProfileCompletionCard and the floating setup bubble.
//
// Ordering = hiring signal. Tiers: 1 = essentials recruiters/talent decide on,
// 2 = strong signal, 3 = logistics/trust polish. Item keys are stable so the hub
// can map each to an edit action.

export type ProfileChecklistTier = 1 | 2 | 3;

export type ProfileChecklistItem = {
  key: string;
  label: string;
  why: string;
  tier: ProfileChecklistTier;
  done: boolean;
};

export type ChecklistProgress = {
  completed: number;
  total: number;
  percent: number;
};

// What a recruiter weighs when evaluating a creator/freelancer.
export type TalentChecklistSignals = {
  hasAvatar: boolean;
  hasHeadline: boolean;
  hasWorkSample: boolean;
  hasRole: boolean;
  hasTools: boolean;
  hasBio: boolean;
  hasNiche: boolean;
  hasExperience: boolean;
  hasAvailabilityDetails: boolean;
};

// What talent weighs when deciding whether to trust/answer a recruiter.
export type RecruiterChecklistSignals = {
  hasAvatar: boolean;
  hasHeadline: boolean;
  hasJob: boolean;
  hasBio: boolean;
  hasHiringFocus: boolean;
  hasCollaborationDetails: boolean;
};

export function buildTalentChecklist(s: TalentChecklistSignals): ProfileChecklistItem[] {
  return [
    { key: "avatar", tier: 1, done: s.hasAvatar, label: "Add a profile photo", why: "The first signal you're a real person — the biggest single lift to profile trust." },
    { key: "headline", tier: 1, done: s.hasHeadline, label: "Write a headline", why: "The one line recruiters scan first: your role plus your niche." },
    { key: "work_sample", tier: 1, done: s.hasWorkSample, label: "Add your first work sample", why: "The single biggest decider in creative hiring — add a result like views or retention to make it land." },
    { key: "role", tier: 1, done: s.hasRole, label: "Set your specialization", why: "Tells recruiters exactly what you do and powers matching." },
    { key: "tools", tier: 2, done: s.hasTools, label: "Add your tools", why: "How recruiters filter (Premiere, After Effects, DaVinci…)." },
    { key: "bio", tier: 2, done: s.hasBio, label: "Write a short bio", why: "Your voice and who you work with — context recruiters want." },
    { key: "niche", tier: 2, done: s.hasNiche, label: "Define your niche", why: "The first thing recruiters match on — what you make and who it's for." },
    { key: "experience", tier: 3, done: s.hasExperience, label: "Add your experience", why: "Track record and social proof — who you've worked with." },
    { key: "availability", tier: 3, done: s.hasAvailabilityDetails, label: "Set availability & turnaround", why: "Practical fit: when you work and how fast you deliver." },
  ];
}

export function buildRecruiterChecklist(s: RecruiterChecklistSignals): ProfileChecklistItem[] {
  return [
    { key: "avatar", tier: 1, done: s.hasAvatar, label: "Add a profile photo or logo", why: "Recognition and trust for the people you want to hire." },
    { key: "headline", tier: 1, done: s.hasHeadline, label: "Write a headline", why: "Who you are and what you hire for, at a glance." },
    { key: "post_job", tier: 2, done: s.hasJob, label: "Post your first job", why: "Shows you're actively hiring and builds your hiring focus." },
    { key: "bio", tier: 2, done: s.hasBio, label: "Write a short bio", why: "Context on your channel, company, or brand." },
    { key: "hiring_focus", tier: 2, done: s.hasHiringFocus, label: "Set what you hire for", why: "Niches, formats, and platforms so talent know it's relevant." },
    { key: "collaboration", tier: 3, done: s.hasCollaborationDetails, label: "Add collaboration style & work model", why: "How you work and your timezone overlap." },
  ];
}

export function checklistProgress(items: ProfileChecklistItem[]): ChecklistProgress {
  const total = items.length;
  const completed = items.filter((item) => item.done).length;
  const percent = total ? Math.round((completed / total) * 100) : 100;
  return { completed, total, percent };
}
