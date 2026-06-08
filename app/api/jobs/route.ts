import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isLocalMocksEnabled } from "../../../lib/backendClient";
import { createJob } from "../../../lib/repositories/jobRepository";
import { Job } from "../../../lib/types";

export async function POST(req: Request) {
  if (!isLocalMocksEnabled()) {
    return NextResponse.json({ error: "Local job creation is disabled." }, { status: 404 });
  }

  let payload: { job?: Job } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!payload.job) {
    return NextResponse.json({ error: "Missing job." }, { status: 400 });
  }

  const created = await createJob(payload.job);
  revalidatePath("/");
  revalidatePath(`/jobs/${created.id}`);
  return NextResponse.json({ id: created.id }, { status: 201 });
}
