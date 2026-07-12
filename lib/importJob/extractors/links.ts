// Links + application-signal extraction (plan D7, §6.4.10–11).
//
// Contact lines and external application routing (emails, phones, non-YouTube
// URLs, handles, "DM me" phrases) are NEVER prefilled into public fields. They
// surface as review evidence and their intent maps to native first-message
// requirement suggestions. YouTube URLs become reference videos.

import { normalizeReferenceVideo } from "../../referenceVideos.ts";
import type { ReferenceVideo } from "../../types.ts";
import type { SectionedDoc } from "../sections.ts";
import type { ClaimSet } from "../textMatch.ts";
import { makeEvidence } from "../textMatch.ts";
import type {
  ApplicationSignals,
  FieldExtraction,
  ImportEvidence,
  ImportSuggestedRequirement,
  ImportWarning,
} from "../types.ts";

export type LinksExtractionResult = {
  refVideos: FieldExtraction<ReferenceVideo[]>;
  applicationSignals: ApplicationSignals;
};

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')]{4,300}/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,10}/g;
const PHONE_RE = /(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g;
const DM_RE = /\b(?:dm|dms)\b[^\n.]{0,40}|direct message[^\n.]{0,30}|whats\s?app[^\n.]{0,30}|wa\.me\/[^\s]{0,30}|link in bio|google form|fill (?:out )?(?:the |this )?form|telegram[^\n.]{0,20}/gi;
const HANDLE_RE = /@[A-Za-z0-9_.]{3,30}/g;
const YOUTUBE_RE = /youtube\.com|youtu\.be/i;

const PORTFOLIO_INTENT_RE = /portfolio|show\s?reel|showreel|work samples?|past work|best work|sample work/i;
const RATE_INTENT_RE = /\brates?\b|quotation|expected (?:salary|pay|rate|ctc)|\bquote\b/i;
const AVAILABILITY_INTENT_RE = /availability|when (?:you|u) can (?:start|join)|notice period|available to start|joining date|how soon/i;

const MAX_REF_VIDEOS = 3;
const MAX_CONTACT_LINES = 8;

export function extractLinks(doc: SectionedDoc, warnings: ImportWarning[], claims: ClaimSet): LinksExtractionResult {
  const refVideos: ReferenceVideo[] = [];
  const refEvidence: ImportEvidence[] = [];
  let droppedVideos = 0;
  const contactLines: ImportEvidence[] = [];
  const suggested = new Set<ImportSuggestedRequirement>();

  const addContact = (evidence: ImportEvidence) => {
    if (contactLines.length >= MAX_CONTACT_LINES) return;
    if (contactLines.some((c) => c.start === evidence.start && c.end === evidence.end)) return;
    contactLines.push(evidence);
  };

  for (const unit of doc.units) {
    if (unit.kind === "blank" || unit.kind === "heading") continue;
    const text = unit.text;

    const emailRanges: Array<[number, number]> = [];

    // ---- URLs ----
    for (const match of text.matchAll(URL_RE)) {
      const idx = match.index ?? 0;
      const start = unit.start + idx;
      const end = start + match[0].length;
      if (YOUTUBE_RE.test(match[0])) {
        const video = normalizeReferenceVideo(match[0].startsWith("www.") ? `https://${match[0]}` : match[0]);
        if (video) {
          if (refVideos.length < MAX_REF_VIDEOS) {
            refVideos.push(video);
            refEvidence.push(makeEvidence(doc.text, start, end));
          } else {
            droppedVideos += 1;
          }
        }
        claims.add(start, end);
      } else {
        addContact(makeEvidence(doc.text, start, end));
        claims.add(start, end);
      }
    }

    // ---- Emails / phones ----
    for (const match of text.matchAll(EMAIL_RE)) {
      const idx = match.index ?? 0;
      emailRanges.push([idx, idx + match[0].length]);
      addContact(makeEvidence(doc.text, unit.start + idx, unit.start + idx + match[0].length));
      claims.add(unit.start + idx, unit.start + idx + match[0].length);
    }
    for (const match of text.matchAll(PHONE_RE)) {
      const idx = match.index ?? 0;
      addContact(makeEvidence(doc.text, unit.start + idx, unit.start + idx + match[0].length));
      claims.add(unit.start + idx, unit.start + idx + match[0].length);
    }

    // ---- "DM us" style routing ----
    for (const match of text.matchAll(DM_RE)) {
      const idx = match.index ?? 0;
      addContact(makeEvidence(doc.text, unit.start + idx, unit.start + idx + match[0].length));
    }

    // ---- Social handles (apply context only; skip emails' @) ----
    if (unit.section === "apply" || unit.kind === "contact") {
      for (const match of text.matchAll(HANDLE_RE)) {
        const idx = match.index ?? 0;
        const insideEmail = emailRanges.some(([s, e]) => idx >= s - 64 && idx < e);
        if (insideEmail) continue;
        addContact(makeEvidence(doc.text, unit.start + idx, unit.start + idx + match[0].length));
      }
    }

    // Contact-kind units are fully claimed so no fragment leaks into prose.
    if (unit.kind === "contact" || unit.kind === "url") claims.add(unit.start, unit.end);

    // ---- Native requirement intent ----
    const applyish = unit.section === "apply" || unit.kind === "contact" || /apply|\bdm\b|share|send|email/i.test(text);
    if (applyish) {
      if (PORTFOLIO_INTENT_RE.test(text)) suggested.add("relevant_portfolio");
      if (RATE_INTENT_RE.test(text)) suggested.add("expected_rate");
      if (AVAILABILITY_INTENT_RE.test(text)) suggested.add("start_availability");
    }
  }

  if (contactLines.length > 0) {
    warnings.push({
      code: "external-application-routing",
      message: "This post routes applicants off-platform — on CreatorJobs, applications arrive in your Inbox.",
      evidence: contactLines[0],
    });
  }

  const refExtraction: FieldExtraction<ReferenceVideo[]> =
    refVideos.length > 0
      ? {
          status: "imported",
          value: refVideos,
          evidence: refEvidence,
          note: droppedVideos > 0 ? `Jobs can include up to 3 reference videos — ${droppedVideos} more link(s) were left out.` : undefined,
        }
      : { status: "missing", value: null, evidence: [] };

  return {
    refVideos: refExtraction,
    applicationSignals: {
      contactLines,
      suggestedRequirements: [...suggested],
    },
  };
}
