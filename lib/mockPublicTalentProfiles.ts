import type {
  BackendPublicJobItem,
  BackendPortfolioItem,
  BackendProfileExperienceItem,
  BackendPublicProfileResponse,
  BackendPublicTalentListingItem,
  BackendTalentListing,
} from "./backendClient";
import { JOBS } from "./jobs";
import { MOCK_TALENT_LISTINGS, mockTalentProfileSlug } from "./mockTalentListings";

const now = "2026-05-20T10:00:00.000Z";

const titleCase = (value?: string | null) =>
  value
    ? value
        .split(/[_-\s]+/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ")
    : "";

const uniq = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const ownerSlug = (listing: BackendTalentListing) =>
  listing.owner_username || mockTalentProfileSlug(listing.owner_display_name || listing.id);

const displayName = (listing: BackendTalentListing) =>
  listing.owner_display_name ||
  listing.owner_username
    ?.split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") ||
  "Talent profile";

const publicTalentItem = (listing: BackendTalentListing): BackendPublicTalentListingItem => ({
  id: listing.id,
  title: listing.title,
  primary_role: listing.primary_role,
  location: listing.location,
  timezone: listing.timezone,
  status: listing.status,
  is_featured: listing.is_featured,
  created_at: listing.created_at,
});

const publicJobItem = (job: (typeof JOBS)[number]): BackendPublicJobItem => ({
  id: job.id,
  title: job.title,
  category: job.category,
  location: job.location,
  status: job.status || "published",
  created_at: job.createdAt || now,
  channel_name: job.channel.name,
});

const portfolioItem = (
  listing: BackendTalentListing,
  index: number,
  title: string,
  summary: string
): BackendPortfolioItem => {
  const slug = ownerSlug(listing);
  const role = listing.primary_role || listing.roles[0] || "Talent";
  const platform = listing.platforms[index % Math.max(listing.platforms.length, 1)] || "YouTube";
  const tools = listing.tools.slice(0, 3);

  return {
    id: `${slug}-sample-${index + 1}`,
    user_id: listing.owner_user_id,
    title,
    source_type: "custom",
    source_url: `https://example.com/${slug}/work-${index + 1}`,
    role_id: null,
    role_name: role,
    role,
    user_role_in_project: role,
    description: summary,
    contribution_summary: summary,
    timeframe: "now",
    media_url: null,
    metrics: null,
    youtube_url: null,
    thumbnail_url: null,
    thumbnail_options: [],
    channel_name: platform,
    channel_id: null,
    views: index === 0 ? 18000 : index === 1 ? 9200 : 5400,
    published_date: null,
    published_at: null,
    duration: null,
    retention_percent: null,
    links: [`https://example.com/${slug}/work-${index + 1}`],
    tags: uniq([listing.niche, ...listing.formats, ...listing.platforms]).slice(0, 5),
    contribution_tags: uniq([role, listing.niche, ...listing.formats]).slice(0, 4),
    tools,
    public_metrics: {},
    manual_metrics: {},
    verification_status: "manual",
    visibility: "public",
    publish_status: "published",
    portfolio_status: "now",
    is_featured: index === 0,
    status: "now",
    is_public: true,
    created_at: now,
    updated_at: now,
  };
};

const portfolioFor = (listing: BackendTalentListing) => {
  const role = listing.primary_role || listing.roles[0] || "Talent";
  const niche = listing.niche || "creator-led media";
  const format = listing.formats[0] || "content";

  return [
    portfolioItem(
      listing,
      0,
      `${titleCase(role)} sample for ${niche}`,
      `A focused ${format.toLowerCase()} project showing ${role.toLowerCase()} work for ${niche}.`
    ),
    portfolioItem(
      listing,
      1,
      `${format} package for ${listing.platforms[0] || "YouTube"}`,
      `Packaging, pacing, and execution for a creator-led ${listing.platforms[0] || "content"} workflow.`
    ),
    portfolioItem(
      listing,
      2,
      `${titleCase(role)} operating system`,
      `Repeatable process, tools, and delivery rhythm for hiring teams evaluating fit.`
    ),
  ];
};

const makeExperienceEntry = (
  slug: string,
  idSuffix: string,
  item: Omit<BackendProfileExperienceItem, "id">
): BackendProfileExperienceItem => ({
  ...item,
  id: `${slug}-${idSuffix}`,
});

const defaultExperienceFor = (listing: BackendTalentListing) => {
  const slug = ownerSlug(listing);
  const role = listing.primary_role || listing.roles[0] || "Creator talent";
  const organizationName = listing.niche ? `${titleCase(listing.niche)} Creator` : "Creator Channel";

  return [
    makeExperienceEntry(slug, "experience-current", {
      role,
      organization_name: organizationName,
      organization_url: `https://example.com/${slug}/channel`,
      organization_logo_url: null,
      organization_links: [
        {
          id: `${slug}-experience-youtube`,
          url: `https://youtube.com/@${slug}`,
          platform: "YouTube",
          resolved_name: organizationName,
          logo_url: null,
        },
        {
          id: `${slug}-experience-instagram`,
          url: `https://instagram.com/${slug}`,
          platform: "Instagram",
          resolved_name: organizationName,
          logo_url: null,
        },
      ],
      platform: listing.platforms[0] || "YouTube",
      work_type: "Contract",
      work_mode: listing.work_mode || "Remote",
      start_month: "Jan",
      start_year: "2025",
      end_month: null,
      end_year: null,
      is_current: true,
      description:
        "Handled creator work across hooks, pacing, captions, and upload-ready delivery for repeat content workflows.",
      tools: listing.tools.slice(0, 3),
    }),
    makeExperienceEntry(slug, "experience-past", {
      role: listing.primary_role?.toLowerCase().includes("short") ? "Shorts Editor" : "Video Editor",
      organization_name: "Education Channel",
      organization_url: null,
      organization_logo_url: null,
      organization_links: null,
      platform: "YouTube",
      work_type: "Freelance",
      work_mode: "Remote",
      start_month: "Mar",
      start_year: "2024",
      end_month: "Dec",
      end_year: "2024",
      is_current: false,
      description:
        "Repurposed long-form videos into short-form cuts with captions, tighter pacing, and mobile-first exports.",
      tools: listing.tools.slice(0, 2),
    }),
  ];
};

const mockExperienceSets: Record<string, BackendProfileExperienceItem[]> = {
  "aarav-mehta": [
    makeExperienceEntry("aarav-mehta", "experience-finance-team", {
      role: "Video editor",
      organization_name: "Finance Creator Team",
      organization_url: "https://financecreatorteam.example.com",
      organization_logo_url: null,
      organization_links: [
        {
          id: "aarav-mehta-finance-youtube",
          url: "https://youtube.com/@financecreatorteam",
          platform: "YouTube",
          resolved_name: "Finance Creator Team",
          logo_url: null,
        },
        {
          id: "aarav-mehta-finance-website",
          url: "https://financecreatorteam.example.com",
          platform: "Website",
          resolved_name: "Finance Creator Team",
          logo_url: null,
        },
      ],
      platform: "YouTube",
      work_type: "Contract",
      work_mode: "Remote",
      start_month: "Jan",
      start_year: "2025",
      end_month: null,
      end_year: null,
      is_current: true,
      description:
        "Edits weekly long-form finance explainers, tightens hooks, and prepares captioned exports and upload-ready packages for the publishing team.",
      tools: ["Premiere Pro", "After Effects", "YouTube Studio"],
    }),
    makeExperienceEntry("aarav-mehta", "experience-saas-founder", {
      role: "Retention editor",
      organization_name: "SaaS Founder YouTube Channel",
      organization_url: "https://youtube.com/@saasfounderstories",
      organization_logo_url: null,
      organization_links: [
        {
          id: "aarav-mehta-saas-youtube",
          url: "https://youtube.com/@saasfounderstories",
          platform: "YouTube",
          resolved_name: "SaaS Founder YouTube Channel",
          logo_url: null,
        },
      ],
      platform: "YouTube",
      work_type: "Freelance",
      work_mode: "Remote",
      start_month: "Apr",
      start_year: "2024",
      end_month: "Dec",
      end_year: "2024",
      is_current: false,
      description:
        "Reviewed audience dips, recut intros, and rebuilt transitions for founder-led case-study videos.",
      tools: ["Premiere Pro", "After Effects"],
    }),
    makeExperienceEntry("aarav-mehta", "experience-education-channel", {
      role: "Video editor",
      organization_name: "Education Channel",
      organization_url: null,
      organization_logo_url: null,
      organization_links: null,
      platform: "YouTube",
      work_type: "Part-time",
      work_mode: "Hybrid",
      start_month: "Jun",
      start_year: "2023",
      end_month: "Mar",
      end_year: "2024",
      is_current: false,
      description:
        "Cut long-form explainers, organized project files, and standardized thumbnail handoff notes for a small creator team.",
      tools: ["Premiere Pro"],
    }),
    makeExperienceEntry("aarav-mehta", "experience-podcast-house", {
      role: "Assistant editor",
      organization_name: "Podcast Production House",
      organization_url: "https://podcastproductionhouse.example.com",
      organization_logo_url: null,
      organization_links: [
        {
          id: "aarav-mehta-podcast-site",
          url: "https://podcastproductionhouse.example.com",
          platform: "Website",
          resolved_name: "Podcast Production House",
          logo_url: null,
        },
      ],
      platform: "Website",
      work_type: "Contract",
      work_mode: "On-site",
      start_month: "Jan",
      start_year: "2023",
      end_month: "May",
      end_year: "2023",
      is_current: false,
      description:
        "Prepared multicam podcast cuts, synced audio cleanups, and delivered short clip selects for secondary distribution.",
      tools: ["Premiere Pro", "Audition"],
    }),
  ],
  "anika-rao": [
    makeExperienceEntry("anika-rao", "experience-fitness-studio", {
      role: "Shorts editor",
      organization_name: "Fitness Shorts Studio",
      organization_url: "https://instagram.com/fitnessshortsstudio",
      organization_logo_url: null,
      organization_links: [
        {
          id: "anika-rao-fitness-instagram",
          url: "https://instagram.com/fitnessshortsstudio",
          platform: "Instagram",
          resolved_name: "Fitness Shorts Studio",
          logo_url: null,
        },
        {
          id: "anika-rao-fitness-tiktok",
          url: "https://tiktok.com/@fitnessshortsstudio",
          platform: "TikTok",
          resolved_name: "Fitness Shorts Studio",
          logo_url: null,
        },
      ],
      platform: "Instagram",
      work_type: "Full-time",
      work_mode: "Hybrid",
      start_month: "Feb",
      start_year: "2025",
      end_month: null,
      end_year: null,
      is_current: true,
      description:
        "Packages daily short-form edits, punch-ins, captions, and trend-safe motion for a high-output fitness content pipeline.",
      tools: ["CapCut", "Premiere Pro"],
    }),
    makeExperienceEntry("anika-rao", "experience-beauty-page", {
      role: "Reels editor",
      organization_name: "Beauty & Lifestyle Page",
      organization_url: "https://instagram.com/beautylifestylepage",
      organization_logo_url: null,
      organization_links: [
        {
          id: "anika-rao-beauty-instagram",
          url: "https://instagram.com/beautylifestylepage",
          platform: "Instagram",
          resolved_name: "Beauty & Lifestyle Page",
          logo_url: null,
        },
      ],
      platform: "Instagram",
      work_type: "Freelance",
      work_mode: "Remote",
      start_month: "May",
      start_year: "2024",
      end_month: "Jan",
      end_year: "2025",
      is_current: false,
      description:
        "Cut creator-led product reels with captions, hook-first starts, and quick visual resets for retention.",
      tools: ["CapCut"],
    }),
    makeExperienceEntry("anika-rao", "experience-travel-vlog", {
      role: "Shorts editor",
      organization_name: "Travel Vlog Channel",
      organization_url: null,
      organization_logo_url: null,
      organization_links: null,
      platform: "YouTube",
      work_type: "Contract",
      work_mode: "Remote",
      start_month: "Aug",
      start_year: "2023",
      end_month: "Apr",
      end_year: "2024",
      is_current: false,
      description:
        "Repurposed longer travel episodes into high-velocity shorts with map callouts and caption timing.",
      tools: ["Premiere Pro", "CapCut"],
    }),
  ],
  "mira-shah": [
    makeExperienceEntry("mira-shah", "experience-tech-finance", {
      role: "Thumbnail designer",
      organization_name: "Tech & Finance Creator",
      organization_url: "https://youtube.com/@techfinancecreator",
      organization_logo_url: null,
      organization_links: [
        {
          id: "mira-shah-techfinance-youtube",
          url: "https://youtube.com/@techfinancecreator",
          platform: "YouTube",
          resolved_name: "Tech & Finance Creator",
          logo_url: null,
        },
      ],
      platform: "YouTube",
      work_type: "Retainer",
      work_mode: "Remote",
      start_month: "Nov",
      start_year: "2024",
      end_month: null,
      end_year: null,
      is_current: true,
      description:
        "Designs packaging systems, variation sets, and final upload-ready thumbnails with stronger subject focus and cleaner hierarchy.",
      tools: ["Photoshop", "Figma", "Midjourney"],
    }),
    makeExperienceEntry("mira-shah", "experience-gaming-creator", {
      role: "Thumbnail designer",
      organization_name: "Gaming · Entertainment Creator",
      organization_url: null,
      organization_logo_url: null,
      organization_links: null,
      platform: "YouTube",
      work_type: "Contract",
      work_mode: "Remote",
      start_month: "Mar",
      start_year: "2024",
      end_month: "Oct",
      end_year: "2024",
      is_current: false,
      description:
        "Created episodic thumbnail systems for challenge videos and recurring reaction formats.",
      tools: ["Photoshop", "Figma"],
    }),
    makeExperienceEntry("mira-shah", "experience-creator-agency", {
      role: "Thumbnail designer",
      organization_name: "Creator Agency",
      organization_url: "https://creatoragency.example.com",
      organization_logo_url: null,
      organization_links: [
        {
          id: "mira-shah-creator-agency-site",
          url: "https://creatoragency.example.com",
          platform: "Website",
          resolved_name: "Creator Agency",
          logo_url: null,
        },
      ],
      platform: "Website",
      work_type: "Part-time",
      work_mode: "On-site",
      start_month: "Jul",
      start_year: "2023",
      end_month: "Feb",
      end_year: "2024",
      is_current: false,
      description:
        "Supported client thumbnail batches, source file cleanup, and concept exports for weekly review cycles.",
      tools: [],
    }),
  ],
  "kabir-sen": [
    makeExperienceEntry("kabir-sen", "experience-science-channel", {
      role: "Scriptwriter",
      organization_name: "Education Channel",
      organization_url: "https://youtube.com/@educationchannel",
      organization_logo_url: null,
      organization_links: [
        {
          id: "kabir-sen-education-youtube",
          url: "https://youtube.com/@educationchannel",
          platform: "YouTube",
          resolved_name: "Education Channel",
          logo_url: null,
        },
      ],
      platform: "YouTube",
      work_type: "Contract",
      work_mode: "Remote",
      start_month: "Jan",
      start_year: "2025",
      end_month: null,
      end_year: null,
      is_current: true,
      description:
        "Writes explainer scripts with stronger cold opens, clearer act structure, and more audience-friendly transitions between ideas.",
      tools: ["Notion", "Google Docs", "Perplexity"],
    }),
    makeExperienceEntry("kabir-sen", "experience-regional-comedy", {
      role: "Research writer",
      organization_name: "Regional Comedy Creator",
      organization_url: null,
      organization_logo_url: null,
      organization_links: null,
      platform: "YouTube",
      work_type: "Freelance",
      work_mode: "Hybrid",
      start_month: "May",
      start_year: "2024",
      end_month: "Dec",
      end_year: "2024",
      is_current: false,
      description:
        "Built punch-up drafts, segment beats, and topic research for weekly commentary episodes.",
      tools: ["Notion", "Google Docs"],
    }),
    makeExperienceEntry("kabir-sen", "experience-podcast-house", {
      role: "Story producer",
      organization_name: "Podcast Production House",
      organization_url: "https://podcastproductionhouse.example.com",
      organization_logo_url: null,
      organization_links: [
        {
          id: "kabir-sen-podcast-site",
          url: "https://podcastproductionhouse.example.com",
          platform: "Website",
          resolved_name: "Podcast Production House",
          logo_url: null,
        },
      ],
      platform: "Website",
      work_type: "Part-time",
      work_mode: "Remote",
      start_month: "Sep",
      start_year: "2023",
      end_month: "Apr",
      end_year: "2024",
      is_current: false,
      description:
        "Researched episodes, drafted outlines, and tightened interview arcs for narrative business podcasts.",
      tools: ["Google Docs"],
    }),
  ],
  "dev-patel": [
    makeExperienceEntry("dev-patel", "experience-gaming-team", {
      role: "Channel manager",
      organization_name: "Gaming · Entertainment Creator",
      organization_url: "https://youtube.com/@gamingentertainmentcreator",
      organization_logo_url: null,
      organization_links: [
        {
          id: "dev-patel-gaming-youtube",
          url: "https://youtube.com/@gamingentertainmentcreator",
          platform: "YouTube",
          resolved_name: "Gaming · Entertainment Creator",
          logo_url: null,
        },
        {
          id: "dev-patel-gaming-distribution",
          url: "https://gamingentertainmentcreator.example.com",
          platform: "Website",
          resolved_name: "Gaming · Entertainment Creator",
          logo_url: null,
        },
      ],
      platform: "YouTube",
      work_type: "Full-time",
      work_mode: "Remote",
      start_month: "Oct",
      start_year: "2024",
      end_month: null,
      end_year: null,
      is_current: true,
      description:
        "Runs uploads, metadata handoff, and content calendar planning while coordinating edit, design, and sponsor deadlines.",
      tools: ["YouTube Studio", "Notion", "Frame.io"],
    }),
    makeExperienceEntry("dev-patel", "experience-creator-agency", {
      role: "Operations manager",
      organization_name: "Creator Agency",
      organization_url: "https://creatoragency.example.com",
      organization_logo_url: null,
      organization_links: [
        {
          id: "dev-patel-agency-site",
          url: "https://creatoragency.example.com",
          platform: "Website",
          resolved_name: "Creator Agency",
          logo_url: null,
        },
        {
          id: "dev-patel-agency-linkedin",
          url: "https://linkedin.com/company/creatoragency",
          platform: "LinkedIn",
          resolved_name: "Creator Agency",
          logo_url: null,
        },
      ],
      platform: "Website",
      work_type: "Contract",
      work_mode: "Hybrid",
      start_month: "Jan",
      start_year: "2024",
      end_month: "Sep",
      end_year: "2024",
      is_current: false,
      description:
        "Built creator-facing delivery workflows, approval checklists, and cross-functional publishing handoffs.",
      tools: ["Notion", "Frame.io"],
    }),
    makeExperienceEntry("dev-patel", "experience-travel-vlog", {
      role: "Publishing coordinator",
      organization_name: "Travel Vlog Channel",
      organization_url: null,
      organization_logo_url: null,
      organization_links: null,
      platform: "YouTube",
      work_type: "Part-time",
      work_mode: "On-site",
      start_month: "Apr",
      start_year: "2023",
      end_month: "Dec",
      end_year: "2023",
      is_current: false,
      description:
        "Managed upload scheduling, title swaps, and weekly asset collection for a small travel creator team.",
      tools: ["YouTube Studio"],
    }),
  ],
};

const experienceFor = (listing: BackendTalentListing) => {
  return mockExperienceSets[ownerSlug(listing)] || defaultExperienceFor(listing);
};

export const getMockPublicTalentProfile = (slug: string): BackendPublicProfileResponse | null => {
  const normalizedSlug = slug.trim().toLowerCase();
  const listing = MOCK_TALENT_LISTINGS.find((item) => ownerSlug(item) === normalizedSlug);
  const jobsForProfile = JOBS.filter(
    (job) =>
      job.channelProfileSlug === normalizedSlug ||
      job.agencyProfileSlug === normalizedSlug
  );

  if (!listing && !jobsForProfile.length) return null;

  if (!listing) {
    const firstJob = jobsForProfile[0];
    const activeJobs = jobsForProfile.map(publicJobItem);
    const roleNames = uniq(jobsForProfile.map((job) => job.category));
    const tools = uniq(jobsForProfile.flatMap((job) => job.tags || []));
    const isAgencyProfile = jobsForProfile.some((job) => job.agencyProfileSlug === normalizedSlug);
    const agencyDisplayName = firstJob.managedByAgencyName || titleCase(normalizedSlug);

    return {
      username: normalizedSlug,
      display_name: isAgencyProfile ? agencyDisplayName : firstJob.channel.name || titleCase(normalizedSlug),
      headline: isAgencyProfile ? "Creator agency hiring for creator-led channels" : "Creator-led hiring for content roles",
      avatar_url: firstJob.channel.logoUrl || null,
      avatar_mode: "generic",
      skills: tools.slice(0, 6),
      public_links: [],
      experience: [],
      availability_status: "selective",
      location: firstJob.location,
      timezone: null,
      social_connections: {
        youtube: {
          connected: false,
          channel_id: null,
          channel_title: null,
          channel_handle: null,
          channel_avatar_url: null,
          channel_url: null,
        },
        instagram: {
          connected: false,
          handle: null,
          url: null,
        },
      },
      stats: {
        jobs_posted_count: activeJobs.length,
        jobs_completed_count: 0,
        projects_count: 0,
        reviews_count: 0,
      },
      reviews: {
        avg_rating: 0,
        review_count: 0,
      },
      collaboration_preferences: {
        project_type_preference: firstJob.type === "Monthly" ? "retainer" : "either",
        turnaround: null,
        revisions: null,
        working_hours: null,
        tools: null,
      },
      hiring_info: {
        hiring_type: isAgencyProfile ? "creator agency" : null,
        website_or_social_url: null,
        primary_platform: "YouTube",
        channels_or_pages_managed: uniq(jobsForProfile.map((job) => job.channel.name)).join(", "),
        verification_status: "unverified",
      },
      roles: roleNames.map((role) => ({
        id: `mock-hiring-role-${normalizedSlug}-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: role,
        category: "Hiring",
        description: null,
      })),
      role_answers_summary: [],
      content_style: {
        primary_niche: firstJob.category,
        format: uniq(jobsForProfile.flatMap((job) => job.tags || [])).slice(0, 4),
        tone: [],
        target_audience: null,
        editing_complexity: null,
      },
      youtube_badge: null,
      jobs_active: activeJobs,
      jobs_past: [],
      portfolio_now: [],
      portfolio_past: [],
      jobs_preview: activeJobs.slice(0, 2),
      portfolio_preview: [],
      talent_listings_active: [],
      talent_listings_preview: [],
      moved_to_username: null,
    };
  }

  const portfolio = portfolioFor(listing);
  const experience = experienceFor(listing);
  const role = listing.primary_role || listing.roles[0] || "Talent";
  const platforms = uniq(listing.platforms);
  const tools = uniq(listing.tools);
  const formats = uniq(listing.formats);
  const talentListings = [publicTalentItem(listing)];

  return {
    username: normalizedSlug,
    display_name: displayName(listing),
    headline: listing.title,
    avatar_url: listing.owner_avatar_url,
    avatar_mode: "generic",
    skills: tools,
    public_links: [`https://example.com/${normalizedSlug}/portfolio`],
    experience,
    availability_status: listing.availability_status,
    location: listing.location,
    timezone: listing.timezone,
    social_connections: {
      youtube: {
        connected: platforms.some((platform) => platform.toLowerCase() === "youtube"),
        channel_id: null,
        channel_title: platforms.includes("YouTube") ? `${displayName(listing)} portfolio` : null,
        channel_handle: null,
        channel_avatar_url: null,
        channel_url: platforms.includes("YouTube") ? `https://www.youtube.com/@${normalizedSlug}` : null,
      },
      instagram: {
        connected: platforms.some((platform) => platform.toLowerCase().includes("instagram")),
        handle: null,
        url: platforms.some((platform) => platform.toLowerCase().includes("instagram"))
          ? `https://www.instagram.com/${normalizedSlug.replace(/-/g, "")}`
          : null,
      },
    },
    stats: {
      jobs_posted_count: 0,
      jobs_completed_count: 0,
      projects_count: portfolio.length,
      reviews_count: 0,
    },
    reviews: {
      avg_rating: 0,
      review_count: 0,
    },
    collaboration_preferences: {
      project_type_preference: "either",
      turnaround: listing.turnaround,
      revisions: "2 rounds",
      working_hours: listing.timezone ? `${listing.timezone} business hours` : null,
      tools: tools.join(", "),
    },
    hiring_info: {
      hiring_type: null,
      website_or_social_url: null,
      primary_platform: platforms.includes("Instagram") && !platforms.includes("YouTube") ? "Instagram" : "YouTube",
      channels_or_pages_managed: null,
      verification_status: "unverified",
    },
    roles: [
      {
        id: `mock-role-${normalizedSlug}`,
        name: role,
        category: "Talent",
        description: listing.niche,
      },
    ],
    role_answers_summary: [],
    content_style: {
      primary_niche: listing.niche,
      format: formats,
      tone: ["Sharp", "Creator-native"],
      target_audience: listing.niche,
      editing_complexity: "Moderate",
    },
    youtube_badge: null,
    jobs_active: [],
    jobs_past: [],
    portfolio_now: portfolio,
    portfolio_past: [],
    jobs_preview: [],
    portfolio_preview: portfolio.slice(0, 2),
    talent_listings_active: talentListings,
    talent_listings_preview: talentListings,
    moved_to_username: null,
  };
};

export const getMockPublicTalentProject = (slug: string, projectId: string) => {
  const profile = getMockPublicTalentProfile(slug);
  if (!profile) return null;
  return [...profile.portfolio_now, ...profile.portfolio_past].find((item) => item.id === projectId) || null;
};
