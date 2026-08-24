const fs = require("node:fs");
const path = require("node:path");
const { aggregateMetrics, CSV_COLUMNS, validateRunId } = require("./finalEvaluation");
const { canonicalize, datasetSha256, readJson } = require("./groundTruth");
const { fileSha256 } = require("./preflight");

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || record.length > 0) {
    record.push(field.replace(/\r$/u, ""));
    records.push(record);
  }
  return records;
}

function checkArtifact(errors, evaluationRoot, resultsRoot, artifact) {
  if (!artifact || typeof artifact.path !== "string") {
    errors.push("Manifest contains an invalid artifact record");
    return null;
  }
  const filePath = path.resolve(evaluationRoot, artifact.path);
  if (!isWithin(resultsRoot, filePath)) {
    errors.push(`Artifact escapes the results directory: ${artifact.path}`);
    return null;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    errors.push(`Artifact does not exist: ${artifact.path}`);
    return null;
  }
  const size = fs.statSync(filePath).size;
  if (size !== artifact.bytes) errors.push(`Artifact byte count differs: ${artifact.path}`);
  const hash = fileSha256(filePath);
  if (hash !== artifact.sha256) errors.push(`Artifact SHA-256 differs: ${artifact.path}`);
  return filePath;
}

function expectedScenarioIds(groundTruth) {
  return [...groundTruth.scenarios.map((scenario) => scenario.id)].sort();
}

function actualScenarioIds(records) {
  return [...records.map((scenario) => scenario.scenarioId)].sort();
}

function metricsFromScenarioRecords(records) {
  const cohorts = [...new Set(records.map((record) => record.cohort))];
  const projectResults = cohorts.map((cohort) => {
    const selected = records.filter((record) => record.cohort === cohort);
    return {
      cohort,
      rows: selected.map((record) => ({
        outcome: record.reactReach.outcome,
        expectedPositive: record.expected.contextuallyReachable,
        secondary: record.reactReach.secondary,
      })),
      baselineRows: selected.map((record) => ({ outcome: record.baseline.outcome })),
    };
  });
  return aggregateMetrics(projectResults);
}

function groundTruthByDatasetHash(evaluationRoot, expectedHash) {
  const candidates = [
    path.join(evaluationRoot, "ground-truth", "ground-truth.json"),
    path.join(evaluationRoot, "ground-truth", "history", `${expectedHash}.json`),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const groundTruth = readJson(candidate);
    if (datasetSha256(groundTruth) === expectedHash) return groundTruth;
  }
  return null;
}

function verifyEvaluationRun(evaluationRoot, runId, options = {}) {
  validateRunId(runId);
  const errors = [];
  const resultsRoot = path.resolve(options.resultsRoot ?? path.join(evaluationRoot, "results"));
  const rawDirectory = path.join(resultsRoot, "raw", runId);
  const processedDirectory = path.join(resultsRoot, "processed", runId);
  const completedPath = path.join(rawDirectory, "run.completed.json");
  const failurePath = path.join(rawDirectory, "failure.json");
  if (!fs.existsSync(completedPath)) errors.push("Completed-run manifest does not exist");
  if (fs.existsSync(failurePath)) errors.push("Run contains a technical failure record");
  if (errors.length > 0) return { valid: false, errors, runId };

  const completed = readJson(completedPath);
  if (completed.runId !== runId) errors.push("Completed-run manifest uses a different run id");
  if (!["completed", "review-required"].includes(completed.status)) errors.push(`Unsupported completed status: ${completed.status}`);
  const artifacts = [...(completed.rawArtifacts ?? []), ...(completed.processedArtifacts ?? [])];
  for (const artifact of artifacts) checkArtifact(errors, evaluationRoot, resultsRoot, artifact);

  const requiredRawNames = ["run.started.json"];
  const requiredProcessedNames = ["scenario-results.json", "scenario-results.csv", "summary.json"];
  for (const name of requiredRawNames) {
    if (!fs.existsSync(path.join(rawDirectory, name))) errors.push(`Required raw artifact is missing: ${name}`);
  }
  for (const name of requiredProcessedNames) {
    if (!fs.existsSync(path.join(processedDirectory, name))) errors.push(`Required processed artifact is missing: ${name}`);
  }
  if (errors.length > 0) return { valid: false, errors, runId };

  const started = readJson(path.join(rawDirectory, "run.started.json"));
  const recordedDatasetHash = started.frozenInputs?.groundTruthDatasetSha256;
  const groundTruth = groundTruthByDatasetHash(evaluationRoot, recordedDatasetHash);
  if (!groundTruth) {
    errors.push(`No current or historical ground truth matches dataset hash ${recordedDatasetHash}`);
    return { valid: false, errors, runId };
  }
  for (const project of groundTruth.projects) {
    for (const suffix of ["reactreach-report.json", "reactreach.sarif.json"]) {
      const name = `${project.id}.${suffix}`;
      if (!fs.existsSync(path.join(rawDirectory, name))) errors.push(`Required raw artifact is missing: ${name}`);
    }
  }
  if (errors.length > 0) return { valid: false, errors, runId };

  const summary = readJson(path.join(processedDirectory, "summary.json"));
  const scenarioOutput = readJson(path.join(processedDirectory, "scenario-results.json"));
  const datasetHash = datasetSha256(groundTruth);
  for (const [label, value] of [
    ["Started-run manifest", started.runId],
    ["Summary", summary.runId],
    ["Scenario JSON", scenarioOutput.runId],
  ]) {
    if (value !== runId) errors.push(`${label} uses a different run id`);
  }
  if (completed.status !== summary.status) errors.push("Completion manifest and summary have different statuses");
  if (completed.reviewRequired !== summary.reviewRequired) errors.push("Completion manifest and summary disagree about review-required status");
  if (started.frozenInputs?.groundTruthDatasetSha256 !== datasetHash) errors.push("Started-run dataset hash differs from the current frozen ground truth");
  if (summary.frozenInputs?.groundTruthDatasetSha256 !== datasetHash) errors.push("Summary dataset hash differs from the current frozen ground truth");
  if (scenarioOutput.groundTruthDatasetSha256 !== datasetHash) errors.push("Scenario JSON dataset hash differs from the current frozen ground truth");

  const scenarioRecords = scenarioOutput.scenarios ?? [];
  if (canonicalize(actualScenarioIds(scenarioRecords)) !== canonicalize(expectedScenarioIds(groundTruth))) {
    errors.push("Scenario JSON ids differ from the frozen ground truth");
  }
  const calculatedMetrics = metricsFromScenarioRecords(scenarioRecords);
  if (canonicalize(calculatedMetrics) !== canonicalize(summary.groups)) {
    errors.push("Summary metrics do not reproduce from the per-scenario JSON");
  }

  let csvRecords = [];
  try {
    csvRecords = parseCsv(fs.readFileSync(path.join(processedDirectory, "scenario-results.csv"), "utf8"));
  } catch (error) {
    errors.push(`Scenario CSV is invalid: ${error.message}`);
  }
  if (csvRecords.length > 0) {
    if (canonicalize(csvRecords[0]) !== canonicalize([...CSV_COLUMNS])) errors.push("Scenario CSV header differs from the frozen columns");
    const rows = csvRecords.slice(1);
    if (rows.length !== scenarioRecords.length) errors.push("Scenario CSV row count differs from the scenario JSON");
    const scenarioIdIndex = CSV_COLUMNS.indexOf("scenarioId");
    if (canonicalize(rows.map((row) => row[scenarioIdIndex]).sort()) !== canonicalize(actualScenarioIds(scenarioRecords))) {
      errors.push("Scenario CSV ids differ from the scenario JSON");
    }
  }

  for (const projectId of groundTruth.projects.map((project) => project.id)) {
    const report = readJson(path.join(rawDirectory, `${projectId}.reactreach-report.json`));
    const sarif = readJson(path.join(rawDirectory, `${projectId}.reactreach.sarif.json`));
    if (report.summary?.findings !== report.findings?.length) errors.push(`${projectId} report finding count is inconsistent`);
    if (sarif.version !== "2.1.0") errors.push(`${projectId} SARIF version is not 2.1.0`);
    if (sarif.runs?.[0]?.results?.length !== report.findings?.length) errors.push(`${projectId} SARIF and JSON finding counts differ`);
  }

  return {
    valid: errors.length === 0,
    errors,
    runId,
    status: summary.status,
    scenarioCount: scenarioRecords.length,
    metrics: summary.groups,
    reviewRequired: summary.reviewRequired,
  };
}

module.exports = {
  parseCsv,
  verifyEvaluationRun,
};
