"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProfileHeaderCardProps = {
  userName?: string | null;
  userImage?: string | null;
};

type IdentityStatus = {
  connected: boolean;
  imageUrl?: string | null;
};

const getInitials = (name?: string | null) => {
  const source = (name || "").trim();
  if (!source) return "YP";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
};

export default function ProfileHeaderCard({
  userName,
  userImage,
}: ProfileHeaderCardProps) {
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>({
    connected: false,
    imageUrl: null,
  });

  useEffect(() => {
    let mounted = true;

    const loadIdentityStatus = async () => {
      try {
        const res = await fetch("/api/identity/status?platform=youtube", {
          method: "GET",
          cache: "no-store",
        });
        if (!mounted || !res.ok) return;

        const data = (await res.json()) as {
          verified?: boolean;
          identity?: { imageUrl?: string | null };
        };

        setIdentityStatus({
          connected: Boolean(data?.verified),
          imageUrl: data?.identity?.imageUrl || null,
        });
      } catch {
        if (!mounted) return;
        setIdentityStatus({ connected: false, imageUrl: null });
      }
    };

    loadIdentityStatus();

    return () => {
      mounted = false;
    };
  }, []);

  const displayName = userName || "Your profile";
  const avatarUrl = identityStatus.imageUrl || userImage || null;
  const avatarFallback = useMemo(() => getInitials(displayName), [displayName]);
  const connectionText = identityStatus.connected ? "Connected" : "Not connected";
  const connectionColor = identityStatus.connected ? "text-emerald-300/95" : "text-white/55";

  return (
    <section
      className={[
        "rounded-3xl border border-white/10 bg-white/[0.06] p-5 sm:p-6",
        "shadow-[0_18px_55px_-32px_rgba(0,0,0,0.95)]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex items-start gap-4">
          <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm sm:text-base font-semibold tracking-wide text-white/85">
                {avatarFallback}
              </span>
            )}
          </div>

          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white truncate">
              {displayName}
            </h1>

            <p className="mt-1 text-sm text-white/65">
              YouTube channel <span className="text-subtle">•</span>{" "}
              <span className={connectionColor}>{connectionText}</span>
            </p>

            <p className="mt-3 text-sm text-white/70 leading-relaxed max-w-2xl">
              Add a headline, tools, location, and availability to make this profile easier to scan.
            </p>
          </div>
        </div>

        <div className="w-full lg:w-auto lg:min-w-[230px] flex flex-col gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Profile visibility</div>
            <div className="mt-2 text-sm font-semibold text-white/80 leading-none">Public when core details are filled out</div>
            <p className="mt-2 text-xs leading-5 text-muted">
              Add a headline, tools, and work samples to make this profile easier to trust and scan.
            </p>
          </div>

          <Link
            href="/you"
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] text-sm font-semibold text-white/75 transition hover:bg-white/[0.08] hover:text-white"
          >
            Edit profile
          </Link>
        </div>
      </div>
    </section>
  );
}
