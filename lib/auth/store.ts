import { VerifiedIdentity } from "../identity/types";

type UserRecord = {
  id: string;
  youtubeChannelId: string;
  createdAt: string;
};

type StoreShape = {
  users: Map<string, UserRecord>;
  channelToUser: Map<string, string>;
  identities: Map<string, VerifiedIdentity>;
};

const getStore = (): StoreShape => {
  const g = globalThis as typeof globalThis & { __cjStore?: StoreShape };
  if (!g.__cjStore) {
    g.__cjStore = {
      users: new Map(),
      channelToUser: new Map(),
      identities: new Map(),
    };
  }
  return g.__cjStore;
};

export const getIdentityForUser = (userId: string) => {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) return null;
  return store.identities.get(user.youtubeChannelId) || null;
};

export const linkUserToIdentity = (userId: string, identity: VerifiedIdentity) => {
  const store = getStore();
  const existingUserId = store.channelToUser.get(identity.brandId);
  if (existingUserId && existingUserId !== userId) {
    return { ok: false, reason: "channel_taken" as const };
  }

  store.channelToUser.set(identity.brandId, userId);
  store.identities.set(identity.brandId, identity);
  if (!store.users.has(userId)) {
    store.users.set(userId, {
      id: userId,
      youtubeChannelId: identity.brandId,
      createdAt: new Date().toISOString(),
    });
  } else {
    const existing = store.users.get(userId);
    if (existing) {
      store.users.set(userId, { ...existing, youtubeChannelId: identity.brandId });
    }
  }
  return { ok: true as const };
};
