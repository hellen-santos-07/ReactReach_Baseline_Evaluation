const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { calculateMetrics, outcome } = require("./effectiveness");
const { readJson, validateGroundTruth } = require("./groundTruth");
const { writeNewJson, writeNewText } = require("./artifactWriters");

const COHORT_BY_PROJECT_ID = Object.freeze({
  "effectiveness-core": "characterization",
  "adversarial-holdout": "holdout",
  "robustness-multipackage": "robustness",
});

const SEMGREP_CSV_COLUMNS = Object.freeze([
  "runId",
  "cohort",
  "projectId",
  "scenarioId",
  "expectedPositive",
  "predictedPositive",
  "outcome",
  "findingCount",
  "ruleIds",
  "evidenceFiles",
]);

function normalizePath(value) {
  return String(value).replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function projectRelativeFindingPath(findingPath, project, evaluationRoot) {
  if (typeof findingPath !== "string" || findingPath.length === 0) {
    throw new Error("Semgrep finding has no path");
  }
  const projectRoot = path.resolve(evaluationRoot, project.root);
  if (path.isAbsolute(findingPath)) {
    const relative = path.relative(projectRoot, findingPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Semgrep finding is outside project ${project.id}: ${findingPath}`);
    }
    return normalizePath(relative);
  }

  const normalized = normalizePath(findingPath);
  const normalizedRoot = normalizePath(project.root).replace(/\/$/u, "");
  if (normalized === normalizedRoot) return "";
  if (normalized.startsWith(`${normalizedRoot}/`)) return normalized.slice(normalizedRoot.length + 1);
  return normalized;
}

function scenarioEvidenceRanges(scenario) {
  return (scenario.evidence?.lines ?? []).map((range) => ({
    file: normalizePath(range.file ?? scenario.sourceFile),
    start: range.start,
    end: range.end,
  }));
}

function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart <= secondEnd && secondStart <= firstEnd;
}

function compactFinding(finding, relativePath) {
  return {
    checkId: finding.check_id,
    path: relativePath,
    start: finding.start,
    end: finding.end,
    message: finding.extra?.message ?? null,
    severity: finding.extra?.severity ?? null,
    category: finding.extra?.metadata?.category ?? null,
    confidence: finding.extra?.metadata?.confidence ?? null,
    cwe: finding.extra?.metadata?.cwe ?? null,
    ruleSource: finding.extra?.metadata?.source ?? null,
  };
}

function validateFindingCoordinates(finding) {
  const start = finding.start?.line;
  const end = finding.end?.line;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error(`Semgrep finding has invalid line coordinates: ${finding.path ?? "unknown path"}`);
  }
  return { start, end };
}

function mapSemgrepProject(groundTruth, projectId, semgrepOutput, evaluationRoot = process.cwd()) {
  const project = groundTruth.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Unknown ground-truth project: ${projectId}`);
  if (!Array.isArray(semgrepOutput?.results)) throw new Error(`Invalid Semgrep JSON for project ${projectId}`);

  const scenarios = groundTruth.scenarios.filter((scenario) => scenario.projectId === projectId);
  const findingsByScenario = new Map(scenarios.map((scenario) => [scenario.id, []]));
  const mappedFindings = [];
  const unmatchedFindings = [];
  const ambiguousFindings = [];

  for (const finding of semgrepOutput.results) {
    const relativePath = projectRelativeFindingPath(finding.path, project, evaluationRoot);
    const coordinates = validateFindingCoordinates(finding);
    const matchingScenarioIds = scenarios
      .filter((scenario) => scenarioEvidenceRanges(scenario).some((range) => (
        range.file === relativePath
        && rangesOverlap(coordinates.start, coordinates.end, range.start, range.end)
      )))
      .map((scenario) => scenario.id);
    const mapped = {
      ...compactFinding(finding, relativePath),
      matchingScenarioIds,
    };
    mappedFindings.push(mapped);
    if (matchingScenarioIds.length === 0) unmatchedFindings.push(mapped);
    if (matchingScenarioIds.length > 1) ambiguousFindings.push(mapped);
    for (const scenarioId of matchingScenarioIds) findingsByScenario.get(scenarioId).push(mapped);
  }

  const rows = scenarios.map((scenario) => {
    const findings = findingsByScenario.get(scenario.id);
    const predictedPositive = findings.length > 0;
    return {
      cohort: COHORT_BY_PROJECT_ID[projectId],
      projectId,
      scenarioId: scenario.id,
      expectedPositive: scenario.expected.contextuallyReachable,
      predictedPositive,
      outcome: outcome(scenario.expected.contextuallyReachable, predictedPositive),
      findingCount: findings.length,
      ruleIds: [...new Set(findings.map((finding) => finding.checkId))].sort(),
      evidenceFiles: [...new Set(scenarioEvidenceRanges(scenario).map((range) => range.file))],
      findings,
    };
  });

  return {
    projectId,
    cohort: COHORT_BY_PROJECT_ID[projectId],
    rows,
    mappedFindings,
    unmatchedFindings,
    ambiguousFindings,
  };
}

function groupMetrics(rows) {
  return {
    scenarioCount: rows.length,
    positiveCount: rows.filter((row) => row.expectedPositive).length,
    negativeCount: rows.filter((row) => !row.expectedPositive).length,
    ...calculateMetrics(rows),
  };
}

function aggregateSemgrepMetrics(projectResults) {
  const groups = {};
  for (const cohort of ["characterization", "holdout", "robustness"]) {
    const rows = projectResults
      .filter((project) => project.cohort === cohort)
      .flatMap((project) => project.rows);
    if (rows.length > 0) groups[cohort] = groupMetrics(rows);
  }
  const primaryRows = projectResults
    .filter((project) => ["characterization", "holdout"].includes(project.cohort))
    .flatMap((project) => project.rows);
  if (primaryRows.length > 0) groups.primary = groupMetrics(primaryRows);
  const extendedRows = projectResults.flatMap((project) => project.rows);
  if (extendedRows.length > 0) groups.extended = groupMetrics(extendedRows);
  return groups;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function formatSemgrepCsv(runId, rows) {
  const lines = [SEMGREP_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const record = { runId, ...row };
    lines.push(SEMGREP_CSV_COLUMNS.map((column) => csvEscape(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function createRunId(date = new Date(), randomBytes = crypto.randomBytes) {
  const timestamp = date.toISOString().replace(/[-:.]/gu, "");
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
}

function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId) || runId === "." || runId === "..") {
    throw new Error("Run id must contain only letters, numbers, dots, underscores and hyphens");
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function extractResolvedRulesetMetadata(stdout, config) {
  const ruleIds = [...stdout.matchAll(/Rule\.id\s*=\s*\(\s*"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort();
  const registryVersionIds = [...stdout.matchAll(/\("version_id",\s*\(JSON\.String\s+"([^"]+)"\)\)/gu)]
    .map((match) => match[1])
    .sort();
  if (ruleIds.length === 0) throw new Error("Resolved Semgrep ruleset contained no rule identifiers");
  const catalog = {
    rulesetId: config.ruleset.id,
    retrievedOn: config.ruleset.retrievedOn,
    ruleCount: ruleIds.length,
    ruleIds,
    registryVersionIds,
  };
  return {
    ...catalog,
    catalogSha256: sha256(JSON.stringify(catalog)),
    redistributionNote: "The resolved rule source is not redistributed; this catalogue records identifiers and registry version identifiers under the Semgrep Rules License v1.0.",
  };
}

function fileRecord(evaluationRoot, filePath) {
  const content = fs.readFileSync(filePath);
  return {
    path: normalizePath(path.relative(evaluationRoot, filePath)),
    bytes: content.length,
    sha256: sha256(content),
  };
}

function runCommand(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${executable} exited with status ${result.status}: ${result.stderr.trim()}`);
    error.exitStatus = result.status;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function parseSemgrepVersion(stdout) {
  const match = stdout.match(/\b\d+\.\d+\.\d+\b/u);
  if (!match) throw new Error(`Unable to parse Semgrep version from: ${stdout.trim()}`);
  return match[0];
}

function semgrepScanArguments(config, projectRoot) {
  const args = [
    "scan",
    "--config", config.ruleset.id,
    "--json",
    "--metrics", config.scan.metrics,
    "--disable-version-check",
    "--oss-only",
    "--jobs", String(config.scan.jobs),
  ];
  if (!config.scan.respectGitIgnore) args.push("--no-git-ignore");
  for (const excluded of config.scan.exclude ?? []) args.push("--exclude", excluded);
  args.push(projectRoot);
  return args;
}

function initializeDirectories(evaluationRoot, runId) {
  validateRunId(runId);
  const rawDirectory = path.join(evaluationRoot, "results", "raw", "semgrep", runId);
  const processedDirectory = path.join(evaluationRoot, "results", "processed", "semgrep", runId);
  if (fs.existsSync(rawDirectory) || fs.existsSync(processedDirectory)) {
    throw new Error(`Semgrep results already exist for run ${runId}`);
  }
  fs.mkdirSync(rawDirectory, { recursive: true });
  fs.mkdirSync(processedDirectory, { recursive: true });
  return { rawDirectory, processedDirectory };
}

function runSemgrepBaseline(options = {}) {
  const evaluationRoot = path.resolve(options.evaluationRoot ?? path.join(__dirname, ".."));
  const configPath = path.join(evaluationRoot, "config", "semgrep-baseline.json");
  const groundTruthPath = path.join(evaluationRoot, "ground-truth", "ground-truth.json");
  const config = readJson(configPath);
  const groundTruth = readJson(groundTruthPath);
  const validation = validateGroundTruth(groundTruth, { evaluationRoot });
  if (!validation.valid) throw new Error(`Ground truth is invalid: ${validation.errors.join("; ")}`);

  const runId = options.runId ?? createRunId();
  const semgrepExecutable = options.semgrepExecutable ?? process.env.SEMGREP_BIN ?? "semgrep";
  const { rawDirectory, processedDirectory } = initializeDirectories(evaluationRoot, runId);
  const startedAt = new Date().toISOString();

  try {
    const versionResult = runCommand(semgrepExecutable, ["--version"], evaluationRoot);
    const actualVersion = parseSemgrepVersion(versionResult.stdout);
    if (actualVersion !== config.tool.version) {
      throw new Error(`Semgrep ${config.tool.version} is required; found ${actualVersion}`);
    }

    const resolvedConfig = runCommand(
      semgrepExecutable,
      ["show", "dump-config", "--json", config.ruleset.id],
      evaluationRoot,
    );
    const resolvedRulesetMetadata = extractResolvedRulesetMetadata(resolvedConfig.stdout, config);
    const resolvedConfigPath = path.join(rawDirectory, "resolved-ruleset-metadata.json");
    writeNewJson(resolvedConfigPath, resolvedRulesetMetadata);
    const resolvedConfigStderrPath = path.join(rawDirectory, "resolved-ruleset.stderr.txt");
    writeNewText(resolvedConfigStderrPath, resolvedConfig.stderr);

    const projectResults = [];
    const rawArtifacts = [
      fileRecord(evaluationRoot, resolvedConfigPath),
      fileRecord(evaluationRoot, resolvedConfigStderrPath),
    ];
    for (const project of groundTruth.projects) {
      const command = semgrepScanArguments(config, project.root);
      const scan = runCommand(semgrepExecutable, command, evaluationRoot);
      const rawJsonPath = path.join(rawDirectory, `${project.id}.semgrep.json`);
      const stderrPath = path.join(rawDirectory, `${project.id}.semgrep.stderr.txt`);
      writeNewText(rawJsonPath, scan.stdout);
      writeNewText(stderrPath, scan.stderr);
      rawArtifacts.push(fileRecord(evaluationRoot, rawJsonPath), fileRecord(evaluationRoot, stderrPath));
      projectResults.push(mapSemgrepProject(groundTruth, project.id, JSON.parse(scan.stdout), evaluationRoot));
    }

    const rows = projectResults.flatMap((project) => project.rows);
    const unmatchedFindings = projectResults.flatMap((project) => project.unmatchedFindings);
    const ambiguousFindings = projectResults.flatMap((project) => project.ambiguousFindings);
    const reviewRequired = unmatchedFindings.length > 0 || ambiguousFindings.length > 0;
    const completedAt = new Date().toISOString();
    const summary = {
      schemaVersion: "1.0.0",
      runId,
      startedAt,
      completedAt,
      status: reviewRequired ? "review-required" : "completed",
      tool: config.tool,
      ruleset: {
        ...config.ruleset,
        ruleCount: resolvedRulesetMetadata.ruleCount,
        catalogSha256: resolvedRulesetMetadata.catalogSha256,
      },
      scan: config.scan,
      matching: config.matching,
      groundTruthSha256: validation.datasetSha256,
      findingCount: projectResults.reduce((total, project) => total + project.mappedFindings.length, 0),
      unmatchedFindingCount: unmatchedFindings.length,
      ambiguousFindingCount: ambiguousFindings.length,
      groups: aggregateSemgrepMetrics(projectResults),
    };

    const scenariosPath = path.join(processedDirectory, "scenario-results.json");
    const csvPath = path.join(processedDirectory, "scenario-results.csv");
    const mappingPath = path.join(processedDirectory, "finding-mapping.json");
    const summaryPath = path.join(processedDirectory, "summary.json");
    writeNewJson(scenariosPath, { schemaVersion: "1.0.0", runId, rows });
    writeNewText(csvPath, formatSemgrepCsv(runId, rows));
    writeNewJson(mappingPath, {
      schemaVersion: "1.0.0",
      runId,
      policy: config.matching,
      projects: projectResults.map((project) => ({
        projectId: project.projectId,
        findings: project.mappedFindings,
        unmatchedFindings: project.unmatchedFindings,
        ambiguousFindings: project.ambiguousFindings,
      })),
    });
    writeNewJson(summaryPath, summary);
    const processedArtifacts = [scenariosPath, csvPath, mappingPath, summaryPath]
      .map((filePath) => fileRecord(evaluationRoot, filePath));
    const manifestPath = path.join(rawDirectory, "run.completed.json");
    writeNewJson(manifestPath, {
      schemaVersion: "1.0.0",
      runId,
      status: summary.status,
      startedAt,
      completedAt,
      tool: config.tool,
      ruleset: summary.ruleset,
      groundTruthSha256: validation.datasetSha256,
      rawArtifacts,
      processedArtifacts,
    });

    return {
      runId,
      status: summary.status,
      rawDirectory,
      processedDirectory,
      summaryPath,
      manifestPath,
      summary,
    };
  } catch (error) {
    const failurePath = path.join(rawDirectory, "failure.json");
    try {
      writeNewJson(failurePath, {
        schemaVersion: "1.0.0",
        runId,
        status: "failed",
        startedAt,
        failedAt: new Date().toISOString(),
        error: { name: error.name, message: error.message },
      });
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
  SEMGREP_CSV_COLUMNS,
  aggregateSemgrepMetrics,
  compactFinding,
  createRunId,
  extractResolvedRulesetMetadata,
  formatSemgrepCsv,
  mapSemgrepProject,
  normalizePath,
  parseSemgrepVersion,
  projectRelativeFindingPath,
  rangesOverlap,
  runSemgrepBaseline,
  scenarioEvidenceRanges,
  semgrepScanArguments,
  validateFindingCoordinates,
  validateRunId,
};
