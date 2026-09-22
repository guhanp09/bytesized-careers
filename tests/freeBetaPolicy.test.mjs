import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("free beta exposes no checkout page or client-side entitlement mint", () => {
  for (const retiredPath of [
    "app/pricing/checkout/page.tsx",
    "components/marketplace/CheckoutPanel.tsx",
  ]) {
    assert.equal(existsSync(join(root, retiredPath)), false, `${retiredPath} must remain absent`);
  }

  const client = read("lib/backendClient.ts");
  assert.doesNotMatch(client, /completeLaunchFreeCheckout|listMyEntitlements|\/checkout\/launch-free/);
});

test("job and talent publication never ask the browser to create access", () => {
  for (const path of ["components/PostJobPage.tsx", "components/PostTalentPage.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /completeLaunchFreeCheckout|checkout_intent_id|pricing\/checkout/);
  }
});

test("public beta copy promises only the approved current price", () => {
  const source = [
    read("components/marketplace/HomeBetaBanner.tsx"),
    read("components/marketplace/HomeWhySection.tsx"),
  ].join("\n");

  assert.match(source, /Free during beta/);
  assert.match(source, /No payment method is required/);
  assert.doesNotMatch(source, /standard price|discount|adjustment|₹(?:4,999|499|7,499|999)/i);
});
