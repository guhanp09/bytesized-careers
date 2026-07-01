import type { ReferenceTimestampNote, ReferenceVideo } from "./types";

const MAX_REFERENCE_NOTES = 8;

export function formatReferenceTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function normalizeReferenceTimestampInput(value: string): { time: string; seconds: number } | null {
  const normalized = value.replace(/\s+/g, "").trim();
  if (!normalized) return null;
  if (!/^\d+(?::\d+){0,2}$/.test(normalized)) return null;

  const parts = normalized.split(":");
  if (parts.length > 3 || parts.some((part) => part === "")) return null;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;

  let seconds: number;
  if (numbers.length === 1) {
    seconds = numbers[0] * 60;
  } else if (numbers.length === 2) {
    const [minutes, remainingSeconds] = numbers;
    if (remainingSeconds >= 60) return null;
    seconds = minutes * 60 + remainingSeconds;
  } else {
    const [hours, minutes, remainingSeconds] = numbers;
    if (minutes >= 60 || remainingSeconds >= 60) return null;
    seconds = hours * 3600 + minutes * 60 + remainingSeconds;
  }

  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return { time: formatReferenceTimestamp(seconds), seconds };
}

export function parseReferenceTimestamp(value: string): number | null {
  return normalizeReferenceTimestampInput(value)?.seconds ?? null;
}

export function buildTimestampedVideoUrl(url: string, seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      parsed.searchParams.set("t", `${safeSeconds}s`);
      return parsed.toString();
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host.endsWith(".youtube.com")) {
      parsed.searchParams.set("t", `${safeSeconds}s`);
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function timestampAriaLabel(videoTitle: string, note: ReferenceTimestampNote, platform = "YouTube") {
  const minutes = Math.floor(note.seconds / 60);
  const seconds = note.seconds % 60;
  const minuteText = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const secondText = seconds === 1 ? "1 second" : `${seconds} seconds`;
  return `Open ${videoTitle} at ${minuteText} ${secondText} on ${platform}`;
}

const cleanString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
};

export function normalizeReferenceTimestampNote(value: unknown): ReferenceTimestampNote | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { id?: unknown; time?: unknown; seconds?: unknown; title?: unknown; description?: unknown };
  const rawTime = cleanString(record.time, 16);
  const normalizedTime = rawTime ? normalizeReferenceTimestampInput(rawTime) : null;
  const parsedSeconds =
    typeof record.seconds === "number" && Number.isFinite(record.seconds)
      ? Math.max(0, Math.floor(record.seconds))
      : normalizedTime
        ? normalizedTime.seconds
        : null;
  if (parsedSeconds === null) return null;
  const title = cleanString(record.title, 60);
  const description = cleanString(record.description, 220);
  if (!title && !description) return null;
  return {
    id: cleanString(record.id, 80),
    time: formatReferenceTimestamp(parsedSeconds),
    seconds: parsedSeconds,
    title: title || "Reference moment",
    description: description || "",
  };
}

export function normalizeReferenceVideo(value: unknown): ReferenceVideo | null {
  if (typeof value === "string") {
    const url = cleanString(value, 2048);
    return url ? { url } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url = cleanString(record.url ?? record.href, 2048);
  if (!url) return null;
  const timestampNotes = Array.isArray(record.timestampNotes ?? record.timestamp_notes)
    ? ((record.timestampNotes ?? record.timestamp_notes) as unknown[])
        .map(normalizeReferenceTimestampNote)
        .filter((entry): entry is ReferenceTimestampNote => Boolean(entry))
        .slice(0, MAX_REFERENCE_NOTES)
    : [];
  return {
    id: cleanString(record.id, 80),
    title: cleanString(record.title, 255),
    url,
    thumbnailUrl: cleanString(record.thumbnailUrl ?? record.thumbnail_url, 2048),
    platform: cleanString(record.platform, 64),
    description: cleanString(record.description, 400),
    whatToReference: cleanString(record.whatToReference ?? record.what_to_reference, 400),
    timestampNotes,
  };
}

export function serializeReferenceVideo(video: ReferenceVideo) {
  const timestampNotes = (video.timestampNotes || [])
    .map((note) => normalizeReferenceTimestampNote(note))
    .filter((note): note is ReferenceTimestampNote => Boolean(note));
  return {
    id: video.id || null,
    title: video.title?.trim() || null,
    url: video.url,
    thumbnail_url: video.thumbnailUrl?.trim() || null,
    platform: video.platform?.trim() || null,
    description: video.description?.trim() || null,
    what_to_reference: video.whatToReference?.trim() || null,
    timestamp_notes: timestampNotes.map((note) => ({
      id: note.id || null,
      time: note.time,
      seconds: note.seconds,
      title: note.title,
      description: note.description,
    })),
  };
}
