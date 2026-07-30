import Link from "next/link";

import type { BackendSearchIntent } from "../../lib/backendClient";


const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const intentLabels = (intent: BackendSearchIntent) =>
  unique([
    ...intent.role_labels,
    ...intent.tool_labels,
    ...intent.platforms.map((value) => value === "x-twitter" ? "X / Twitter" : value.replaceAll("-", " ")),
    ...intent.formats.map((value) => value.replaceAll("-", " ")),
    ...intent.genres.map((value) => value.replaceAll("-", " ")),
    ...intent.niches,
    ...intent.locations,
    ...intent.work_modes.map((value) => value.replaceAll("_", " ")),
    ...intent.engagement_types.map((value) => value.replaceAll("_", " ")),
    ...(intent.compensation
      ? [
          `${intent.compensation.operator === "under" ? "Up to " : intent.compensation.operator === "over" ? "From " : ""}${
            intent.compensation.currency === "INR" ? "₹" : intent.compensation.currency ? `${intent.compensation.currency} ` : ""
          }${new Intl.NumberFormat("en-IN").format(intent.compensation.amount)}${
            intent.compensation.unit ? ` ${intent.compensation.unit}` : ""
          }`,
        ]
      : []),
  ]).slice(0, 8);

export default function SearchSummary({
  domain,
  intent,
  total,
  noExactMatch,
}: {
  domain: "jobs" | "talent";
  intent: BackendSearchIntent;
  total: number;
  noExactMatch?: boolean;
}) {
  const labels = intentLabels(intent);
  const otherDomain = domain === "jobs" ? "talent" : "jobs";
  const currentHref = `/${domain}?q=${encodeURIComponent(intent.query)}`;
  const otherHref = `/${otherDomain}?q=${encodeURIComponent(intent.query)}`;

  return (
    <section
      aria-label="Search interpretation"
      className="mb-5 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-white/90">
            {noExactMatch ? "Closest relevant matches" : `${total} ${domain === "jobs" ? "job" : "talent"} match${total === 1 ? "" : "es"}`}
          </p>
          <p className="mt-1 break-words text-xs text-white/55">
            {noExactMatch
              ? "No result met every required signal, so these are ranked partial matches."
              : `Results for “${intent.query}”`}
          </p>
        </div>
        <div
          role="group"
          aria-label="Search results type"
          className="flex w-fit shrink-0 rounded-xl border border-white/10 bg-black/15 p-1"
        >
          <Link
            href={domain === "jobs" ? currentHref : otherHref}
            aria-current={domain === "jobs" ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
              domain === "jobs" ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            Jobs
          </Link>
          <Link
            href={domain === "talent" ? currentHref : otherHref}
            aria-current={domain === "talent" ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
              domain === "talent" ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            Talent
          </Link>
        </div>
      </div>

      {labels.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Recognized search criteria">
          {labels.map((label) => (
            <span
              key={label}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] capitalize text-white/65"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {intent.corrections.length ? (
        <p className="mt-3 text-[11px] text-white/45">
          Typo-tolerant matches: {intent.corrections.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
