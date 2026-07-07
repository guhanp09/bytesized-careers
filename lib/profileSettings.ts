export type WorkingHoursMode = "flexible" | "fixed";

export const DEFAULT_WORKING_HOURS_START = "09:00";
export const DEFAULT_WORKING_HOURS_END = "18:00";
export const DEFAULT_WORKING_HOURS_TIMEZONE = "IST";
export const FLEXIBLE_WORKING_HOURS_LABEL = "Flexible working hours";

const RESERVED_PROFILE_HANDLES = new Set([
  "you",
  "jobs",
  "talent",
  "post",
  "admin",
  "api",
  "login",
  "signup",
  "settings",
  "applications",
  "reviews",
  "portfolio",
  "search",
  "saved",
]);

export const normalizeProfileHandle = (value: string) =>
  value.trim().replace(/^@+/, "").toLowerCase();

export const validateProfileDisplayName = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "Display name is required.";
  if (trimmed.length < 2) return "Display name must be at least 2 characters.";
  if (trimmed.length > 80) return "Display name is too long.";
  if (/https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) {
    return "Use your name or brand name, not a URL.";
  }
  if (/\s{3,}/.test(trimmed)) return "Use normal spacing in your name.";
  return null;
};

export const validateProfileUsername = (value: string) => {
  const normalized = normalizeProfileHandle(value);
  if (!normalized) return "Username is required.";
  if (normalized.length < 3 || normalized.length > 20) return "Username must be 3-20 characters.";
  if (/\s/.test(normalized)) return "Usernames cannot contain spaces.";
  if (/[/.]/.test(normalized) || /https?:\/\/|www\./i.test(value)) {
    return "Use your profile username, not a URL.";
  }
  if (!/^[a-z0-9][a-z0-9_]{2,19}$/.test(normalized)) {
    return "Use only lowercase letters, numbers, or underscores.";
  }
  if (RESERVED_PROFILE_HANDLES.has(normalized)) return "This username is reserved.";
  return null;
};

export const cleanProfileDisplayName = (value: string) =>
  value.trim().replace(/\s{2,}/g, " ");

export const parseWorkingHours = (
  value?: string | null,
  fallbackTimezone?: string | null
): { mode: WorkingHoursMode; start: string; end: string; timezone: string } => {
  const timezone = fallbackTimezone?.trim() || DEFAULT_WORKING_HOURS_TIMEZONE;
  const text = value?.trim();
  if (!text || /flexible/i.test(text)) {
    return {
      mode: "flexible",
      start: DEFAULT_WORKING_HOURS_START,
      end: DEFAULT_WORKING_HOURS_END,
      timezone,
    };
  }

  const match = text.match(/(\d{2}:\d{2})\s*(?:to|-|–)\s*(\d{2}:\d{2})(?:\s+(.+))?/i);
  if (!match) {
    return {
      mode: "flexible",
      start: DEFAULT_WORKING_HOURS_START,
      end: DEFAULT_WORKING_HOURS_END,
      timezone,
    };
  }

  return {
    mode: "fixed",
    start: match[1],
    end: match[2],
    timezone: match[3]?.trim() || timezone,
  };
};

export const formatWorkingHours = ({
  mode,
  start,
  end,
  timezone,
}: {
  mode: WorkingHoursMode;
  start: string;
  end: string;
  timezone: string;
}) =>
  mode === "flexible"
    ? FLEXIBLE_WORKING_HOURS_LABEL
    : `${start} to ${end} ${timezone.trim() || DEFAULT_WORKING_HOURS_TIMEZONE}`;
