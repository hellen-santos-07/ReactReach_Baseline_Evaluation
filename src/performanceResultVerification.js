const fs = require("node:fs");
const path = require("node:path");
const { canonicalize, readJson } = require("./groundTruth");
const { fileSha256, runPreflight } = require("./preflight");
const { consistencySummary, SAMPLE_CSV_COLUMNS } = require("./performanceCampaign");
const { runPerformancePreflight } = require("./performanceInputs");
const { loadPerformanceConfig } = require("./performanceProjects");
const {
  evaluateThresholds,
  loadPerformanceBenchmarkConfig,
  summarizeMeasuredSamples,
} = require("./performanceProtocol");
const { parseCsv } = require("./resultVerification");
const { validateRunId } = require("./finalEvaluation");

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function checkArtifact(errors, evaluationRoot, resultsRoot, artifact) {
  if (!artifact || typeof artifact.path !== "string") {
    errors.push("Manifest contains an invalid artifact record");
    return;
  }
  const filePath = path.resolve(evaluationRoot, artifact.path);
  if (!isWithin(resultsRoot, filePath)) {
    errors.push(`Artifact escapes the results directory: ${artifact.path}`);
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    errors.push(`Artifact does not exist: ${artifact.path}`);
    return;
  }
  if (fs.statSync(filePath).size !== artifact.bytes) errors.push(`Artifact byte count differs: ${artifact.path}`);
  if (fileSha256(filePath) !== artifact.sha256) errors.push(`Artifact SHA-256 differs: ${artifact.path}`);
}

function derivedProjectSummaries(samples, performanceConfig, benchmarkConfig) {
  return performanceConfig.projects.map((project) => {
    const selected = samples.filter((sample) => sample.projectId === project.id);
    return {
      projectId: project.id,
      targetSourceFiles: project.targetSourceFiles,
      statistics: summarizeMeasuredSamples(selected, benchmarkConfig),
      consistency: {
        sourceFileCount: consistencySummary(selected, "sourceFileCount"),
        componentCount: consistencySummary(selected, "componentCount"),
        sinkCount: consistencySummary(selected, "sinkCount"),
        findingCount: consistencySummary(selected, "findingCount"),
      },
      diagnosticSampleCount: selected.filter((sample) => sample.diagnosticCount > 0).length,
    };
  });
}

function verifyPerformanceRun(evaluationRoot, runId, options = {}) {
  validateRunId(runId);
  const errors = [];
  const resultsRoot = path.resolve(options.resultsRoot ?? path.join(evaluationRoot, "results"));
  const rawDirectory = path.join(resultsRoot, "raw", "performance", runId);
  const processedDirectory = path.join(resultsRoot, "processed", "performance", runId);
  const completedPath = path.join(rawDirectory, "run.completed.json");
  if (!fs.existsSync(completedPath)) return { valid: false, errors: ["Completed-run manifest does not exist"], runId };
  if (fs.existsSync(path.join(rawDirectory, "failure.json"))) errors.push("Run contains a technical failure record");
  const completed = readJson(completedPath);
  if (completed.runId !== runId) errors.push("Completion manifest uses a different run id");
  if (!["completed", "review-required"].includes(completed.status)) errors.push(`Unsupported run status: ${completed.status}`);
  for (const artifact of [...(completed.rawArtifacts ?? []), ...(completed.processedArtifacts ?? [])]) {
    checkArtifact(errors, evaluationRoot, resultsRoot, artifact);
  }

  const requiredProcessed = ["samples.json", "samples.csv", "statistics.json"];
  for (const name of requiredProcessed) {
    if (!fs.existsSync(path.join(processedDirectory, name))) errors.push(`Required processed artifact is missing: ${name}`);
  }
  if (!fs.existsSync(path.join(rawDirectory, "run.started.json"))) errors.push("Started-run manifest is missing");
  if (errors.length > 0) return { valid: false, errors, runId };

  const benchmarkConfig = loadPerformanceBenchmarkConfig(evaluationRoot);
  const performanceConfig = loadPerformanceConfig(evaluationRoot);
  const preflightRunner = options.preflightRunner ?? ((root) => runPerformancePreflight(root, {
    preflightRunner: (baseRoot) => runPreflight(baseRoot, { requireEvaluationClean: false }),
  }));
  const preflight = preflightRunner(evaluationRoot);
  const started = readJson(path.join(rawDirectory, "run.started.json"));
  const samplesOutput = readJson(path.join(processedDirectory, "samples.json"));
  const statistics = readJson(path.join(processedDirectory, "statistics.json"));
  for (const [label, value] of [
    ["Started manifest", started.runId],
    ["Samples JSON", samplesOutput.runId],
    ["Statistics", statistics.runId],
  ]) if (value !== runId) errors.push(`${label} uses a different run id`);
  if (canonicalize(started.benchmarkConfig) !== canonicalize(benchmarkConfig)) errors.push("Started benchmark config differs from the frozen config");
  if (canonicalize(statistics.benchmarkConfig) !== canonicalize(benchmarkConfig)) errors.push("Statistics benchmark config differs from the frozen config");
  if (canonicalize(started.frozenInputs) !== canonicalize(statistics.frozenInputs)) {
    errors.push("Started manifest and statistics contain different frozen inputs");
  }
  // The execution commit is provenance rather than an input hash. Committing
  // the resulting artefacts necessarily changes HEAD after the campaign, while
  // every configuration, dataset and generated-project hash remains unchanged.
  const comparableInputs = (value) => {
    if (value === null || typeof value !== "object") return value;
    const { evaluationCommit: _executionCommit, ...inputs } = value;
    return inputs;
  };
  const currentInputsMatch = preflight.summary !== undefined
    && canonicalize(comparableInputs(started.frozenInputs)) === canonicalize(comparableInputs(preflight.summary));

  const samples = samplesOutput.samples ?? [];
  const expectedSamples = performanceConfig.projects.length * benchmarkConfig.measuredRuns;
  if (samples.length !== expectedSamples) errors.push(`Expected ${expectedSamples} processed samples, received ${samples.length}`);
  const identities = new Set();
  for (const project of performanceConfig.projects) {
    const projectSamples = samples.filter((sample) => sample.projectId === project.id);
    if (projectSamples.length !== benchmarkConfig.measuredRuns) errors.push(`${project.id} measured sample count differs`);
    for (let index = 1; index <= benchmarkConfig.measuredRuns; index++) {
      const sample = projectSamples.find((item) => item.measurementIndex === index);
      if (!sample) {
        errors.push(`${project.id} measurement ${index} is missing`);
        continue;
      }
      const identity = `${project.id}:${index}`;
      if (identities.has(identity)) errors.push(`Duplicate sample identity: ${identity}`);
      identities.add(identity);
      const rawPath = path.join(rawDirectory, "samples", project.id, `measurement-${String(index).padStart(3, "0")}.json`);
      if (!fs.existsSync(rawPath)) errors.push(`Raw sample is missing: ${identity}`);
      else if (canonicalize(readJson(rawPath)) !== canonicalize(sample)) errors.push(`Raw and processed sample differ: ${identity}`);
    }
    const warmupPath = path.join(rawDirectory, "warmups", `${project.id}.completed.json`);
    if (!fs.existsSync(warmupPath)) errors.push(`${project.id} warm-up marker is missing`);
    else if (readJson(warmupPath).completedWarmups !== benchmarkConfig.warmupRuns) errors.push(`${project.id} warm-up count differs`);
  }

  if (samples.length === expectedSamples) {
    const recalculatedProjects = derivedProjectSummaries(samples, performanceConfig, benchmarkConfig);
    if (canonicalize(recalculatedProjects) !== canonicalize(statistics.projects)) errors.push("Statistics do not reproduce from measured samples");
    const recalculatedThresholds = evaluateThresholds(recalculatedProjects, benchmarkConfig);
    if (canonicalize(recalculatedThresholds) !== canonicalize(statistics.thresholds)) errors.push("Threshold evaluation does not reproduce from measured samples");
    const reviewRequired = recalculatedProjects.some((project) =>
      Object.values(project.consistency).some((item) => !item.stable) || project.diagnosticSampleCount > 0);
    if (statistics.reviewRequired !== reviewRequired || completed.reviewRequired !== reviewRequired) errors.push("Review-required status does not reproduce from samples");
    const expectedStatus = reviewRequired ? "review-required" : "completed";
    if (statistics.status !== expectedStatus || completed.status !== expectedStatus) errors.push("Run status does not reproduce from samples");
    if (completed.thresholdsPassed !== recalculatedThresholds.passed) errors.push("Completion threshold status differs from recalculation");
  }

  try {
    const csv = parseCsv(fs.readFileSync(path.join(processedDirectory, "samples.csv"), "utf8"));
    if (canonicalize(csv[0]) !== canonicalize([...SAMPLE_CSV_COLUMNS])) errors.push("Sample CSV header differs");
    if (csv.length - 1 !== samples.length) errors.push("Sample CSV row count differs from JSON");
  } catch (error) {
    errors.push(`Sample CSV is invalid: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    runId,
    status: statistics.status,
    sampleCount: samples.length,
    thresholds: statistics.thresholds,
    reviewRequired: statistics.reviewRequired,
    currentInputsMatch,
  };
}

module.exports = {
  derivedProjectSummaries,
  verifyPerformanceRun,
};
