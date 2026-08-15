"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Icon } from "../components/Icons";
import { isEmailAuthEnabled } from "../lib/authVisibility";
import { registerWithEmail, resendVerification } from "../lib/backendClient";
import { shouldShowDevEmailInboxLink } from "../lib/devEmailInbox";
import { GOOGLE_ACCOUNT_SELECTION_PARAMS } from "../lib/googleOAuthPolicy";
import { safeInternalPath } from "../lib/safeRedirect";

type AuthMode = "login" | "signup";

const parseMode = (value: string | null): AuthMode => (value === "signup" ? "signup" : "login");
const USERNAME_RE = /^[a-z0-9][a-z0-9_]{2,19}$/;

const getAuthErrorMessage = (value: string | null) => {
  switch (value) {
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
      return "Google sign-in failed during the callback. Check Google OAuth credentials and redirect URIs.";
    case "AccessDenied":
      return "Google sign-in was cancelled or access was denied.";
    case "Callback":
      return "The login callback was rejected. Try again.";
    case "Configuration":
      return "Google auth is not configured correctly. Check NEXTAUTH_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET.";
    case "Default":
      return "Login failed. Try again.";
    default:
      return null;
  }
};

function ModeButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: "log-in" | "user-plus";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-10 rounded-xl px-4 text-sm font-semibold border transition-colors inline-flex items-center justify-center gap-2 cursor-pointer",
        active
          ? "bg-white text-black border-white"
          : "bg-white/[0.04] border-white/10 text-white/75 hover:bg-white/[0.08] hover:text-white",
      ].join(" ")}
    >
      <Icon name={icon} className="h-4 w-4" />
      {label}
    </button>
  );
}

const toUsernameCandidate = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 20);

function getVerificationNotice(hasDirectLink = false) {
  if (!shouldShowDevEmailInboxLink()) {
    return "Verification link sent. Check your email.";
  }
  return hasDirectLink
    ? "Verification link created for local development."
    : "Verification link created. Open the local development inbox.";
}

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeFromQuery = useMemo(() => parseMode(searchParams.get("mode")), [searchParams]);
  // A sign-in page is where an open redirect is worth the most: the person has
  // just been asked to trust it. `next` is validated once, here, and every use
  // below reads the validated value.
  const nextAfterAuth = safeInternalPath(searchParams.get("next"), "/you");
  const authError = searchParams.get("error");
  const emailAuthEnabled = isEmailAuthEnabled({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_ENABLE_EMAIL_AUTH: process.env.NEXT_PUBLIC_ENABLE_EMAIL_AUTH,
  });

  const [mode, setMode] = useState<AuthMode>(modeFromQuery);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);

  useEffect(() => {
    setMode(modeFromQuery);
  }, [modeFromQuery]);

  useEffect(() => {
    const authErrorMessage = getAuthErrorMessage(authError);
    if (!authErrorMessage) return;
    setError(authErrorMessage);
    setNotice(null);
  }, [authError]);

  const normalizedEmail = email.trim();
  const normalizedUsername = username.trim().toLowerCase();
  const canResendVerification = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const showDevEmailInboxLink = shouldShowDevEmailInboxLink();

  const handleResendVerification = async () => {
    if (!canResendVerification) {
      setError("Enter a valid email to resend verification.");
      return;
    }

    setError(null);
    setNotice(null);
    setVerificationUrl(null);
    setResendBusy(true);
    try {
      await resendVerification(normalizedEmail);
      setNotice(getVerificationNotice());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend verification link.");
    } finally {
      setResendBusy(false);
    }
  };

  const switchMode = (nextMode: AuthMode, options?: { preserveNotice?: boolean }) => {
    setMode(nextMode);
    setError(null);
    setVerificationUrl(null);
    if (!options?.preserveNotice) {
      setNotice(null);
    }
    const query = new URLSearchParams(searchParams.toString());
    query.set("mode", nextMode);
    router.replace(`/auth?${query.toString()}`);
  };

  const loginWithCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setVerificationUrl(null);
    setBusy(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        email: normalizedEmail,
        password,
        callbackUrl: nextAfterAuth,
      });
      if (result?.ok) {
        router.push(safeInternalPath(result.url, nextAfterAuth));
        return;
      }
      setError("Login failed. Check your credentials and verify your email first.");
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const registerAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setVerificationUrl(null);
    if (!USERNAME_RE.test(normalizedUsername)) {
      setError(
        "Username must be 3-20 chars, use lowercase letters/numbers/underscore, and cannot start with underscore."
      );
      return;
    }
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
      const result = await registerWithEmail(normalizedEmail, password, normalizedUsername);
      const backendMessage = result.message || "";
      const isResentPath = backendMessage.toLowerCase().includes("isn't verified");
      const directVerificationUrl = result.verification_url || null;

      setNotice(
        isResentPath
          ? `Account exists but isn't verified. ${getVerificationNotice(Boolean(directVerificationUrl))}`
          : `Account created. ${getVerificationNotice(Boolean(directVerificationUrl))} You can log in after verifying.`
      );
      setVerificationUrl(directVerificationUrl);
      setConfirmPassword("");
      setPassword("");
      if (!isResentPath) {
        switchMode("login", { preserveNotice: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    setError(null);
    setNotice(null);
    setVerificationUrl(null);
    setBusy(true);
    try {
      await signIn(
        "google",
        {
          callbackUrl: nextAfterAuth,
        },
        GOOGLE_ACCOUNT_SELECTION_PARAMS
      );
    } catch {
      setError("Could not start Google sign-in. Check your Google OAuth setup and try again.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white px-4 sm:px-6 py-10">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
        <h1 className="text-xl font-semibold text-white">
          {emailAuthEnabled && mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-white/60">
          Login is separate from channel verification. You can connect YouTube later from Post Job.
        </p>

        {emailAuthEnabled ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <ModeButton
              active={mode === "login"}
              icon="log-in"
              label="Log in"
              onClick={() => switchMode("login")}
            />
            <ModeButton
              active={mode === "signup"}
              icon="user-plus"
              label="Sign up"
              onClick={() => switchMode("signup")}
            />
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-lg border border-emerald-200/25 bg-emerald-200/10 px-3 py-2 text-xs text-emerald-100">
            {notice}
            {verificationUrl ? (
              <Link
                href={verificationUrl}
                className="mt-2 inline-flex font-semibold text-emerald-50 underline underline-offset-4 hover:text-white"
              >
                Open verification link
              </Link>
            ) : null}
            {showDevEmailInboxLink ? (
              <Link
                href="/dev/emails"
                className="mt-2 block font-semibold text-emerald-50 underline underline-offset-4 hover:text-white"
              >
                Local development: open dev email inbox
              </Link>
            ) : null}
          </div>
        ) : null}

        {emailAuthEnabled && mode === "login" ? (
          <form className="mt-5 space-y-3" onSubmit={loginWithCredentials}>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
            />
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/auth/reset"
                className="cursor-pointer text-xs text-white/65 transition-colors hover:text-white"
              >
                Forgot password?
              </Link>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={!canResendVerification || busy || resendBusy}
                className={[
                  "text-xs transition-colors cursor-pointer",
                  !canResendVerification || busy || resendBusy
                    ? "text-subtle cursor-not-allowed"
                    : "text-white/65 hover:text-white",
                ].join(" ")}
              >
                {resendBusy ? "Resending..." : "Resend verification email"}
              </button>
            </div>
            <button
              type="submit"
              disabled={busy}
              className={[
                "h-11 w-full rounded-xl bg-white text-black text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer",
                busy ? "opacity-60 pointer-events-none" : "hover:bg-white/90",
              ].join(" ")}
            >
              <Icon name="log-in" className="h-4 w-4" />
              {busy ? "Logging in..." : "Log in"}
            </button>
          </form>
        ) : emailAuthEnabled ? (
          <form className="mt-5 space-y-3" onSubmit={registerAccount}>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(toUsernameCandidate(event.target.value))}
              placeholder="Username (lowercase, 3-20 chars)"
              autoComplete="username"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
            />
            <p className="px-1 text-[11px] text-muted">
              Use lowercase letters, numbers, and underscore only. Cannot start with underscore.
            </p>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password (min 8 chars)"
              autoComplete="new-password"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              required
              className="h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={!canResendVerification || busy || resendBusy}
                className={[
                  "text-xs transition-colors cursor-pointer",
                  !canResendVerification || busy || resendBusy
                    ? "text-subtle cursor-not-allowed"
                    : "text-white/65 hover:text-white",
                ].join(" ")}
              >
                {resendBusy ? "Resending..." : "Resend verification email"}
              </button>
            </div>
            <button
              type="submit"
              disabled={busy}
              className={[
                "h-11 w-full rounded-xl bg-white text-black text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer",
                busy ? "opacity-60 pointer-events-none" : "hover:bg-white/90",
              ].join(" ")}
            >
              <Icon name="user-plus" className="h-4 w-4" />
              {busy ? "Creating account..." : "Sign up"}
            </button>
          </form>
        ) : null}

        {emailAuthEnabled ? (
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-white/10" />
            <span>or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
        ) : null}

        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={busy}
          className={[
            emailAuthEnabled ? "" : "mt-5",
            "h-11 w-full rounded-xl border border-white/15 bg-white/[0.04] text-sm font-semibold text-white/90 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer",
            busy ? "opacity-60 pointer-events-none" : "hover:bg-white/[0.08]",
          ].join(" ")}
        >
          <Icon name="log-in" className="h-4 w-4" />
          {busy ? "Starting Google sign-in..." : "Continue with Google"}
        </button>

        <p className="mt-4 text-xs text-muted">
          By continuing, you agree to use CreatorJobs responsibly.
          <Link href="/" className="ml-1 text-white/70 hover:text-white">
            Back to jobs
          </Link>
        </p>
      </section>
    </main>
  );
}
