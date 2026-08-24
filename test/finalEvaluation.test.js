const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  aggregateMetrics,
  createRunId,
  formatCsv,
  runFinalEvaluation,
} = require("../src/finalEvaluation");
const { parseCsv, verifyEvaluationRun } = require("../src/resultVerification");
const { datasetSha256, readJson } = require("../src/groundTruth");

const evaluationRoot = path.resolve(__dirname, "..");

function preflightFixture() {
  const groundTruth = readJson(path.join(evaluationRoot, "ground-truth", "ground-truth.json"));
  return {
    valid: true,
    errors: [],
    config: {},
    summary: {
      projects: 3,
      scenarios: 54,
      groundTruthDatasetSha256: datasetSha256(groundTruth),
      groundTruthFileSha256: "file-sha256",
      evaluationConfigSha256: "config-sha256",
      sinkCatalogSha256: "catalog-sha256",
      reactReachCommit: "commit",
    },
  };
}

function emptyReport(projectRoot, config = {}) {
  return {
    projectPath: projectRoot,
    scannedAt: "2026-08-17T00:00:00.000Z",
    configuration: config,
    diagnostics: [],
    timings: { totalMs: 1 },
    summary: {
      vulnerablePackages: 1,
      sourceFiles: 0,
      components: 0,
      cogNodes: 0,
      cogEdges: 0,
      sinks: 0,
      findings: 0,
    },
    packages: [],
    analyzedFiles: [],
    findings: [],
  };
}

function fakeScanner(projectRoot, config) {
  return Promise.resolve({
    findings: [],
    diagnostics: [],
    timings: { totalMs: 1 },
    report: emptyReport(projectRoot, config),
  });
}

test("run ids encode the UTC instant and an injected random suffix", () => {
  const runId = createRunId(
    new Date("2026-08-17T12:34:56.789Z"),
    () => Buffer.from("01020304", "hex"),
  );
  assert.equal(runId, "20260817T123456789Z-01020304");
});

test("cohort aggregation preserves the primary study and separates supplemental robustness", () => {
  const projectResults = [
    {
      cohort: "characterization",
      rows: [{ outcome: "TP", expectedPositive: true, secondary: { tierMatch: true, sinkRuleMatch: true, reasonCodeMatch: true, exactMatch: true } }],
      baselineRows: [{ outcome: "TP" }],
    },
    {
      cohort: "holdout",
      rows: [{ outcome: "TN", expectedPositive: false, secondary: { tierMatch: true, sinkRuleMatch: null, reasonCodeMatch: true, exactMatch: true } }],
      baselineRows: [{ outcome: "FP" }],
    },
    {
      cohort: "robustness",
      rows: [{ outcome: "TP", expectedPositive: true, secondary: { tierMatch: true, sinkRuleMatch: true, reasonCodeMatch: true, exactMatch: true } }],
      baselineRows: [{ outcome: "TP" }],
    },
  ];
  const metrics = aggregateMetrics(projectResults);
  assert.deepEqual(metrics.characterization.reactReach.confusion, { TP: 1, FP: 0, TN: 0, FN: 0 });
  assert.deepEqual(metrics.holdout.reactReach.confusion, { TP: 0, FP: 0, TN: 1, FN: 0 });
  assert.deepEqual(metrics.robustness.reactReach.confusion, { TP: 1, FP: 0, TN: 0, FN: 0 });
  assert.deepEqual(metrics.primary.reactReach.confusion, { TP: 1, FP: 0, TN: 1, FN: 0 });
  assert.deepEqual(metrics.extended.reactReach.confusion, { TP: 2, FP: 0, TN: 1, FN: 0 });
  assert.deepEqual(metrics.extended.baseline.confusion, { TP: 2, FP: 1, TN: 0, FN: 0 });
});

test("CSV output escapes commas, quotes and line breaks", () => {
  const csv = formatCsv([{ first: "plain", second: "a,\"b\"\nline" }], ["first", "second"]);
  assert.equal(csv, 'first,second\nplain,"a,""b""\nline"\n');
  assert.deepEqual(parseCsv(csv), [["first", "second"], ["plain", 'a,"b"\nline']]);
});

test("the final runner writes all raw projects before deriving the 54 processed rows", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-evaluation-success-"));
  const resultsRoot = path.join(temporaryRoot, "results");
  const runId = "test-success";
  let scanCount = 0;
  const scanner = async (projectRoot, config) => {
    scanCount++;
    if (scanCount === 3) {
      const firstRaw = path.join(resultsRoot, "raw", runId, "effectiveness-core.reactreach-report.json");
      const firstSarif = path.join(resultsRoot, "raw", runId, "effectiveness-core.reactreach.sarif.json");
      const secondRaw = path.join(resultsRoot, "raw", runId, "adversarial-holdout.reactreach-report.json");
      assert.equal(fs.existsSync(firstRaw), true);
      assert.equal(fs.existsSync(firstSarif), true);
      assert.equal(fs.existsSync(secondRaw), true);
    }
    return fakeScanner(projectRoot, config);
  };

  try {
    const result = await runFinalEvaluation(evaluationRoot, {
      runId,
      resultsRoot,
      scanner,
      preflightRunner: preflightFixture,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });
    assert.equal(scanCount, 3);
    assert.equal(result.status, "completed");
    assert.equal(result.reviewRequired, false);
    assert.equal(result.metrics.characterization.scenarioCount, 30);
    assert.equal(result.metrics.holdout.scenarioCount, 12);
    assert.equal(result.metrics.robustness.scenarioCount, 12);
    assert.equal(result.metrics.primary.scenarioCount, 42);
    assert.equal(result.metrics.extended.scenarioCount, 54);
    assert.deepEqual(result.metrics.primary.reactReach.confusion, { TP: 0, FP: 0, TN: 21, FN: 21 });
    assert.deepEqual(result.metrics.extended.reactReach.confusion, { TP: 0, FP: 0, TN: 27, FN: 27 });
    assert.deepEqual(result.metrics.extended.baseline.confusion, { TP: 27, FP: 27, TN: 0, FN: 0 });

    const scenarioOutput = JSON.parse(fs.readFileSync(result.scenarioJsonPath, "utf8"));
    assert.equal(scenarioOutput.scenarios.length, 54);
    const csvLines = fs.readFileSync(result.scenarioCsvPath, "utf8").trimEnd().split("\n");
    assert.equal(csvLines.length, 55);
    const completion = JSON.parse(fs.readFileSync(result.completedManifestPath, "utf8"));
    assert.equal(completion.rawArtifacts.length, 7);
    assert.equal(completion.processedArtifacts.length, 3);
    const verification = verifyEvaluationRun(evaluationRoot, runId, { resultsRoot });
    assert.equal(verification.valid, true, verification.errors.join("\n"));
    assert.equal(verification.scenarioCount, 54);

    await assert.rejects(
      runFinalEvaluation(evaluationRoot, {
        runId,
        resultsRoot,
        scanner,
        preflightRunner: preflightFixture,
      }),
      (error) => error.code === "RUN_ALREADY_EXISTS",
    );
    assert.equal(scanCount, 3);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("a failed scan preserves its failure record and any earlier raw output", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-evaluation-failure-"));
  const resultsRoot = path.join(temporaryRoot, "results");
  const runId = "test-failure";
  let scanCount = 0;
  const scanner = async (projectRoot, config) => {
    scanCount++;
    if (scanCount === 2) throw new Error("simulated holdout scanner failure");
    return fakeScanner(projectRoot, config);
  };

  try {
    await assert.rejects(
      runFinalEvaluation(evaluationRoot, {
        runId,
        resultsRoot,
        scanner,
        preflightRunner: preflightFixture,
        now: () => new Date("2026-08-17T12:00:00.000Z"),
      }),
      /simulated holdout scanner failure/u,
    );
    const rawDirectory = path.join(resultsRoot, "raw", runId);
    assert.equal(fs.existsSync(path.join(rawDirectory, "effectiveness-core.reactreach-report.json")), true);
    const failure = JSON.parse(fs.readFileSync(path.join(rawDirectory, "failure.json"), "utf8"));
    assert.equal(failure.status, "failed");
    assert.equal(failure.error.message, "simulated holdout scanner failure");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
