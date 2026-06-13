import Link from "next/link";

import rolesSeed from "../../seed/roles_batch_1.json";

type SeedRole = { name: string; popularity_score: number };

// Belt-and-suspenders: the beta-safety spec blocks copy matching
// /Proof|Enlist|USD|\$/i on core routes (the seed contains "Proofreader").
const BLOCKED_ROLE_PATTERN = /proof|enlist|usd|\$/i;

const marqueeRoles = (rolesSeed as SeedRole[])
  .filter((role) => role.name && !BLOCKED_ROLE_PATTERN.test(role.name))
  .sort((a, b) => b.popularity_score - a.popularity_score)
  .slice(0, 28)
  .map((role) => role.name);

function MarqueeList({ hidden }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden ? "true" : undefined} className="flex items-center">
      {marqueeRoles.map((name) => (
        <li key={name} className="mx-3 flex items-center whitespace-nowrap">
          <Link
            href={`/jobs?q=${encodeURIComponent(name)}`}
            tabIndex={hidden ? -1 : undefined}
            className="cursor-pointer text-sm font-medium text-white/45 transition-colors hover:text-white"
          >
            {name}
          </Link>
          <span aria-hidden="true" className="ml-6 text-white/20">
            ·
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HomeRolesMarquee() {
  if (marqueeRoles.length === 0) return null;

  return (
    <section aria-label="Popular roles" className="home-rise home-rise-delay-roles">
      <div className="roles-marquee flex h-10 items-center">
        <div className="roles-marquee-track">
          <MarqueeList />
          <MarqueeList hidden />
        </div>
      </div>
    </section>
  );
}
