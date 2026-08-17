/**
 * Which version of the legal documents is published, and where each one lives.
 *
 * An acceptance record stores a version. Until now nothing could turn that
 * version back into the wording it named: the pages held the text inline and
 * carried no version at all, so "they accepted 2026-06-01" pointed at nothing
 * retrievable. Editing a page silently changed what every prior acceptance
 * appeared to mean.
 *
 * The registry closes that without deciding anything about future wording. Each
 * published version is an immutable file; the current one is named here; adding
 * a version is adding a file. Whether superseded versions must remain *reachable
 * to a reader* — a public archive, a permalink — is still a product and counsel
 * question, and this deliberately does not answer it. What it guarantees is that
 * the bytes still exist to answer it with.
 *
 * The version must match the backend's `CURRENT_DOCUMENTS`. A test pins that:
 * a backend recording acceptances against a version the frontend cannot render
 * is the exact failure the backend module warns about.
 */

import * as v20260601 from "./versions/2026-06-01";

export type LegalSection = {
  readonly title: string;
  readonly icon: string;
  readonly body: string;
};

export type LegalVersion = {
  readonly version: string;
  readonly terms: readonly LegalSection[];
  readonly privacy: readonly LegalSection[];
};

/** Every version ever published, newest last. Entries are never removed. */
export const LEGAL_VERSIONS: readonly LegalVersion[] = [
  {
    version: v20260601.VERSION,
    terms: v20260601.TERMS_SECTIONS,
    privacy: v20260601.PRIVACY_SECTIONS,
  },
];

export const CURRENT_LEGAL_VERSION = LEGAL_VERSIONS[LEGAL_VERSIONS.length - 1];

export function legalVersion(version: string): LegalVersion | undefined {
  return LEGAL_VERSIONS.find((entry) => entry.version === version);
}
