const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { formatSarifReport } = require("reactreach/src/report/generateReport");
const { writeNewJson } = require("./artifactWriters");
const { fileSha256 } = require("./preflight");
const { runPublicApplicationSample } = require("./publicApplicationSample");
const {
  manualReviewQueue,
  runPublicApplicationPreflight,
  serializeError,
} = require("./publicApplicationStudy");

function createRunId(date = new Date(), randomBytes = crypto.randomBytes) {
  return `${date.toISOString().replace(/[-:.]/gu, "")}-${randomBytes(4).toString("hex")}`;
}

function initializeDirectories(evaluationRoot, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId) || runId === "." || runId === "..") {
    const error = new Error("Run id contains unsupported characters");
    error.code = "INVALID_RUN_ID";
    throw error;
  }
  const rawDirectory = path.join(evaluationRoot, "results", "raw", "public-applications", runId);
  const processedDirectory = path.join(evaluationRoot, "results", "processed", "public-applications", runId);
  if (fs.existsSync(rawDirectory) || fs.existsSync(processedDirectory)) {
    const error = new Error(`Results already exist for public-application run ${runId}`);
    error.code = "RUN_ALREADY_EXISTS";
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

async function runPublicApplicationStudy(evaluationRoot, options = {}) {
  const preflightRunner = options.preflightRunner ?? runPublicApplicationPreflight;
  const preflight = preflightRunner(evaluationRoot);
  if (!preflight.valid) {
    const error = new Error(`Public-application preflight failed:\n${preflight.errors.map((item) => `- ${item}`).join("\n")}`);
    error.code = "PREFLIGHT_FAILED";
    throw error;
  }
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = options.runId ?? createRunId(new Date(startedAt), options.randomBytes);
  const { rawDirectory, processedDirectory } = initializeDirectories(evaluationRoot, runId);
  const startedPath = path.join(rawDirectory, "run.started.json");
  writeNewJson(startedPath, {
    schemaVersion: "1.0.0",
    runId,
    status: "running",
    protocol: "public-react-application-feasibility",
    startedAt,
    groundTruthAvailable: false,
    precisionRecallF1Computed: false,
    environment: {
      node: process.version,
      npm: preflight.summary.npmVersion,
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? null,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    frozenInputs: preflight.summary,
  });

  const sampleRunner = options.sampleRunner ?? runPublicApplicationSample;
  const projectResults = [];
  const reviewItems = [];
  const rawArtifacts = [artifactRecord(evaluationRoot, startedPath)];
  for (const project of preflight.config.projects) {
    try {
      const sample = await sampleRunner({
        evaluationRoot,
        projectId: project.id,
        timeoutMs: preflight.config.timeoutMs,
      });
      const reportPath = path.join(rawDirectory, `${project.id}.reactreach-report.json`);
      const sarifPath = path.join(rawDirectory, `${project.id}.reactreach.sarif.json`);
      writeNewJson(reportPath, sample.report);
      writeNewJson(sarifPath, formatSarifReport(sample.report));
      rawArtifacts.push(artifactRecord(evaluationRoot, reportPath), artifactRecord(evaluationRoot, sarifPath));
      const queue = manualReviewQueue(project.id, sample.findings);
      reviewItems.push(...queue);
      projectResults.push({
        projectId: project.id,
        repository: project.repository,
        commit: project.commit,
        status: "completed",
        sourceFileCount: sample.report?.summary?.sourceFiles ?? null,
        vulnerablePackageCount: sample.report?.summary?.vulnerablePackages ?? null,
        findingCount: sample.findings.length,
        reachabilityCounts: sample.reachabilityCounts,
        criticalHighManualReviewCount: queue.length,
        durationMs: sample.timings?.totalMs ?? null,
        timings: sample.timings,
        peakRssBytes: sample.peakRssBytes,
        rssSampleCount: sample.rssSampleCount,
        diagnostics: sample.diagnostics,
        crash: null,
        parsingError: null,
      });
    } catch (error) {
      const serialized = serializeError(error);
      const errorPath = path.join(rawDirectory, `${project.id}.error.json`);
      writeNewJson(errorPath, serialized);
      rawArtifacts.push(artifactRecord(evaluationRoot, errorPath));
      projectResults.push({
        projectId: project.id,
        repository: project.repository,
        commit: project.commit,
        status: "failed",
        sourceFileCount: null,
        vulnerablePackageCount: null,
        findingCount: null,
        reachabilityCounts: null,
        criticalHighManualReviewCount: 0,
        durationMs: null,
        timings: null,
        peakRssBytes: null,
        rssSampleCount: null,
        diagnostics: [],
        crash: serialized,
        parsingError: serialized.code === "PARSE_FAILED" ? serialized : null,
      });
    }
  }

  const failedCount = projectResults.filter((result) => result.status === "failed").length;
  const status = failedCount > 0 ? "completed-with-errors" : (reviewItems.length > 0 ? "manual-review-required" : "completed");
  const reviewPath = path.join(processedDirectory, "critical-high-manual-review.json");
  const summaryPath = path.join(processedDirectory, "summary.json");
  writeNewJson(reviewPath, {
    schemaVersion: "1.0.0",
    runId,
    purpose: "Manual inspection of CRITICAL and HIGH findings; this is not a ground-truth classification.",
    groundTruthAvailable: false,
    items: reviewItems,
  });
  writeNewJson(summaryPath, {
    schemaVersion: "1.0.0",
    runId,
    status,
    groundTruthAvailable: false,
    precisionRecallF1Computed: false,
    interpretation: "Feasibility observations only. Counts are analyser outputs and must not be interpreted as accuracy estimates.",
    frozenInputs: preflight.summary,
    projectCount: projectResults.length,
    completedProjectCount: projectResults.length - failedCount,
    failedProjectCount: failedCount,
    criticalHighManualReviewCount: reviewItems.length,
    projects: projectResults,
    limitations: [
      "The applications have no labelled ground truth, so precision, recall and F1 are not computed.",
      "The sample is purposive and small; it does not support population-level generalisation.",
      "npm audit snapshots and derived npm lockfiles freeze dependency evidence for this run but may differ from each project's native package-manager resolution.",
      "Peak RSS is sampled and therefore approximates, rather than proves, the instantaneous maximum.",
    ],
  });
  const processedArtifacts = [reviewPath, summaryPath].map((filePath) => artifactRecord(evaluationRoot, filePath));
  const completedPath = path.join(rawDirectory, "run.completed.json");
  writeNewJson(completedPath, {
    schemaVersion: "1.0.0",
    runId,
    status,
    startedAt,
    completedAt: now().toISOString(),
    rawArtifacts,
    processedArtifacts,
  });
  return { runId, status, rawDirectory, processedDirectory, summaryPath, reviewPath, projectResults };
}

module.exports = { createRunId, initializeDirectories, runPublicApplicationStudy };
