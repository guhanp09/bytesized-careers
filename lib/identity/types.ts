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
  error?: string;
};

export type IdentityDisconnectResponse = {
  ok: true;
  disconnected: true;
  provider_revocation:
    | "confirmed"
    | "already_invalid"
    | "rejected"
    | "unavailable"
    | "not_applicable";
  channel_links_removed: number;
};
