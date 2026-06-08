"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  exchangeGoogleOAuthForBackend,
  getMyProfile,
  isBackendAuthError,
  listMyPortfolio,
} from "../../lib/backendClient";
import type { BackendPortfolioItem, BackendProfileResponse } from "../../lib/backendClient";
import ProjectDetailPage from "./ProjectDetailPage";

type OwnerProjectDetailClientProps = {
  projectId: string;
  initialBackendAccessToken?: string;
};

type ProjectDetailError = {
  title: string;
  message: string;
  href?: string;
  label?: string;
};

function ProjectUnavailable({
  title,
  message,
  href = "/you?tab=portfolio",
  label = "Back to Work",
}: ProjectDetailError) {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto flex min-h-[65vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.055] p-6 text-center shadow-[0_22px_70px_-44px_rgba(0,0,0,1)]">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/58">{message}</p>
          <Link
            href={href}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white/78 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            {label}
          </Link>
        </div>
      </section>
    </main>
  );
}

function ProjectLoading() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto w-full max-w-[1480px] animate-pulse space-y-5">
        <div className="h-4 w-28 rounded-full bg-white/10" />
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.05]">
          <div className="aspect-[16/8] bg-white/[0.07]" />
          <div className="space-y-3 p-6">
            <div className="h-8 w-3/5 rounded-full bg-white/10" />
            <div className="h-4 w-36 rounded-full bg-white/10" />
            <div className="h-4 w-52 rounded-full bg-white/10" />
          </div>
        </div>
      </section>
    </main>
  );
}

export default function OwnerProjectDetailClient({
  projectId,
  initialBackendAccessToken,
}: OwnerProjectDetailClientProps) {
  const { data: session, status: sessionStatus } = useSession();
  const tokenRecoveryPromiseRef = useRef<Promise<string | null> | null>(null);
  const loadRequestIdRef = useRef(0);
  const [backendAccessToken, setBackendAccessToken] = useState<string | undefined>(
    initialBackendAccessToken
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ProjectDetailError | null>(null);
  const [profile, setProfile] = useState<BackendProfileResponse | null>(null);
  const [project, setProject] = useState<BackendPortfolioItem | null>(null);

  const oauthProviderAccountId = session?.user?.providerAccountId;
  const oauthAccessToken = session?.user?.accessToken;
  const oauthRefreshToken = session?.user?.refreshToken;
  const oauthExpiresAt = session?.user?.oauthExpiresAt;
  const oauthScope = session?.user?.oauthScope;
  const oauthEmail =
    session?.user?.email ||
    (typeof session?.user?.profile?.email === "string" ? session.user.profile.email : undefined);

  useEffect(() => {
    if (initialBackendAccessToken) {
      setBackendAccessToken(initialBackendAccessToken);
    }
  }, [initialBackendAccessToken]);

  const exchangeBackendTokenFromOAuth = useCallback(async (): Promise<string | null> => {
    if (tokenRecoveryPromiseRef.current) {
      return tokenRecoveryPromiseRef.current;
    }
    if (sessionStatus !== "authenticated" || !oauthEmail || !oauthProviderAccountId) {
      return null;
    }

    const recoveryPromise = (async () => {
      try {
        const result = await exchangeGoogleOAuthForBackend({
          email: oauthEmail,
          provider_account_id: oauthProviderAccountId,
          display_name: session?.user?.name || undefined,
          access_token: oauthAccessToken || null,
          refresh_token: oauthRefreshToken || null,
          expires_at: typeof oauthExpiresAt === "number" ? oauthExpiresAt : null,
          scope: typeof oauthScope === "string" ? oauthScope : null,
        });
        const nextToken = result.access_token?.trim();
        if (!nextToken) {
          return null;
        }
        setBackendAccessToken(nextToken);
        return nextToken;
      } catch {
        return null;
      } finally {
        tokenRecoveryPromiseRef.current = null;
      }
    })();

    tokenRecoveryPromiseRef.current = recoveryPromise;
    return recoveryPromise;
  }, [
    oauthAccessToken,
    oauthEmail,
    oauthExpiresAt,
    oauthProviderAccountId,
    oauthRefreshToken,
    oauthScope,
    session?.user?.name,
    sessionStatus,
  ]);

  const withFreshBackendToken = useCallback(
    async <T,>(request: (token: string) => Promise<T>): Promise<T> => {
      let token: string | null | undefined = backendAccessToken;
      if (!token) {
        token = await exchangeBackendTokenFromOAuth();
      }
      if (!token) {
        throw new Error("Your session is missing backend auth. Sign in again.");
      }

      try {
        return await request(token);
      } catch (err) {
        if (!isBackendAuthError(err)) {
          throw err;
        }
        const recoveredToken = await exchangeBackendTokenFromOAuth();
        if (!recoveredToken) {
          throw err;
        }
        return await request(recoveredToken);
      }
    },
    [backendAccessToken, exchangeBackendTokenFromOAuth]
  );

  useEffect(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    if (sessionStatus === "loading") {
      setLoading(true);
      return;
    }

    if (sessionStatus !== "authenticated") {
      setLoading(false);
      setError({
        title: "Sign in to view this project",
        message: "Owner project pages require an authenticated CreatorJobs account.",
        href: "/auth",
        label: "Sign in",
      });
      return;
    }

    setLoading(true);
    setError(null);

    void withFreshBackendToken((token) =>
      Promise.all([getMyProfile(token), listMyPortfolio(token)] as const)
    )
      .then(([loadedProfile, portfolio]) => {
        if (loadRequestIdRef.current !== requestId) return;
        const matchedProject =
          (portfolio.items || []).find((item) => item.id === projectId) || null;
        if (!matchedProject) {
          setProfile(null);
          setProject(null);
          setError({
            title: "Project not found",
            message: "This project may have been deleted or it does not belong to your profile.",
          });
          return;
        }
        setProfile(loadedProfile);
        setProject(matchedProject);
      })
      .catch((err) => {
        if (loadRequestIdRef.current !== requestId) return;
        if (isBackendAuthError(err)) {
          setError({
            title: "Sign in again to view this project",
            message: "Your CreatorJobs session could not be refreshed. Sign in again and reopen the project.",
            href: `/auth?mode=login&next=/you/projects/${encodeURIComponent(projectId)}`,
            label: "Sign in",
          });
          return;
        }
        setError({
          title: "Project unavailable",
          message: err instanceof Error ? err.message : "Could not load this project right now.",
        });
      })
      .finally(() => {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [projectId, sessionStatus, withFreshBackendToken]);

  if (loading) {
    return <ProjectLoading />;
  }

  if (error || !profile || !project) {
    return (
      <ProjectUnavailable
        title={error?.title || "Project not found"}
        message={error?.message || "This project may have been deleted or it does not belong to your profile."}
        href={error?.href}
        label={error?.label}
      />
    );
  }

  return (
    <ProjectDetailPage
      project={project}
      profile={profile}
      owner
      backendAccessToken={backendAccessToken}
      backHref="/you?tab=portfolio"
      backLabel="Back to Work"
      profileHref="/you"
    />
  );
}
