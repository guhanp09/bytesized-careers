import type { BackendTalentListing } from "./backendClient";
import { publicProfileFallbackSlug } from "./profileSlug";

const now = "2026-05-20T10:00:00.000Z";

export const mockTalentProfileSlug = publicProfileFallbackSlug;

const makeTalent = (
  item: Pick<BackendTalentListing, "id" | "title" | "primary_role" | "niche" | "location" | "timezone"> &
    Partial<BackendTalentListing>
): BackendTalentListing => {
  const ownerDisplayName = item.owner_display_name || "Talent profile";
  const ownerUsername = item.owner_username || mockTalentProfileSlug(ownerDisplayName);

  return {
    owner_user_id: `mock-owner-${ownerUsername}`,
    owner_display_name: ownerDisplayName,
    owner_username: ownerUsername,
    owner_avatar_url: item.owner_avatar_url || null,
    // Default to the under-a-year bucket so the "Less than 1 year" label is visible
    // across mock cards; individual listings override with exact years for contrast.
    experience_years: 0,
    roles: item.primary_role ? [item.primary_role] : [],
    content_niches: item.content_niches || (item.niche ? item.niche.split(/[·,]/).map((part) => part.trim()).filter(Boolean) : []),
    content_genres: item.content_genres || [],
    formats: ["Shorts", "Long-form"],
    platforms: ["YouTube"],
    tools: ["Premiere Pro", "After Effects"],
    work_mode: "Remote",
    availability_status: "selective",
    rate_min: null,
    rate_max: null,
    rate_currency: "INR",
    rate_note: "₹20,000 per project",
    open_slots: 1,
    turnaround: "3-5 days",
    description: null,
    portfolio_item_ids: [`${ownerUsername}-sample-1`, `${ownerUsername}-sample-2`, `${ownerUsername}-sample-3`],
    status: "published",
    is_featured: false,
    featured_until: null,
    paused_at: null,
    closed_at: null,
    views: 0,
    saves: 0,
    created_at: now,
    updated_at: now,
    ...item,
  };
};

export const MOCK_TALENT_LISTINGS: BackendTalentListing[] = [
  makeTalent({
    id: "mock-talent-retention-editor",
    owner_display_name: "Aarav Mehta",
    title: "Retention editor for creator-led YouTube channels",
    primary_role: "Video editor",
    niche: "Education · business",
    content_niches: ["Education", "Business"],
    content_genres: ["Explainers"],
    location: "Remote",
    timezone: "IST",
    tools: ["Premiere Pro", "After Effects", "YouTube Studio"],
    rate_note: "₹20,000 per long-form video",
    availability_status: "available",
    experience_years: 5,
    is_featured: true,
    portfolio_item_ids: [
      "aarav-mehta-sample-1",
      "aarav-mehta-sample-2",
      "aarav-mehta-sample-3",
      "aarav-mehta-sample-4",
    ],
    // Sample listing that exercises every talent-context first-message requirement.
    first_message_requirements: [
      "project_budget",
      "project_brief",
      "turnaround",
      "working_hours",
      "channel_or_brand_link",
      "reference_links",
      "start_availability",
      "fit_note",
      "custom_instruction",
    ],
    first_message_custom_instruction:
      "Share the channel context, one reference to match, and what success would look like in the first month.",
  }),
  makeTalent({
    id: "mock-talent-shorts-editor",
    owner_display_name: "Anika Rao",
    title: "Shorts editor for daily faceless channels",
    primary_role: "Shorts editor",
    niche: "Motivation · self improvement",
    content_niches: ["Education", "Fitness"],
    content_genres: ["Shorts/Reels"],
    location: "Bengaluru",
    timezone: "IST",
    formats: ["Shorts", "Reels", "TikTok"],
    platforms: ["YouTube", "Instagram", "TikTok"],
    tools: ["CapCut", "Premiere Pro"],
    rate_note: "₹3,000 per short",
    availability_status: "available",
    experience_years: 1,
    // Smaller combination: budget + brief + turnaround.
    first_message_requirements: ["project_budget", "project_brief", "turnaround"],
  }),
  makeTalent({
    id: "mock-talent-thumbnail-designer",
    owner_display_name: "Mira Shah",
    title: "CTR-focused thumbnail designer for tech and finance",
    primary_role: "Thumbnail designer",
    niche: "Tech · finance",
    content_niches: ["Tech", "Finance"],
    content_genres: ["Reviews"],
    location: "Remote",
    timezone: "GMT+5:30",
    formats: ["Thumbnails", "A/B concepts"],
    platforms: ["YouTube"],
    tools: ["Photoshop", "Figma", "Midjourney"],
    rate_note: "₹1,500 per thumbnail",
    experience_years: 4,
    is_featured: true,
    // Smaller combination: working hours + channel/brand link + reference links.
    first_message_requirements: ["working_hours", "channel_or_brand_link", "reference_links"],
  }),
  makeTalent({
    id: "mock-talent-scriptwriter",
    owner_display_name: "Kabir Sen",
    title: "Scriptwriter for explainers, documentary hooks, and outlines",
    primary_role: "Scriptwriter",
    niche: "Science · history",
    content_niches: ["Education"],
    content_genres: ["Documentaries", "Explainers"],
    location: "London",
    timezone: "GMT",
    formats: ["Long-form", "Explainers"],
    tools: ["Notion", "Google Docs", "Perplexity"],
    rate_note: "₹8,000 per script",
    experience_years: 6,
    // No required first-message details: hiring creates an event-only thread.
    first_message_requirements: [],
    first_message_custom_instruction: null,
  }),
  makeTalent({
    id: "mock-talent-motion-designer",
    owner_display_name: "Nora Chen",
    title: "Motion designer for callouts, lower thirds, and kinetic text",
    primary_role: "Motion designer",
    niche: "SaaS · creator education",
    content_niches: ["Tech", "Education", "Business"],
    content_genres: ["Explainers", "Product demos"],
    location: "Remote",
    timezone: "CET",
    formats: ["Long-form", "Launch videos"],
    tools: ["After Effects", "Illustrator", "Premiere Pro"],
    rate_note: "₹12,000 per project",
    availability_status: "selective",
    first_message_requirements: ["project_budget", "project_brief", "reference_links", "start_availability"],
  }),
  makeTalent({
    id: "mock-talent-podcast-producer",
    owner_display_name: "Rhea Thomas",
    title: "Podcast producer for clips, show notes, and upload ops",
    primary_role: "Podcast producer",
    niche: "Business · interviews",
    content_niches: ["Business"],
    content_genres: ["Interviews", "Podcasts"],
    location: "Toronto",
    timezone: "EST",
    formats: ["Podcast", "Clips"],
    platforms: ["Spotify", "YouTube", "Apple Podcasts"],
    tools: ["Descript", "Riverside", "Premiere Pro"],
    rate_note: "₹18,000 per episode",
    first_message_requirements: ["project_brief", "turnaround", "working_hours"],
  }),
  makeTalent({
    id: "mock-talent-channel-manager",
    owner_display_name: "Dev Patel",
    title: "Channel manager for uploads, analytics, and content calendar",
    primary_role: "Channel manager",
    niche: "Gaming · entertainment",
    content_niches: ["Gaming", "Entertainment"],
    content_genres: ["Live streams", "Commentary"],
    location: "Remote",
    timezone: "PST",
    formats: ["Long-form", "Shorts"],
    tools: ["YouTube Studio", "Notion", "Frame.io"],
    rate_note: "₹80,000 monthly",
    experience_years: 8,
    is_featured: true,
    portfolio_item_ids: ["dev-patel-sample-1"],
    first_message_requirements: [
      "project_brief",
      "working_hours",
      "channel_or_brand_link",
      "start_availability",
    ],
  }),
  makeTalent({
    id: "mock-talent-content-strategist",
    owner_display_name: "Leah Morgan",
    title: "Content strategist for content creator positioning and packaging",
    primary_role: "Content strategist",
    niche: "Personal brands",
    content_niches: ["Business", "Education"],
    content_genres: ["Case studies", "Behind-the-scenes"],
    location: "New York",
    timezone: "EST",
    formats: ["Strategy", "Packaging", "Content calendar"],
    tools: ["Notion", "YouTube Studio", "Sheets"],
    rate_note: "₹1,000/hr",
    first_message_requirements: ["project_budget", "channel_or_brand_link", "fit_note", "custom_instruction"],
    first_message_custom_instruction:
      "Tell me what positioning problem you want solved and which existing creator account is closest to the direction.",
  }),
  makeTalent({
    id: "mock-talent-ugc-creator",
    owner_display_name: "Sofia Garcia",
    title: "UGC creator for content creator tools, apps, and education products",
    primary_role: "UGC creator",
    niche: "Content creator tools · apps",
    content_niches: ["Tech", "Business"],
    content_genres: ["Product demos", "Reviews"],
    location: "Austin",
    timezone: "CST",
    formats: ["UGC", "Reels", "TikTok"],
    platforms: ["Instagram", "TikTok", "YouTube"],
    tools: ["CapCut", "iPhone", "Canva"],
    rate_note: "₹15,000 per video",
    availability_status: "available",
    first_message_requirements: ["project_budget", "project_brief", "reference_links"],
  }),
  makeTalent({
    id: "mock-talent-social-editor",
    owner_display_name: "Ishaan Kapoor",
    title: "Social media editor for content creator launch campaigns",
    primary_role: "Social media editor",
    niche: "Launches · education",
    content_niches: ["Education", "Business"],
    content_genres: ["Shorts/Reels", "Behind-the-scenes"],
    location: "Mumbai",
    timezone: "IST",
    formats: ["Threads", "Reels", "Shorts"],
    platforms: ["Instagram", "YouTube", "LinkedIn"],
    tools: ["Canva", "CapCut", "Buffer"],
    rate_note: "₹35,000 per project",
    availability_status: "available",
    first_message_requirements: ["turnaround", "working_hours", "start_availability", "fit_note"],
  }),
  makeTalent({
    id: "mock-talent-retention-analyst",
    owner_display_name: "Elena Rossi",
    title: "Retention analyst for YouTube intros, dips, and packaging tests",
    primary_role: "Retention analyst",
    niche: "YouTube growth",
    content_niches: ["Education", "Business"],
    content_genres: ["Explainers"],
    location: "Remote",
    timezone: "CET",
    formats: ["Analytics", "Retention review"],
    tools: ["YouTube Studio", "Sheets", "Looker Studio"],
    rate_note: "₹25,000 per project",
    first_message_requirements: ["project_brief", "channel_or_brand_link", "reference_links"],
  }),
  makeTalent({
    id: "mock-talent-faceless-editor",
    owner_display_name: "Samir Nair",
    title: "Faceless channel editor for documentary-style videos",
    primary_role: "Faceless channel editor",
    niche: "Mystery · history",
    content_niches: ["Entertainment", "Education"],
    content_genres: ["Documentaries"],
    location: "Remote",
    timezone: "GMT+1",
    formats: ["Long-form", "Documentary"],
    tools: ["Premiere Pro", "After Effects", "Audition"],
    rate_note: "₹18,000 per video",
    availability_status: "available",
    first_message_requirements: ["project_budget", "project_brief", "turnaround", "working_hours"],
  }),
];

export const filterMockTalentListings = ({
  q,
  role,
  platform,
  location,
  availability,
}: {
  q?: string;
  role?: string;
  platform?: string;
  location?: string;
  availability?: string;
}) => {
  const includes = (item: BackendTalentListing, value?: string) => {
    if (!value) return true;
    const haystack = [
      item.title,
      item.primary_role,
      item.experience_years != null ? `${item.experience_years} years` : null,
      item.niche,
      item.location,
      item.timezone,
      ...(item.content_niches || []),
      ...(item.content_genres || []),
      ...item.roles,
      ...item.platforms,
      ...item.formats,
      ...item.tools,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(value.toLowerCase());
  };

  return MOCK_TALENT_LISTINGS.filter(
    (item) =>
      item.status === "published" &&
      includes(item, q) &&
      includes(item, role) &&
      includes(item, platform) &&
      includes(item, location) &&
      (!availability || item.availability_status === availability)
  );
};
