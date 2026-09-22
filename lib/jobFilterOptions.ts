import type { StartTimeframe } from "./types";

/** Product vocabulary used by client-side browse controls, with no fixture dependency. */
export const JOB_CATEGORIES = [
  "All",
  "Editing",
  "Design",
  "Writing",
  "Thumbnails",
  "Shorts",
  "Motion Graphics",
  "Channel Manager",
  "Research",
  "Voice Over",
  "Marketing",
] as const;

export const JOB_START_TIME_VALUES: StartTimeframe[] = [
  "ASAP",
  "<1mo",
  "<2mo",
  "<3mo",
  "Flexible",
];
