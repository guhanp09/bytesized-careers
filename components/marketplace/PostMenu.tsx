import Link from "next/link";
import { Icon } from "../Icons";

export function PostMenu({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/post"
      aria-label="Post to CreatorJobs"
      className={[
        "inline-flex h-10 cursor-pointer items-center gap-1 rounded-full bg-[var(--vt-post-bg,#ffffff)] text-xs font-bold uppercase tracking-[0.12em] text-[var(--vt-post-text,#000000)] shadow-[var(--vt-post-glow,0_10px_30px_-25px_rgba(0,0,0,0.9))] transition-colors hover:bg-[var(--vt-post-bg-hover,rgba(255,255,255,0.9))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-post-ring,rgba(255,255,255,0.3))] sm:gap-2",
        compact ? "px-2.5 sm:px-3" : "px-2.5 sm:px-3.5",
      ].join(" ")}
    >
      <Icon name="globe" className="h-[17px] w-[17px]" />
      <span className="hidden sm:inline">POST</span>
    </Link>
  );
}
