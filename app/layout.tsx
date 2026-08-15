import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"),
  title: {
    default: "CreatorJobs",
    template: "%s | CreatorJobs",
  },
  alternates: {
    canonical: "/",
  },
  description:
    "A premium creator economy marketplace for hiring content talent, finding freelance work, and publishing talent listings.",
  openGraph: {
    title: "CreatorJobs",
    description:
      "Hire content talent, discover creator-led jobs, and publish talent listings in a premium creator economy marketplace.",
    siteName: "CreatorJobs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CreatorJobs",
    description:
      "Hire content talent, discover creator-led jobs, and publish talent listings in a premium creator economy marketplace.",
  },
};

import Header from "../components/Header";
import SmartTypingProvider from "../components/SmartTypingProvider";
import AuthProvider from "../components/AuthProvider";
import DevToolsPanel from "../components/dev/DevToolsPanel";
import { isDevToolsAllowed } from "../lib/devTools";
import QaPersonaDrawer from "../components/qa/QaPersonaDrawer";
import { isQaPersonaUiAllowed } from "../lib/qaPersonas";
import VisualThemeToggle from "../components/theme/VisualThemeToggle";
import { VISUAL_THEME_BOOTSTRAP_SCRIPT } from "../lib/visualTheme";
import AppContent from "../components/AppContent";

import { CSP_NONCE_HEADER } from "../lib/contentSecurityPolicy";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Computed on the server: in production the panel is never rendered into the tree
  // at all (not merely hidden), so the dev tooling cannot be reached in production.
  const devToolsEnabled = isDevToolsAllowed();
  const qaPersonaEnabled = isQaPersonaUiAllowed();
  // Set by middleware, one value per response. Reading it here is also what
  // keeps every page rendering per request: a nonce baked into build-time HTML
  // would not match the policy sent with it, and the page would refuse to run.
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-[var(--vt-canvas,#0b0b0f)] text-[var(--vt-ink,#ffffff)] antialiased`}
      >
        {/* Apply a stored "enhanced" theme choice before first paint (no flash).
            The visual theme is a reversible CSS-token preview; see lib/visualTheme.ts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: VISUAL_THEME_BOOTSTRAP_SCRIPT }} />
        <AuthProvider>
          <Header />
          <SmartTypingProvider />

          {/* Job creation uses the full phone viewport; the desktop rail returns at sm. */}
          <AppContent>{children}</AppContent>
          {devToolsEnabled ? <DevToolsPanel /> : null}
          {qaPersonaEnabled ? <QaPersonaDrawer /> : null}
          <VisualThemeToggle />
        </AuthProvider>
      </body>
    </html>
  );
}
