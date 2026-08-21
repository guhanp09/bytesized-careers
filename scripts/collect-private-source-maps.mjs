import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{6,99}$/;
const SOURCE_MAP_COMMENT = /(?:\r?\n)?\/\/[#@]\s*sourceMappingURL=[^\r\n]*|\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g;

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing a symlink inside the build artifact: ${path}`);
    }
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function walkIfPresent(directory) {
  try {
    return await walk(directory);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function assertOutsideBuild(buildDirectory, destinationDirectory) {
  const relation = relative(buildDirectory, destinationDirectory);
  if (relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..")) {
    throw new Error("The private source-map destination must be outside the Next.js build directory.");
  }
}

async function ensureAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing to overwrite an existing source-map artifact: ${path}`);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function collectPrivateSourceMaps({
  buildDirectory = ".next",
  destinationDirectory,
  release,
}) {
  if (!SAFE_RELEASE.test(release || "")) {
    throw new Error("A 7–100 character safe release identifier is required for source maps.");
  }
  if (!destinationDirectory) {
    throw new Error("A private source-map destination is required.");
  }

  const build = resolve(buildDirectory);
  const destination = resolve(destinationDirectory);
  assertOutsideBuild(build, destination);
  const buildInfo = await stat(build);
  if (!buildInfo.isDirectory()) throw new Error(`Next.js build directory not found: ${build}`);
  await ensureAbsent(destination);

  // `.next/dev` may coexist with a production build and contains framework
  // symlinks. It is neither part of the release nor a source-map source. Scope
  // collection to the two production trees instead of traversing stale dev
  // state (and still refuse a symlink if one appears inside either tree).
  const productionRoots = [join(build, "static"), join(build, "server")];
  const [staticFiles, serverFiles] = await Promise.all(
    productionRoots.map((root) => walkIfPresent(root)),
  );
  const maps = [...staticFiles, ...serverFiles].filter((path) => path.endsWith(".map"));
  if (maps.length === 0) {
    throw new Error(
      "No source maps were produced. Refusing a release artifact that cannot symbolicate errors.",
    );
  }

  const staging = `${destination}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });

  try {
    const manifestFiles = [];
    for (const map of maps) {
      const mapRelative = relative(build, map);
      if (mapRelative.startsWith("..") || isAbsolute(mapRelative)) {
        throw new Error(`Source map escaped the build directory: ${map}`);
      }
      const target = join(staging, mapRelative);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(map, target);
      manifestFiles.push({
        path: mapRelative.split(sep).join("/"),
        sha256: await sha256(target),
      });
    }
    manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
    await writeFile(
      join(staging, "manifest.json"),
      `${JSON.stringify({ version: 1, release, files: manifestFiles }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await rename(staging, destination);

    // Maps under `.next/static` are directly web-addressable when
    // productionBrowserSourceMaps is enabled. Preserve their private copy,
    // then remove both the map and the browser hint before an image/deployment
    // can ship. Server maps are not public and remain available to Node.
    const publicRoot = join(build, "static") + sep;
    // Turbopack's emitted map filename is not necessarily the JavaScript
    // filename plus `.map`, so pair-by-name is incorrect. Remove hints from
    // every public JavaScript asset and then remove every public map.
    for (const javascript of staticFiles.filter((path) => path.endsWith(".js"))) {
      const source = await readFile(javascript, "utf8");
      const withoutComment = source.replace(SOURCE_MAP_COMMENT, "");
      if (withoutComment !== source) await writeFile(javascript, withoutComment, "utf8");
    }
    for (const map of maps.filter((path) => path.startsWith(publicRoot))) {
      await rm(map);
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    release,
    destination,
    mapCount: maps.length,
    publicMapCount: maps.filter((path) => path.startsWith(join(build, "static") + sep)).length,
  };
}

async function main() {
  const release =
    process.env.CREATORJOBS_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_RELEASE_SHA;
  const destination =
    process.env.CREATORJOBS_SOURCE_MAP_DIR ||
    join(".private-artifacts", "source-maps", release || "missing-release");
  const result = await collectPrivateSourceMaps({
    buildDirectory: process.env.CREATORJOBS_NEXT_BUILD_DIR || ".next",
    destinationDirectory: destination,
    release,
  });
  process.stdout.write(
    `Collected ${result.mapCount} source maps (${result.publicMapCount} public maps stripped) for ${result.release}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
