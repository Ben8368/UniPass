import { inspectHardenedArtifact } from "./release-artifact-check.mjs";

const errors = await inspectHardenedArtifact(process.argv[2] ?? "dist");
if (errors.length) {
  console.error(`🚦 Hardened Artifact Audit: RED\n${errors.map((error) => `🔴 ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("🚦 Hardened Artifact Audit: GREEN");
}
