export type IdentityPlatform = "youtube" | "instagram";

export type VerifiedIdentity = {
  platform: IdentityPlatform;
  brandId: string;
  name: string;
  imageUrl: string | null;
  followersCount: number | null;
  handle: string | null;
  verifiedAt: string;
};

export type IdentityStatusResponse = {
  verified: boolean;
  identity?: VerifiedIdentity;
};

export type IdentityConnectResponse = {
  options: VerifiedIdentity[];
};
