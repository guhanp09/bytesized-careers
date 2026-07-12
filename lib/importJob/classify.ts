// Deterministic job-post classification (plan §6.5). Signal categories:
// (a) hiring lexicon, (b) recognized role, (c) money mention, (d) application
// instruction, (e) structural shape, (f) minimum length.
// looksLikeJobPost = roleFound || distinct categories ≥ 2. Always overridable in
// the UI ("Parse anyway") — deterministic classifiers must be cheap to overrule.

import type { SectionedDoc } from "./sections.ts";
import type { FieldExtraction, ImportBudgetValue, ImportClassification } from "./types.ts";

const HIRING_LEXICON_RE =
  /\bhiring\b|looking for|we need|need (?:a|an)\b|we're hiring|we are hiring|join our team|vacanc|opening|position\b|\brole\b|apply\b|dm to apply|immediate requirement|\bjob\b|work with us|required[:!]|chahiye/i;
const APPLY_INSTRUCTION_RE = /apply|send (?:your|us)|share (?:your|us)|reach out|dm\b|email (?:us|your)|contact us/i;

export function classifyJobPost(
  doc: SectionedDoc,
  extracted: {
    rolesDetected: string[];
    budget: FieldExtraction<ImportBudgetValue>;
    contactSignals: number;
  }
): ImportClassification {
  const text = doc.text;
  const reasons: string[] = [];

  const hiringLanguage = HIRING_LEXICON_RE.test(text);
  const roleFound = extracted.rolesDetected.length > 0;
  const moneyFound = extracted.budget.status !== "missing";
  const applicationInstruction = APPLY_INSTRUCTION_RE.test(text) || extracted.contactSignals > 0;
  const bullets = doc.units.filter((unit) => unit.kind === "bullet").length;
  const recognizedSections = new Set(
    doc.units.filter((unit) => unit.isSectionHeading).map((unit) => unit.section)
  ).size;
  const structured = bullets >= 3 || recognizedSections >= 2;
  const longEnough = Array.from(text.trim()).length >= 80;

  const categories = [hiringLanguage, roleFound, moneyFound, applicationInstruction, structured, longEnough];
  const score = categories.filter(Boolean).length;
  const looksLikeJobPost = roleFound || score >= 2;

  if (!roleFound) reasons.push("No role we recognize");
  if (!hiringLanguage) reasons.push("No hiring language found");
  if (!moneyFound && !applicationInstruction) reasons.push("No pay or application details found");
  if (!longEnough) reasons.push("The text is very short");

  return {
    looksLikeJobPost,
    score,
    reasons: looksLikeJobPost ? [] : reasons,
    rolesDetected: extracted.rolesDetected,
  };
}
