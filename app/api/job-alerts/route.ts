import { promises as fs } from "fs";
import path from "path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Real (non-fake) capture of homepage job-alert sign-ups. Mirrors the app's existing
// `.local-data/*.json` dev-persistence convention. Durable production storage (a DB
// table or managed list) is a recommended follow-up — see the section component notes.
const STORE_DIR = path.join(process.cwd(), ".local-data");
const STORE_PATH = path.join(STORE_DIR, "job-alerts.json");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type JobAlertRecord = { email: string; source: string; created_at: string };

export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body?.email === "string" ? body.email.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const record: JobAlertRecord = {
    email: email.toLowerCase(),
    source: "homepage_job_alerts",
    created_at: new Date().toISOString(),
  };

  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
    let existing: JobAlertRecord[] = [];
    try {
      const raw = await fs.readFile(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed as JobAlertRecord[];
    } catch {
      // No file yet — first subscriber.
    }

    const duplicate = existing.some((entry) => entry?.email === record.email);
    if (!duplicate) {
      existing.push(record);
      await fs.writeFile(STORE_PATH, JSON.stringify(existing, null, 2), "utf8");
    }

    return NextResponse.json({ ok: true, duplicate });
  } catch {
    // Persistence failed (e.g. read-only filesystem) — do not pretend it succeeded.
    return NextResponse.json({ error: "persist_failed" }, { status: 500 });
  }
}
