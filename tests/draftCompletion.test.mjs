import test from "node:test";
import assert from "node:assert/strict";

import { getJobDraftCompletion, getTalentDraftCompletion } from "../lib/draftCompletion.ts";

test("empty job draft: nothing started, not publish-ready", () => {
  const c = getJobDraftCompletion({});
  assert.equal(c.publishReady, false);
  assert.equal(c.requiredComplete, 0);
  assert.equal(c.requiredPercent, 0);
  assert.equal(c.recommendedComplete, 0);
  assert.equal(c.statusKind, "not_started");
  assert.equal(c.statusLabel, "Not started");
  // Next best action points at a required field.
  assert.equal(c.nextBestAction.done, false);
  assert.ok(c.missingRequiredItems.length > 0);
});

test("fallback job draft title is not completion evidence", () => {
  const c = getJobDraftCompletion({
    title: "Untitled job draft",
    platform: "youtube",
    hiringDisplayName: "@financechannel",
    workMode: "remote",
    budget: "₹3,000 per video",
    about: "Weekly finance explainers for an India-first creator audience.",
  });
  const title = c.requiredItems.find((i) => i.key === "title");
  assert.equal(title.done, false);
  assert.ok(c.missingRequiredItems.some((i) => i.key === "title"));
});

test("fallback flexible budget is not completion evidence", () => {
  const c = getJobDraftCompletion({
    title: "Video editor for finance explainers",
    platform: "youtube",
    hiringDisplayName: "@financechannel",
    workMode: "remote",
    budget: "Flexible",
    about: "Weekly finance explainers for an India-first creator audience.",
  });
  const budget = c.requiredItems.find((i) => i.key === "budget");
  assert.equal(budget.done, false);
  assert.ok(c.missingRequiredItems.some((i) => i.key === "budget"));
});

test("job default-like completion fields stay incomplete when not explicitly present", () => {
  const c = getJobDraftCompletion({
    title: "Video editor for finance explainers",
    hiringDisplayName: "@financechannel",
    budget: "₹3,000 per video",
    about: "Weekly finance explainers for an India-first creator audience.",
    draftCompletion: {
      hasPlatform: false,
      hasWorkMode: false,
      hasTimeline: false,
      hasChannel: true,
    },
  });

  assert.equal(c.requiredItems.find((i) => i.key === "platform").done, false);
  assert.equal(c.requiredItems.find((i) => i.key === "workMode").done, false);
  // "Add timeline" was removed from Improve your listing. A recruiter reads
  // that panel as work still to do, and a start window is not something a
  // listing is weaker for omitting — so it no longer appears, and no longer
  // counts against the recommended percentage.
  assert.equal(
    c.recommendedItems.find((i) => i.key === "timeline"),
    undefined
  );
});

test("job display fallback hiring name is not channel completion evidence", () => {
  const c = getJobDraftCompletion({
    title: "Video editor for finance explainers",
    platform: "youtube",
    hiringDisplayName: "Content creator",
    workMode: "remote",
    budget: "₹3,000 per video",
    about: "Weekly finance explainers for an India-first creator audience.",
    draftCompletion: {
      hasChannel: false,
    },
  });

  const channel = c.requiredItems.find((i) => i.key === "channel");
  assert.equal(channel.done, false);
  assert.ok(c.missingRequiredItems.some((i) => i.key === "channel"));
});

test("partially complete job draft: missing budget is publish-blocking", () => {
  const c = getJobDraftCompletion({
    title: "Video editor for finance explainers",
    platform: "youtube",
    hiringDisplayName: "@financechannel",
    workMode: "remote",
    about: "Weekly finance explainers for an India-first creator audience.",
    // no budget
  });
  assert.equal(c.publishReady, false);
  const budget = c.requiredItems.find((i) => i.key === "budget");
  assert.ok(budget && budget.done === false);
  assert.ok(c.missingRequiredItems.some((i) => i.key === "budget"));
  assert.match(c.nextBestAction.title, /budget/i);
  assert.equal(c.nextBestAction.jump, "budget");
});

test("job brand-context field uses About the brand labels", () => {
  const c = getJobDraftCompletion({
    title: "Video editor for finance explainers",
    platform: "youtube",
    hiringDisplayName: "@financechannel",
    workMode: "remote",
    budget: "₹3,000 per video",
    // no about field
  });
  const context = c.requiredItems.find((i) => i.key === "context");
  assert.equal(context.label, "Add about the brand");
  assert.equal(context.actionLabel, "Add about the brand");
  assert.equal(context.groupLabel, "About the brand");
  assert.equal(context.done, false);
});

test("publish-ready but weak job draft: required done, recommended mostly missing", () => {
  const c = getJobDraftCompletion({
    title: "Motion graphics editor",
    platform: "youtube",
    hiringDisplayName: "@explainlab",
    workMode: "remote",
    budget: "₹3,000 per video",
    about: "Explainer videos for a creator-led education channel.",
    // no recommended fields
  });
  assert.equal(c.publishReady, true);
  assert.equal(c.statusKind, "ready");
  assert.equal(c.requiredPercent, 100);
  assert.ok(c.recommendedPercent < 100);
  // Once publishable, the next action targets a recommended (strength) field.
  assert.match(c.nextBestAction.body, /improve listing strength/i);
  assert.ok(c.missingRecommendedItems.length > 0);
});

test("job listing strength excludes tags and includes experience", () => {
  const c = getJobDraftCompletion({
    title: "Motion graphics editor",
    platform: "youtube",
    hiringDisplayName: "@explainlab",
    workMode: "remote",
    budget: "₹3,000 per video",
    about: "Explainer videos for a creator-led education channel.",
    tags: ["motion"],
  });
  assert.equal(c.publishReady, true);
  assert.equal(c.recommendedItems.some((i) => i.key === "tags"), false);
  const experience = c.recommendedItems.find((i) => i.key === "experience");
  assert.ok(experience);
  assert.equal(experience.done, false);
  assert.equal(experience.target, "experience");
  assert.equal(experience.type, "recommended");
  assert.equal(experience.actionLabel, "Add experience");
});

test("job creator context checklist tracks each creator field independently", () => {
  const base = {
    title: "Motion graphics editor",
    platform: "youtube",
    hiringDisplayName: "@explainlab",
    workMode: "remote",
    budget: "₹3,000 per video",
    about: "Explainer videos for a creator-led education channel.",
  };

  const empty = getJobDraftCompletion(base);
  const oneField = getJobDraftCompletion({ ...base, contentNiches: ["Education"] });
  const allFields = getJobDraftCompletion({
    ...base,
    contentNiches: ["Education"],
    contentGenres: ["Explainers"],
    formatsHiredFor: ["Long-form video"],
  });

  assert.equal(empty.recommendedItems.find((i) => i.key === "contentNiches").done, false);
  assert.equal(empty.recommendedItems.find((i) => i.key === "contentGenres").done, false);
  assert.equal(empty.recommendedItems.find((i) => i.key === "formatsHiredFor").done, false);

  assert.equal(oneField.recommendedItems.find((i) => i.key === "contentNiches").done, true);
  assert.equal(oneField.recommendedItems.find((i) => i.key === "contentGenres").done, false);
  assert.equal(oneField.recommendedItems.find((i) => i.key === "formatsHiredFor").done, false);

  assert.equal(allFields.recommendedItems.find((i) => i.key === "contentNiches").label, "Add content niches");
  assert.equal(allFields.recommendedItems.find((i) => i.key === "contentGenres").label, "Add genres");
  assert.equal(allFields.recommendedItems.find((i) => i.key === "formatsHiredFor").label, "Add formats hired for");
  assert.equal(allFields.recommendedItems.find((i) => i.key === "contentNiches").done, true);
  assert.equal(allFields.recommendedItems.find((i) => i.key === "contentGenres").done, true);
  assert.equal(allFields.recommendedItems.find((i) => i.key === "formatsHiredFor").done, true);
});

test("fully complete & strong job draft", () => {
  const c = getJobDraftCompletion({
    title: "Motion graphics editor",
    platform: "youtube",
    hiringDisplayName: "@explainlab",
    hiringIdentityId: "id-1",
    hiringVerificationStatus: "VERIFIED",
    workMode: "remote",
    budget: "₹3,000 per video",
    about: "Explainer videos for a creator-led education channel.",
    experience: "2–4 years",
    responsibilities: "Animate explainers.",
    requirements: "2y experience.",
    tools: ["After Effects"],
    contentNiches: ["Education"],
    contentGenres: ["Explainers"],
    formatsHiredFor: ["Long-form video"],
    weeklyHours: "48 hours",
    referenceVideos: [{ url: "https://youtu.be/x" }],
  });
  assert.equal(c.publishReady, true);
  assert.equal(c.requiredPercent, 100);
  assert.equal(c.recommendedPercent, 100);
  assert.equal(c.nextBestAction.done, true);
  assert.equal(c.missingRequiredItems.length, 0);
  assert.equal(c.missingRecommendedItems.length, 0);
});

test("job draft needing verification reports needs_verification", () => {
  const c = getJobDraftCompletion({
    title: "Channel manager for uploads",
    platform: "youtube",
    hiringDisplayName: "@examplechannel",
    hiringIdentityId: "id-2",
    hiringVerificationStatus: "REJECTED",
    workMode: "remote",
    budget: "₹2,000 per month",
    about: "Channel operations support for weekly YouTube uploads.",
  });
  assert.equal(c.publishReady, false);
  assert.equal(c.statusKind, "needs_verification");
  assert.equal(c.nextShortLabel, "Verify channel access");
  assert.match(c.nextBestAction.title, /verify/i);
});

test("section statuses reflect per-section state", () => {
  const c = getJobDraftCompletion({
    title: "Editor",
    platform: "youtube",
    hiringDisplayName: "@x",
    workMode: "remote",
    budget: "₹1,000",
    about: "Editing support for recurring YouTube uploads.",
  });
  const budgetSection = c.sectionStatuses.find((s) => s.key === "budget");
  assert.equal(budgetSection.state, "complete");
  const mediaSection = c.sectionStatuses.find((s) => s.key === "media");
  assert.equal(mediaSection.state, "not-started");
});

test("empty talent draft: not started", () => {
  const c = getTalentDraftCompletion({});
  assert.equal(c.publishReady, false);
  assert.equal(c.statusKind, "not_started");
  assert.equal(c.requiredComplete, 0);
});

test("talent blank work mode and rate stay incomplete", () => {
  const c = getTalentDraftCompletion({
    title: "Retention editor for YouTube",
    primary_role: "Video Editor",
    work_mode: "",
    rate_min: null,
    rate_max: null,
    rate_note: null,
  });

  assert.equal(c.requiredItems.find((i) => i.key === "workMode").done, false);
  assert.equal(c.requiredItems.find((i) => i.key === "rate").done, false);
  assert.equal(c.requiredItems.find((i) => i.key === "workMode").jump, "basics");
  assert.equal(c.requiredItems.find((i) => i.key === "rate").jump, "basics");
  assert.ok(c.missingRequiredItems.some((i) => i.key === "workMode"));
  assert.ok(c.missingRequiredItems.some((i) => i.key === "rate"));
});

test("user-filled talent required fields mark complete", () => {
  const c = getTalentDraftCompletion({
    title: "Retention editor for YouTube",
    primary_role: "Video Editor",
    work_mode: "remote",
    rate_note: "Contact for pricing",
  });

  assert.equal(c.requiredItems.find((i) => i.key === "workMode").done, true);
  assert.equal(c.requiredItems.find((i) => i.key === "rate").done, true);
});

test("fallback talent draft title is not completion evidence", () => {
  const c = getTalentDraftCompletion({
    title: "Untitled talent listing",
    primary_role: "Video Editor",
    work_mode: "remote",
    rate_min: 1200,
  });
  const title = c.requiredItems.find((i) => i.key === "title");
  assert.equal(title.done, false);
  assert.ok(c.missingRequiredItems.some((i) => i.key === "title"));
});

test("partially complete talent draft: missing rate blocks publish", () => {
  const c = getTalentDraftCompletion({
    title: "Retention editor for YouTube",
    primary_role: "Video Editor",
    work_mode: "remote",
    niche: "Education",
    platforms: ["YouTube"],
    tools: ["Premiere Pro"],
    // no rate
  });
  assert.equal(c.publishReady, false);
  assert.ok(c.missingRequiredItems.some((i) => i.key === "rate"));
  // tools/niche count toward recommended strength.
  assert.ok(c.recommendedComplete >= 2);
});

test("publish-ready but weak talent draft", () => {
  const c = getTalentDraftCompletion({
    title: "Shorts editor",
    primary_role: "Shorts Editor",
    work_mode: "remote",
    rate_min: 1200,
  });
  assert.equal(c.publishReady, true);
  assert.ok(c.recommendedPercent < 100);
});

test("talent creator context checklist completes when at least two fields are filled", () => {
  const base = {
    title: "Thumbnail designer",
    primary_role: "Thumbnail Designer",
    work_mode: "remote",
    rate_min: 1000,
  };

  const empty = getTalentDraftCompletion(base);
  const oneField = getTalentDraftCompletion({ ...base, content_niches: ["Finance"] });
  const twoFields = getTalentDraftCompletion({
    ...base,
    content_niches: ["Finance"],
    formats: ["Thumbnails"],
  });

  assert.equal(empty.recommendedItems.find((i) => i.key === "creatorContext").done, false);
  assert.equal(oneField.recommendedItems.find((i) => i.key === "creatorContext").done, false);
  const creatorContext = twoFields.recommendedItems.find((i) => i.key === "creatorContext");
  assert.equal(creatorContext.done, true);
  assert.equal(creatorContext.label, "Add creator context");
  assert.equal(creatorContext.helpText, "Helps recruiters find you in search.");
  assert.equal(creatorContext.groupLabel, "Creator context");
});

test("talent draft completion groups route to the restructured talent flow", () => {
  const c = getTalentDraftCompletion({
    title: "Thumbnail designer",
    primary_role: "Thumbnail Designer",
    work_mode: "remote",
    rate_min: 1000,
    platforms: ["YouTube"],
    content_niches: ["Finance"],
    content_genres: ["Explainers"],
    tools: ["Photoshop"],
    description: "High-CTR thumbnail packaging for education and finance channels.",
    portfolio_item_ids: ["p1"],
  });

  assert.equal(c.recommendedItems.find((i) => i.key === "niche").groupLabel, "Creator context");
  assert.equal(c.recommendedItems.find((i) => i.key === "tools").groupLabel, "Tools & portfolio");
  assert.equal(c.recommendedItems.find((i) => i.key === "portfolio").groupLabel, "Tools & portfolio");
  assert.equal(c.recommendedItems.find((i) => i.key === "description").groupLabel, "Services");

  assert.equal(c.keyFacts.find((item) => item.key === "workMode").jump, "basics");
  assert.equal(c.keyFacts.find((item) => item.key === "rate").jump, "basics");
});

test("fully complete & strong talent draft", () => {
  const c = getTalentDraftCompletion({
    title: "Thumbnail designer",
    primary_role: "Thumbnail Designer",
    work_mode: "remote",
    rate_min: 1000,
    niche: "Tech",
    content_niches: ["Tech", "Finance"],
    content_genres: ["Reviews"],
    formats: ["Thumbnails"],
    platforms: ["YouTube"],
    tools: ["Photoshop"],
    description: "High-CTR thumbnails.",
    experience_years: 3,
    portfolio_item_ids: ["p1", "p2"],
  });
  assert.equal(c.publishReady, true);
  assert.equal(c.requiredPercent, 100);
  assert.equal(c.recommendedPercent, 100);
  assert.equal(c.nextBestAction.done, true);
});

test("key facts surface missing high-value fields as null", () => {
  const c = getJobDraftCompletion({ title: "Editor", platform: "youtube", hiringDisplayName: "@x", workMode: "remote" });
  const compensation = c.keyFacts.find((f) => f.key === "budget");
  assert.equal(compensation.value, null);
  assert.equal(compensation.jump, "budget");
});
