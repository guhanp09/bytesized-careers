import { expect, test } from "@playwright/test";

test("dev marketplace data source switch toggles and persists", async ({ page }) => {
  await page.goto("/jobs?q=finance thumbnail youtube", { waitUntil: "domcontentloaded" });

  const switcher = page.getByTestId("dev-data-source-switch").first();
  await expect(switcher).toBeVisible();

  const mock = switcher.getByRole("button", { name: "Mock" });
  const backend = switcher.getByRole("button", { name: "Backend" });

  await expect(mock).toHaveAttribute("aria-pressed", "true");

  await backend.click();
  await expect(backend).toHaveAttribute("aria-pressed", "true");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dev-data-source-switch").first().getByRole("button", { name: "Backend" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByTestId("dev-data-source-switch").first().getByRole("button", { name: "Mock" }).click();
  await expect(page.getByTestId("dev-data-source-switch").first().getByRole("button", { name: "Mock" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByText("Video editor for YouTube", { exact: false }).first()).toBeVisible();
});

