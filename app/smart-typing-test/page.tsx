import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Typing test");

import { notFound } from "next/navigation";

import SmartTypingTestClient from "./SmartTypingTestClient";

export default function SmartTypingTestPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <SmartTypingTestClient />;
}
