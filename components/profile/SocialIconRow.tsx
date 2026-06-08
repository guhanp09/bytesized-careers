"use client";

import { Icon } from "../Icons";
import type { SocialIconLink } from "../../lib/profileSocialLinks";

export default function SocialIconRow({ links }: { links: SocialIconLink[] }) {
  if (!links.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1" aria-label="Social links">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.label}
          title={link.label}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/12 bg-white/[0.035] text-white/58 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-white/86 focus:outline-none focus:ring-2 focus:ring-white/20"
        >
          <Icon name={link.icon} className="h-3.5 w-3.5" />
        </a>
      ))}
    </div>
  );
}
