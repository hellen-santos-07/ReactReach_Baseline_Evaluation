#!/usr/bin/env node

const path = require("node:path");
const { runPerformancePreflight } = require("../src/performanceInputs");

function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = runPerformancePreflight(evaluationRoot);
  if (!result.valid) {
    console.error("Performance preflight failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Performance preflight passed without executing ReactReach.");
  for (const project of result.summary.projects) {
    console.log(`${project.projectId}: ${project.sourceFileCount} files (${project.coreSourceFiles} core + ${project.benignSourceFiles} benign)`);
    console.log(`  source-tree SHA-256: ${project.sourceTreeSha256}`);
  }
  console.log(`Core source-tree SHA-256: ${result.summary.coreSourceTreeSha256}`);
  console.log(`Dependency-set SHA-256: ${result.summary.dependencySetSha256}`);
  console.log(`Audit-data SHA-256: ${result.summary.auditDataSha256}`);
console.log(`Benchmark-config SHA-256: ${result.summary.performanceBenchmarkConfigSha256}`);
console.log(`Evaluation commit: ${result.summary.evaluationCommit}`);
console.log(`ReactReach release: ${result.summary.reactReachTag} (${result.summary.reactReachVersion})`);
console.log(`ReactReach commit: ${result.summary.reactReachCommit}`);
  console.log("Status: INPUTS VERIFIED; NO PERFORMANCE MEASUREMENTS EXECUTED");
}

main();
