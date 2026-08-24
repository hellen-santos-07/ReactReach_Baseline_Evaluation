const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRunId, csvEscape, validateRunId } = require("./finalEvaluation");
const { fileSha256 } = require("./preflight");
const { loadPerformanceConfig } = require("./performanceProjects");
const { runPerformancePreflight } = require("./performanceInputs");
const {
  evaluateThresholds,
  loadPerformanceBenchmarkConfig,
  summarizeMeasuredSamples,
} = require("./performanceProtocol");
const { runIsolatedPerformanceSample } = require("./performanceSample");

const SAMPLE_CSV_COLUMNS = Object.freeze([
  "runId", "projectId", "targetSourceFiles", "measurementIndex",
  "auditMs", "parseMs", "dependenciesMs", "componentsMs", "sinksMs",
  "graphMs", "reachabilityMs", "staticAnalysisMs", "reportMs", "totalMs",
  "peakRssBytes", "peakRssMiB", "rssSampleCount", "sourceFileCount",
  "componentCount", "sinkCount", "findingCount", "diagnosticCount", "outlier",
]);

function writeNewText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { encoding: "utf8", flag: "wx" });
}

function writeNewJson(filePath, value) {
  writeNewText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function initializePerformanceRun(resultsRoot, runId) {
  validateRunId(runId);
  const rawDirectory = path.join(resultsRoot, "raw", "performance", runId);
  const processedDirectory = path.join(resultsRoot, "processed", "performance", runId);
  if (fs.existsSync(rawDirectory) || fs.existsSync(processedDirectory)) {
    const error = new Error(`Performance results already exist for run ${runId}`);
    error.code = "PERFORMANCE_RUN_ALREADY_EXISTS";
    throw error;
  }
  fs.mkdirSync(rawDirectory, { recursive: true });
  fs.mkdirSync(processedDirectory, { recursive: true });
  return { rawDirectory, processedDirectory };
}

function artifactRecord(evaluationRoot, filePath) {
  return {
    path: path.relative(evaluationRoot, filePath).replace(/\\/gu, "/"),
    bytes: fs.statSync(filePath).size,
    sha256: fileSha256(filePath),
  };
}

function validateSample(sample, project, benchmarkConfig) {
  const errors = [];
  if (sample?.projectId !== project.id) errors.push(`sample projectId is ${sample?.projectId}`);
  if (sample?.sourceFileCount !== project.targetSourceFiles) errors.push(`sourceFileCount is ${sample?.sourceFileCount}`);
  if (!Number.isFinite(sample?.peakRssBytes) || sample.peakRssBytes <= 0) errors.push("peakRssBytes is invalid");
  if (!Number.isInteger(sample?.rssSampleCount) || sample.rssSampleCount <= 0) errors.push("rssSampleCount is invalid");
  for (const field of benchmarkConfig.retainedTimings) {
    if (!Number.isFinite(sample?.timings?.[field]) || sample.timings[field] < 0) errors.push(`${field} is invalid`);
  }
  for (const field of ["componentCount", "sinkCount", "findingCount", "diagnosticCount"]) {
    if (!Number.isInteger(sample?.[field]) || sample[field] < 0) errors.push(`${field} is invalid`);
  }
  if (errors.length > 0) {
    const error = new Error(`Invalid performance sample for ${project.id}:\n${errors.map((item) => `- ${item}`).join("\n")}`);
    error.code = "INVALID_PERFORMANCE_SAMPLE";
    throw error;
  }
}

function sampleCsvRows(runId, projects, outlierIndexesByProject) {
  return projects.flatMap((project) => {
    const outliers = new Set(outlierIndexesByProject.get(project.projectId));
    return project.samples.map((sample) => ({
      runId,
      projectId: project.projectId,
      targetSourceFiles: project.targetSourceFiles,
      measurementIndex: sample.measurementIndex,
      ...sample.timings,
      peakRssBytes: sample.peakRssBytes,
      peakRssMiB: sample.peakRssBytes / (1024 ** 2),
      rssSampleCount: sample.rssSampleCount,
      sourceFileCount: sample.sourceFileCount,
      componentCount: sample.componentCount,
      sinkCount: sample.sinkCount,
      findingCount: sample.findingCount,
      diagnosticCount: sample.diagnosticCount,
      outlier: outliers.has(sample.measurementIndex),
    }));
  });
}

function formatSampleCsv(records) {
  const lines = [SAMPLE_CSV_COLUMNS.join(",")];
  for (const record of records) lines.push(SAMPLE_CSV_COLUMNS.map((column) => csvEscape(record[column])).join(","));
  return `${lines.join("\n")}\n`;
}

function consistencySummary(samples, field) {
  const values = [...new Set(samples.map((sample) => sample[field]))];
  return { stable: values.length === 1, values };
}

function failurePayload(runId, startedAt, failedAt, error) {
  return {
    schemaVersion: "1.0.0",
    runId,
    status: "failed",
    startedAt,
    failedAt,
    error: {
      name: error.name,
      code: error.code ?? null,
      message: error.message,
      stack: error.stack ?? null,
    },
  };
}

async function runPerformanceCampaign(evaluationRoot, options = {}) {
  const preflightRunner = options.preflightRunner ?? runPerformancePreflight;
  const preflight = preflightRunner(evaluationRoot);
  if (!preflight.valid) {
    const error = new Error(`Performance preflight failed:\n${preflight.errors.map((item) => `- ${item}`).join("\n")}`);
    error.code = "PERFORMANCE_PREFLIGHT_FAILED";
    throw error;
  }
  const benchmarkConfig = options.benchmarkConfig ?? loadPerformanceBenchmarkConfig(evaluationRoot);
  const performanceConfig = loadPerformanceConfig(evaluationRoot);
  const sampleExecutor = options.sampleExecutor ?? runIsolatedPerformanceSample;
  const now = options.now ?? (() => new Date());
  const started = now();
  const startedAt = started.toISOString();
  const runId = options.runId ?? createRunId(started, options.randomBytes);
  const resultsRoot = options.resultsRoot ?? path.join(evaluationRoot, "results");
  const { rawDirectory, processedDirectory } = initializePerformanceRun(resultsRoot, runId);
  const startedManifestPath = path.join(rawDirectory, "run.started.json");
  writeNewJson(startedManifestPath, {
    schemaVersion: "1.0.0",
    runId,
    status: "running",
    startedAt,
    protocol: "RQ04-performance",
    benchmarkConfig,
    frozenInputs: preflight.summary,
    environment: {
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model.trim() ?? null,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
  });

  try {
    const rawArtifacts = [artifactRecord(evaluationRoot, startedManifestPath)];
    const projectRuns = [];
    for (const project of performanceConfig.projects) {
      for (let warmupIndex = 1; warmupIndex <= benchmarkConfig.warmupRuns; warmupIndex++) {
        const sample = await sampleExecutor(evaluationRoot, project.id, {
          rssSampleIntervalMs: benchmarkConfig.rssSampleIntervalMs,
          timeoutMs: benchmarkConfig.sampleTimeoutMs,
          phase: "warmup",
          warmupIndex,
        });
        validateSample(sample, project, benchmarkConfig);
      }
      const warmupPath = path.join(rawDirectory, "warmups", `${project.id}.completed.json`);
      writeNewJson(warmupPath, {
        schemaVersion: "1.0.0",
        runId,
        projectId: project.id,
        completedWarmups: benchmarkConfig.warmupRuns,
        measurementsRetained: false,
        completedAt: now().toISOString(),
      });
      rawArtifacts.push(artifactRecord(evaluationRoot, warmupPath));

      const samples = [];
      for (let measurementIndex = 1; measurementIndex <= benchmarkConfig.measuredRuns; measurementIndex++) {
        const sample = await sampleExecutor(evaluationRoot, project.id, {
          rssSampleIntervalMs: benchmarkConfig.rssSampleIntervalMs,
          timeoutMs: benchmarkConfig.sampleTimeoutMs,
          phase: "measurement",
          measurementIndex,
        });
        validateSample(sample, project, benchmarkConfig);
        const recorded = { ...sample, runId, phase: "measurement", measurementIndex };
        samples.push(recorded);
        const samplePath = path.join(rawDirectory, "samples", project.id, `measurement-${String(measurementIndex).padStart(3, "0")}.json`);
        writeNewJson(samplePath, recorded);
        rawArtifacts.push(artifactRecord(evaluationRoot, samplePath));
      }
      projectRuns.push({ projectId: project.id, targetSourceFiles: project.targetSourceFiles, samples });
    }

    const projectSummaries = projectRuns.map((project) => ({
      projectId: project.projectId,
      targetSourceFiles: project.targetSourceFiles,
      statistics: summarizeMeasuredSamples(project.samples, benchmarkConfig),
      consistency: {
        sourceFileCount: consistencySummary(project.samples, "sourceFileCount"),
        componentCount: consistencySummary(project.samples, "componentCount"),
        sinkCount: consistencySummary(project.samples, "sinkCount"),
        findingCount: consistencySummary(project.samples, "findingCount"),
      },
      diagnosticSampleCount: project.samples.filter((sample) => sample.diagnosticCount > 0).length,
    }));
    const thresholdEvaluation = evaluateThresholds(projectSummaries, benchmarkConfig);
    const reviewRequired = projectSummaries.some((project) =>
      Object.values(project.consistency).some((item) => !item.stable) || project.diagnosticSampleCount > 0);
    const outlierIndexesByProject = new Map(projectSummaries.map((project) => [
      project.projectId,
      project.statistics.outliers.measurementIndexes,
    ]));
    const csvRecords = sampleCsvRows(runId, projectRuns, outlierIndexesByProject);
    const samplesJsonPath = path.join(processedDirectory, "samples.json");
    const samplesCsvPath = path.join(processedDirectory, "samples.csv");
    const statisticsPath = path.join(processedDirectory, "statistics.json");
    writeNewJson(samplesJsonPath, { schemaVersion: "1.0.0", runId, samples: projectRuns.flatMap((project) => project.samples) });
    writeNewText(samplesCsvPath, formatSampleCsv(csvRecords));
    writeNewJson(statisticsPath, {
      schemaVersion: "1.0.0",
      runId,
      status: reviewRequired ? "review-required" : "completed",
      benchmarkConfig,
      frozenInputs: preflight.summary,
      projects: projectSummaries,
      thresholds: thresholdEvaluation,
      reviewRequired,
      outlierPolicy: "Tukey 1.5 IQR flags are reported but no sample is automatically excluded.",
    });
    const processedArtifacts = [samplesJsonPath, samplesCsvPath, statisticsPath]
      .map((filePath) => artifactRecord(evaluationRoot, filePath));
    const completedManifestPath = path.join(rawDirectory, "run.completed.json");
    writeNewJson(completedManifestPath, {
      schemaVersion: "1.0.0",
      runId,
      status: reviewRequired ? "review-required" : "completed",
      startedAt,
      completedAt: now().toISOString(),
      reviewRequired,
      thresholdsPassed: thresholdEvaluation.passed,
      rawArtifacts,
      processedArtifacts,
    });
    return {
      runId,
      status: reviewRequired ? "review-required" : "completed",
      reviewRequired,
      rawDirectory,
      processedDirectory,
      statisticsPath,
      completedManifestPath,
      projects: projectSummaries,
      thresholds: thresholdEvaluation,
    };
  } catch (error) {
    const failurePath = path.join(rawDirectory, "failure.json");
    try {
      writeNewJson(failurePath, failurePayload(runId, startedAt, now().toISOString(), error));
    } catch (writeError) {
      error.failureWriteError = writeError;
    }
    error.runId = runId;
    error.rawDirectory = rawDirectory;
    throw error;
  }
}

module.exports = {
  SAMPLE_CSV_COLUMNS,
  consistencySummary,
  formatSampleCsv,
  initializePerformanceRun,
  runPerformanceCampaign,
  sampleCsvRows,
  validateSample,
};
