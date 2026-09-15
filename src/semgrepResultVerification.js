const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { outcome } = require("./effectiveness");
const { datasetSha256, readJson } = require("./groundTruth");
const { aggregateSemgrepMetrics, validateRunId } = require("./semgrepBaseline");

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function verifyArtifactRecords(evaluationRoot, records, errors) {
  for (const record of records ?? []) {
    const artifactPath = path.resolve(evaluationRoot, record.path ?? "");
    if (!isWithin(evaluationRoot, artifactPath)) {
      errors.push(`Artifact path leaves the evaluation repository: ${record.path}`);
      continue;
    }
    if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
      errors.push(`Missing artifact: ${record.path}`);
      continue;
    }
    if (fs.statSync(artifactPath).size !== record.bytes) errors.push(`Byte count differs: ${record.path}`);
    if (fileSha256(artifactPath) !== record.sha256) errors.push(`SHA-256 differs: ${record.path}`);
  }
}

function catalogSha256(metadata) {
  const catalog = {
    rulesetId: metadata.rulesetId,
    retrievedOn: metadata.retrievedOn,
    ruleCount: metadata.ruleCount,
    ruleIds: metadata.ruleIds,
    registryVersionIds: metadata.registryVersionIds,
  };
  return crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}

function verifySemgrepRun(evaluationRoot, runId) {
  validateRunId(runId);
  const errors = [];
  const rawDirectory = path.join(evaluationRoot, "results", "raw", "semgrep", runId);
  const processedDirectory = path.join(evaluationRoot, "results", "processed", "semgrep", runId);
  const manifestPath = path.join(rawDirectory, "run.completed.json");
  const summaryPath = path.join(processedDirectory, "summary.json");
  const scenariosPath = path.join(processedDirectory, "scenario-results.json");
  const mappingPath = path.join(processedDirectory, "finding-mapping.json");
  const metadataPath = path.join(rawDirectory, "resolved-ruleset-metadata.json");
  for (const requiredPath of [manifestPath, summaryPath, scenariosPath, mappingPath, metadataPath]) {
    if (!fs.existsSync(requiredPath)) errors.push(`Missing required file: ${path.relative(evaluationRoot, requiredPath)}`);
  }
  if (errors.length > 0) return { valid: false, errors, runId };

  const manifest = readJson(manifestPath);
  const summary = readJson(summaryPath);
  const scenarioResults = readJson(scenariosPath);
  const mapping = readJson(mappingPath);
  const rulesetMetadata = readJson(metadataPath);
  const groundTruth = readJson(path.join(evaluationRoot, "ground-truth", "ground-truth.json"));
  const config = readJson(path.join(evaluationRoot, "config", "semgrep-baseline.json"));

  if (manifest.runId !== runId || summary.runId !== runId || scenarioResults.runId !== runId || mapping.runId !== runId) {
    errors.push("Run identifiers are inconsistent");
  }
  if (manifest.status !== "completed" || summary.status !== "completed") errors.push("Semgrep run is not completed");
  if (summary.tool.version !== config.tool.version || manifest.tool.version !== config.tool.version) {
    errors.push("Semgrep version differs from the frozen configuration");
  }
  if (summary.ruleset.id !== config.ruleset.id || rulesetMetadata.rulesetId !== config.ruleset.id) {
    errors.push("Semgrep ruleset differs from the frozen configuration");
  }
  if (rulesetMetadata.ruleCount !== rulesetMetadata.ruleIds.length) errors.push("Resolved rule count is inconsistent");
  if (rulesetMetadata.catalogSha256 !== catalogSha256(rulesetMetadata)) errors.push("Resolved rule catalogue hash is inconsistent");
  if (summary.ruleset.catalogSha256 !== rulesetMetadata.catalogSha256) errors.push("Summary rule catalogue hash is inconsistent");
  if (summary.groundTruthSha256 !== datasetSha256(groundTruth)) errors.push("Ground-truth hash is inconsistent");

  verifyArtifactRecords(evaluationRoot, manifest.rawArtifacts, errors);
  verifyArtifactRecords(evaluationRoot, manifest.processedArtifacts, errors);

  const expectedScenarios = new Map(groundTruth.scenarios.map((scenario) => [scenario.id, scenario]));
  const rows = scenarioResults.rows ?? [];
  const rowIds = new Set(rows.map((row) => row.scenarioId));
  if (rows.length !== groundTruth.scenarios.length || rowIds.size !== groundTruth.scenarios.length) {
    errors.push("Scenario result cardinality differs from the ground truth");
  }
  for (const row of rows) {
    const scenario = expectedScenarios.get(row.scenarioId);
    if (!scenario) {
      errors.push(`Unknown scenario result: ${row.scenarioId}`);
      continue;
    }
    if (row.projectId !== scenario.projectId) errors.push(`Project differs for scenario ${row.scenarioId}`);
    if (row.expectedPositive !== scenario.expected.contextuallyReachable) {
      errors.push(`Expected label differs for scenario ${row.scenarioId}`);
    }
    if (row.predictedPositive !== (row.findingCount > 0)) errors.push(`Prediction differs for scenario ${row.scenarioId}`);
    if (row.outcome !== outcome(row.expectedPositive, row.predictedPositive)) errors.push(`Outcome differs for scenario ${row.scenarioId}`);
  }
  for (const scenarioId of expectedScenarios.keys()) {
    if (!rowIds.has(scenarioId)) errors.push(`Missing scenario result: ${scenarioId}`);
  }

  const projectResults = Object.entries(mapping.projects.reduce((byProject, project) => {
    byProject[project.projectId] = project;
    return byProject;
  }, {})).map(([projectId]) => ({
    projectId,
    cohort: rows.find((row) => row.projectId === projectId)?.cohort,
    rows: rows.filter((row) => row.projectId === projectId),
  }));
  const derivedMetrics = aggregateSemgrepMetrics(projectResults);
  if (JSON.stringify(derivedMetrics) !== JSON.stringify(summary.groups)) errors.push("Derived metrics differ from the summary");

  const mappedFindings = mapping.projects.flatMap((project) => project.findings ?? []);
  const unmatchedFindings = mapping.projects.flatMap((project) => project.unmatchedFindings ?? []);
  const ambiguousFindings = mapping.projects.flatMap((project) => project.ambiguousFindings ?? []);
  if (mappedFindings.length !== summary.findingCount) errors.push("Finding count differs from the mapping");
  if (unmatchedFindings.length !== summary.unmatchedFindingCount) errors.push("Unmatched finding count differs from the mapping");
  if (ambiguousFindings.length !== summary.ambiguousFindingCount) errors.push("Ambiguous finding count differs from the mapping");

  const rawFindingCount = groundTruth.projects.reduce((total, project) => {
    const rawPath = path.join(rawDirectory, `${project.id}.semgrep.json`);
    if (!fs.existsSync(rawPath)) {
      errors.push(`Missing raw Semgrep JSON for ${project.id}`);
      return total;
    }
    const raw = readJson(rawPath);
    return total + (Array.isArray(raw.results) ? raw.results.length : 0);
  }, 0);
  if (rawFindingCount !== summary.findingCount) errors.push("Raw Semgrep finding count differs from the summary");

  return {
    valid: errors.length === 0,
    errors,
    runId,
    status: summary.status,
    scenarioCount: rows.length,
    findingCount: summary.findingCount,
    metrics: summary.groups,
  };
}

module.exports = { catalogSha256, fileSha256, verifyArtifactRecords, verifySemgrepRun };
