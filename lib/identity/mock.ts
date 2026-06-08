import { IdentityPlatform, VerifiedIdentity } from "./types";

const nowIso = () => new Date().toISOString();

export const getMockIdentities = (platform: IdentityPlatform): VerifiedIdentity[] => {
  if (platform === "youtube") {
    return [
      {
        platform,
        brandId: "yt_channel_01",
        name: "Creator Studio",
        imageUrl: "https://picsum.photos/seed/yt1/96/96",
        followersCount: 128000,
        handle: "@creatorstudio",
        verifiedAt: nowIso(),
      },
      {
        platform,
        brandId: "yt_channel_02",
        name: "Edit Lab",
        imageUrl: "https://picsum.photos/seed/yt2/96/96",
        followersCount: 54200,
        handle: "@editlab",
        verifiedAt: nowIso(),
      },
    ];
  }

  return [
    {
      platform,
      brandId: "ig_user_01",
      name: "Creator Studio",
      imageUrl: "https://picsum.photos/seed/ig1/96/96",
      followersCount: null,
      handle: "@creatorstudio",
      verifiedAt: nowIso(),
    },
  ];
};

export const findMockIdentity = (platform: IdentityPlatform, brandId: string) =>
  getMockIdentities(platform).find((item) => item.brandId === brandId) || null;
