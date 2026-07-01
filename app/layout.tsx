import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Computed on the server: in production the panel is never rendered into the tree
  // at all (not merely hidden), so the dev tooling cannot be reached in production.
  const devToolsEnabled = isDevToolsAllowed();
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} bg-[#0b0b0f] text-white antialiased`}>
        <AuthProvider>
          <Header />
          <SmartTypingProvider />

          {/* Content sits "under" the fixed header, and to the right of the fixed sidebar */}
          <div className="pl-20 pt-14">{children}</div>
          {devToolsEnabled ? <DevToolsPanel /> : null}
        </AuthProvider>
      </body>
    </html>
  );
}
