import { notFound } from "next/navigation";

import DevEmailInboxClient from "../../../components/dev/DevEmailInboxClient";
import { isDevEmailInboxAllowed } from "../../../lib/devEmailInbox";

export const dynamic = "force-dynamic";

export default function DevEmailsPage() {
  if (!isDevEmailInboxAllowed()) {
    notFound();
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto w-full max-w-4xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-subtle">Development only</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Development email inbox
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
            Use this local inbox to open email verification and password reset links without searching
            backend logs. This page is unavailable in production.
          </p>
          <DevEmailInboxClient />
        </div>
      </section>
    </main>
  );
}
