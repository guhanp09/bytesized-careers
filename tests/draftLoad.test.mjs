import test from "node:test";
import assert from "node:assert/strict";

import { classifyDraftLoad } from "../lib/draftLoad.ts";

const isAuth = (error) => Boolean(error) && error.status === 401;
const ok = (value) => ({ status: "fulfilled", value });
const fail = (reason) => ({ status: "rejected", reason });

test("an expired session (401) on either request resolves to auth, never a false empty list", () => {
  assert.equal(classifyDraftLoad(fail({ status: 401 }), ok([]), isAuth).kind, "auth");
  assert.equal(classifyDraftLoad(ok([]), fail({ status: 401 }), isAuth).kind, "auth");
});

test("both requests failing for non-auth reasons resolves to a generic error", () => {
  assert.equal(classifyDraftLoad(fail({ status: 0 }), fail({ status: 500 }), isAuth).kind, "error");
});

test("a single non-auth failure still renders the data that loaded", () => {
  const out = classifyDraftLoad(ok([{ id: "j1" }]), fail({ status: 500 }), isAuth);
  assert.equal(out.kind, "ready");
  assert.deepEqual(out.jobs, [{ id: "j1" }]);
  assert.deepEqual(out.listings, []);
});

test("both requests succeeding but empty is a genuine empty state", () => {
  const out = classifyDraftLoad(ok([]), ok([]), isAuth);
  assert.equal(out.kind, "ready");
  assert.equal(out.jobs.length, 0);
  assert.equal(out.listings.length, 0);
});

test("both requests succeeding with data returns ready with that data", () => {
  const out = classifyDraftLoad(ok([{ id: "j1" }]), ok([{ id: "t1" }]), isAuth);
  assert.equal(out.kind, "ready");
  assert.equal(out.jobs.length, 1);
  assert.equal(out.listings.length, 1);
});
