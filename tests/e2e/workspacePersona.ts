import { expect, type Page } from "@playwright/test";

/**
 * Switch the Applications workspace persona.
 *
 * Phase 2 turned this from a two-option segmented control into a disclosure,
 * deliberately: the header's Jobs/Talent search scope is a segmented control
 * with the same inverted active pill, and the two used to be indistinguishable
 * despite meaning entirely different things. Specs go through this helper so
 * the next change to the control costs one edit rather than thirteen.
 */
export async function switchPersona(page: Page, persona: "talent" | "hiring") {
  const trigger = page.getByTestId("workspace-persona");
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute("data-persona")) === persona) return;

  await trigger.click();
  await page.getByTestId(`workspace-persona-${persona}`).click();
  await expect(page.getByTestId("workspace-persona")).toHaveAttribute("data-persona", persona);
}
