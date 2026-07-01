export type ToolCategory =
  | "Video editing"
  | "Motion / VFX"
  | "Design / thumbnails"
  | "Audio / podcast"
  | "Creator/platform tools"
  | "Content/research/planning"
  | "Social scheduling/analytics"
  | "Collaboration/review"
  | "AI / automation";

export type ToolIconName =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "x"
  | "facebook"
  | "podcast"
  | "globe"
  | "file"
  | "image";

export type ToolCatalogEntry = {
  name: string;
  aliases: string[];
  logoKey: string;
  category: ToolCategory;
  initials: string;
  iconName?: ToolIconName;
};

const entry = (
  name: string,
  category: ToolCategory,
  logoKey: string,
  initials: string,
  aliases: string[] = [],
  iconName?: ToolIconName
): ToolCatalogEntry => ({
  name,
  aliases,
  logoKey,
  category,
  initials,
  iconName,
});

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  entry("Adobe Premiere Pro", "Video editing", "premiere-pro", "Pr", ["Premiere", "Premiere Pro", "Adobe Premiere"]),
  entry("Final Cut Pro", "Video editing", "final-cut-pro", "FC", ["FCP", "Final Cut"]),
  entry("DaVinci Resolve", "Video editing", "davinci-resolve", "DR", ["DaVinci", "Resolve"]),
  entry("CapCut", "Video editing", "capcut", "CC", ["Cap Cut"]),
  entry("iMovie", "Video editing", "imovie", "iM"),
  entry("Vegas Pro", "Video editing", "vegas-pro", "VP", ["Sony Vegas", "Vegas"]),
  entry("Adobe After Effects", "Motion / VFX", "after-effects", "Ae", ["After Effects", "AE", "Adobe AE"]),
  entry("Blender", "Motion / VFX", "blender", "Bl"),
  entry("Cinema 4D", "Motion / VFX", "cinema-4d", "C4"),
  entry("Unreal Engine", "Motion / VFX", "unreal-engine", "UE", ["Unreal"]),
  entry("Motion", "Motion / VFX", "motion", "Mo", ["Apple Motion"]),
  entry("Adobe Photoshop", "Design / thumbnails", "photoshop", "Ps", ["Photoshop", "Adobe PS", "PS"]),
  entry("Adobe Illustrator", "Design / thumbnails", "illustrator", "Ai", ["Illustrator", "Adobe AI", "AI"]),
  entry("Adobe Lightroom", "Design / thumbnails", "lightroom", "Lr", ["Lightroom"]),
  entry("Canva", "Design / thumbnails", "canva", "Ca"),
  entry("Figma", "Design / thumbnails", "figma", "Fi"),
  entry("Sketch", "Design / thumbnails", "sketch", "Sk"),
  entry("Photopea", "Design / thumbnails", "photopea", "Ph"),
  entry("Adobe Audition", "Audio / podcast", "audition", "Au", ["Audition"]),
  entry("Audacity", "Audio / podcast", "audacity", "Ad"),
  entry("Descript", "Audio / podcast", "descript", "De"),
  entry("GarageBand", "Audio / podcast", "garageband", "GB", ["Garage Band"]),
  entry("Logic Pro", "Audio / podcast", "logic-pro", "LP"),
  entry("Riverside", "Audio / podcast", "riverside", "Ri"),
  entry("Podcastle", "Audio / podcast", "podcastle", "Pc", [], "podcast"),
  entry("YouTube Studio", "Creator/platform tools", "youtube-studio", "YT", ["YT Studio", "YouTube Creator Studio"], "youtube"),
  entry("Instagram", "Creator/platform tools", "instagram", "IG", ["IG"], "instagram"),
  entry("TikTok", "Creator/platform tools", "tiktok", "TT", ["Tik Tok"], "tiktok"),
  entry("Twitch", "Creator/platform tools", "twitch", "Tw"),
  entry("LinkedIn", "Creator/platform tools", "linkedin", "In", [], "linkedin"),
  entry("X / Twitter", "Creator/platform tools", "x-twitter", "X", ["X", "Twitter"], "x"),
  entry("Meta Business Suite", "Creator/platform tools", "meta-business-suite", "Me", ["Meta Suite", "Facebook Business Suite"], "facebook"),
  entry("Creator Studio", "Creator/platform tools", "creator-studio", "CS"),
  entry("Notion", "Content/research/planning", "notion", "No"),
  entry("Google Docs", "Content/research/planning", "google-docs", "GD", ["Docs"]),
  entry("Google Sheets", "Content/research/planning", "google-sheets", "GS", ["Sheets"]),
  entry("Google Drive", "Content/research/planning", "google-drive", "Gd", ["Drive"]),
  entry("Airtable", "Content/research/planning", "airtable", "At"),
  entry("Trello", "Content/research/planning", "trello", "Tr"),
  entry("Asana", "Content/research/planning", "asana", "As"),
  entry("Monday.com", "Content/research/planning", "monday", "Mo", ["Monday"]),
  entry("ClickUp", "Content/research/planning", "clickup", "CU", ["Click Up"]),
  entry("Buffer", "Social scheduling/analytics", "buffer", "Bu"),
  entry("Hootsuite", "Social scheduling/analytics", "hootsuite", "Ho"),
  entry("Later", "Social scheduling/analytics", "later", "La"),
  entry("Sprout Social", "Social scheduling/analytics", "sprout-social", "SS"),
  entry("Metricool", "Social scheduling/analytics", "metricool", "Me"),
  entry("TubeBuddy", "Social scheduling/analytics", "tubebuddy", "TB", ["Tube Buddy"]),
  entry("VidIQ", "Social scheduling/analytics", "vidiq", "VQ", ["vidIQ"]),
  entry("Google Analytics", "Social scheduling/analytics", "google-analytics", "GA", ["GA4", "Analytics"]),
  entry("Frame.io", "Collaboration/review", "frame-io", "Fr", ["Frameio", "Frame IO"]),
  entry("Slack", "Collaboration/review", "slack", "Sl"),
  entry("Discord", "Collaboration/review", "discord", "Di"),
  entry("Zoom", "Collaboration/review", "zoom", "Zo"),
  entry("Loom", "Collaboration/review", "loom", "Lo"),
  entry("Midjourney", "AI / automation", "midjourney", "Mj"),
  entry("Perplexity", "AI / automation", "perplexity", "Px"),
  entry("Runway", "AI / automation", "runway", "Rw"),
  entry("ElevenLabs", "AI / automation", "elevenlabs", "11", ["Eleven Labs"]),
  entry("ChatGPT", "AI / automation", "chatgpt", "CG", ["GPT", "OpenAI"]),
  entry("Claude", "AI / automation", "claude", "Cl"),
] as const;

const normalizeLookupKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TOOL_LOOKUP = new Map<string, ToolCatalogEntry>();

for (const tool of TOOL_CATALOG) {
  TOOL_LOOKUP.set(normalizeLookupKey(tool.name), tool);
  TOOL_LOOKUP.set(normalizeLookupKey(tool.logoKey), tool);
  for (const alias of tool.aliases) {
    TOOL_LOOKUP.set(normalizeLookupKey(alias), tool);
  }
}

export function findToolCatalogEntry(toolName?: string | null): ToolCatalogEntry | null {
  const key = normalizeLookupKey(toolName || "");
  return key ? TOOL_LOOKUP.get(key) || null : null;
}

export function toolInitials(toolName?: string | null) {
  const trimmed = toolName?.trim();
  if (!trimmed) return "•";
  const entry = findToolCatalogEntry(trimmed);
  if (entry) return entry.initials;
  const parts = trimmed
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function resolveToolDisplay(toolName?: string | null) {
  const trimmed = toolName?.trim() || "";
  const entry = findToolCatalogEntry(trimmed);
  return {
    inputName: trimmed,
    displayName: entry?.name || trimmed,
    logoKey: entry?.logoKey || null,
    category: entry?.category || null,
    aliases: entry?.aliases || [],
    initials: entry?.initials || toolInitials(trimmed),
    iconName: entry?.iconName || null,
    known: Boolean(entry),
  };
}
