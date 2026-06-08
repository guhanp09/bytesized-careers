"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Icon } from "../components/Icons";
import { confirmPasswordReset, requestPasswordReset } from "../lib/backendClient";
import { shouldShowDevEmailInboxLink } from "../lib/devEmailInbox";

export default function PasswordResetPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const showDevEmailInboxLink = shouldShowDevEmailInboxLink();

  const handleRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setDevResetUrl(null);
    setBusy(true);
    try {
      const response = await requestPasswordReset(email.trim());
      setNotice(response.message);
      setDevResetUrl(response.reset_url || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request a password reset link.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const response = await confirmPasswordReset(token, password);
      setNotice(response.message);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
        <h1 className="text-xl font-semibold text-white">
          {token ? "Reset your password" : "Password reset"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          {token
            ? "Choose a new password for your CreatorJobs account."
            : "Enter your account email. If it exists, we will send a reset link."}
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-lg border border-emerald-200/25 bg-emerald-200/10 px-3 py-2 text-xs text-emerald-100">
            {notice}
            {devResetUrl ? (
              <Link
                href={devResetUrl}
                className="mt-2 inline-flex font-semibold text-emerald-50 underline underline-offset-4 hover:text-white"
              >
                Open local reset link
              </Link>
            ) : null}
            {showDevEmailInboxLink && !token ? (
              <Link
                href="/dev/emails"
                className="mt-2 block font-semibold text-emerald-50 underline underline-offset-4 hover:text-white"
              >
                Local development: open dev email inbox
              </Link>
            ) : null}
          </div>
        ) : null}

        {token ? (
          <form className="mt-5 space-y-3" onSubmit={handleConfirm}>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25 focus:bg-white/7"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25 focus:bg-white/7"
            />
            <button
              type="submit"
              disabled={busy}
              className={[
                "inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-black transition-colors",
                busy ? "pointer-events-none opacity-60" : "hover:bg-white/90",
              ].join(" ")}
            >
              <Icon name="check" className="h-4 w-4" />
              {busy ? "Updating..." : "Update password"}
            </button>
          </form>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={handleRequest}>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25 focus:bg-white/7"
            />
            <button
              type="submit"
              disabled={busy}
              className={[
                "inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-black transition-colors",
                busy ? "pointer-events-none opacity-60" : "hover:bg-white/90",
              ].join(" ")}
            >
              <Icon name="send" className="h-4 w-4" />
              {busy ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <Link
          href="/auth?mode=login"
          className="mt-5 inline-flex cursor-pointer text-xs font-semibold text-white/60 transition-colors hover:text-white"
        >
          Back to login
        </Link>
      </section>
    </main>
  );
}
