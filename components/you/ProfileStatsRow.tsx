import { formatCompactNumber } from "../../lib/format";

type ProfileStatsRowProps = {
  jobsPostedCount: number;
};

type StatTileProps = {
  label: string;
  value: string;
  caption: string;
};

function StatTile({ label, value, caption }: StatTileProps) {
  return (
    <article
      className={[
        "rounded-2xl border border-white/10 bg-white/[0.05] p-4",
        "shadow-[0_12px_34px_-24px_rgba(0,0,0,0.9)]",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white/90 leading-none tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-xs text-white/50">{caption}</p>
    </article>
  );
}

export default function ProfileStatsRow({ jobsPostedCount }: ProfileStatsRowProps) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <StatTile
        label="Jobs posted"
        value={formatCompactNumber(jobsPostedCount)}
        caption="Marketplace jobs (MVP)"
      />
      <StatTile label="Applications sent" value="—" caption="Tracked in Inbox" />
      <StatTile label="Saved jobs" value="—" caption="Tracked in Saved" />
      <StatTile label="Active engagements" value="—" caption="Appears after live collaborations" />
    </section>
  );
}
