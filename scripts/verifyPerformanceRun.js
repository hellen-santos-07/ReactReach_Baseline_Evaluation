#!/usr/bin/env node

const path = require("node:path");
const { verifyPerformanceRun } = require("../src/performanceResultVerification");

function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("Usage: npm run performance:verify -- <run-id>");
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = verifyPerformanceRun(evaluationRoot, runId);
  if (!result.valid) {
    console.error(`Performance run ${runId} is invalid:`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Performance run ${runId} verified.`);
  console.log(`Status: ${result.status}`);
  console.log(`Measured samples: ${result.sampleCount}`);
  console.log(`Thresholds: ${result.thresholds.passed ? "passed" : "failed"}`);
  console.log(`Matches current frozen inputs: ${result.currentInputsMatch ? "yes" : "no (historical run)"}`);
  console.log("Artifact hashes, raw samples, CSV and derived statistics are consistent.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
