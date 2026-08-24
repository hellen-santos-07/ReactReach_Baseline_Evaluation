#!/usr/bin/env node

const path = require("node:path");
const { verifyEvaluationRun } = require("../src/resultVerification");

function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("Usage: npm run evaluation:verify -- <run-id>");
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = verifyEvaluationRun(evaluationRoot, runId);
  if (!result.valid) {
    console.error(`Evaluation run ${runId} is invalid:`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Evaluation run ${runId} verified.`);
  console.log(`Status: ${result.status}`);
  console.log(`Scenarios: ${result.scenarioCount}`);
  console.log("Artifact hashes, JSON/SARIF counts, CSV identities and derived metrics are consistent.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
