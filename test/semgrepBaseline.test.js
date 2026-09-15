const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  aggregateSemgrepMetrics,
  extractResolvedRulesetMetadata,
  formatSemgrepCsv,
  mapSemgrepProject,
  parseSemgrepVersion,
  projectRelativeFindingPath,
  semgrepScanArguments,
} = require("../src/semgrepBaseline");
const { verifySemgrepRun } = require("../src/semgrepResultVerification");

function fixtureGroundTruth() {
  return {
    projects: [
      { id: "effectiveness-core", root: "corpus/effectiveness-core" },
      { id: "adversarial-holdout", root: "corpus/adversarial-holdout" },
    ],
    scenarios: [
      {
        id: "positive",
        projectId: "effectiveness-core",
        sourceFile: "src/Parent.jsx",
        expected: { contextuallyReachable: true },
        evidence: { lines: [{ start: 1, end: 2 }, { file: "src/Sink.jsx", start: 4, end: 6 }] },
      },
      {
        id: "negative",
        projectId: "effectiveness-core",
        sourceFile: "src/Negative.jsx",
        expected: { contextuallyReachable: false },
        evidence: { lines: [{ start: 1, end: 5 }] },
      },
      {
        id: "holdout-positive",
        projectId: "adversarial-holdout",
        sourceFile: "src/Holdout.jsx",
        expected: { contextuallyReachable: true },
        evidence: { lines: [{ start: 1, end: 3 }] },
      },
    ],
  };
}

function finding(file, start, end, checkId = "javascript.react.example") {
  return {
    check_id: checkId,
    path: file,
    start: { line: start, col: 1, offset: 0 },
    end: { line: end, col: 2, offset: 1 },
    extra: { message: "example", severity: "WARNING", metadata: { category: "security" } },
  };
}

test("Semgrep findings map through frozen cross-file evidence ranges", () => {
  const result = mapSemgrepProject(fixtureGroundTruth(), "effectiveness-core", {
    results: [finding("corpus/effectiveness-core/src/Sink.jsx", 5, 5)],
  }, path.resolve("evaluation"));
  assert.equal(result.rows[0].scenarioId, "positive");
  assert.equal(result.rows[0].outcome, "TP");
  assert.equal(result.rows[0].findingCount, 1);
  assert.equal(result.rows[1].outcome, "TN");
  assert.deepEqual(result.unmatchedFindings, []);
});

test("a Semgrep alert on negative evidence is a false positive", () => {
  const result = mapSemgrepProject(fixtureGroundTruth(), "effectiveness-core", {
    results: [finding("corpus\\effectiveness-core\\src\\Negative.jsx", 3, 3)],
  }, path.resolve("evaluation"));
  assert.deepEqual(result.rows.map((row) => row.outcome), ["FN", "FP"]);
});

test("unmatched Semgrep alerts remain explicit for manual review", () => {
  const result = mapSemgrepProject(fixtureGroundTruth(), "effectiveness-core", {
    results: [finding("corpus/effectiveness-core/src/Outside.jsx", 1, 1)],
  }, path.resolve("evaluation"));
  assert.equal(result.unmatchedFindings.length, 1);
  assert.deepEqual(result.unmatchedFindings[0].matchingScenarioIds, []);
});

test("absolute and repository-relative Semgrep paths normalize to the project", () => {
  const project = { id: "effectiveness-core", root: "corpus/effectiveness-core" };
  const evaluationRoot = path.resolve("evaluation");
  assert.equal(
    projectRelativeFindingPath(path.join(evaluationRoot, project.root, "src", "App.jsx"), project, evaluationRoot),
    "src/App.jsx",
  );
  assert.equal(
    projectRelativeFindingPath("corpus/effectiveness-core/src/App.jsx", project, evaluationRoot),
    "src/App.jsx",
  );
});

test("Semgrep metrics retain separate characterization, holdout, primary and extended groups", () => {
  const metrics = aggregateSemgrepMetrics([
    { cohort: "characterization", rows: [{ expectedPositive: true, outcome: "TP" }, { expectedPositive: false, outcome: "FP" }] },
    { cohort: "holdout", rows: [{ expectedPositive: true, outcome: "FN" }] },
  ]);
  assert.deepEqual(metrics.characterization.confusion, { TP: 1, FP: 1, TN: 0, FN: 0 });
  assert.deepEqual(metrics.holdout.confusion, { TP: 0, FP: 0, TN: 0, FN: 1 });
  assert.deepEqual(metrics.primary.confusion, { TP: 1, FP: 1, TN: 0, FN: 1 });
  assert.deepEqual(metrics.extended.confusion, metrics.primary.confusion);
});

test("the command and serialisers freeze the intended Semgrep invocation", () => {
  const config = {
    ruleset: { id: "p/javascript" },
    scan: { metrics: "off", respectGitIgnore: false, jobs: 1, exclude: ["node_modules"] },
  };
  assert.deepEqual(semgrepScanArguments(config, "corpus/effectiveness-core"), [
    "scan", "--config", "p/javascript", "--json", "--metrics", "off",
    "--disable-version-check", "--oss-only", "--jobs", "1", "--no-git-ignore",
    "--exclude", "node_modules", "corpus/effectiveness-core",
  ]);
  assert.equal(parseSemgrepVersion("1.177.0\n"), "1.177.0");
  const resolved = extractResolvedRulesetMetadata(`
    { Rule.id = ("javascript.rule.two", _); metadata = [("version_id", (JSON.String "v2"))] }
    { Rule.id = ("javascript.rule.one", _); metadata = [("version_id", (JSON.String "v1"))] }
  `, { ruleset: { id: "p/javascript", retrievedOn: "2026-09-13" } });
  assert.deepEqual(resolved.ruleIds, ["javascript.rule.one", "javascript.rule.two"]);
  assert.deepEqual(resolved.registryVersionIds, ["v1", "v2"]);
  assert.equal(resolved.ruleCount, 2);
  assert.match(resolved.catalogSha256, /^[a-f0-9]{64}$/u);
  const csv = formatSemgrepCsv("run", [{
    cohort: "characterization",
    projectId: "effectiveness-core",
    scenarioId: "case",
    expectedPositive: true,
    predictedPositive: true,
    outcome: "TP",
    findingCount: 1,
    ruleIds: ["rule.one"],
    evidenceFiles: ["src/App.jsx"],
  }]);
  assert.match(csv, /run,characterization,effectiveness-core,case,true,true,TP,1,rule\.one,src\/App\.jsx/u);
});

test("the published Semgrep baseline verifies from raw findings to derived metrics", () => {
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = verifySemgrepRun(evaluationRoot, "20260913T162943241Z-c1b5665a");
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.scenarioCount, 54);
  assert.equal(result.findingCount, 23);
});
