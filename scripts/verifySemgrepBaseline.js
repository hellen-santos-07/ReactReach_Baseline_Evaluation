#!/usr/bin/env node

const path = require("node:path");
const { readJson } = require("../src/groundTruth");
const { verifySemgrepRun } = require("../src/semgrepResultVerification");

try {
  const evaluationRoot = path.resolve(__dirname, "..");
  const configuredRun = readJson(path.join(evaluationRoot, "config", "final-runs.json")).semgrepBaselineRun;
  const runId = process.argv[2] ?? configuredRun;
  if (!runId) throw new Error("Usage: npm run semgrep:verify -- <run-id>");
  const result = verifySemgrepRun(evaluationRoot, runId);
  if (!result.valid) {
    console.error(`Semgrep baseline run ${runId} is invalid:`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Semgrep baseline run ${runId} verified.`);
    console.log(`Status: ${result.status}`);
    console.log(`Scenarios: ${result.scenarioCount}`);
    console.log(`Findings: ${result.findingCount}`);
    console.log("Artifact hashes, raw finding counts, scenario mappings and derived metrics are consistent.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
