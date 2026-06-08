"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Icon } from "./Icons";

export default function Sidebar() {
  const pathname = usePathname();
  const { status } = useSession();
  const isAuthed = status === "authenticated";

  const navClass = (active: boolean) =>
    [
      "w-16 flex flex-col items-center gap-1 rounded-lg px-1 py-1 text-[12px] leading-tight text-center transition-colors cursor-pointer",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
      active ? "text-white" : "text-white/72 hover:text-white",
    ].join(" ");

  const items: Array<{ href: string; label: string; icon: Parameters<typeof Icon>[0]["name"]; auth?: boolean }> = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/jobs", label: "Jobs", icon: "briefcase" },
    { href: "/talent", label: "Talent", icon: "users" },
    { href: "/activity", label: "Activity", icon: "send", auth: true },
    { href: "/saved", label: "Saved", icon: "bookmark", auth: true },
    { href: "/you", label: "You", icon: "user" },
  ];

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-20 flex-col items-center gap-6 bg-[#0b0b0f] pt-16">
      {items
        .filter((item) => !item.auth || isAuthed)
        .map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={navClass(active)}>
              <Icon name={item.icon} className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}

      <div className="flex-1" />
    </aside>
  );
}
