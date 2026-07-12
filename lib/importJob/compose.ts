// Prose composition (plan §6.4.8/D7). Never rewrites: `about` is the original
// narrative minus claimed/contact/hashtag lines; responsibilities/requirements are
// the detected bullets verbatim (newline-joined, de-bulleted); How to apply keeps
// only native screening instructions plus the verbatim deadline sentence. Every
// leftover line lands in `unmapped` so nothing silently disappears.

import type { SectionedDoc, SectionedUnit } from "./sections.ts";
import type { ClaimSet } from "./textMatch.ts";
import { makeEvidence } from "./textMatch.ts";
import type { FieldExtraction, ImportEvidence } from "./types.ts";

export type NarrativeResult = {
  about: FieldExtraction<string>;
  responsibilities: FieldExtraction<string>;
  requirements: FieldExtraction<string>;
  howToApply: FieldExtraction<string>;
  unmapped: string[];
};

const IMPERATIVE_VERBS = new Set([
  "edit",
  "create",
  "manage",
  "write",
  "design",
  "plan",
  "upload",
  "research",
  "coordinate",
  "develop",
  "produce",
  "handle",
  "own",
  "publish",
  "schedule",
  "deliver",
  "shoot",
  "brainstorm",
  "collaborate",
  "repurpose",
  "optimize",
]);

const REQUIREMENT_HINT_RE = /\bmust\b|\bshould\b|experience (?:in|with|of)|proficien|knowledge of|familiar(?:ity)? with|comfortable with|strong grasp|good (?:at|with)|expertise/i;

const CLAIM_THRESHOLD = 0.5;
const ABOUT_MIN_CHARS = 20;

function deBullet(text: string): string {
  return text.replace(/^\s*-\s+/, "").trim();
}

function firstWord(text: string): string {
  const match = deBullet(text)
    .toLowerCase()
    .match(/[a-z']+/);
  return match ? match[0] : "";
}

export function composeNarrative(
  doc: SectionedDoc,
  claims: ClaimSet,
  options: { deadlineSentence?: string | null; deadlineEvidence?: ImportEvidence[] } = {}
): NarrativeResult {
  const aboutParts: Array<{ lineIndex: number; text: string }> = [];
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  const applyParts: string[] = [];
  const unmapped: string[] = [];

  const evidenceFor = (units: SectionedUnit[]): ReturnType<typeof makeEvidence>[] =>
    units.slice(0, 2).map((unit) => makeEvidence(doc.text, unit.start, unit.end));

  const aboutUnits: SectionedUnit[] = [];
  const respUnits: SectionedUnit[] = [];
  const reqUnits: SectionedUnit[] = [];
  const applyUnits: SectionedUnit[] = [];

  for (const unit of doc.units) {
    if (unit.kind === "blank" || unit.kind === "heading" || unit.isSectionHeading) continue;
    if (unit.kind === "contact" || unit.kind === "url" || unit.kind === "hashtagRow") continue;

    const claimed = claims.coverage(unit.start, unit.end, doc.text) >= CLAIM_THRESHOLD;
    if (claimed) continue;

    if (unit.kind === "kv") {
      // A labeled line no extractor consumed — surface it rather than hiding it in prose.
      unmapped.push(unit.text.trim());
      continue;
    }

    const isBullet = unit.kind === "bullet";
    const body = deBullet(unit.text);
    if (!body) continue;

    // "To apply, …" lead sentences are application instructions even without a
    // "How to apply" heading above them.
    if (unit.section === "body" && /^(?:to apply|how to apply|interested\?)\b/i.test(body)) {
      applyParts.push(body);
      applyUnits.push(unit);
      continue;
    }

    switch (unit.section) {
      case "responsibilities":
        responsibilities.push(body);
        respUnits.push(unit);
        break;
      case "requirements":
        requirements.push(body);
        reqUnits.push(unit);
        break;
      case "apply":
        applyParts.push(body);
        applyUnits.push(unit);
        break;
      case "meta":
        unmapped.push(unit.text.trim());
        break;
      case "compensation":
        // Non-claimed compensation prose reads as context.
        aboutParts.push({ lineIndex: unit.lineIndex, text: body });
        aboutUnits.push(unit);
        break;
      default: {
        if (isBullet) {
          const verb = firstWord(unit.text);
          if (IMPERATIVE_VERBS.has(verb)) {
            responsibilities.push(body);
            respUnits.push(unit);
          } else if (REQUIREMENT_HINT_RE.test(body)) {
            requirements.push(body);
            reqUnits.push(unit);
          } else {
            aboutParts.push({ lineIndex: unit.lineIndex, text: body });
            aboutUnits.push(unit);
          }
        } else {
          aboutParts.push({ lineIndex: unit.lineIndex, text: unit.text.trim() });
          aboutUnits.push(unit);
        }
      }
    }
  }

  // Rejoin about text: units from the same source line concatenate back into one
  // paragraph; different lines are separated by blank lines.
  const aboutBlocks: string[] = [];
  let lastLine = -2;
  for (const part of aboutParts) {
    if (part.lineIndex === lastLine && aboutBlocks.length > 0) {
      aboutBlocks[aboutBlocks.length - 1] = `${aboutBlocks[aboutBlocks.length - 1]} ${part.text}`.replace(/\s+/g, " ");
    } else {
      aboutBlocks.push(part.text);
    }
    lastLine = part.lineIndex;
  }
  const aboutText = aboutBlocks.join("\n\n").trim();

  const howToApplyPieces = [...applyParts];
  if (options.deadlineSentence) howToApplyPieces.push(options.deadlineSentence);
  const howToApplyText = howToApplyPieces.join("\n").trim();

  const about: FieldExtraction<string> =
    aboutText.length === 0
      ? { status: "missing", value: null, evidence: [] }
      : aboutText.length < ABOUT_MIN_CHARS
        ? {
            status: "review",
            value: aboutText,
            evidence: evidenceFor(aboutUnits),
            note: "Add at least 20 characters about the brand — the post didn't include much background.",
          }
        : { status: "imported", value: aboutText, evidence: evidenceFor(aboutUnits) };

  return {
    about,
    responsibilities:
      responsibilities.length > 0
        ? { status: "imported", value: responsibilities.join("\n"), evidence: evidenceFor(respUnits) }
        : { status: "missing", value: null, evidence: [] },
    requirements:
      requirements.length > 0
        ? { status: "imported", value: requirements.join("\n"), evidence: evidenceFor(reqUnits) }
        : { status: "missing", value: null, evidence: [] },
    howToApply:
      howToApplyText.length > 0
        ? {
            status: "imported",
            value: howToApplyText,
            evidence: [...evidenceFor(applyUnits), ...(options.deadlineSentence ? options.deadlineEvidence ?? [] : [])],
          }
        : { status: "missing", value: null, evidence: [] },
    unmapped,
  };
}
