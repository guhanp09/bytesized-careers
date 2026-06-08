import path from "node:path";
import sharp from "sharp";

const brandDir = path.join(process.cwd(), "public", "brand");
const source = path.join(brandDir, "logo-source-v2.png");

const outputs = [
  { name: "logo-source-v2-64.png", height: 64 },
  { name: "logo-source-v2-96.png", height: 96 },
];

async function main() {
  const trimmed = await sharp(source).ensureAlpha().trim({ threshold: 4 }).toBuffer();

  for (const output of outputs) {
    await sharp(trimmed)
      .resize({
        height: output.height,
        fit: "contain",
        kernel: "lanczos3",
      })
      .png({
        compressionLevel: 3,
        adaptiveFiltering: false,
        palette: false,
        quality: 100,
      })
      .toFile(path.join(brandDir, output.name));
  }

  console.log("Generated:");
  for (const output of outputs) {
    console.log(`- public/brand/${output.name}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
