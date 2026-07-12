// Experience, start timeframe, turnaround, and deadline extraction (plan §6.4.3–4
// + §6.4.12). Deadlines are unsupported by the form; the verbatim sentence is kept
// for How to apply and the row explains why.

import type { StartTimeframe } from "../../types.ts";
import type { SectionedDoc } from "../sections.ts";
import type { ClaimSet } from "../textMatch.ts";
import { makeEvidence } from "../textMatch.ts";
import type { FieldExtraction, ImportWarning } from "../types.ts";

export type TimelineExtractionResult = {
  experience: FieldExtraction<{ min: string; max: string }>;
  startWithin: FieldExtraction<StartTimeframe>;
  turnaround: FieldExtraction<{ value: number; unit: "hours" | "days" | "weeks" }>;
  deadline: FieldExtraction<string>;
  /** Verbatim deadline sentence for How to apply. */
  deadlineSentence: string | null;
};

const EXP_RANGE_RE = /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i;
const EXP_PLUS_RE = /(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i;
const EXP_SINGLE_RE = /(\d{1,2})\s*(?:years?|yrs?)\b/i;
const FRESHER_RE = /\bfreshers?\b|entry[- ]level|no experience (?:needed|required)/i;
const EXP_CONTEXT_RE = /experience|\bexp\b|yrs/i;

const ASAP_RE = /\bimmediate(?:ly)?\b|\basap\b|\burgent(?:ly)?\b|join(?:ing)? immediately|start immediately|immediate joiner/i;
const WITHIN_1MO_RE = /within (?:a|1|one) month|next month/i;
const WITHIN_2MO_RE = /within (?:2|two) months/i;
const WITHIN_3MO_RE = /within (?:3|three) months|next quarter/i;

const TURNAROUND_A_RE = /(\d{1,2})\s*[- ]?\s*(hours?|hrs?|days?|weeks?)\s*(?:turnaround|delivery)/i;
const TURNAROUND_B_RE = /turnaround(?:\s*(?:time|of|:|-))?\s*(?:is\s*)?(?:within\s*)?(\d{1,2})\s*(hours?|hrs?|days?|weeks?)/i;

const DEADLINE_RE = /apply by|\bdeadline\b|last date|applications? close/i;

const clampYears = (n: number) => Math.max(0, Math.min(10, n));

function turnaroundUnit(raw: string): "hours" | "days" | "weeks" {
  const lower = raw.toLowerCase();
  if (lower.startsWith("hour") || lower.startsWith("hr")) return "hours";
  if (lower.startsWith("week")) return "weeks";
  return "days";
}

export function extractExperienceAndTimeline(
  doc: SectionedDoc,
  warnings: ImportWarning[],
  claims: ClaimSet
): TimelineExtractionResult {
  let experience: FieldExtraction<{ min: string; max: string }> = { status: "missing", value: null, evidence: [] };
  let startWithin: FieldExtraction<StartTimeframe> = { status: "missing", value: null, evidence: [] };
  let turnaround: FieldExtraction<{ value: number; unit: "hours" | "days" | "weeks" }> = {
    status: "missing",
    value: null,
    evidence: [],
  };
  let deadline: FieldExtraction<string> = { status: "missing", value: null, evidence: [] };
  let deadlineSentence: string | null = null;

  for (const unit of doc.units) {
    if (unit.kind === "blank" || unit.kind === "url" || unit.kind === "hashtagRow") continue;
    const text = unit.text;

    // ---- Experience ----
    if (experience.status === "missing") {
      const contextOk = unit.label === "experience" || EXP_CONTEXT_RE.test(text);
      const range = text.match(EXP_RANGE_RE);
      if (range && range.index !== undefined && contextOk) {
        let min = clampYears(Number(range[1]));
        let max = clampYears(Number(range[2]));
        if (min > max) [min, max] = [max, min];
        const clamped = Number(range[1]) > 10 || Number(range[2]) > 10;
        experience = {
          status: clamped ? "review" : "imported",
          value: { min: String(min), max: String(max) },
          evidence: [makeEvidence(doc.text, unit.start + range.index, unit.start + range.index + range[0].length)],
          note: clamped ? "CreatorJobs experience tops out at 10 years — adjust if needed." : undefined,
        };
        if (unit.label === "experience") claims.add(unit.start, unit.end);
      } else {
        const plus = text.match(EXP_PLUS_RE);
        if (plus && plus.index !== undefined && contextOk) {
          const years = clampYears(Number(plus[1]));
          experience = {
            status: "review",
            value: { min: String(years), max: String(years) },
            evidence: [makeEvidence(doc.text, unit.start + plus.index, unit.start + plus.index + plus[0].length)],
            note: `The post says ${plus[1]}+ years — adjust the range if you'd accept more.`,
          };
          if (unit.label === "experience") claims.add(unit.start, unit.end);
        } else {
          const single = text.match(EXP_SINGLE_RE);
          if (single && single.index !== undefined && contextOk && !EXP_RANGE_RE.test(text)) {
            const years = clampYears(Number(single[1]));
            experience = {
              status: "imported",
              value: { min: String(years), max: String(years) },
              evidence: [makeEvidence(doc.text, unit.start + single.index, unit.start + single.index + single[0].length)],
            };
            if (unit.label === "experience") claims.add(unit.start, unit.end);
          } else {
            const fresher = text.match(FRESHER_RE);
            if (fresher && fresher.index !== undefined) {
              experience = {
                status: "imported",
                value: { min: "0", max: "0" },
                evidence: [
                  makeEvidence(doc.text, unit.start + fresher.index, unit.start + fresher.index + fresher[0].length),
                ],
              };
            }
          }
        }
      }
    }

    // ---- Start timeframe ----
    if (startWithin.status === "missing") {
      const patterns: Array<[RegExp, StartTimeframe]> = [
        [ASAP_RE, "ASAP"],
        [WITHIN_1MO_RE, "<1mo"],
        [WITHIN_2MO_RE, "<2mo"],
        [WITHIN_3MO_RE, "<3mo"],
      ];
      for (const [re, value] of patterns) {
        const match = text.match(re);
        if (match && match.index !== undefined) {
          startWithin = {
            status: "imported",
            value,
            evidence: [makeEvidence(doc.text, unit.start + match.index, unit.start + match.index + match[0].length)],
          };
          break;
        }
      }
    }

    // ---- Turnaround ----
    if (turnaround.status === "missing") {
      const a = text.match(TURNAROUND_A_RE);
      const b = a ? null : text.match(TURNAROUND_B_RE);
      const match = a ?? b;
      if (match && match.index !== undefined) {
        turnaround = {
          status: "imported",
          value: { value: Number(match[1]), unit: turnaroundUnit(match[2]) },
          evidence: [makeEvidence(doc.text, unit.start + match.index, unit.start + match.index + match[0].length)],
        };
      }
    }

    // ---- Deadline (unsupported by the form) ----
    if (deadline.status === "missing") {
      const match = text.match(DEADLINE_RE);
      if (match && match.index !== undefined && (unit.label === "deadline" || unit.section === "apply" || /\d/.test(text))) {
        const evidence = makeEvidence(doc.text, unit.start, unit.end);
        deadlineSentence = text.trim().replace(/^-\s+/, "");
        deadline = {
          status: "unsupported",
          value: null,
          evidence: [evidence],
          note: "CreatorJobs doesn't set application deadlines yet — we kept this in How to apply.",
        };
        warnings.push({
          code: "deadline-unsupported",
          message: "The application deadline was kept as text in How to apply.",
          evidence,
        });
        claims.add(unit.start, unit.end);
      }
    }
  }

  return { experience, startWithin, turnaround, deadline, deadlineSentence };
}
