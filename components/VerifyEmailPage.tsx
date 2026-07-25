"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resendVerification, verifyEmailToken } from "../lib/backendClient";
import { shouldShowDevEmailInboxLink } from "../lib/devEmailInbox";

type VerifyState = "idle" | "verifying" | "success" | "error";

function getVerificationNotice() {
  return process.env.NODE_ENV === "development"
    ? "Verification link created. Open the local development email inbox."
    : "Verification link sent. Check your email.";
}

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [state, setState] = useState<VerifyState>(token ? "idle" : "error");
  const [message, setMessage] = useState<string>(
    token ? "" : "Missing verification token."
  );
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const showDevEmailInboxLink = shouldShowDevEmailInboxLink();

  const canResendVerification = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleResendVerification = async () => {
    if (!canResendVerification) {
      setResendNotice("Enter a valid email to resend verification.");
      return;
    }

    setResendBusy(true);
    setResendNotice(null);
    try {
      await resendVerification(email.trim());
      setResendNotice(getVerificationNotice());
    } catch (err) {
      setResendNotice(err instanceof Error ? err.message : "Could not resend verification link.");
    } finally {
      setResendBusy(false);
    }
  };

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;
    const run = async () => {
      setState("verifying");
      setMessage("Verifying your email...");
      try {
        await verifyEmailToken(token);
        if (!active) return;
        setState("success");
        setMessage("Email verified successfully. You can now log in.");
      } catch (err) {
        if (!active) return;
        setState("error");
        setMessage(err instanceof Error ? err.message : "Verification failed.");
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white px-4 sm:px-6 py-10">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
        <h1 className="text-xl font-semibold text-white">Verify Email</h1>
        <p className="mt-3 text-sm text-white/70">{message}</p>

        {state === "verifying" ? (
          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse bg-white/55" />
          </div>
        ) : null}

        {state === "error" ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-white/65">
              Token expired. Resend verification email.
            </p>
            <div className="mt-3 space-y-2">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="h-10 w-full rounded-lg border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
              />
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={!canResendVerification || resendBusy}
                className={[
                  "h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] text-sm font-semibold transition-colors",
                  !canResendVerification || resendBusy
                    ? "text-subtle cursor-not-allowed"
                    : "text-white/90 hover:bg-white/[0.08]",
                ].join(" ")}
              >
                {resendBusy ? "Resending..." : "Resend verification email"}
              </button>
            </div>
            {resendNotice ? (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-white/60">{resendNotice}</p>
                {showDevEmailInboxLink ? (
                  <Link
                    href="/dev/emails"
                    className="inline-flex text-xs font-semibold text-white/75 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  >
                    Local development: open dev email inbox
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          <Link
            href="/auth?mode=login"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 transition-colors"
          >
            Go to log in
          </Link>
        </div>
      </section>
    </main>
  );
}
