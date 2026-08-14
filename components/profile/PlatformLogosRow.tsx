"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icons";

export type PlatformKey = "youtube" | "instagram";

export type ConnectedPlatformAccount = {
  id: string;
  handle?: string | null;
  displayName?: string | null;
  url?: string | null;
};

type PlatformDescriptor = {
  key: PlatformKey;
  label: string;
  icon: ReactNode;
};

const supportedPlatforms: PlatformDescriptor[] = [
  {
    key: "youtube",
    label: "YouTube",
    icon: <Icon name="youtube" className="h-3.5 w-3.5" />,
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: <Icon name="instagram" className="h-3.5 w-3.5" />,
  },
];

type PlatformLogosRowProps = {
  isOwnerView: boolean;
  connectedAccounts: Partial<Record<PlatformKey, ConnectedPlatformAccount[]>>;
  onConnectAccount?: (platformKey: PlatformKey) => void | Promise<void>;
  onRemoveAccount?: (
    platformKey: PlatformKey,
    account: ConnectedPlatformAccount
  ) => void | Promise<void>;
};

const ensureHandlePrefix = (handle?: string | null) => {
  const trimmed = (handle || "").trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
};

const getAccountName = (account: ConnectedPlatformAccount) => {
  const displayName = (account.displayName || "").trim();
  if (displayName) return displayName;
  const handle = ensureHandlePrefix(account.handle);
  if (handle) return handle;
  return "Connected account";
};

export default function PlatformLogosRow({
  isOwnerView,
  connectedAccounts,
  onConnectAccount,
  onRemoveAccount,
}: PlatformLogosRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [openPlatformKey, setOpenPlatformKey] = useState<PlatformKey | null>(null);
  const [removingAccountKey, setRemovingAccountKey] = useState<string | null>(null);

  const accountsByPlatform = useMemo<Record<PlatformKey, ConnectedPlatformAccount[]>>(
    () => ({
      youtube: connectedAccounts.youtube || [],
      instagram: connectedAccounts.instagram || [],
    }),
    [connectedAccounts.instagram, connectedAccounts.youtube]
  );

  const visiblePlatforms = useMemo(
    () =>
      isOwnerView
        ? supportedPlatforms
        : supportedPlatforms.filter((platform) => accountsByPlatform[platform.key].length > 0),
    [accountsByPlatform, isOwnerView]
  );

  useEffect(() => {
    if (!openPlatformKey) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rowRef.current) return;
      if (!rowRef.current.contains(event.target as Node)) {
        setOpenPlatformKey(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPlatformKey(null);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openPlatformKey]);

  if (!visiblePlatforms.length) return null;

  const handleRemove = async (
    platformKey: PlatformKey,
    platformLabel: string,
    account: ConnectedPlatformAccount
  ) => {
    if (!isOwnerView || !onRemoveAccount) return;
    const confirmMessage =
      platformKey === "youtube"
        ? "Disconnect YouTube from CreatorJobs? This removes every verified YouTube channel and revokes stored YouTube access. Google sign-in remains linked."
        : `Remove this ${platformLabel} account?`;
    if (!window.confirm(confirmMessage)) return;

    const accountKey = `${platformKey}:${account.id}`;
    setRemovingAccountKey(accountKey);
    try {
      await onRemoveAccount(platformKey, account);
    } finally {
      setRemovingAccountKey((current) => (current === accountKey ? null : current));
    }
  };

  return (
    <div ref={rowRef} className="flex flex-wrap items-center gap-2 pt-1">
      {visiblePlatforms.map((platform) => {
        const accounts = accountsByPlatform[platform.key];
        const hasAccounts = accounts.length > 0;
        const isOpen = openPlatformKey === platform.key;
        const openLinkLabel = platform.key === "youtube" ? "Open channel" : "Open profile";

        return (
          <div key={platform.key} className="relative">
            <button
              type="button"
              onClick={() => setOpenPlatformKey((current) => (current === platform.key ? null : platform.key))}
              className={[
                "h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                hasAccounts
                  ? "border-white/15 bg-white/[0.05] text-white/70 hover:bg-white/[0.1] hover:text-white/90"
                  : "border-white/10 bg-white/[0.03] text-muted hover:bg-white/[0.08] hover:text-white/75",
              ].join(" ")}
              aria-label={`${platform.label} accounts`}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
            >
              {platform.icon}
            </button>

            {isOpen ? (
              <div
                role="dialog"
                aria-label={`${platform.label} accounts`}
                className="absolute left-0 top-[calc(100%+8px)] z-30 w-72 rounded-2xl border border-white/15 bg-[#111216] p-3 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.95)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white/90">{platform.label}</p>
                  <button
                    type="button"
                    onClick={() => setOpenPlatformKey(null)}
                    className="h-6 w-6 rounded-md border border-white/10 bg-white/[0.03] text-white/65 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                    aria-label={`Close ${platform.label} popover`}
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </div>

                {accounts.length ? (
                  <ul className="mt-3 space-y-2">
                    {accounts.map((account) => {
                      const accountKey = `${platform.key}:${account.id}`;
                      const isRemoving = removingAccountKey === accountKey;
                      const handleLabel = ensureHandlePrefix(account.handle);

                      return (
                        <li
                          key={accountKey}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2"
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs text-white/85">{getAccountName(account)}</p>
                              {handleLabel ? (
                                <p className="truncate text-[11px] text-muted">{handleLabel}</p>
                              ) : null}
                            </div>
                            <div className="ml-auto inline-flex items-center gap-2">
                              {account.url ? (
                                <a
                                  href={account.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setOpenPlatformKey(null)}
                                  className="text-[11px] text-white/60 hover:text-white/90 transition-colors"
                                >
                                  {openLinkLabel}
                                </a>
                              ) : null}
                              {isOwnerView ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRemove(platform.key, platform.label, account)}
                                  disabled={isRemoving || !onRemoveAccount}
                                  className="text-[11px] text-muted hover:text-white/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isRemoving ? "Removing..." : "Remove"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-white/55">No accounts connected yet.</p>
                )}

                {isOwnerView ? (
                  <button
                    type="button"
                    onClick={() => void onConnectAccount?.(platform.key)}
                    disabled={!onConnectAccount}
                    className="mt-3 h-8 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-xs font-semibold text-white/85 hover:bg-white/[0.1] transition-colors inline-flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {accounts.length ? "Add account" : `Connect ${platform.label}`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
