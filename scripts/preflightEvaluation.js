#!/usr/bin/env node

const path = require("node:path");
const { runPreflight } = require("../src/preflight");

const evaluationRoot = path.resolve(__dirname, "..");

try {
  const result = runPreflight(evaluationRoot);
  if (!result.valid) {
    console.error("Evaluation preflight failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Evaluation preflight passed.");
    console.log(`Projects: ${result.summary.projects}`);
    console.log(`Scenarios: ${result.summary.scenarios}`);
    console.log(`Ground-truth dataset SHA-256: ${result.summary.groundTruthDatasetSha256}`);
    console.log(`Ground-truth file SHA-256: ${result.summary.groundTruthFileSha256}`);
    console.log(`Evaluation-config SHA-256: ${result.summary.evaluationConfigSha256}`);
    console.log(`Sink-catalog SHA-256: ${result.summary.sinkCatalogSha256}`);
    console.log(`ReactReach commit: ${result.summary.reactReachCommit}`);
    console.log("Status: INPUTS VERIFIED; PREFLIGHT PERFORMS NO CORPUS SCAN");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
