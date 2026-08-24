const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { formatSarifReport } = require("reactreach/src/report/generateReport");
const {
  calculateMetrics,
  calculateSecondaryMetrics,
  evaluatePresenceBaseline,
  evaluateScenarios,
  scanWithFrozenAudit,
} = require("./effectiveness");
const { readJson, validateGroundTruth } = require("./groundTruth");
const { fileSha256, runPreflight } = require("./preflight");

const COHORT_BY_PROJECT_ID = Object.freeze({
  "effectiveness-core": "characterization",
  "adversarial-holdout": "holdout",
  "robustness-multipackage": "robustness",
});

const CSV_COLUMNS = Object.freeze([
  "runId",
  "cohort",
  "projectId",
  "scenarioId",
  "packageName",
  "sourceFile",
  "component",
  "expectedPositive",
  "expectedTier",
  "predictedPositive",
  "predictedTier",
  "outcome",
  "tierMatch",
  "expectedSinkRuleId",
  "predictedSinkRuleId",
  "sinkRuleMatch",
  "expectedReasonCode",
  "predictedReasonCode",
  "reasonCodeMatch",
  "exactSecondaryMatch",
  "findingCount",
  "positiveFindingCount",
  "baselinePredictedPositive",
  "baselineOutcome",
]);

function createRunId(date = new Date(), randomBytes = crypto.randomBytes) {
  const timestamp = date.toISOString().replace(/[-:.]/gu, "");
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
}

function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId) || runId === "." || runId === "..") {
    const error = new Error("Run id must contain only letters, numbers, dots, underscores and hyphens");
    error.code = "INVALID_RUN_ID";
    throw error;
  }
}

function writeNewText(filePath, value) {
  fs.writeFileSync(filePath, value, { encoding: "utf8", flag: "wx" });
}

function writeNewJson(filePath, value) {
  writeNewText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function initializeRunDirectories(resultsRoot, runId) {
  validateRunId(runId);
  const rawDirectory = path.join(resultsRoot, "raw", runId);
  const processedDirectory = path.join(resultsRoot, "processed", runId);
  if (fs.existsSync(rawDirectory) || fs.existsSync(processedDirectory)) {
    const error = new Error(`Results already exist for run ${runId}`);
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

function groupMetrics(rows, baselineRows) {
  return {
    scenarioCount: rows.length,
    positiveCount: rows.filter((row) => row.expectedPositive).length,
    negativeCount: rows.filter((row) => !row.expectedPositive).length,
    reactReach: {
      ...calculateMetrics(rows),
      secondary: calculateSecondaryMetrics(rows),
    },
    baseline: calculateMetrics(baselineRows),
  };
}

function aggregateMetrics(projectResults) {
  const groups = {};
  for (const cohort of ["characterization", "holdout", "robustness"]) {
    const selected = projectResults.filter((project) => project.cohort === cohort);
    if (selected.length === 0) continue;
    groups[cohort] = groupMetrics(
      selected.flatMap((project) => project.rows),
      selected.flatMap((project) => project.baselineRows),
    );
  }
  const primary = projectResults.filter((project) => ["characterization", "holdout"].includes(project.cohort));
  if (groups.robustness) {
    groups.primary = groupMetrics(
      primary.flatMap((project) => project.rows),
      primary.flatMap((project) => project.baselineRows),
    );
    groups.extended = groupMetrics(
      projectResults.flatMap((project) => project.rows),
      projectResults.flatMap((project) => project.baselineRows),
    );
  } else {
    groups.complete = groupMetrics(
      projectResults.flatMap((project) => project.rows),
      projectResults.flatMap((project) => project.baselineRows),
    );
  }
  return groups;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function scenarioCsvRecords(runId, projectResults, scenariosById) {
  return projectResults.flatMap((project) => project.rows.map((row, index) => {
    const scenario = scenariosById.get(row.scenarioId);
    const baseline = project.baselineRows[index];
    return {
      runId,
      cohort: project.cohort,
      projectId: row.projectId,
      scenarioId: row.scenarioId,
      packageName: row.packageName,
      sourceFile: row.sourceFile,
      component: row.component,
      expectedPositive: row.expectedPositive,
      expectedTier: row.expectedTier,
      predictedPositive: row.predictedPositive,
      predictedTier: row.predictedTier,
      outcome: row.outcome,
      tierMatch: row.secondary.tierMatch,
      expectedSinkRuleId: scenario.matching.sinkRuleId,
      predictedSinkRuleId: row.sinkRuleId,
      sinkRuleMatch: row.secondary.sinkRuleMatch,
      expectedReasonCode: scenario.expected.reasonCode,
      predictedReasonCode: row.reasonCode,
      reasonCodeMatch: row.secondary.reasonCodeMatch,
      exactSecondaryMatch: row.secondary.exactMatch,
      findingCount: row.findingCount,
      positiveFindingCount: row.positiveFindingCount,
      baselinePredictedPositive: baseline.predictedPositive,
      baselineOutcome: baseline.outcome,
    };
  }));
}

function formatCsv(records, columns = CSV_COLUMNS) {
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((column) => csvEscape(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function scenarioJsonRecords(projectResults, scenariosById) {
  return projectResults.flatMap((project) => project.rows.map((row, index) => {
    const scenario = scenariosById.get(row.scenarioId);
    return {
      cohort: project.cohort,
      projectId: row.projectId,
      scenarioId: row.scenarioId,
      packageName: row.packageName,
      sourceFile: row.sourceFile,
      component: row.component,
      expected: {
        contextuallyReachable: row.expectedPositive,
        tier: row.expectedTier,
        sinkRuleId: scenario.matching.sinkRuleId,
        reasonCode: scenario.expected.reasonCode,
      },
      reactReach: {
        predictedPositive: row.predictedPositive,
        predictedTier: row.predictedTier,
        predictedTiers: row.predictedTiers,
        outcome: row.outcome,
        secondary: row.secondary,
        findingCount: row.findingCount,
        positiveFindingCount: row.positiveFindingCount,
        findings: row.findings,
      },
      baseline: project.baselineRows[index],
    };
  }));
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

async function runFinalEvaluation(evaluationRoot, options = {}) {
  const preflightRunner = options.preflightRunner ?? runPreflight;
  const preflight = preflightRunner(evaluationRoot);
  if (!preflight.valid) {
    const error = new Error(`Evaluation preflight failed:\n${preflight.errors.map((item) => `- ${item}`).join("\n")}`);
    error.code = "PREFLIGHT_FAILED";
    throw error;
  }

  const now = options.now ?? (() => new Date());
  const started = now();
  const startedAt = started.toISOString();
  const runId = options.runId ?? createRunId(started, options.randomBytes);
  const resultsRoot = options.resultsRoot ?? path.join(evaluationRoot, "results");
  const { rawDirectory, processedDirectory } = initializeRunDirectories(resultsRoot, runId);
  const startedManifestPath = path.join(rawDirectory, "run.started.json");
  writeNewJson(startedManifestPath, {
    schemaVersion: "1.0.0",
    runId,
    status: "running",
    startedAt,
    protocol: "RQ04-contextual-reachability-effectiveness",
    environment: {
      node: process.version,
      npm: preflight.summary.npmVersion ?? null,
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? null,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    frozenInputs: preflight.summary,
  });

  try {
    const groundTruthPath = path.join(evaluationRoot, "ground-truth", "ground-truth.json");
    const groundTruth = readJson(groundTruthPath);
    const validation = validateGroundTruth(groundTruth, { evaluationRoot });
    if (!validation.valid) {
      const error = new Error(`Final ground truth is invalid:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
      error.code = "INVALID_FINAL_GROUND_TRUTH";
      throw error;
    }

    const unknownProjects = groundTruth.projects.filter((project) => !COHORT_BY_PROJECT_ID[project.id]);
    if (unknownProjects.length > 0) {
      const error = new Error(`No cohort is defined for project(s): ${unknownProjects.map((project) => project.id).join(", ")}`);
      error.code = "UNDEFINED_PROJECT_COHORT";
      throw error;
    }

    const projectResults = [];
    const rawArtifacts = [artifactRecord(evaluationRoot, startedManifestPath)];
    for (const project of groundTruth.projects) {
      const projectRoot = path.resolve(evaluationRoot, project.root);
      const auditData = readJson(path.join(evaluationRoot, "audit-data", `${project.id}.npm-audit.json`));
      const scan = await scanWithFrozenAudit(projectRoot, auditData, {
        config: preflight.config,
        logger: options.logger ?? null,
        scanner: options.scanner,
      });
      if (!scan.report || !Array.isArray(scan.findings)) {
        const error = new Error(`ReactReach returned an incomplete result for ${project.id}`);
        error.code = "INCOMPLETE_REACTREACH_RESULT";
        throw error;
      }

      const reportPath = path.join(rawDirectory, `${project.id}.reactreach-report.json`);
      const sarifPath = path.join(rawDirectory, `${project.id}.reactreach.sarif.json`);
      writeNewJson(reportPath, scan.report);
      writeNewJson(sarifPath, formatSarifReport(scan.report));
      rawArtifacts.push(artifactRecord(evaluationRoot, reportPath), artifactRecord(evaluationRoot, sarifPath));

      const scenarios = groundTruth.scenarios.filter((scenario) => scenario.projectId === project.id);
      projectResults.push({
        projectId: project.id,
        cohort: COHORT_BY_PROJECT_ID[project.id],
        projectRoot,
        scenarios,
        findings: scan.findings,
        vulnerablePackages: scan.vulnerablePackages,
        timings: scan.timings ?? {},
        diagnostics: scan.diagnostics ?? [],
      });
    }

    // Matching and metric derivation intentionally start only after every raw
    // ReactReach JSON/SARIF output has been written successfully.
    for (const project of projectResults) {
      const evaluation = evaluateScenarios(project.scenarios, project.findings, project.projectRoot);
      project.rows = evaluation.rows;
      project.baselineRows = evaluatePresenceBaseline(project.scenarios, project.vulnerablePackages);
      project.unexpectedPositiveFindings = evaluation.unexpectedPositiveFindings;
      project.reviewRequired = evaluation.reviewRequired;
    }

    const scenariosById = new Map(groundTruth.scenarios.map((scenario) => [scenario.id, scenario]));
    const metrics = aggregateMetrics(projectResults);
    const reviewRequired = projectResults.some((project) => project.reviewRequired);
    const scenarioRecords = scenarioJsonRecords(projectResults, scenariosById);
    const csvRecords = scenarioCsvRecords(runId, projectResults, scenariosById);
    const unexpectedPositiveFindings = projectResults.flatMap((project) => project.unexpectedPositiveFindings.map((finding) => ({
      cohort: project.cohort,
      projectId: project.projectId,
      ...finding,
    })));

    const scenarioJsonPath = path.join(processedDirectory, "scenario-results.json");
    const scenarioCsvPath = path.join(processedDirectory, "scenario-results.csv");
    const summaryPath = path.join(processedDirectory, "summary.json");
    writeNewJson(scenarioJsonPath, {
      schemaVersion: "1.0.0",
      runId,
      groundTruthDatasetSha256: preflight.summary.groundTruthDatasetSha256,
      scenarios: scenarioRecords,
    });
    writeNewText(scenarioCsvPath, formatCsv(csvRecords));
    writeNewJson(summaryPath, {
      schemaVersion: "1.0.0",
      runId,
      status: reviewRequired ? "review-required" : "completed",
      semantics: {
        target: "contextual-reachability",
        negativeMeaning: "no-demonstrated-path",
        runtimeExploitationMeasured: false,
      },
      classificationPolicy: groundTruth.classificationPolicy,
      frozenInputs: preflight.summary,
      groups: metrics,
      projects: projectResults.map((project) => ({
        projectId: project.projectId,
        cohort: project.cohort,
        scenarioCount: project.rows.length,
        findingCount: project.findings.length,
        timings: project.timings,
        diagnostics: project.diagnostics,
        reviewRequired: project.reviewRequired,
        unexpectedPositiveFindingCount: project.unexpectedPositiveFindings.length,
      })),
      reviewRequired,
      unexpectedPositiveFindings,
    });

    const processedArtifacts = [scenarioJsonPath, scenarioCsvPath, summaryPath]
      .map((filePath) => artifactRecord(evaluationRoot, filePath));
    const completedAt = now().toISOString();
    const completedManifestPath = path.join(rawDirectory, "run.completed.json");
    writeNewJson(completedManifestPath, {
      schemaVersion: "1.0.0",
      runId,
      status: reviewRequired ? "review-required" : "completed",
      startedAt,
      completedAt,
      reviewRequired,
      rawArtifacts,
      processedArtifacts,
    });

    return {
      runId,
      status: reviewRequired ? "review-required" : "completed",
      reviewRequired,
      rawDirectory,
      processedDirectory,
      summaryPath,
      scenarioJsonPath,
      scenarioCsvPath,
      completedManifestPath,
      metrics,
      unexpectedPositiveFindings,
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
  COHORT_BY_PROJECT_ID,
  CSV_COLUMNS,
  aggregateMetrics,
  createRunId,
  csvEscape,
  formatCsv,
  initializeRunDirectories,
  runFinalEvaluation,
  scenarioCsvRecords,
  scenarioJsonRecords,
  validateRunId,
};
