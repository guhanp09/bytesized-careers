import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, lstat, readlink, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { transformSync } from "@babel/core";
import { NodeHfs } from "@humanfs/node";
import browserslist from "browserslist";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const floors = {
  "@babel/core": { 7: [7, 29, 6] },
  "@humanfs/node": { 0: [0, 16, 8] },
  "brace-expansion": { 1: [1, 1, 18], 2: [2, 1, 4] },
  browserslist: { 4: [4, 28, 7] },
  "js-yaml": { 4: [4, 3, 2] },
};

function entriesFor(name) {
  return Object.entries(lock.packages).filter(([path]) => path.endsWith(`node_modules/${name}`));
}

for (const [name, supported] of Object.entries(floors)) {
  test(`${name}: every installed copy excludes the audited vulnerable versions`, () => {
    const entries = entriesFor(name);
    assert.ok(entries.length > 0, `${name} disappeared; review its consumers`);
    for (const [path, entry] of entries) {
      assert.match(entry.version, /^\d+\.\d+\.\d+$/);
      const version = entry.version.split(".").map(Number);
      const floor = supported[version[0]];
      assert.ok(floor, `${path}: a new major requires compatibility review`);
      const different = version.findIndex((part, index) => part !== floor[index]);
      assert.ok(different === -1 || version[different] > floor[different], `${path}@${entry.version}`);
      assert.equal(entry.dev, true, `${path} now ships in production; review artifact exposure`);
    }
  });
}

test("Babel does not import an external source map outside the owned package", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "creatorjobs-babel-security-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  await mkdir(project);
  await writeFile(join(project, "package.json"), '{"name":"owned-security-fixture"}');
  await writeFile(join(directory, "outside.map"), JSON.stringify({
    version: 3, sources: ["outside.js"], sourcesContent: ["private-fixture-marker"],
    names: [], mappings: "AAAA",
  }));
  const result = transformSync("const value = 1;\n//# sourceMappingURL=../outside.map", {
    filename: join(project, "input.js"), root: project,
    configFile: false, babelrc: false, sourceMaps: true,
  });
  assert.match(result.code, /const value = 1/);
  assert.ok(!JSON.stringify(result.map).includes("private-fixture-marker"));
  assert.ok(!result.map.sources.includes("outside.js"));
});

test("recursive humanfs copies preserve symlinks instead of copying outside file contents", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "creatorjobs-humanfs-security-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const destination = join(directory, "destination");
  await mkdir(source);
  const outside = join(directory, "outside.txt");
  await writeFile(outside, "owned outside fixture");
  const { symlink } = await import("node:fs/promises");
  await symlink(outside, join(source, "link.txt"));
  await new NodeHfs().copyAll(source, destination);
  assert.equal((await lstat(join(destination, "link.txt"))).isSymbolicLink(), true);
  assert.equal(await readlink(join(destination, "link.txt")), outside);
});

for (const [path] of entriesFor("brace-expansion")) {
  test(`${path}: finite expansion budgets preserve ordinary patterns`, () => {
    const expand = require(join(process.cwd(), path));
    assert.deepEqual(expand("file-{a,b}.js"), ["file-a.js", "file-b.js"]);
    // Small inputs even if the limit regresses: never run an OOM exploit in CI.
    const expanded = expand("{a,b,c,d}{a,b,c,d}{a,b,c,d}", { max: 5, maxLength: 12 });
    assert.ok(expanded.length > 0);
    assert.ok(expanded.length <= 5);
    assert.ok(expanded.reduce((sum, value) => sum + value.length, 0) <= 12);
  });
}

test("YAML merge accounting includes empty mappings and still parses ordinary configuration", () => {
  assert.deepEqual(yaml.load("name: CreatorJobs\nchecks: [lint, build]\n"), {
    name: "CreatorJobs", checks: ["lint", "build"],
  });
  assert.throws(() => yaml.load("empty: &empty {}\nmerged: {<<: [*empty, *empty, *empty]}\n", {
    maxTotalMergeKeys: 2,
  }), /maxTotalMergeKeys/);
});

test("Browserslist tolerates prototype-named custom statistics without polluting objects", () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const stats = JSON.parse('{"__proto__":{"1":5},"constructor":{"1":5},"chrome":{"120":90}}');
  const result = browserslist("> 10% in my stats", { stats, path: false });
  assert.ok(result.includes("chrome 120"));
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});
