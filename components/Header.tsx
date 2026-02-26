"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Icon } from "./Icons";
import Sidebar from "./Sidebar";
import { getMyProfile } from "../lib/backendClient";

export default function Header() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [identityAvatar, setIdentityAvatar] = useState<string | null>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen && !bellOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedMenu = menuRef.current?.contains(target);
      const clickedBell = bellRef.current?.contains(target);
      if (!clickedMenu && !clickedBell) {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen, bellOpen]);

  const isAuthed = status === "authenticated";
  const showName = profileUsername || "CreatorJobs account";
  const showSub = profileDisplayName || session?.user?.name || "Profile";
  const avatarUrl = isAuthed ? profileAvatar || identityAvatar || session?.user?.image || null : null;

  useEffect(() => {
    let mounted = true;
    if (!isAuthed) return;
    const loadIdentity = async () => {
      try {
        const res = await fetch("/api/identity/status?platform=youtube");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setIdentityAvatar(data?.identity?.imageUrl || null);
      } catch {
        if (!mounted) return;
        setIdentityAvatar(null);
      }
    };
    loadIdentity();
    return () => {
      mounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    let mounted = true;
    const token = session?.backendAccessToken;
    if (!isAuthed || !token) return;

    void (async () => {
      try {
        const profile = await getMyProfile(token);
        if (!mounted) return;
        setProfileUsername(profile.username || null);
        setProfileDisplayName(profile.display_name || null);
        setProfileAvatar(profile.avatar_url || null);
      } catch {
        if (!mounted) return;
        setProfileUsername(null);
        setProfileDisplayName(null);
        setProfileAvatar(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isAuthed, session?.backendAccessToken]);

  return (
    <>
      <Sidebar />

      {/* Top header — full width; hamburger sits in the same rail column */}
      <header className="fixed top-0 left-0 right-0 z-[60] bg-[#0b0b0f]/92 backdrop-blur">
        <div className="h-14 flex items-center">
          {/* Rail column: NO horizontal padding (so it aligns with sidebar icons) */}
          <div className="w-20 flex items-center justify-center">
            <button className="p-1 rounded-md text-white/90" aria-label="Menu">
              <Icon name="menu" className="w-5 h-5" />
            </button>
          </div>

          {/* Rest of header: padding applies ONLY here */}
          <div className="flex-1 px-3 sm:px-4 flex items-center gap-3">
            <Link
              href="/"
              aria-label="CreatorJobs"
              className="inline-flex items-center gap-3 text-white rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
            >
              <Image
                src="/assets/brand/logo-mark-primary.svg"
                alt="CreatorJobs"
                width={32}
                height={32}
                className="hidden sm:block h-8 w-8 select-none"
                priority
              />
              <Image
                src="/assets/brand/logo-mark-micro.svg"
                alt="CreatorJobs"
                width={20}
                height={20}
                className="block sm:hidden h-5 w-5 select-none"
                priority
              />
              <span className="hidden sm:inline font-semibold tracking-tight leading-none">
                Creator<span className="text-white/60">Jobs</span>
              </span>
            </Link>

            <div className="flex-1 flex items-center justify-center">
              <div className="w-full max-w-2xl flex items-center gap-2">
                <div className="flex-1 flex items-center bg-white/6 border border-white/10 rounded-full overflow-hidden shadow-[0_10px_30px_-25px_rgba(0,0,0,0.9)]">
                  <input
                    className="w-full bg-transparent px-4 py-2.5 outline-none text-sm text-white placeholder:text-white/45"
                    placeholder="Search jobs"
                  />
                  <button
                    className="px-4 py-2.5 border-l border-white/10 hover:bg-white/10"
                    aria-label="Search"
                  >
                    <Icon name="search" className="w-5 h-5" />
                  </button>
                </div>

                <button
                  className="p-2.5 rounded-full bg-white/10 hover:bg-white/15 hidden sm:inline-flex"
                  aria-label="Voice"
                >
                  <Icon name="mic" className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/post-job"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 shadow-[0_10px_30px_-25px_rgba(0,0,0,0.9)]"
              >
                <Icon name="plus" className="w-4 h-4" />
                <span className="hidden sm:inline">Post</span>
              </Link>

              <div className="relative" ref={bellRef}>
                <button
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-white/10"
                  aria-label="Notifications"
                  aria-expanded={bellOpen}
                  aria-haspopup="menu"
                  onClick={() => setBellOpen((open) => !open)}
                >
                  <Icon name="bell-yt" className="w-[20px] h-[20px]" />
                </button>

                {bellOpen ? (
                  <div
                    role="menu"
                    className={[
                      "absolute right-0 mt-2 w-52 rounded-xl",
                      "bg-[#111216] border border-white/10",
                      "shadow-[0_20px_60px_-25px_rgba(0,0,0,0.95)]",
                      "p-3 text-xs text-white/70",
                    ].join(" ")}
                  >
                    Notifications coming soon
                  </div>
                ) : null}
              </div>

              <div className="relative" ref={menuRef}>
                <button
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-white/10"
                  aria-label="Profile"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setMenuOpen((open) => !open);
                  }}
                >
                  {isAuthed && avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={showName}
                      className="h-8 w-8 rounded-full object-cover border border-white/20"
                    />
                  ) : (
                    <Icon name="user" className="w-5 h-5" />
                  )}
                </button>

                {menuOpen ? (
                  <div
                    role="menu"
                    className={[
                      "absolute right-0 mt-2 w-64 rounded-xl",
                      "bg-[#111216] border border-white/10",
                      "shadow-[0_20px_60px_-25px_rgba(0,0,0,0.95)]",
                      "p-3",
                    ].join(" ")}
                  >
                    {isAuthed ? (
                      <>
                        <div className="flex items-center gap-3 px-2 py-2">
                          <div className="h-10 w-10 rounded-full border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={showName} className="h-full w-full object-cover" />
                            ) : (
                              <Icon name="user" className="w-5 h-5 text-white/70" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white/90 truncate">{showName}</div>
                            <div className="text-xs text-white/50 truncate">{showSub}</div>
                          </div>
                        </div>

                        <div className="my-3 border-t border-white/10" />

                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm text-white/85 hover:bg-white/10"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/you");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="user" className="w-4 h-4" />
                            Account
                          </span>
                          <span className="text-white/45">›</span>
                        </button>

                        <button
                          type="button"
                          className={[
                            "w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm",
                            profileUsername
                              ? "text-white/85 hover:bg-white/10"
                              : "text-white/45 cursor-not-allowed",
                          ].join(" ")}
                          onClick={() => {
                            if (!profileUsername) return;
                            setMenuOpen(false);
                            router.push(`/u/${encodeURIComponent(profileUsername)}`);
                          }}
                          disabled={!profileUsername}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="globe" className="w-4 h-4" />
                            Public profile
                          </span>
                          <span className="text-white/45">›</span>
                        </button>

                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-white/85 hover:bg-white/10"
                          onClick={() => signOut({ callbackUrl: "/" })}
                        >
                          <Icon name="log-out" className="w-4 h-4" />
                          Logout
                        </button>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm text-white/85 hover:bg-white/10"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/auth?mode=login");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="user" className="w-4 h-4" />
                            Log in
                          </span>
                          <span className="text-white/45">›</span>
                        </button>

                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-2 py-2 rounded-lg text-sm text-white/85 hover:bg-white/10"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/auth?mode=signup");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="plus" className="w-4 h-4" />
                            Sign up
                          </span>
                          <span className="text-white/45">›</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
