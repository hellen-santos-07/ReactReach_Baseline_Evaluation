const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runPerformanceCampaign } = require("../src/performanceCampaign");
const {
  describe,
  evaluateThresholds,
  loadPerformanceBenchmarkConfig,
  nearestRank,
  outlierIndexes,
  sampleStandardDeviation,
  summarizeMeasuredSamples,
} = require("../src/performanceProtocol");
const { runPerformanceSampleProcess } = require("../src/performanceSampleProcess");
const { verifyPerformanceRun } = require("../src/performanceResultVerification");

const evaluationRoot = path.resolve(__dirname, "..");

function preflightFixture() {
  return {
    valid: true,
    errors: [],
    summary: {
      reactReachCommit: "test-commit",
      benchmarkConfigSha256: "test-benchmark-config",
      projects: [],
    },
  };
}

function fakeTimings(value) {
  return {
    auditMs: 0.001,
    parseMs: value,
    dependenciesMs: value,
    componentsMs: value,
    sinksMs: value,
    graphMs: value,
    reachabilityMs: value,
    staticAnalysisMs: value * 6,
    reportMs: value,
    totalMs: value * 7,
  };
}

function sourceCount(projectId) {
  return Number(projectId.split("-")[1]);
}

test("descriptive statistics use sample deviation and nearest-rank p95", () => {
  const values = Array.from({ length: 30 }, (_, index) => index + 1);
  const statistics = describe(values);
  assert.equal(statistics.count, 30);
  assert.equal(statistics.min, 1);
  assert.equal(statistics.max, 30);
  assert.equal(statistics.mean, 15.5);
  assert.equal(statistics.median, 15.5);
  assert.equal(statistics.p95, 29);
  assert.ok(Math.abs(statistics.sampleStandardDeviation - Math.sqrt(77.5)) < 1e-12);
  assert.equal(nearestRank(values, 0.95), 29);
  assert.equal(sampleStandardDeviation([5]), null);
});

test("Tukey outliers are flagged without changing the measured sample set", () => {
  const values = [...Array.from({ length: 29 }, (_, index) => index + 1), 1000];
  const result = outlierIndexes(values);
  assert.deepEqual(result.indexes, [29]);
  const config = loadPerformanceBenchmarkConfig(evaluationRoot);
  const samples = values.map((value, index) => ({
    measurementIndex: index + 1,
    timings: fakeTimings(value),
    peakRssBytes: 100 * 1024 * 1024,
  }));
  const summary = summarizeMeasuredSamples(samples, config);
  assert.equal(summary.sampleCount, 30);
  assert.deepEqual(summary.outliers.measurementIndexes, [30]);
  assert.equal(summary.outliers.excludedAutomatically, false);
  assert.equal(summary.timings.staticAnalysisMs.count, 30);
});

test("threshold evaluation uses performance-500 p95 duration and maximum peak RSS", () => {
  const config = loadPerformanceBenchmarkConfig(evaluationRoot);
  const projects = [{
    projectId: "performance-500",
    statistics: {
      timings: { staticAnalysisMs: { p95: 29999 } },
      peakRssBytes: { max: 536870911 },
    },
  }];
  assert.equal(evaluateThresholds(projects, config).passed, true);
  projects[0].statistics.timings.staticAnalysisMs.p95 = 30000;
  assert.equal(evaluateThresholds(projects, config).passed, false);
});

test("sample-process coordinator combines interval and worker RSS without a real scan", async () => {
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      setImmediate(() => {
        this.emit("message", {
          type: "scan-completed",
          rssBytes: 500,
          result: {
            projectId: "performance-50",
            timings: fakeTimings(1),
            sourceFileCount: 50,
            componentCount: 50,
            sinkCount: 15,
            findingCount: 33,
            diagnosticCount: 0,
          },
        });
        this.emit("exit", 0);
      });
    }
  }
  const result = await runPerformanceSampleProcess({
    evaluationRoot,
    projectId: "performance-50",
    rssSampleIntervalMs: 1,
    WorkerClass: FakeWorker,
    rssReader: () => 100,
  });
  assert.equal(result.peakRssBytes, 500);
  assert.ok(result.rssSampleCount >= 2);
});

test("campaign runner schedules 99 simulated scans and preserves 90 measured samples", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-performance-success-"));
  const resultsRoot = path.join(temporaryRoot, "results");
  const calls = [];
  const measuredByProject = new Map();
  const sampleExecutor = async (_root, projectId, options) => {
    calls.push({ projectId, ...options });
    const measurementIndex = options.measurementIndex ?? 0;
    if (options.phase === "measurement") measuredByProject.set(projectId, (measuredByProject.get(projectId) ?? 0) + 1);
    const value = options.phase === "measurement" ? measurementIndex : 1;
    return {
      schemaVersion: "1.0.0",
      projectId,
      startedAt: "2026-08-19T00:00:00.000Z",
      completedAt: "2026-08-19T00:00:00.001Z",
      timings: fakeTimings(value),
      peakRssBytes: (80 + (sourceCount(projectId) / 10)) * 1024 * 1024,
      rssSampleCount: 5,
      sourceFileCount: sourceCount(projectId),
      componentCount: sourceCount(projectId),
      sinkCount: 15,
      findingCount: 33,
      diagnosticCount: 0,
      diagnostics: [],
      stageRss: [],
    };
  };

  try {
    const result = await runPerformanceCampaign(evaluationRoot, {
      runId: "test-performance-success",
      resultsRoot,
      preflightRunner: preflightFixture,
      sampleExecutor,
      now: () => new Date("2026-08-19T00:00:00.000Z"),
    });
    assert.equal(calls.length, 99);
    assert.equal(calls.filter((call) => call.phase === "warmup").length, 9);
    assert.equal(calls.filter((call) => call.phase === "measurement").length, 90);
    assert.deepEqual([...measuredByProject.values()], [30, 30, 30]);
    assert.equal(result.status, "completed");
    assert.equal(result.thresholds.passed, true);
    assert.deepEqual(result.projects.map((project) => project.statistics.sampleCount), [30, 30, 30]);
    assert.equal(result.projects[2].statistics.timings.staticAnalysisMs.p95, 174);
    assert.equal(result.projects[2].statistics.peakRssMiB.max, 130);

    const rawSamples = fs.readdirSync(path.join(result.rawDirectory, "samples", "performance-500"));
    assert.equal(rawSamples.length, 30);
    const csvLines = fs.readFileSync(path.join(result.processedDirectory, "samples.csv"), "utf8").trimEnd().split("\n");
    assert.equal(csvLines.length, 91);
    const completion = JSON.parse(fs.readFileSync(result.completedManifestPath, "utf8"));
    assert.equal(completion.rawArtifacts.length, 94);
    assert.equal(completion.processedArtifacts.length, 3);
    const verification = verifyPerformanceRun(evaluationRoot, result.runId, {
      resultsRoot,
      preflightRunner: preflightFixture,
    });
    assert.equal(verification.valid, true, verification.errors.join("\n"));
    assert.equal(verification.sampleCount, 90);
    assert.equal(verification.currentInputsMatch, true);

    const verificationWithGeneratedOutputs = verifyPerformanceRun(evaluationRoot, result.runId, {
      resultsRoot,
      preflightRunner: () => ({ ...preflightFixture(), valid: false, errors: ["working tree is dirty"] }),
    });
    assert.equal(verificationWithGeneratedOutputs.valid, true, verificationWithGeneratedOutputs.errors.join("\n"));
    assert.equal(verificationWithGeneratedOutputs.currentInputsMatch, true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("campaign runner preserves a failure before producing processed metrics", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-performance-failure-"));
  const resultsRoot = path.join(temporaryRoot, "results");
  let calls = 0;
  const sampleExecutor = async (_root, projectId) => {
    calls++;
    if (calls === 2) throw new Error("simulated performance sample failure");
    return {
      projectId,
      timings: fakeTimings(1),
      peakRssBytes: 100 * 1024 * 1024,
      rssSampleCount: 5,
      sourceFileCount: sourceCount(projectId),
      componentCount: sourceCount(projectId),
      sinkCount: 15,
      findingCount: 33,
      diagnosticCount: 0,
    };
  };
  try {
    await assert.rejects(
      runPerformanceCampaign(evaluationRoot, {
        runId: "test-performance-failure",
        resultsRoot,
        preflightRunner: preflightFixture,
        sampleExecutor,
        now: () => new Date("2026-08-19T00:00:00.000Z"),
      }),
      /simulated performance sample failure/u,
    );
    const rawDirectory = path.join(resultsRoot, "raw", "performance", "test-performance-failure");
    const failure = JSON.parse(fs.readFileSync(path.join(rawDirectory, "failure.json"), "utf8"));
    assert.equal(failure.status, "failed");
    assert.equal(failure.error.message, "simulated performance sample failure");
    assert.equal(fs.existsSync(path.join(resultsRoot, "processed", "performance", "test-performance-failure", "statistics.json")), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
