const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { canonicalize, readJson } = require("../src/groundTruth");
const {
  dependencySetSha256,
  loadEvaluationConfig,
  runPreflight,
} = require("../src/preflight");

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

test("both effectiveness projects have an equivalent frozen dependency set", () => {
  const characterization = readJson(path.join(evaluationRoot, "corpus", "effectiveness-core", "package-lock.json"));
  const holdout = readJson(path.join(evaluationRoot, "corpus", "adversarial-holdout", "package-lock.json"));
  assert.equal(dependencySetSha256(characterization), dependencySetSha256(holdout));
  assert.equal(
    dependencySetSha256(characterization),
    "733020bbeaa7bc7f8c527a3d50164c378763edb7a16f880eff3786facef5360f",
  );
});

test("the supplemental robustness project freezes two distinct vulnerable packages", () => {
  const packageLock = readJson(path.join(evaluationRoot, "corpus", "robustness-multipackage", "package-lock.json"));
  const audit = readJson(path.join(evaluationRoot, "audit-data", "robustness-multipackage.npm-audit.json"));
  assert.equal(packageLock.packages["node_modules/dompurify"].version, "2.4.0");
  assert.equal(packageLock.packages["node_modules/serialize-javascript"].version, "2.1.1");
  assert.equal(audit.vulnerabilities.dompurify.severity, "critical");
  assert.equal(audit.vulnerabilities["serialize-javascript"].severity, "high");
  assert.ok(audit.vulnerabilities.dompurify.via.some((advisory) => /XSS|Cross-site Scripting/u.test(advisory.title)));
  assert.ok(audit.vulnerabilities["serialize-javascript"].via.some((advisory) => /RCE|serialization/u.test(advisory.title)));
  assert.equal(
    dependencySetSha256(packageLock),
    "37e33902403f74c5838d62ba2ead67e5ed7b354c3800c66b71c0fba790d7c36f",
  );
});

test("the loaded ReactReach configuration equals the frozen explicit config", () => {
  const loaded = loadEvaluationConfig(evaluationRoot);
  const frozen = readJson(path.join(evaluationRoot, "config", "reactreach-evaluation.config.json"));
  assert.equal(canonicalize(loaded), canonicalize(frozen));
});

test("evaluation preflight verifies every frozen input without running a corpus", {
  skip: reactReachDirty || evaluationDirty ? "Both repositories must be committed before the real preflight" : false,
}, () => {
  const result = runPreflight(evaluationRoot);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(
    { projects: result.summary.projects, scenarios: result.summary.scenarios },
    { projects: 3, scenarios: 54 },
  );
  assert.equal(
    result.summary.groundTruthDatasetSha256,
    "68951480a3987ef7314631d41304076807fbd220e11e1b67910cb0e8ea70aae1",
  );
  const metadata = readJson(path.join(evaluationRoot, "audit-data", "robustness-multipackage.metadata.json"));
  assert.equal(result.summary.reactReachCommit, metadata.reactReachCommit);
  assert.match(result.summary.evaluationCommit, /^[0-9a-f]{40}$/u);
});
