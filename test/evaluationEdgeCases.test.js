const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { evaluateScenarios } = require("../src/effectiveness");
const { aggregateMetrics, validateRunId } = require("../src/finalEvaluation");
const { validateSample } = require("../src/performanceCampaign");
const { summarizeMeasuredSamples } = require("../src/performanceProtocol");
const { parseCsv } = require("../src/resultVerification");

const secondary = {
  tierMatch: true,
  sinkRuleMatch: null,
  reasonCodeMatch: true,
  exactMatch: true,
};

test("run ids reject path traversal and path separators", () => {
  for (const runId of ["../escape", "..\\escape", "nested/run", ".", "..", ""]) {
    assert.throws(() => validateRunId(runId), (error) => error.code === "INVALID_RUN_ID");
  }
});

test("evaluateScenarios handles empty scenarios and findings", () => {
  assert.deepEqual(evaluateScenarios([], [], path.resolve("empty-project")), {
    rows: [],
    unexpectedPositiveFindings: [],
    reviewRequired: false,
  });
});

test("aggregateMetrics handles a single cohort", () => {
  const metrics = aggregateMetrics([{
    cohort: "characterization",
    rows: [{ outcome: "TN", expectedPositive: false, secondary }],
    baselineRows: [{ outcome: "FP" }],
  }]);

  assert.deepEqual(Object.keys(metrics), ["characterization", "complete"]);
  assert.deepEqual(metrics.complete.reactReach.confusion, { TP: 0, FP: 0, TN: 1, FN: 0 });
  assert.deepEqual(metrics.complete.baseline.confusion, { TP: 0, FP: 1, TN: 0, FN: 0 });
});

test("parseCsv accepts CRLF records without retaining carriage returns", () => {
  assert.deepEqual(parseCsv("first,second\r\none,two\r\nthree,four\r\n"), [
    ["first", "second"],
    ["one", "two"],
    ["three", "four"],
  ]);
});

test("zero static-analysis time is retained and negative time is rejected before Tukey analysis", () => {
  const benchmarkConfig = {
    measuredRuns: 2,
    retainedTimings: ["staticAnalysisMs"],
    primaryDuration: "staticAnalysisMs",
    outliers: { method: "tukey-1.5-iqr", excludeAutomatically: false },
  };
  const project = { id: "performance-test", targetSourceFiles: 1 };
  const sample = {
    projectId: project.id,
    sourceFileCount: 1,
    peakRssBytes: 1,
    rssSampleCount: 1,
    timings: { staticAnalysisMs: 0 },
    componentCount: 0,
    sinkCount: 0,
    findingCount: 0,
    diagnosticCount: 0,
  };

  assert.doesNotThrow(() => validateSample(sample, project, benchmarkConfig));
  const summary = summarizeMeasuredSamples([
    { ...sample, measurementIndex: 1 },
    { ...sample, measurementIndex: 2, timings: { staticAnalysisMs: 1 } },
  ], benchmarkConfig);
  assert.equal(summary.timings.staticAnalysisMs.min, 0);

  const negative = { ...sample, timings: { staticAnalysisMs: -1 } };
  assert.throws(
    () => validateSample(negative, project, benchmarkConfig),
    (error) => error.code === "INVALID_PERFORMANCE_SAMPLE",
  );
  assert.throws(
    () => summarizeMeasuredSamples([
      { ...negative, measurementIndex: 1 },
      { ...sample, measurementIndex: 2 },
    ], benchmarkConfig),
    /staticAnalysisMs values must be non-negative/u,
  );
});
