import type { MetadataRoute } from "next";
import { isLocalMocksEnabled, listJobsWithMeta, listTalentListings } from "../lib/backendClient";
import { JOBS } from "../lib/jobs";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/jobs`,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${siteUrl}/talent`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/support`,
      changeFrequency: "monthly",
      priority: 0.35,
    },
    {
      url: `${siteUrl}/terms`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/privacy`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  const jobs = isLocalMocksEnabled()
    ? JOBS
    : await listJobsWithMeta({ limit: 100, offset: 0 })
        .then((response) => response.items)
        .catch(() => []);

  const jobRoutes = jobs
    .filter((job) => job.status !== "archived" && job.status !== "closed")
    .map((job) => ({
      url: `${siteUrl}/jobs/${encodeURIComponent(String(job.id))}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  const talentRoutes = isLocalMocksEnabled()
    ? []
    : await listTalentListings({ limit: 100, offset: 0 })
        .then((response) =>
          response.items.map((listing) => ({
            url: `${siteUrl}/talent/${encodeURIComponent(listing.id)}`,
            lastModified: listing.updated_at ? new Date(listing.updated_at) : new Date(),
            changeFrequency: "weekly" as const,
            priority: 0.6,
          }))
        )
        .catch(() => []);

  return [...staticRoutes, ...jobRoutes, ...talentRoutes];
}
