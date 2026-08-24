#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { datasetSha256, readJson } = require("../src/groundTruth");
const {
  dependencySetSha256,
  fileSha256,
  installedNpmVersion,
  REQUIRED_REACTREACH_TAG,
  REQUIRED_REACTREACH_VERSION,
  runPreflight,
} = require("../src/preflight");
const { buildMetadata, createFreezeContext } = require("../src/performanceInputs");

const evaluationRoot = path.resolve(__dirname, "..");
const reactReachRoot = path.resolve(evaluationRoot, "..", "ReactReach");
const normalizedRoot = reactReachRoot.replace(/\\/gu, "/");
const git = (...args) => execFileSync(
  "git",
  ["-c", `safe.directory=${normalizedRoot}`, "-C", reactReachRoot, ...args],
  { encoding: "utf8" },
).trim();

if (git("status", "--porcelain=v1") !== "") {
  throw new Error("ReactReach must be committed and clean before evaluation metadata can be refreshed");
}

const reactReachCommit = git("rev-parse", "HEAD");
const taggedCommit = git("rev-list", "-n", "1", REQUIRED_REACTREACH_TAG);
const reactReachVersion = readJson(path.join(reactReachRoot, "package.json")).version;
if (reactReachCommit !== taggedCommit) {
  throw new Error(`ReactReach HEAD must match ${REQUIRED_REACTREACH_TAG}`);
}
if (reactReachVersion !== REQUIRED_REACTREACH_VERSION) {
  throw new Error(`ReactReach package version must be ${REQUIRED_REACTREACH_VERSION}`);
}

const groundTruthPath = path.join(evaluationRoot, "ground-truth", "ground-truth.json");
const configPath = path.join(evaluationRoot, "config", "reactreach-evaluation.config.json");
const catalogPath = path.join(evaluationRoot, "config", "sink-catalog.json");
const groundTruth = readJson(groundTruthPath);
const shared = {
  groundTruthDatasetSha256: datasetSha256(groundTruth),
  groundTruthFileSha256: fileSha256(groundTruthPath),
  evaluationConfigSha256: fileSha256(configPath),
  sinkCatalogSha256: fileSha256(catalogPath),
  nodeVersion: process.version,
  npmVersion: installedNpmVersion(),
  reactReachVersion,
  reactReachTag: REQUIRED_REACTREACH_TAG,
  reactReachCommit,
  reactReachWorkingTreeClean: true,
};

const metadataDirectory = path.join(evaluationRoot, "audit-data");
const metadataPaths = fs.readdirSync(metadataDirectory)
  .filter((name) => name.endsWith(".metadata.json"))
  .map((name) => path.join(metadataDirectory, name));

for (const metadataPath of metadataPaths) {
  const current = readJson(metadataPath);
  if (current.purpose === "performance") continue;
  const metadata = { ...current, ...shared };
  const packageLockPath = path.resolve(evaluationRoot, metadata.packageLock);
  const auditDataPath = path.resolve(evaluationRoot, metadata.auditData);
  metadata.packageLockSha256 = fileSha256(packageLockPath);
  metadata.dependencySetSha256 = dependencySetSha256(readJson(packageLockPath));
  metadata.auditDataSha256 = fileSha256(auditDataPath);
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`${metadata.projectId}: ${shared.reactReachCommit}`);
}

const performanceContext = createFreezeContext(evaluationRoot, {
  preflightRunner: (root) => runPreflight(root, { requireEvaluationClean: false }),
});
const performanceCapturedAt = new Date().toISOString();
for (const project of performanceContext.config.projects) {
  const metadata = buildMetadata(evaluationRoot, performanceContext, project, performanceCapturedAt);
  const metadataPath = path.join(metadataDirectory, `${project.id}.metadata.json`);
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`${metadata.projectId}: ${metadata.sourceTreeSha256}`);
}

console.log(`Ground-truth dataset SHA-256: ${shared.groundTruthDatasetSha256}`);
