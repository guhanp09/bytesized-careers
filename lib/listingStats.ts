const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const normalizeCount = (value: unknown): number => {
  const parsed = finiteNumber(value);
  return parsed == null ? 0 : Math.max(0, Math.trunc(parsed));
};

export const normalizePercent = (value: unknown): number => {
  const parsed = finiteNumber(value);
  return parsed == null ? 0 : Math.min(100, Math.max(0, Math.round(parsed)));
};

type TalentStatsSource = {
  saves?: unknown;
  interested_recruiters?: unknown;
  interestedRecruiters?: unknown;
  response_rate?: unknown;
  responseRate?: unknown;
  reply_rate?: unknown;
  replyRate?: unknown;
  match_percentage?: unknown;
  matchPercentage?: unknown;
};

export const getTalentInterestedRecruiters = (item: TalentStatsSource): number =>
  normalizeCount(item.interested_recruiters ?? item.interestedRecruiters ?? item.saves);

export const getTalentResponseRate = (item: TalentStatsSource): number =>
  normalizePercent(
    item.response_rate ??
      item.responseRate ??
      item.reply_rate ??
      item.replyRate ??
      item.match_percentage ??
      item.matchPercentage
  );
