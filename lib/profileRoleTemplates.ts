import type { BackendPublicProfileResponse } from "./backendClient";

export type ProfileRoleTemplateKind =
  | "video_editor"
  | "shorts_editor"
  | "thumbnail_designer"
  | "scriptwriter"
  | "channel_manager"
  | "content_strategist"
  | "podcast_producer"
  | "ugc_creator"
  | "motion_designer"
  | "social_media_manager"
  | "generic";

export type RoleFitRow = {
  label: string;
  value: string;
};

export type RoleFitModule = {
  title: string;
  rows: RoleFitRow[];
};

const clean = (value?: string | null) => value?.trim() || "";

const uniq = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const includesAny = (text: string, values: string[]) => values.some((value) => text.includes(value));

export function detectProfileRoleKind(values: Array<string | null | undefined>): ProfileRoleTemplateKind {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (includesAny(text, ["thumbnail"])) return "thumbnail_designer";
  if (includesAny(text, ["shorts", "reels", "tiktok", "short-form", "short form"])) return "shorts_editor";
  if (includesAny(text, ["script", "writer", "copywriter"])) return "scriptwriter";
  if (includesAny(text, ["channel manager", "channel ops", "youtube manager"])) return "channel_manager";
  if (includesAny(text, ["strategist", "strategy", "content strategy"])) return "content_strategist";
  if (includesAny(text, ["podcast"])) return "podcast_producer";
  if (includesAny(text, ["ugc"])) return "ugc_creator";
  if (includesAny(text, ["motion", "animation", "vfx"])) return "motion_designer";
  if (includesAny(text, ["social media", "community manager", "social manager"])) return "social_media_manager";
  if (includesAny(text, ["editor", "editing", "post production", "post-production"])) return "video_editor";
  return "generic";
}

const row = (label: string, values: Array<string | null | undefined>): RoleFitRow | null => {
  const cleaned = uniq(values);
  return cleaned.length ? { label, value: cleaned.join(" · ") } : null;
};

export function getProfileRoleFitModule({
  profile,
  activeRole,
  activeTalentListingTitle,
}: {
  profile: BackendPublicProfileResponse;
  activeRole?: string | null;
  activeTalentListingTitle?: string | null;
}): RoleFitModule {
  const roleNames = (profile.roles || []).map((roleItem) => roleItem.name);
  const formats = profile.content_style?.format || [];
  const tones = profile.content_style?.tone || [];
  const tools = profile.skills?.length
    ? profile.skills
    : profile.collaboration_preferences?.tools?.split(",").map((tool) => tool.trim()) || [];
  const niche = profile.content_style?.primary_niche;
  const targetAudience = profile.content_style?.target_audience;
  const kind = detectProfileRoleKind([
    activeRole,
    activeTalentListingTitle,
    profile.headline,
    niche,
    ...roleNames,
    ...formats,
    ...tools,
  ]);

  const templateConfig: Record<ProfileRoleTemplateKind, { title: string; labels: string[] }> = {
    video_editor: {
      title: "Role fit",
      labels: ["Platforms", "Editing strengths", "Content formats", "Workflow", "Tools"],
    },
    shorts_editor: {
      title: "Role fit",
      labels: ["Platforms", "Short-form strengths", "Content formats", "Batch workflow", "Tools"],
    },
    thumbnail_designer: {
      title: "Role fit",
      labels: ["Thumbnail styles", "Deliverables", "Testing support", "Niches", "Tools"],
    },
    scriptwriter: {
      title: "Role fit",
      labels: ["Script formats", "Writing strengths", "Research style", "Output", "Niches"],
    },
    channel_manager: {
      title: "Role fit",
      labels: ["Channel operations", "Analytics/SEO", "Team coordination", "Cadence", "Tools"],
    },
    content_strategist: {
      title: "Role fit",
      labels: ["Strategy strengths", "Analytics", "Content systems", "Research", "Deliverables"],
    },
    podcast_producer: {
      title: "Role fit",
      labels: ["Podcast workflow", "Audio/video support", "Clips/repurposing", "Publishing support", "Tools"],
    },
    ugc_creator: {
      title: "Role fit",
      labels: ["On-camera style", "Product categories", "Deliverables", "Usage rights", "Turnaround"],
    },
    motion_designer: {
      title: "Role fit",
      labels: ["Motion style", "Animation/VFX strengths", "Deliverables", "Formats", "Tools"],
    },
    social_media_manager: {
      title: "Role fit",
      labels: ["Platform management", "Scheduling", "Community", "Analytics", "Tools"],
    },
    generic: {
      title: "Creator fit",
      labels: ["Platforms", "Content niche", "Formats", "Strengths", "Tools"],
    },
  };

  const config = templateConfig[kind];
  const rows = [
    row(config.labels[0], [activeRole, ...roleNames]),
    row(config.labels[1], [niche, ...tones]),
    row(config.labels[2], formats),
    row(config.labels[3], [targetAudience, profile.collaboration_preferences?.project_type_preference]),
    row(config.labels[4], tools),
  ].filter((item): item is RoleFitRow => Boolean(item));

  return {
    title: config.title,
    rows,
  };
}
