// Stage 3 of the import pipeline: fold classified units into named sections based
// on recognizable headings. Everything defaults to "body" — sections only refine
// where prose composition sends a unit.

import type { ImportUnit } from "./segment.ts";

export type ImportSection =
  | "about"
  | "responsibilities"
  | "requirements"
  | "compensation"
  | "apply"
  | "meta"
  | "body";

export type SectionedUnit = ImportUnit & {
  section: ImportSection;
  /** True for the heading unit that opened its section (skipped by prose). */
  isSectionHeading: boolean;
};

export type SectionedDoc = {
  text: string;
  units: SectionedUnit[];
};

export const SECTION_HEADING_LEXICON: Array<{ section: ImportSection; phrases: string[] }> = [
  {
    section: "about",
    phrases: ["about us", "about the role", "about the channel", "about the company", "who we are", "about"],
  },
  {
    section: "responsibilities",
    phrases: [
      "responsibilities",
      "key responsibilities",
      "what you'll do",
      "what you will do",
      "your job",
      "your role",
      "the role",
      "scope of work",
      "day to day",
      "day-to-day",
      "you will",
    ],
  },
  {
    section: "requirements",
    phrases: [
      "requirements",
      "must have",
      "must-have",
      "must haves",
      "we expect",
      "you should",
      "ideal candidate",
      "qualifications",
      "skills required",
      "what we're looking for",
      "what we are looking for",
      "who you are",
      "looking for",
    ],
  },
  {
    section: "compensation",
    phrases: ["compensation", "salary", "pay", "budget", "payment", "remuneration", "stipend", "ctc", "what we offer"],
  },
  {
    section: "apply",
    phrases: [
      "how to apply",
      "to apply",
      "apply",
      "interested",
      "interested?",
      "application process",
      "next steps",
      "hiring process",
    ],
  },
  { section: "meta", phrases: ["perks", "benefits", "why join us", "why us"] },
];

function headingSection(text: string): ImportSection | null {
  const key = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z'? -]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[:：]+$/, "")
    .trim();
  if (!key) return null;
  for (const entry of SECTION_HEADING_LEXICON) {
    for (const phrase of entry.phrases) {
      if (key === phrase || key === `${phrase}?`) return entry.section;
    }
  }
  return null;
}

export function detectSections(units: ImportUnit[], text: string): SectionedDoc {
  let current: ImportSection = "body";
  const out: SectionedUnit[] = units.map((unit) => {
    if (unit.kind === "heading") {
      const section = headingSection(unit.text);
      if (section) {
        current = section;
        return { ...unit, section, isSectionHeading: true };
      }
      // Unrecognized heading resets to body (a new topic we don't understand).
      current = "body";
      return { ...unit, section: "body", isSectionHeading: false };
    }
    if (unit.kind === "blank") {
      return { ...unit, section: current, isSectionHeading: false };
    }
    return { ...unit, section: current, isSectionHeading: false };
  });

  return { text, units: out };
}
