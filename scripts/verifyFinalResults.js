#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { readJson } = require("../src/groundTruth");
const { fileSha256 } = require("../src/preflight");
const { checkPerformanceRepeatability } = require("../src/performanceRepeatability");
const { verifyPerformanceRun } = require("../src/performanceResultVerification");
const { verifyEvaluationRun } = require("../src/resultVerification");
const { verifySemgrepRun } = require("../src/semgrepResultVerification");

const evaluationRoot = path.resolve(__dirname, "..");
const manifest = readJson(path.join(evaluationRoot, "config", "final-runs.json"));
const errors = [];

function verifyArtifactRecords(records, label) {
  if (!Array.isArray(records)) {
    errors.push(`${label} artifact list is missing`);
    return;
  }
  for (const record of records) {
    const artifactPath = path.resolve(evaluationRoot, record.path ?? "");
    const relative = path.relative(evaluationRoot, artifactPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      errors.push(`${label} artifact escapes the evaluation repository: ${record.path}`);
      continue;
    }
    if (!fs.existsSync(artifactPath)) {
      errors.push(`${label} artifact is missing: ${record.path}`);
      continue;
    }
    if (fs.statSync(artifactPath).size !== record.bytes) errors.push(`${label} artifact byte count differs: ${record.path}`);
    if (fileSha256(artifactPath) !== record.sha256) errors.push(`${label} artifact hash differs: ${record.path}`);
  }
}

function verifyPublicApplicationRun(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId)) {
    errors.push("final-runs requires one public-application run");
    return;
  }
  const rawRoot = path.join(evaluationRoot, "results", "raw", "public-applications", runId);
  const processedRoot = path.join(evaluationRoot, "results", "processed", "public-applications", runId);
  const completedPath = path.join(rawRoot, "run.completed.json");
  const summaryPath = path.join(processedRoot, "summary.json");
  const reviewPath = path.join(processedRoot, "critical-high-manual-review.json");
  for (const requiredPath of [completedPath, summaryPath, reviewPath]) {
    if (!fs.existsSync(requiredPath)) errors.push(`${runId}: missing ${path.relative(evaluationRoot, requiredPath)}`);
  }
  if (![completedPath, summaryPath, reviewPath].every((requiredPath) => fs.existsSync(requiredPath))) return;
  const completed = readJson(completedPath);
  const summary = readJson(summaryPath);
  const review = readJson(reviewPath);
  if (completed.runId !== runId || summary.runId !== runId || review.runId !== runId) errors.push(`${runId}: inconsistent run identifier`);
  if (completed.status !== "completed-after-manual-review" || summary.status !== completed.status) {
    errors.push(`${runId}: public-application review is not complete`);
  }
  if (summary.groundTruthAvailable !== false || summary.precisionRecallF1Computed !== false) {
    errors.push(`${runId}: public-application study must not claim accuracy metrics`);
  }
  if (summary.frozenInputs?.evaluationCommit !== manifest.evaluationCommit) errors.push(`${runId}: evaluation execution commit differs from final-runs`);
  if (summary.frozenInputs?.reactReachCommit !== manifest.reactReach.commit) errors.push(`${runId}: ReactReach commit differs from final-runs`);
  if (summary.frozenInputs?.reactReachVersion !== manifest.reactReach.version) errors.push(`${runId}: ReactReach version differs from final-runs`);
  if (summary.projectCount !== 3 || summary.completedProjectCount !== 3 || summary.failedProjectCount !== 0) {
    errors.push(`${runId}: all three public applications must complete`);
  }
  if (summary.manualReviewCompleted !== true || !Array.isArray(review.items) || review.items.some((item) => item.reviewed !== true)) {
    errors.push(`${runId}: CRITICAL/HIGH manual review is incomplete`);
  }
  if (review.items?.length !== summary.criticalHighManualReviewCount) errors.push(`${runId}: manual-review count differs from the summary`);
  verifyArtifactRecords(completed.rawArtifacts, runId);
  verifyArtifactRecords(completed.processedArtifacts, runId);
}

function executionCommitIsAncestor(commit) {
  const normalizedRoot = evaluationRoot.replace(/\\/gu, "/");
  try {
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${normalizedRoot}`,
        "-C",
        evaluationRoot,
        "merge-base",
        "--is-ancestor",
        commit,
        "HEAD",
      ],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

if (manifest.schemaVersion !== "1.0.0") errors.push("final-runs schemaVersion must be 1.0.0");
if (manifest.reactReach?.version !== "1.1.0") errors.push("final-runs must reference ReactReach 1.1.0");
if (manifest.reactReach?.tag !== "v1.1.0") errors.push("final-runs must reference ReactReach tag v1.1.0");
if (!/^[0-9a-f]{40}$/u.test(manifest.reactReach?.commit ?? "")) errors.push("final-runs requires a full ReactReach commit");
if (!/^[0-9a-f]{40}$/u.test(manifest.evaluationCommit ?? "")) errors.push("final-runs requires the evaluation execution commit");
else if (!executionCommitIsAncestor(manifest.evaluationCommit)) {
  errors.push("the evaluation execution commit must be an ancestor of the published revision");
}
if (typeof manifest.effectivenessRun !== "string" || manifest.effectivenessRun === "") {
  errors.push("final-runs requires one effectiveness run");
} else {
  const result = verifyEvaluationRun(evaluationRoot, manifest.effectivenessRun);
  if (!result.valid) errors.push(...result.errors.map((error) => `${manifest.effectivenessRun}: ${error}`));
  const summary = readJson(path.join(evaluationRoot, "results", "processed", manifest.effectivenessRun, "summary.json"));
  if (summary.frozenInputs?.evaluationCommit !== manifest.evaluationCommit) {
    errors.push(`${manifest.effectivenessRun}: evaluation execution commit differs from final-runs`);
  }
}

if (typeof manifest.semgrepBaselineRun !== "string" || manifest.semgrepBaselineRun === "") {
  errors.push("final-runs requires one Semgrep baseline run");
} else {
  const result = verifySemgrepRun(evaluationRoot, manifest.semgrepBaselineRun);
  if (!result.valid) errors.push(...result.errors.map((error) => `${manifest.semgrepBaselineRun}: ${error}`));
}

verifyPublicApplicationRun(manifest.publicApplicationRun);

if (!Array.isArray(manifest.performanceRuns) || manifest.performanceRuns.length !== 3) {
  errors.push("final-runs requires exactly three performance runs");
} else {
  for (const runId of manifest.performanceRuns) {
    const result = verifyPerformanceRun(evaluationRoot, runId);
    if (!result.valid) errors.push(...result.errors.map((error) => `${runId}: ${error}`));
    const statistics = readJson(path.join(evaluationRoot, "results", "processed", "performance", runId, "statistics.json"));
    if (statistics.frozenInputs?.evaluationCommit !== manifest.evaluationCommit) {
      errors.push(`${runId}: evaluation execution commit differs from final-runs`);
    }
  }
}

const repeatability = checkPerformanceRepeatability(evaluationRoot);
if (!repeatability.valid) errors.push(...repeatability.errors);
if (!repeatability.complete) errors.push("the three-campaign repeatability plan is incomplete");
if (repeatability.complete && repeatability.everyThresholdPassed !== true) errors.push("a final performance campaign failed its thresholds");
if (Array.isArray(manifest.performanceRuns) && repeatability.complete) {
  const declared = repeatability.campaigns.map((campaign) => campaign.runId);
  if (JSON.stringify(declared) !== JSON.stringify(manifest.performanceRuns)) {
    errors.push("final-runs and performance-repeatability declare different campaign identifiers");
  }
}

if (errors.length > 0) {
  console.error("Final result verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Effectiveness run verified: ${manifest.effectivenessRun}`);
  console.log(`Semgrep baseline run verified: ${manifest.semgrepBaselineRun}`);
  console.log(`Public-application run verified: ${manifest.publicApplicationRun}`);
  for (const runId of manifest.performanceRuns) console.log(`Performance run verified: ${runId}`);
  console.log("Final ReactReach v1.1.0 evaluation: PASS");
}
