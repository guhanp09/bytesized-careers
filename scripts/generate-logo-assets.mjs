import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const brandDir = path.join(process.cwd(), "public", "brand");
const sourcePath = path.join(brandDir, "logo-source.png");

const outputs = [
  { height: 28, name: "logo-mark-28.png" },
  { height: 30, name: "logo-mark-30.png" },
  { height: 32, name: "logo-mark-32.png" },
  { height: 36, name: "logo-mark-36.png" },
  { height: 40, name: "logo-mark-40.png" },
  { height: 56, name: "logo-mark-56.png" },
  { height: 60, name: "logo-mark-60.png" },
  { height: 64, name: "logo-mark-64.png" },
  { height: 72, name: "logo-mark-72.png" },
  { height: 80, name: "logo-mark-80.png" },
  { height: 84, name: "logo-mark-84.png" },
  { height: 90, name: "logo-mark-90.png" },
  { height: 96, name: "logo-mark-96.png" },
  { height: 108, name: "logo-mark-108.png" },
  { height: 120, name: "logo-mark-120.png" },
];

async function ensureSource() {
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Missing canonical source logo at ${sourcePath}`);
  }
}

async function main() {
  await ensureSource();

  const trimmed = sharp(sourcePath)
    .ensureAlpha()
    .trim({ threshold: 4 })
    .png({
      compressionLevel: 3,
      adaptiveFiltering: false,
      palette: false,
      quality: 100,
    });

  const trimmedBuffer = await trimmed.toBuffer();
  const metadata = await sharp(trimmedBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read trimmed logo dimensions.");
  }

  for (const item of outputs) {
    const outPath = path.join(brandDir, item.name);
    let image = sharp(trimmedBuffer).resize({
      height: item.height,
      fit: "contain",
      kernel: "lanczos3",
      withoutEnlargement: false,
    });

    // Preserve bevel readability at tiny header sizes where gradients can flatten.
    if (item.height <= 40) {
      image = image.linear(1.08, -4).sharpen({
        sigma: 0.9,
        m1: 1,
        m2: 1.2,
        x1: 2,
        y2: 8,
        y3: 16,
      });
    }

    await image
      .png({
        compressionLevel: 3,
        adaptiveFiltering: false,
        palette: false,
        quality: 100,
      })
      .toFile(outPath);
  }

  console.log(`Generated ${outputs.length} logo variants from ${path.relative(process.cwd(), sourcePath)} (${metadata.width}x${metadata.height})`);
  for (const item of outputs) {
    console.log(`- public/brand/${item.name}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
