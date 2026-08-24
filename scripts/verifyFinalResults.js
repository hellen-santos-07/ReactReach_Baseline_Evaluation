#!/usr/bin/env node

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readJson } = require("../src/groundTruth");
const { checkPerformanceRepeatability } = require("../src/performanceRepeatability");
const { verifyPerformanceRun } = require("../src/performanceResultVerification");
const { verifyEvaluationRun } = require("../src/resultVerification");

const evaluationRoot = path.resolve(__dirname, "..");
const manifest = readJson(path.join(evaluationRoot, "config", "final-runs.json"));
const errors = [];

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
if (manifest.reactReach?.version !== "1.0.0") errors.push("final-runs must reference ReactReach 1.0.0");
if (manifest.reactReach?.tag !== "v1.0.0") errors.push("final-runs must reference ReactReach tag v1.0.0");
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
  for (const runId of manifest.performanceRuns) console.log(`Performance run verified: ${runId}`);
  console.log("Final ReactReach v1.0.0 evaluation: PASS");
}
