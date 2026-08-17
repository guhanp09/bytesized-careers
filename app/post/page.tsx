import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Post");

import Link from "next/link";
import { Icon } from "../../components/Icons";
import { isJobImportAllowed } from "../../lib/importJob/flag";

const options = [
  {
    title: "Post a job",
    description: "Hire editors, designers, writers, strategists, and operators for content creator teams.",
    href: "/post-job",
    icon: "briefcase" as const,
  },
  {
    title: "Create talent listing",
    description: "Show hiring teams what you do and that you are open to paid work.",
    href: "/post-talent",
    icon: "users" as const,
  },
];

export default function PostChooserPage() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-5xl pt-8 sm:pt-14 lg:pt-20">
        <h1 className="sr-only">Choose what to post</h1>

        <div className="grid w-full gap-5 md:grid-cols-2 lg:gap-6">
          {options.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              aria-label={option.title}
              className="group relative flex min-h-[220px] cursor-pointer flex-col rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:p-7"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.055] text-white/58 transition group-hover:bg-white/[0.075] group-hover:text-white">
                <Icon name={option.icon} className="h-5 w-5" />
              </div>
              <h2 className="mt-7 text-xl font-semibold tracking-tight text-white">{option.title}</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-white/55">{option.description}</p>
              <span
                aria-hidden="true"
                className="absolute right-6 top-6 translate-x-1 text-xl leading-none text-white/0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-white/58 group-focus-visible:translate-x-0 group-focus-visible:text-white/58"
              >
                →
              </span>
            </Link>
          ))}
        </div>

        {isJobImportAllowed() ? (
          <Link
            href="/post-job/import"
            data-testid="post-import-card"
            className="group relative mt-5 flex cursor-pointer items-center gap-4 rounded-[30px] border border-white/[0.08] bg-white/[0.035] px-6 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 lg:mt-6"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.055] text-white/58 transition group-hover:bg-white/[0.075] group-hover:text-white">
              <Icon name="file" className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold tracking-tight text-white">
                Already wrote a hiring post?
              </span>
              <span className="mt-1 block text-sm leading-6 text-white/55">
                Paste it from LinkedIn, WhatsApp, or anywhere else — CreatorJobs will prepare the draft.
              </span>
            </span>
            <span
              aria-hidden="true"
              className="ml-auto translate-x-1 text-xl leading-none text-white/0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-white/58 group-focus-visible:translate-x-0 group-focus-visible:text-white/58"
            >
              →
            </span>
          </Link>
        ) : null}
      </section>
    </main>
  );
}
