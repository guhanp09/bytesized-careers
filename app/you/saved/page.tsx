import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Saved");

import { redirect } from "next/navigation";

export default function YouSavedRedirect() {
  redirect("/saved");
}

