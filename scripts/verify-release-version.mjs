import { readFile } from "node:fs/promises";

const tagName = process.argv[2];
if (!tagName) {
  throw new Error("Usage: node scripts/verify-release-version.mjs <tag-name>");
}

const [packageJson, manifest] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../public/manifest.json", import.meta.url), "utf8").then(JSON.parse),
]);

const expectedTag = `v${packageJson.version}`;
if (tagName !== expectedTag) {
  throw new Error(
    `Release tag must be ${expectedTag} to match package.json, received ${tagName}.`,
  );
}

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Version mismatch: package.json is ${packageJson.version}, while manifest.json is ${manifest.version}.`,
  );
}

console.log(`Verified release version ${packageJson.version}.`);