import { VerifiedIdentity } from "./types";

type YouTubeApiItem = {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
  };
  statistics?: { subscriberCount?: string };
};

export async function fetchYouTubeChannels(accessToken: string): Promise<VerifiedIdentity[]> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: YouTubeApiItem[] };
  const items = data.items || [];
  return items.map((item) => {
    const thumb =
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url ||
      null;
    return {
      platform: "youtube",
      brandId: item.id,
      name: item.snippet?.title || "YouTube Channel",
      imageUrl: thumb,
      followersCount: item.statistics?.subscriberCount
        ? Number(item.statistics.subscriberCount)
        : null,
      handle: item.snippet?.customUrl ? `@${item.snippet.customUrl.replace(/^@/, "")}` : null,
      verifiedAt: new Date().toISOString(),
    };
  });
}
