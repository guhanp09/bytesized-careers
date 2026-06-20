import { prisma } from "../db/prisma";
import { JOBS } from "../jobs";
import { Job, JobCategory, ReferenceVideo, StartTimeframe } from "../types";
import { randomUUID } from "crypto";

const toIso = (date: Date) => date.toISOString();
const LOCAL_SAMPLE_POSTED_LABEL = "Local sample";
const LOCAL_SAMPLE_JOB_IDS = new Set(JOBS.map((job) => String(job.id)));

const isSyntheticPostedShort = (value?: string | null) => {
  const raw = (value || "").trim().toLowerCase();
  return !raw || raw === "now" || raw === "just now" || /^\d+[mhd]$/.test(raw) || raw.includes("ago");
};

const parsePostedShortToDate = (value?: string | null) => {
  if (!value) return new Date();
  const match = value.trim().match(/^(\d+)([mhd])$/i);
  if (!match) return new Date();
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms =
    unit === "m"
      ? amount * 60 * 1000
      : unit === "h"
        ? amount * 60 * 60 * 1000
        : amount * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
};

const formatPostedShort = (createdAt: Date) => {
  const diffMs = Date.now() - createdAt.getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
};

const getLocalPostedShort = (record: { id: string; postedShort: string | null; createdAt: Date }) => {
  if (LOCAL_SAMPLE_JOB_IDS.has(String(record.id))) {
    return LOCAL_SAMPLE_POSTED_LABEL;
  }
  return isSyntheticPostedShort(record.postedShort)
    ? formatPostedShort(record.createdAt)
    : record.postedShort || formatPostedShort(record.createdAt);
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const MOCK_ATTRIBUTION_BY_ID = new Map(
  JOBS.map((job) => [
    String(job.id),
    {
      channelProfileSlug: job.channelProfileSlug || undefined,
      channelExternalUrl: job.channelExternalUrl || undefined,
      postedByAgency: Boolean(job.postedByAgency),
      agencyProfileSlug: job.agencyProfileSlug || undefined,
      managedByAgencyName: job.managedByAgencyName || undefined,
    },
  ]),
);

const getAttributionForJob = (jobId: string, channelName: string) => {
  const fromMock = MOCK_ATTRIBUTION_BY_ID.get(String(jobId));
  if (fromMock) {
    return {
      channelProfileSlug: fromMock.channelProfileSlug || toSlug(channelName) || undefined,
      channelExternalUrl: fromMock.channelExternalUrl,
      postedByAgency: fromMock.postedByAgency,
      agencyProfileSlug: fromMock.agencyProfileSlug,
      managedByAgencyName: fromMock.managedByAgencyName,
    };
  }
  return {
    channelProfileSlug: toSlug(channelName) || undefined,
    postedByAgency: false,
    agencyProfileSlug: undefined,
    managedByAgencyName: undefined,
  };
};

const toJobType = (value: string | null): Job["type"] => {
  if (value === "One-time" || value === "Monthly" || value === "Part-time" || value === "Full-time") {
    return value;
  }
  return undefined;
};

const mapRecordToJob = (record: {
  id: string;
  title: string;
  category: string;
  budget: string;
  experience: string;
  location: string;
  postedShort: string | null;
  views: number;
  applicants: number;
  responseRate: number;
  platform: string | null;
  startTimeframe: string;
  type: string | null;
  about: string | null;
  responsibilities: string | null;
  requirements: string | null;
  howToApply: string | null;
  tags: unknown;
  referenceVideos: unknown;
  channelName: string;
  channelLogoUrl: string | null;
  channelSubscribers: number | null;
  channelVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Job => ({
  ...getAttributionForJob(record.id, record.channelName),
  id: String(record.id),
  title: record.title,
  category: record.category as JobCategory,
  budget: record.budget,
  experience: record.experience,
  location: record.location,
  postedShort: getLocalPostedShort(record),
  views: record.views,
  applicants: record.applicants,
  responseRate: record.responseRate,
  channel: {
    name: record.channelName,
    logoUrl: record.channelLogoUrl || "https://picsum.photos/seed/new/96/96",
    subscribers: record.channelSubscribers ?? null,
    verified: record.channelVerified || undefined,
  },
  tags: Array.isArray(record.tags) ? (record.tags as string[]) : [],
  startTimeframe: record.startTimeframe as StartTimeframe,
  type: toJobType(record.type),
  referenceVideos: Array.isArray(record.referenceVideos)
    ? (record.referenceVideos as ReferenceVideo[])
    : undefined,
  platform: record.platform || undefined,
  about: record.about || "",
  responsibilities: record.responsibilities || "",
  requirements: record.requirements || "",
  howToApply: record.howToApply || "",
  createdAt: toIso(record.createdAt),
  updatedAt: toIso(record.updatedAt),
});

const mapMockToCreateInput = (job: Job) => ({
  id: job.id || randomUUID(),
  title: job.title,
  category: job.category,
  budget: job.budget,
  experience: job.experience,
  location: job.location,
  postedShort: job.postedShort,
  views: job.views ?? 0,
  applicants: job.applicants ?? 0,
  responseRate: job.responseRate ?? 0,
  platform: job.platform,
  startTimeframe: job.startTimeframe,
  type: job.type,
  about: job.about || "",
  responsibilities: job.responsibilities || "",
  requirements: job.requirements || "",
  howToApply: job.howToApply || "",
  tags: job.tags ?? [],
  referenceVideos: job.referenceVideos ?? [],
  channelName: job.channel?.name || "Content creator",
  channelLogoUrl: job.channel?.logoUrl || null,
  channelSubscribers: job.channel?.subscribers ?? null,
  channelVerified: job.channel?.verified ?? false,
  createdAt: parsePostedShortToDate(job.postedShort),
});

const ensureSeeded = async () => {
  const count = await prisma.job.count();
  if (count > 0) return;

  for (const job of JOBS) {
    await prisma.job.create({ data: mapMockToCreateInput(job) });
  }
};

const backfillSeededJobs = async () => {
  for (const job of JOBS) {
    const id = String(job.id);
    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) {
      await prisma.job.create({ data: mapMockToCreateInput(job) });
      continue;
    }

    const updates: {
      about?: string;
      responsibilities?: string;
      requirements?: string;
      howToApply?: string;
      views?: number;
      responseRate?: number;
    } = {};

    if (!existing.about && job.about) updates.about = job.about;
    if (!existing.responsibilities && job.responsibilities)
      updates.responsibilities = job.responsibilities;
    if (!existing.requirements && job.requirements) updates.requirements = job.requirements;
    if (!existing.howToApply && job.howToApply) updates.howToApply = job.howToApply;
    if (existing.views !== job.views) updates.views = job.views ?? 0;
    if (existing.responseRate !== job.responseRate) updates.responseRate = job.responseRate ?? 0;

    if (Object.keys(updates).length) {
      await prisma.job.update({ where: { id }, data: updates });
    }
  }
};

export async function createJob(job: Job): Promise<Job> {
  const id = job.id && String(job.id).trim() ? String(job.id) : randomUUID();

  const created = await prisma.job.create({
    data: {
      id,
      title: job.title,
      category: job.category,
      budget: job.budget || "",
      experience: job.experience || "",
      location: job.location || "",
      postedShort: job.postedShort || undefined,
      views: job.views ?? 0,
      applicants: job.applicants ?? 0,
      responseRate: job.responseRate ?? 0,
      platform: job.platform,
      startTimeframe: job.startTimeframe,
      type: job.type,
      about: job.about || "",
      responsibilities: job.responsibilities || "",
      requirements: job.requirements || "",
      howToApply: job.howToApply || "",
      tags: job.tags ?? [],
      referenceVideos: job.referenceVideos ?? [],
      channelName: job.channel?.name || "Content creator",
      channelLogoUrl: job.channel?.logoUrl || null,
      channelSubscribers: job.channel?.subscribers ?? null,
      channelVerified: job.channel?.verified ?? false,
    },
  });

  return mapRecordToJob(created);
}

export async function getJobById(id: string): Promise<Job | null> {
  await ensureSeeded();
  await backfillSeededJobs();
  const record = await prisma.job.findUnique({ where: { id } });
  if (!record) return null;
  return mapRecordToJob(record);
}

export async function listJobs(): Promise<Job[]> {
  await ensureSeeded();
  await backfillSeededJobs();
  const records = await prisma.job.findMany({ orderBy: { createdAt: "desc" } });
  return records.map(mapRecordToJob);
}
