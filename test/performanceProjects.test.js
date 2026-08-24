const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { dependencySetSha256, fileSha256 } = require("../src/preflight");
const {
  benignSource,
  buildProjectPlan,
  loadPerformanceConfig,
  validateAllGeneratedProjects,
} = require("../src/performanceProjects");
const { runPerformancePreflight } = require("../src/performanceInputs");
const { readJson } = require("../src/groundTruth");

const evaluationRoot = path.resolve(__dirname, "..");
const reactReachRoot = path.resolve(evaluationRoot, "..", "ReactReach");
const normalizedReactReachRoot = reactReachRoot.replace(/\\/gu, "/");
const reactReachDirty = execFileSync(
  "git",
  ["-c", `safe.directory=${normalizedReactReachRoot}`, "-C", reactReachRoot, "status", "--porcelain=v1"],
  { encoding: "utf8" },
).trim() !== "";
const normalizedEvaluationRoot = evaluationRoot.replace(/\\/gu, "/");
const evaluationDirty = execFileSync(
  "git",
  ["-c", `safe.directory=${normalizedEvaluationRoot}`, "-C", evaluationRoot, "status", "--porcelain=v1"],
  { encoding: "utf8" },
).trim() !== "";

test("performance plans preserve one 33-file core and reach 50, 250 and 500 source files", () => {
  const config = loadPerformanceConfig(evaluationRoot);
  assert.deepEqual(config.projects.map((project) => project.targetSourceFiles), [50, 250, 500]);
  const plans = config.projects.map((project) => buildProjectPlan(evaluationRoot, config, project));
  assert.deepEqual(plans.map((plan) => plan.manifest.core.sourceFileCount), [33, 33, 33]);
  assert.deepEqual(plans.map((plan) => plan.manifest.benign.sourceFileCount), [17, 217, 467]);
  assert.deepEqual(plans.map((plan) => plan.manifest.sourceFileCount), [50, 250, 500]);
  assert.equal(new Set(plans.map((plan) => plan.manifest.core.sourceTreeSha256)).size, 1);
});

test("the benign fixture template is deterministic and contains no imports or configured sinks", () => {
  const first = benignSource(7);
  assert.equal(first, benignSource(7));
  assert.match(first, /function Benign0007/u);
  assert.doesNotMatch(first, /\bimport\b|dangerouslySetInnerHTML|\beval\s*\(|new Function|insertAdjacentHTML/u);
});

test("generated performance projects match every deterministic source and project file", () => {
  const result = validateAllGeneratedProjects(evaluationRoot);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.projects.map((project) => project.summary.sourceFileCount), [50, 250, 500]);
  assert.deepEqual(result.projects.map((project) => project.summary.sourceTreeSha256), [
    "dbdbc1867a69a61dfd1b7bc9af7b06b60914cb17b0eec6ec15974d4eb3c0e539",
    "9d11381021594d23c7d5f44a1849ede15f3a02aac7d7f5973b99b9a4245647fe",
    "41214a29c8b0573eae898ebe96074ddaae61843d349658d526bacec8b0c50612",
  ]);
});

test("performance package locks and reused audits have one frozen dependency and audit fingerprint", () => {
  const config = loadPerformanceConfig(evaluationRoot);
  const dependencyHashes = new Set();
  const auditHashes = new Set();
  for (const project of config.projects) {
    const projectRoot = path.join(evaluationRoot, config.generatedRoot, project.id);
    dependencyHashes.add(dependencySetSha256(readJson(path.join(projectRoot, "package-lock.json"))));
    auditHashes.add(fileSha256(path.join(evaluationRoot, "audit-data", `${project.id}.npm-audit.json`)));
    const metadata = readJson(path.join(evaluationRoot, "audit-data", `${project.id}.metadata.json`));
    assert.equal(metadata.sourceFileCount, project.targetSourceFiles);
    assert.equal(metadata.fixedScenarioCount, 30);
    assert.equal(metadata.auditSnapshotOrigin, "reused-equivalent-dependency-set");
  }
  assert.deepEqual([...dependencyHashes], ["733020bbeaa7bc7f8c527a3d50164c378763edb7a16f880eff3786facef5360f"]);
  assert.deepEqual([...auditHashes], ["44252063881e2fe2e9225716ebc881bed0e8961b6b7ac3791605504acba41a4c"]);
  assert.equal(fs.readFileSync(path.join(evaluationRoot, "audit-data", "performance-500.npm-audit.json")).equals(
    fs.readFileSync(path.join(evaluationRoot, "audit-data", "effectiveness-core.npm-audit.json")),
  ), true);
});

test("performance preflight verifies frozen inputs without scanning a generated project", {
  skip: reactReachDirty || evaluationDirty ? "Both repositories must be committed before the real preflight" : false,
}, () => {
  const result = runPerformancePreflight(evaluationRoot);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.summary.projects.map((project) => project.sourceFileCount), [50, 250, 500]);
  const metadata = readJson(path.join(evaluationRoot, "audit-data", "performance-500.metadata.json"));
  assert.equal(result.summary.reactReachCommit, metadata.reactReachCommit);
  assert.equal(result.summary.reactReachVersion, "1.0.0");
  assert.equal(result.summary.reactReachTag, "v1.0.0");
  assert.match(result.summary.evaluationCommit, /^[0-9a-f]{40}$/u);
});
