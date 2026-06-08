import Link from "next/link";
import { Icon } from "../Icons";

export function PostMenu({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/post"
      aria-label="Post to CreatorJobs"
      className={[
        "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[0_10px_30px_-25px_rgba(0,0,0,0.9)] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        compact ? "px-3" : "px-3.5",
      ].join(" ")}
    >
      <Icon name="globe" className="h-[17px] w-[17px]" />
      <span>POST</span>
    </Link>
  );
}
