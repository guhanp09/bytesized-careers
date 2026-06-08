#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const outPath = path.resolve("src/data/video_editing_styles.big.json");

const seedPhrases = [
  "cinematic suspense pacing",
  "retention-first jump cuts",
  "documentary / continuity edit",
  "fast meme edit",
  "montage-heavy pacing",
  "J-cut / L-cut dialogue flow",
  "clean minimal captions",
  "high-energy shorts pacing",
  "story-driven cold open",
  "hook-first structure",
  "rhythmic b-roll intercuts",
  "subtle sound design",
  "dramatic punch-ins",
  "minimalist lower thirds",
  "sfx-driven beats",
  "quick-cut commentary",
  "kinetic text overlays",
  "punchy comedic timing",
  "slow-burn tension build",
  "tight narrative trim",
  "soft documentary tone",
  "high-contrast grading",
  "muted cinematic grade",
  "film grain texture",
  "subtle camera shake",
  "whip-pan transitions",
  "smash-cut humor",
  "emotive pacing",
  "sound stinger hooks",
  "ambient tone bed",
  "retro VHS texture",
  "minimalist soundscape",
  "clean dialogue focus",
  "dynamic zooms",
  "cut-on-beat rhythm",
  "reaction-driven pacing",
  "caption-heavy clarity",
  "diagram / callout overlays",
  "rapid recap flow",
  "slow reveal structure",
  "minimal meme insertions",
  "tasteful motion graphics",
  "high-signal editing",
  "micro-beat pacing",
  "fast hook then breathe",
  "tight scene compression",
  "subtle dolly zoom effect",
  "interview-centric flow",
  "social-first framing",
  "story arc emphasis",
  "b-roll layering",
  "low-latency snappy cuts",
  "soft vignette aesthetic",
  "high-clarity captions",
  "bold subtitle style",
  "ASMR-style quiet pacing",
  "clean corporate polish",
  "premium documentary finish",
  "naturalistic pacing",
  "emotional beat emphasis",
  "tight punchline timing",
  "minimalist music bed",
  "suspense stinger cadence",
  "rhythmic silence beats",
  "motion-graphics-lite",
  "tight outro cadence",
  "intro hook, fast pull-in",
  "chaptered storytelling",
  "fast cuts, slow reveals",
  "tasteful zoom accents",
  "clean text-on-screen",
  "live-clip pacing",
  "multi-cam sync flow",
  "quick flashback inserts",
  "collage edit",
  "retro montage vibe",
  "lo-fi documentary style",
  "bold kinetic typography",
  "smooth pans + jump cuts",
  "tight audio polish",
  "quiet tension build",
  "measured narrative pacing",
  "story beat underscores",
  "tightest possible runtime",
];

const adjectives = [
  "cinematic",
  "retention-first",
  "story-first",
  "hook-first",
  "high-energy",
  "minimalist",
  "documentary",
  "naturalistic",
  "dramatic",
  "suspenseful",
  "punchy",
  "tight",
  "snappy",
  "fast-paced",
  "slow-burn",
  "moody",
  "gritty",
  "clean",
  "premium",
  "polished",
  "editorial",
  "social-first",
  "short-form",
  "long-form",
  "narrative",
  "emotive",
  "quiet",
  "intense",
  "high-contrast",
  "low-contrast",
  "muted",
  "warm",
  "cool",
  "retro",
  "lo-fi",
  "modern",
  "bold",
  "subtle",
  "elegant",
  "raw",
  "authentic",
  "memetic",
  "deadpan",
  "quirky",
  "comedic",
  "edgy",
  "minimal",
  "maximal",
  "kinetic",
  "rhythmic",
  "ambient",
  "clean-room",
  "broadcast",
  "studio",
  "indie",
  "festival",
  "noir",
  "horror",
  "thriller",
];

const techniques = [
  "jump cuts",
  "match cuts",
  "smash cuts",
  "hard cuts",
  "cut-on-beat timing",
  "L-cut dialogue flow",
  "J-cut dialogue flow",
  "montage sequencing",
  "b-roll layering",
  "whip-pan transitions",
  "speed ramps",
  "punch-ins",
  "punch-outs",
  "zoom accents",
  "sound design beats",
  "caption overlays",
  "kinetic typography",
  "reaction inserts",
  "cold opens",
  "cliffhanger beats",
  "micro-pauses",
  "breath beats",
  "flashback inserts",
  "cutaway rhythm",
  "beat-matched edits",
  "music-driven edits",
  "subtle motion graphics",
  "minimal lower thirds",
  "quick recaps",
  "hook recaps",
  "callout overlays",
  "diagram overlays",
  "audio cleanup",
  "dialogue polish",
  "ambient beds",
  "tension stingers",
  "subtle glitches",
  "film grain texture",
  "VHS texture",
  "camera shake accents",
  "stabilized pans",
];

const contexts = [
  "for YouTube long-form",
  "for TikTok shorts",
  "for Instagram Reels",
  "for podcast clips",
  "for interviews",
  "for explainer content",
  "for storytime videos",
  "for documentary cuts",
  "for commentary videos",
  "for gaming highlights",
  "for cinematic recaps",
  "for product launches",
  "for behind-the-scenes",
  "for social teasers",
  "for live-show highlights",
];

const formats = [
  "chaptered storytelling",
  "hook-driven structure",
  "three-act pacing",
  "tight narrative trim",
  "fast hook then breathe",
  "slow reveal structure",
  "tension build cadence",
  "reaction-led pacing",
  "punchline-first setup",
  "cold open, fast pull-in",
  "micro-hook layering",
  "open-loop storytelling",
  "payoff-first montage",
  "series recap flow",
];

const set = new Set();
seedPhrases.forEach((p) => set.add(p));

for (const adj of adjectives) {
  for (const tech of techniques) {
    const techLower = tech.toLowerCase();
    const adjLower = adj.toLowerCase();
    if (techLower.startsWith(adjLower)) continue;
    set.add(`${adj} ${tech}`);
    set.add(`${adj} ${tech} pacing`);
    set.add(`${adj} ${tech} flow`);
  }
}

for (const adj of adjectives) {
  for (const ctx of contexts) {
    set.add(`${adj} pacing ${ctx}`);
  }
}

for (const fmt of formats) {
  for (const tech of techniques.slice(0, 20)) {
    set.add(`${fmt} with ${tech}`);
  }
}

const styles = Array.from(set)
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(styles, null, 2), "utf-8");

console.log(`Wrote ${styles.length} styles to ${outPath}`);
