const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  derivedProjectSummaries,
  verifyPerformanceRun,
} = require("../src/performanceResultVerification");

test("derived performance summaries reproduce timing and consistency evidence", () => {
  const performanceConfig = { projects: [{ id: "performance-test", targetSourceFiles: 1 }] };
  const benchmarkConfig = {
    measuredRuns: 2,
    retainedTimings: ["staticAnalysisMs"],
    primaryDuration: "staticAnalysisMs",
    outliers: { method: "tukey-1.5-iqr", excludeAutomatically: false },
  };
  const samples = [1, 2].map((value, index) => ({
    projectId: "performance-test",
    measurementIndex: index + 1,
    timings: { staticAnalysisMs: value },
    peakRssBytes: 1024 + index,
    sourceFileCount: 1,
    componentCount: 1,
    sinkCount: 1,
    findingCount: 1,
    diagnosticCount: 0,
  }));

  const [summary] = derivedProjectSummaries(samples, performanceConfig, benchmarkConfig);
  assert.equal(summary.statistics.timings.staticAnalysisMs.mean, 1.5);
  assert.deepEqual(summary.consistency.sourceFileCount, { stable: true, values: [1] });
  assert.equal(summary.diagnosticSampleCount, 0);
});

test("verifyPerformanceRun reports a missing completion manifest", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-performance-verify-"));
  try {
    const result = verifyPerformanceRun(temporaryRoot, "missing-run", {
      resultsRoot: path.join(temporaryRoot, "results"),
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["Completed-run manifest does not exist"]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
