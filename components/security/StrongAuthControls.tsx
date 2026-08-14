"use client";

import { signIn, signOut } from "next-auth/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  confirmStrongAuthEnrollment,
  describeStrongAuthError,
  disableStrongAuth,
  loadStrongAuthStatus,
  regenerateStrongAuthRecoveryCodes,
  startStrongAuthEnrollment,
  verifyStrongAuth,
  type StrongAuthEnrollment,
  type StrongAuthMethod,
  type StrongAuthStatus,
} from "../../lib/strongAuthClient";
import { copyTextToClipboard } from "../ui";
import {
  InlinePanel,
  RowActionButton,
  SettingRow,
} from "../settings/settingsPrimitives";

type Provider = string | undefined;
type RecoveryReason = "enrollment" | "regeneration";

const inputClassName =
  "h-11 w-full rounded-xl border border-white/12 bg-black/24 px-3 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/28";
const primaryButtonClassName =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-55";
const secondaryButtonClassName =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] px-4 text-sm font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-55";
const dangerButtonClassName =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-rose-300/22 bg-rose-400/[0.08] px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/[0.14] disabled:cursor-not-allowed disabled:opacity-55";

function useStrongAuthStatus() {
  const [status, setStatus] = useState<StrongAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    void loadStrongAuthStatus()
      .then(setStatus)
      .catch((reason) => setError(describeStrongAuthError(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let active = true;
    void loadStrongAuthStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((reason) => {
        if (active) setError(describeStrongAuthError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return { status, setStatus, loading, error, reload };
}

function SecurityCard({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <section
      data-testid={testId}
      className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(255,255,255,0.025))] p-5 shadow-2xl shadow-black/30 sm:p-7"
    >
      {children}
    </section>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-xl border border-amber-200/18 bg-amber-200/[0.075] px-3 py-2 text-sm leading-6 text-amber-50/90"
    >
      {message}
    </p>
  ) : null;
}

function TotpInput({
  value,
  onChange,
  label = "Authenticator code",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold text-white/58">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        className={`${inputClassName} font-mono tracking-[0.35em]`}
      />
    </label>
  );
}

function PasswordInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold text-white/58">Current password</span>
      <input
        type="password"
        autoComplete="current-password"
        maxLength={128}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
    </label>
  );
}

function GoogleReauthenticationButton({ busy }: { busy: boolean }) {
  const reauthenticate = async () => {
    const callbackUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    await signIn(
      "google",
      { callbackUrl },
      { prompt: "login", max_age: "0" }
    );
  };
  return (
    <button
      type="button"
      className={secondaryButtonClassName}
      disabled={busy}
      onClick={() => void reauthenticate()}
    >
      Reauthenticate with Google
    </button>
  );
}

function RecoveryCodesPanel({
  codes,
  onAcknowledged,
}: {
  codes: string[];
  onAcknowledged: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyCodes = async () => {
    try {
      await copyTextToClipboard(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div data-testid="strong-auth-recovery-codes" className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Save your recovery codes</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Each code works once. They will not be shown again after you leave this step.
        </p>
      </div>
      <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/28 p-4 sm:grid-cols-2">
        {codes.map((code) => (
          <code key={code} className="select-all font-mono text-xs tracking-wide text-white/86">
            {code}
          </code>
        ))}
      </div>
      <button type="button" className={secondaryButtonClassName} onClick={() => void copyCodes()}>
        {copied ? "Copied" : "Copy all codes"}
      </button>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3 text-sm leading-6 text-white/72">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-1 h-4 w-4 accent-white"
        />
        <span>I saved these codes somewhere secure.</span>
      </label>
      <button type="button" className={primaryButtonClassName} disabled={!saved} onClick={onAcknowledged}>
        Continue
      </button>
    </div>
  );
}

function StrongAuthFlow({
  status,
  provider,
  mode,
  onStatusChange,
  onAccessGranted,
}: {
  status: StrongAuthStatus;
  provider: Provider;
  mode: "gate" | "settings";
  onStatusChange: (status: StrongAuthStatus) => void;
  onAccessGranted?: () => void;
}) {
  const [enrollment, setEnrollment] = useState<StrongAuthEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryReason, setRecoveryReason] = useState<RecoveryReason>("enrollment");
  const [screen, setScreen] = useState<"default" | "regenerate" | "disable">("default");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [proofMethod, setProofMethod] = useState<StrongAuthMethod>("totp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleReady = provider === "google" && status.google_reauthentication_available;
  const primaryReady = provider === "credentials" ? password.length >= 8 : googleReady;
  const proofMethods: StrongAuthMethod[] = status.available_methods.includes("recovery_code")
    ? ["totp", "recovery_code"]
    : ["totp"];
  const setFailure = (reason: unknown) => {
    setError(describeStrongAuthError(reason));
    setBusy(false);
  };

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await startStrongAuthEnrollment(
        provider === "credentials" ? password : undefined
      );
      setEnrollment(next);
      setPassword("");
      setBusy(false);
    } catch (reason) {
      setFailure(reason);
    }
  };

  const confirmEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await confirmStrongAuthEnrollment(code);
      const nextStatus: StrongAuthStatus = {
        ...status,
        enrolled: true,
        enrollment_pending: false,
        enrollment_expires_at: null,
        recovery_codes_remaining: result.recovery_codes_remaining,
        strong_auth_satisfied: true,
        strong_auth_method: result.method,
        strong_auth_expires_at: result.expires_at,
        available_methods: ["totp", "recovery_code"],
      };
      if (mode === "settings") onStatusChange(nextStatus);
      setRecoveryReason("enrollment");
      setRecoveryCodes(result.recovery_codes);
      setEnrollment(null);
      setCode("");
      setBusy(false);
    } catch (reason) {
      setFailure(reason);
    }
  };

  const challenge = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyStrongAuth(proofMethod, code);
      onStatusChange({
        ...status,
        strong_auth_satisfied: true,
        strong_auth_method: result.method,
        strong_auth_expires_at: result.expires_at,
        recovery_codes_remaining: result.recovery_codes_remaining,
      });
      setCode("");
      setBusy(false);
      onAccessGranted?.();
    } catch (reason) {
      setFailure(reason);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await regenerateStrongAuthRecoveryCodes(code);
      onStatusChange({
        ...status,
        strong_auth_satisfied: true,
        strong_auth_method: "totp",
        strong_auth_expires_at: result.expires_at,
        recovery_codes_remaining: result.recovery_codes.length,
      });
      setRecoveryReason("regeneration");
      setRecoveryCodes(result.recovery_codes);
      setCode("");
      setBusy(false);
    } catch (reason) {
      setFailure(reason);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await disableStrongAuth(
        proofMethod,
        code,
        provider === "credentials" ? password : undefined
      );
      setPassword("");
      setCode("");
      await signOut({ callbackUrl: "/" });
    } catch (reason) {
      setFailure(reason);
    }
  };

  if (recoveryCodes) {
    return (
      <RecoveryCodesPanel
        codes={recoveryCodes}
        onAcknowledged={() => {
          setRecoveryCodes(null);
          if (recoveryReason === "enrollment" && mode === "gate") {
            onAccessGranted?.();
          } else {
            setScreen("default");
          }
        }}
      />
    );
  }

  if (!status.enrolled) {
    if (enrollment) {
      return (
        <div data-testid="strong-auth-enrollment-confirm" className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Add CreatorJobs to your authenticator</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Open the link on a supported device or enter the setup key manually, then confirm the current code.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Setup key</p>
            <code data-testid="strong-auth-setup-key" className="mt-2 block break-all font-mono text-sm tracking-wider text-white">
              {enrollment.secret}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => void copyTextToClipboard(enrollment.secret)}
              >
                Copy setup key
              </button>
              <a className={secondaryButtonClassName} href={enrollment.provisioning_uri}>
                Open authenticator app
              </a>
            </div>
          </div>
          <TotpInput value={code} onChange={setCode} />
          <FormError message={error} />
          <button
            type="button"
            className={primaryButtonClassName}
            disabled={busy || code.length !== 6}
            onClick={() => void confirmEnrollment()}
          >
            {busy ? "Confirming…" : "Confirm authenticator"}
          </button>
        </div>
      );
    }

    return (
      <div data-testid="strong-auth-enrollment" className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Secure administrator access</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Set up a time-based authenticator before opening CreatorJobs administration.
          </p>
        </div>
        {provider === "credentials" ? (
          <PasswordInput value={password} onChange={setPassword} />
        ) : provider === "google" && !googleReady ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted">
              Confirm your Google account again before creating the factor.
            </p>
            <GoogleReauthenticationButton busy={busy} />
          </div>
        ) : provider !== "google" ? (
          <p className="text-sm leading-6 text-amber-100/88">
            This sign-in method cannot enroll an administrator authenticator.
          </p>
        ) : null}
        <FormError message={error} />
        {provider === "credentials" || googleReady ? (
          <button
            type="button"
            className={primaryButtonClassName}
            disabled={busy || !primaryReady}
            onClick={() => void startEnrollment()}
          >
            {busy ? "Starting…" : "Start authenticator setup"}
          </button>
        ) : null}
      </div>
    );
  }

  if (!status.strong_auth_satisfied) {
    return (
      <div data-testid="strong-auth-challenge" className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Verify administrator access</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Enter a current authenticator code or one unused recovery code.
          </p>
        </div>
        <div
          className={`grid gap-2 ${proofMethods.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
          role="group"
          aria-label="Verification method"
        >
          {proofMethods.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={proofMethod === item}
              onClick={() => {
                setProofMethod(item);
                setCode("");
                setError(null);
              }}
              className={proofMethod === item ? primaryButtonClassName : secondaryButtonClassName}
            >
              {item === "totp" ? "Authenticator" : "Recovery code"}
            </button>
          ))}
        </div>
        {proofMethod === "totp" ? (
          <TotpInput value={code} onChange={setCode} />
        ) : (
          <label className="block space-y-2">
            <span className="text-xs font-semibold text-white/58">Recovery code</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className={`${inputClassName} font-mono tracking-wide`}
            />
          </label>
        )}
        <FormError message={error} />
        <button
          type="button"
          className={primaryButtonClassName}
          disabled={busy || (proofMethod === "totp" ? code.length !== 6 : code.length < 6)}
          onClick={() => void challenge()}
        >
          {busy ? "Verifying…" : "Verify and continue"}
        </button>
      </div>
    );
  }

  if (screen === "regenerate") {
    return (
      <div data-testid="strong-auth-regenerate" className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Replace recovery codes</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            A fresh authenticator code invalidates every existing recovery code.
          </p>
        </div>
        <TotpInput value={code} onChange={setCode} />
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClassName} disabled={busy} onClick={() => setScreen("default")}>
            Cancel
          </button>
          <button type="button" className={primaryButtonClassName} disabled={busy || code.length !== 6} onClick={() => void regenerate()}>
            {busy ? "Replacing…" : "Replace codes"}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "disable") {
    return (
      <div data-testid="strong-auth-disable" className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-rose-100">Disable administrator authenticator</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            This revokes every CreatorJobs session. You must prove both your primary sign-in and the existing factor.
          </p>
        </div>
        {provider === "credentials" ? (
          <PasswordInput value={password} onChange={setPassword} />
        ) : provider === "google" && !googleReady ? (
          <GoogleReauthenticationButton busy={busy} />
        ) : provider !== "google" ? (
          <p className="text-sm text-amber-100/88">This sign-in method cannot disable the factor.</p>
        ) : null}
        <div
          className={`grid gap-2 ${proofMethods.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
          role="group"
          aria-label="Disable verification method"
        >
          {proofMethods.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={proofMethod === item}
              className={proofMethod === item ? primaryButtonClassName : secondaryButtonClassName}
              onClick={() => {
                setProofMethod(item);
                setCode("");
              }}
            >
              {item === "totp" ? "Authenticator" : "Recovery code"}
            </button>
          ))}
        </div>
        {proofMethod === "totp" ? (
          <TotpInput value={code} onChange={setCode} />
        ) : (
          <label className="block space-y-2">
            <span className="text-xs font-semibold text-white/58">Recovery code</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className={`${inputClassName} font-mono`}
            />
          </label>
        )}
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClassName} disabled={busy} onClick={() => setScreen("default")}>
            Cancel
          </button>
          <button
            type="button"
            className={dangerButtonClassName}
            disabled={
              busy ||
              code.length < 6 ||
              (provider === "credentials" ? password.length < 8 : !googleReady)
            }
            onClick={() => void disable()}
          >
            {busy ? "Disabling…" : "Disable and sign out everywhere"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="strong-auth-management" className="space-y-4">
      <div className="rounded-xl border border-emerald-300/14 bg-emerald-300/[0.055] px-3 py-2 text-sm text-emerald-50/86">
        Authenticator enabled · {status.recovery_codes_remaining} recovery codes remaining
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButtonClassName} onClick={() => setScreen("regenerate")}>
          Replace recovery codes
        </button>
        <button type="button" className={dangerButtonClassName} onClick={() => setScreen("disable")}>
          Disable authenticator
        </button>
      </div>
    </div>
  );
}

export function AdminStrongAuthBoundary({
  provider,
  failClosed,
  children,
}: {
  provider: Provider;
  failClosed: boolean;
  children: ReactNode;
}) {
  const { status, setStatus, loading, error, reload } = useStrongAuthStatus();
  const [accessGranted, setAccessGranted] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-56px)] items-center px-4 py-10">
        <SecurityCard testId="admin-strong-auth-loading">
          <p className="text-sm font-semibold text-white/78">Checking administrator security…</p>
        </SecurityCard>
      </div>
    );
  }
  if (error || !status) {
    if (!failClosed) return <>{children}</>;
    return (
      <div className="flex min-h-[calc(100dvh-56px)] items-center px-4 py-10">
        <SecurityCard testId="admin-strong-auth-unavailable">
          <h1 className="text-xl font-semibold text-white">Administrator security is unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            CreatorJobs cannot verify this session’s second factor. No administrator tools were opened.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className={primaryButtonClassName} onClick={() => reload()}>
              Try again
            </button>
            <button type="button" className={secondaryButtonClassName} onClick={() => void signOut({ callbackUrl: "/" })}>
              Sign out
            </button>
          </div>
        </SecurityCard>
      </div>
    );
  }
  if (!status.required || status.strong_auth_satisfied || accessGranted) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-[calc(100dvh-56px)] items-center px-4 py-10">
      <SecurityCard testId="admin-strong-auth-gate">
        <StrongAuthFlow
          status={status}
          provider={provider}
          mode="gate"
          onStatusChange={setStatus}
          onAccessGranted={() => setAccessGranted(true)}
        />
      </SecurityCard>
    </div>
  );
}

export function AdminStrongAuthSettings({ provider }: { provider: Provider }) {
  const { status, setStatus, loading, error, reload } = useStrongAuthStatus();
  const [open, setOpen] = useState(false);
  const label = loading
    ? "Checking"
    : error || !status
      ? "Unavailable"
      : status.enrolled
        ? "Enabled"
        : "Not enabled";

  return (
    <SettingRow
      rowId="security-strong-auth"
      title="Administrator authenticator"
      description="A real second factor is required before administrator tools can open in production."
      status={label}
      statusTone={status?.enrolled ? "active" : "readonly"}
      action={
        error ? (
          <RowActionButton onClick={() => reload()}>Retry</RowActionButton>
        ) : !loading ? (
          <RowActionButton onClick={() => setOpen((current) => !current)}>
            {open ? "Close" : status?.enrolled ? "Manage" : "Set up"}
          </RowActionButton>
        ) : undefined
      }
    >
      {open && status ? (
        <InlinePanel actions={<span />} error={error}>
          <StrongAuthFlow
            status={status}
            provider={provider}
            mode="settings"
            onStatusChange={setStatus}
          />
        </InlinePanel>
      ) : null}
    </SettingRow>
  );
}
