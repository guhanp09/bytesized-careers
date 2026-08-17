import { noindexPage } from "../../lib/seo/noindex";

/**
 * Exists only to carry the indexing directive.
 *
 * The pages below are client components, and a client component cannot export
 * `metadata` — so the noindex lives on a layout instead. Same instruction, moved
 * one file up because of a framework rule rather than a design choice.
 */
export const metadata = noindexPage("Post a job");

export default function PostJobLayout({ children }: { children: React.ReactNode }) {
  return children;
}
