// Compensation extraction (plan §6.3). Per-unit scanning only — no whole-text
// regexes. Never converts currencies; never converts annual (LPA/CTC) figures to
// monthly amounts (the ÷12 arithmetic appears only inside the note as a hint).

import type { SectionedDoc, SectionedUnit } from "../sections.ts";
import type { ClaimSet } from "../textMatch.ts";
import { makeEvidence } from "../textMatch.ts";
import type { FieldExtraction, ImportBudgetValue, ImportEvidence, ImportWarning } from "../types.ts";

export type BudgetExtractionResult = {
  budget: FieldExtraction<ImportBudgetValue>;
  /** True when the source stated a billing period (per month/project/video/annual…). */
  explicitUnit: boolean;
};

type MoneyAtom = {
  amount: number;
  hasCurrency: boolean;
  annual: boolean;
  scaled: boolean;
  start: number;
  end: number;
};

type Candidate = {
  min: number;
  max: number;
  unit: "per project" | "per month";
  explicitUnit: boolean;
  coercedFrom: string | null;
  annual: boolean;
  singleAmount: boolean;
  assumedUnit: boolean;
  priority: number;
  start: number;
  end: number;
  unitIdx: number;
};

const ATOM_RE = /(₹|rs\.?\s?|inr\s?)?(\d[\d,]{0,11}(?:\.\d{1,2})?)((?:\s?(?:k|thousand|lakhs?|lacs?|lpa))|l)?(?![\d])/gi;
const RANGE_SEP_RE = /^\s*(?:-|–|—|~|to)\s*(?:₹|rs\.?\s?|inr\s?)?$/i;
const FOREIGN_RE = /(?:\$|€|£)\s?\d|(?:\b(?:usd|eur|gbp)\b\s?\d)|\d\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/i;
const SUBSCRIBER_GUARD_RE = /subs?\b|subscriber|follower|views?\b|likes\b/i;

const MONTHLY_RE = /\/\s*month|per\s+month|monthly|\bpm\b|p\.m\.|a\s+month|\/\s*mo\b|per\s+mo\b|retainer/i;
const PROJECT_RE = /per\s+project|\/\s*project|for\s+the\s+project|project\s+budget|one[- ]time/i;
const PER_OTHER_RE = /per\s+(video|thumbnail|reel|short|hour|day|week|post|article|episode)s?|\/\s*(video|thumbnail|reel|hour|hr|day|week|episode)\b|hourly/i;
const ANNUAL_RE = /\blpa\b|per\s+annum|\bp\.?a\.\b|annum|annual(?:ly)?|yearly|\/\s*year|per\s+year|\bctc\b/i;
const SALARY_CONTEXT_RE = /salary|stipend/i;

const CONTACT_INTENT_RE =
  /dm (?:me |us )?(?:your |for )?(?:rates?|quote|quotation|budget)|share your (?:rates?|quotation|expected)|rates? (?:are )?negotiable|\bnegotiable\b|depends on experience|budget (?:is )?open|contact for (?:pricing|rates?)|quote your/i;
const FLEXIBLE_INTENT_RE = /flexible budget|budget\s*[:\-]?\s*flexible|budget is flexible/i;

const MIN_AMOUNT = 100;
const MAX_AMOUNT = 100_000_000;

const FOREIGN_ADJACENT_RE = /(?:[$€£]|usd|eur|gbp)\s{0,2}$/i;

function scanAtoms(unit: SectionedUnit): MoneyAtom[] {
  const atoms: MoneyAtom[] = [];
  for (const match of unit.text.matchAll(ATOM_RE)) {
    const idx = match.index ?? 0;
    const currency = match[1] ?? "";
    // Foreign-currency amounts never enter the INR budget path.
    if (FOREIGN_ADJACENT_RE.test(unit.text.slice(Math.max(0, idx - 4), idx))) continue;
    const numberText = match[2];
    let suffix = (match[3] ?? "").trim().toLowerCase();
    // A bare "l" only counts when directly adjacent to the digits ("1.5L", not "5 l").
    if (suffix === "l" && match[3] !== "l" && match[3] !== "L") suffix = "";

    // Subscriber/view-count guard: ignore numbers in audience-metric context.
    const windowStart = Math.max(0, idx - 24);
    const windowEnd = Math.min(unit.text.length, idx + match[0].length + 24);
    if (SUBSCRIBER_GUARD_RE.test(unit.text.slice(windowStart, windowEnd))) continue;

    const base = Number(numberText.replace(/,/g, ""));
    if (!Number.isFinite(base) || base <= 0) continue;

    let amount = base;
    let annual = false;
    let scaled = false;
    if (suffix === "k" || suffix === "thousand") {
      amount = base * 1_000;
      scaled = true;
    } else if (suffix === "l" || suffix.startsWith("lakh") || suffix.startsWith("lac")) {
      amount = base * 100_000;
      scaled = true;
    } else if (suffix === "lpa") {
      amount = base * 100_000;
      annual = true;
      scaled = true;
    }

    atoms.push({
      amount,
      hasCurrency: Boolean(currency),
      annual,
      scaled,
      start: unit.start + idx,
      end: unit.start + idx + match[0].length,
    });
  }
  return atoms;
}

function unitWords(text: string): { unit: "per project" | "per month" | null; coercedFrom: string | null; annual: boolean } {
  if (ANNUAL_RE.test(text)) return { unit: null, coercedFrom: null, annual: true };
  // The billing word closest to the amount wins ("₹1,500 per video, 4 videos a
  // month" must read per-video, not monthly).
  const monthly = text.search(MONTHLY_RE);
  const perOtherMatch = text.match(PER_OTHER_RE);
  const perOther = perOtherMatch?.index ?? -1;
  const project = text.search(PROJECT_RE);
  const candidates = [
    { idx: monthly, kind: "monthly" as const },
    { idx: perOther, kind: "perOther" as const },
    { idx: project, kind: "project" as const },
  ]
    .filter((c) => c.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const winner = candidates[0];
  if (!winner) return { unit: null, coercedFrom: null, annual: false };
  if (winner.kind === "monthly") return { unit: "per month", coercedFrom: null, annual: false };
  if (winner.kind === "perOther") {
    return { unit: "per project", coercedFrom: perOtherMatch?.[1] ?? perOtherMatch?.[2] ?? "unit", annual: false };
  }
  return { unit: "per project", coercedFrom: null, annual: false };
}

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-US")}`;
}

export function extractBudget(doc: SectionedDoc, warnings: ImportWarning[], claims: ClaimSet): BudgetExtractionResult {
  const candidates: Candidate[] = [];
  let foreignEvidence: ImportEvidence | null = null;
  let contactEvidence: ImportEvidence | null = null;
  let flexibleEvidence: ImportEvidence | null = null;

  doc.units.forEach((unit, unitIdx) => {
    if (unit.kind === "blank" || unit.kind === "heading" || unit.kind === "hashtagRow" || unit.kind === "url") return;

    if (!foreignEvidence) {
      const foreign = unit.text.match(FOREIGN_RE);
      if (foreign && foreign.index !== undefined) {
        foreignEvidence = makeEvidence(doc.text, unit.start + foreign.index, unit.start + foreign.index + foreign[0].length);
      }
    }
    if (!contactEvidence) {
      const contact = unit.text.match(CONTACT_INTENT_RE);
      if (contact && contact.index !== undefined) {
        contactEvidence = makeEvidence(doc.text, unit.start + contact.index, unit.start + contact.index + contact[0].length);
      }
    }
    if (!flexibleEvidence) {
      const flexible = unit.text.match(FLEXIBLE_INTENT_RE);
      if (flexible && flexible.index !== undefined) {
        flexibleEvidence = makeEvidence(doc.text, unit.start + flexible.index, unit.start + flexible.index + flexible[0].length);
      }
    }

    const payContext = unit.label === "pay" || unit.section === "compensation";
    const atoms = scanAtoms(unit);
    if (atoms.length === 0) return;

    // Pair adjacent atoms into ranges when separated only by a range separator.
    const consumed = new Array(atoms.length).fill(false);
    for (let i = 0; i < atoms.length; i += 1) {
      if (consumed[i]) continue;
      let range: { min: MoneyAtom; max: MoneyAtom } | null = null;
      if (i + 1 < atoms.length) {
        const between = doc.text.slice(atoms[i].end, atoms[i + 1].start);
        if (between.length <= 6 && RANGE_SEP_RE.test(between)) {
          range = { min: atoms[i], max: atoms[i + 1] };
          consumed[i + 1] = true;
        }
      }
      consumed[i] = true;

      const first = range ? range.min : atoms[i];
      const last = range ? range.max : atoms[i];

      // Distribute the max atom's scale across an unscaled min ("20-30k", "3–3.6 LPA").
      let minAmount = first.amount;
      let maxAmount = last.amount;
      let annual = first.annual || last.annual;
      if (range && last.scaled && !first.scaled && first.amount < 1_000) {
        const scale = last.annual ? 100_000 : last.amount >= 100_000 ? 100_000 : 1_000;
        minAmount = first.amount * scale;
        if (last.annual) annual = true;
      }
      if (minAmount > maxAmount) [minAmount, maxAmount] = [maxAmount, minAmount];

      // Billing-period words near the money mention (same unit).
      const contextStart = Math.max(0, first.start - unit.start - 16);
      const contextEnd = Math.min(unit.text.length, last.end - unit.start + 40);
      const context = unit.text.slice(contextStart, contextEnd);
      const words = unitWords(context.length >= 12 ? context : unit.text);
      if (words.annual) annual = true;

      const salaryContext = SALARY_CONTEXT_RE.test(unit.text);
      const hasMoneySignal = first.hasCurrency || last.hasCurrency || first.scaled || last.scaled || annual || payContext || salaryContext;
      if (!hasMoneySignal && !words.unit) continue;
      if (!annual && (maxAmount < MIN_AMOUNT || maxAmount > MAX_AMOUNT || minAmount < MIN_AMOUNT)) continue;

      let billing: "per project" | "per month" = "per project";
      let explicitUnit = false;
      let assumedUnit = false;
      if (words.unit) {
        billing = words.unit;
        explicitUnit = true;
      } else if (salaryContext && !annual) {
        billing = "per month";
        explicitUnit = true;
      } else {
        assumedUnit = true;
      }

      candidates.push({
        min: minAmount,
        max: maxAmount,
        unit: billing,
        explicitUnit: explicitUnit || annual,
        coercedFrom: words.coercedFrom,
        annual,
        singleAmount: !range,
        assumedUnit,
        priority: unit.label === "pay" ? 0 : unit.section === "compensation" ? 1 : 2,
        start: first.start,
        end: last.end,
        unitIdx,
      });
    }
  });

  candidates.sort((a, b) => a.priority - b.priority || a.start - b.start);

  const build = (candidate: Candidate): { extraction: FieldExtraction<ImportBudgetValue>; explicitUnit: boolean } => {
    const evidence = makeEvidence(doc.text, candidate.start, candidate.end);
    claims.add(candidate.start, candidate.end);
    const unit = doc.units[candidate.unitIdx];
    if (unit.label === "pay") claims.add(unit.start, unit.end);

    if (candidate.annual) {
      const monthlyMin = formatInr(candidate.min / 12);
      const monthlyMax = formatInr(candidate.max / 12);
      const hint =
        candidate.min === candidate.max
          ? `≈ ${monthlyMin} if treated as monthly`
          : `≈ ${monthlyMin}–${monthlyMax} if treated as monthly`;
      warnings.push({
        code: "annual-compensation",
        message: "The post lists annual compensation — enter the per-month or per-project amount yourself.",
        evidence,
      });
      return {
        extraction: {
          status: "review",
          value: { min: "", max: "", unit: "per month", intent: "" },
          evidence: [evidence],
          note: `The post lists annual compensation ("${evidence.snippet}"). CreatorJobs budgets are per project or per month — enter the amount yourself (${hint}).`,
        },
        explicitUnit: true,
      };
    }

    const min = String(Math.round(candidate.min));
    const max = String(Math.round(candidate.max));
    let status: FieldExtraction<ImportBudgetValue>["status"] = "imported";
    let note: string | undefined;

    if (candidate.coercedFrom) {
      status = "review";
      note = `The post says per ${candidate.coercedFrom}; CreatorJobs budgets are per project or per month — we kept the amount under per project.`;
      warnings.push({
        code: "per-unit-coerced",
        message: `Compensation was stated per ${candidate.coercedFrom} and was carried over as a per-project amount.`,
        evidence,
      });
    }
    if (candidate.singleAmount) {
      status = "review";
      const single = `We used ₹${Number(min).toLocaleString("en-US")} as both minimum and maximum — set a range if you have one.`;
      note = note ? `${note} ${single}` : single;
      warnings.push({ code: "single-amount-as-range", message: single, evidence });
    }
    if (candidate.assumedUnit) {
      status = "review";
      const assumed = "The post didn't say per project or per month — confirm the billing period.";
      note = note ? `${note} ${assumed}` : assumed;
    }

    return {
      extraction: {
        status,
        value: { min, max, unit: candidate.unit, intent: "range" },
        evidence: [evidence],
        note,
      },
      explicitUnit: candidate.explicitUnit,
    };
  };

  if (candidates.length > 0) {
    const primary = candidates[0];
    const { extraction, explicitUnit } = build(primary);

    // Distinct money mentions in other units → conflict with alternatives.
    const others = candidates.filter(
      (c) => c.unitIdx !== primary.unitIdx && (c.min !== primary.min || c.max !== primary.max)
    );
    if (others.length > 0 && extraction.value) {
      extraction.status = "conflict";
      extraction.alternatives = others.slice(0, 3).map((c) => ({
        value: {
          min: c.annual ? "" : String(Math.round(c.min)),
          max: c.annual ? "" : String(Math.round(c.max)),
          unit: c.unit,
          intent: c.annual ? ("" as const) : ("range" as const),
        },
        evidence: makeEvidence(doc.text, c.start, c.end),
      }));
      extraction.note = `${extraction.note ? `${extraction.note} ` : ""}The post mentions more than one amount — confirm which one is the budget.`;
      warnings.push({
        code: "multiple-budgets",
        message: "More than one compensation amount was found; the first labeled one was used.",
        evidence: extraction.evidence[0],
      });
    }
    return { budget: extraction, explicitUnit };
  }

  if (foreignEvidence) {
    warnings.push({
      code: "non-inr-currency",
      message: "Compensation is stated in a non-INR currency — enter the INR budget yourself.",
      evidence: foreignEvidence,
    });
    return {
      budget: {
        status: "unsupported",
        value: null,
        evidence: [foreignEvidence],
        note: "The post lists a non-INR amount. CreatorJobs budgets are in ₹ — enter the INR budget yourself.",
      },
      explicitUnit: false,
    };
  }

  if (contactEvidence) {
    const contact: ImportEvidence = contactEvidence;
    return {
      budget: {
        status: "imported",
        value: { min: "", max: "", unit: "per project", intent: "contact" },
        evidence: [contact],
        note: "The post asks applicants to share rates, so the budget is set to Contact for pricing.",
      },
      explicitUnit: false,
    };
  }

  if (flexibleEvidence) {
    const flexible: ImportEvidence = flexibleEvidence;
    return {
      budget: {
        status: "imported",
        value: { min: "", max: "", unit: "per project", intent: "flexible" },
        evidence: [flexible],
        note: "The post describes the budget as flexible.",
      },
      explicitUnit: false,
    };
  }

  return {
    budget: { status: "missing", value: null, evidence: [] },
    explicitUnit: false,
  };
}
