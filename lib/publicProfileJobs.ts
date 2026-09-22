import type { BackendPublicJobItem } from "./backendClient";
import type { Job } from "./types";

export type PublicJobFixtureLookup = ReadonlyMap<string, Job>;

const cleanText = (value?: string | null) => {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["not shared", "not set", "creator-economy profile"].includes(normalized)) {
    return null;
  }
  return text;
};

const cleanList = (values: Array<string | null | undefined>) =>
  values.map(cleanText).filter((item): item is string => Boolean(item));

const basePublicJobId = (value: string) => value.split("-past-hiring-")[0];

const PUBLIC_JOB_CATEGORIES = new Set<Job["category"]>([
  "Editing",
  "Design",
  "Writing",
  "Thumbnails",
  "Shorts",
  "Motion Graphics",
  "Channel Manager",
  "Research",
  "Voice Over",
  "Marketing",
  "Uncategorized",
]);

/**
 * Adapt the deliberately compact public-profile job response for JobCard.
 *
 * A fixture lookup is an explicit capability, supplied only by the server when
 * local profile fixtures are allowed. Without it, even an ID equal to a demo
 * record is mapped exclusively from the backend response; production data can
 * never inherit demo compensation, identity, tags, media, or status.
 */
export const mapPublicJobToCanonical = (
  item: BackendPublicJobItem,
  fallbackChannelName?: string | null,
  fixtureLookup?: PublicJobFixtureLookup,
): Job => {
  const lookupId = String(item.id || "");
  const baseJob = fixtureLookup?.get(lookupId) || fixtureLookup?.get(basePublicJobId(lookupId));
  const channelName = cleanText(item.channel_name) || baseJob?.channel.name || cleanText(fallbackChannelName) || "Creator profile";
  const isClosed = String(item.status || "").toLowerCase() === "closed";
  const legacyCategory = cleanText(item.category);
  const category = PUBLIC_JOB_CATEGORIES.has(legacyCategory as Job["category"])
    ? (legacyCategory as Job["category"])
    : baseJob?.category || "Uncategorized";
  const primaryRoleName = cleanText(item.primary_role_name_snapshot);
  const roleSpecialization = cleanText(item.role_specialization);

  return {
    ...(baseJob || {
      id: lookupId,
      title: cleanText(item.title) || "Job listing",
      category,
      legacyCategory: legacyCategory || null,
      primaryRoleName: primaryRoleName || undefined,
      roleSpecialization: roleSpecialization || undefined,
      budget: "",
      experience: "",
      location: cleanText(item.location) || "",
      postedShort: "",
      views: 0,
      applicants: 0,
      responseRate: 0,
      channel: {
        name: channelName,
        logoUrl: "",
        subscribers: null,
        verified: false,
      },
      tags: [],
      startTimeframe: "Flexible" as const,
      type: "One-time" as const,
    }),
    id: baseJob?.id || lookupId,
    title: cleanText(item.title) || baseJob?.title || "Job listing",
    category,
    legacyCategory: legacyCategory || baseJob?.legacyCategory || null,
    primaryRoleName: primaryRoleName || baseJob?.primaryRoleName,
    roleSpecialization: roleSpecialization || baseJob?.roleSpecialization,
    location: cleanText(item.location) || baseJob?.location || "",
    channel: {
      name: channelName,
      logoUrl: baseJob?.channel.logoUrl || "",
      subscribers: baseJob?.channel.subscribers ?? null,
      verified: baseJob?.channel.verified ?? false,
    },
    tags:
      baseJob?.tags?.length
        ? baseJob.tags
        : cleanList([
            primaryRoleName,
            roleSpecialization,
            cleanText(item.category),
            cleanText(item.location),
            isClosed ? "Closed" : "Open",
          ]),
    status: isClosed ? "closed" : baseJob?.status || "published",
    createdAt: item.created_at || baseJob?.createdAt,
    updatedAt: item.created_at || baseJob?.updatedAt,
  };
};
