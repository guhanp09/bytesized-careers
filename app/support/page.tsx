import { Icon } from "../../components/Icons";
import { PageHeader, StateCard } from "../../components/ui";

export const metadata = {
  title: "Support | CreatorJobs",
  description: "Get help with CreatorJobs beta accounts, listings, reports, and marketplace workflows.",
  alternates: { canonical: "/support" },
};

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@creatorjobs.in";

const topics = [
  "Account access, verification, or password reset issues",
  "Unsafe, misleading, or abusive listings",
  "Problems applying to jobs or contacting talent",
  "Questions about free beta posting",
];

export default function SupportPage() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Support"
          description="For beta, support is handled directly so marketplace issues can be reviewed carefully."
        />

        <StateCard
          icon="send"
          title="Contact CreatorJobs"
          description="Include your account email, the listing or profile URL, and a short description of the issue."
          actionLabel={supportEmail}
          actionHref={`mailto:${supportEmail}`}
        />

        <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white/92">
            <span aria-hidden="true" className="inline-flex shrink-0 text-muted">
              <Icon name="help" className="h-4 w-4" />
            </span>
            <span>What support can help with</span>
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-white/58">
            {topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white/92">
            <span aria-hidden="true" className="inline-flex shrink-0 text-muted">
              <Icon name="shield" className="h-4 w-4" />
            </span>
            <span>Safety reports</span>
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/58">
            Use Report listing on job and talent listing pages when possible. For urgent beta issues, email support with the listing URL and the reason it should be reviewed.
          </p>
        </section>
      </section>
    </main>
  );
}
