#!/usr/bin/env node

const path = require("node:path");
const { runPerformanceCampaign } = require("../src/performanceCampaign");
const { runPerformancePreflight } = require("../src/performanceInputs");
const { loadPerformanceBenchmarkConfig } = require("../src/performanceProtocol");

function printPlan(evaluationRoot) {
  const preflight = runPerformancePreflight(evaluationRoot);
  if (!preflight.valid) throw new Error(`Performance preflight failed:\n${preflight.errors.map((error) => `- ${error}`).join("\n")}`);
  const config = loadPerformanceBenchmarkConfig(evaluationRoot);
  console.log("Performance campaign plan (no scans executed):");
  for (const project of preflight.summary.projects) {
    console.log(`${project.projectId}: ${config.warmupRuns} warm-ups + ${config.measuredRuns} measured runs; ${project.sourceFileCount} source files`);
  }
  console.log(`Total isolated sequential scans: ${preflight.summary.projects.length * (config.warmupRuns + config.measuredRuns)}`);
  console.log(`RSS sample interval: ${config.rssSampleIntervalMs} ms`);
  console.log(`Per-sample timeout: ${config.sampleTimeoutMs} ms`);
  console.log(`Benchmark-config SHA-256: ${preflight.summary.performanceBenchmarkConfigSha256}`);
}

function metric(value) {
  return Number(value).toFixed(3);
}

async function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  if (process.argv.includes("--plan")) {
    printPlan(evaluationRoot);
    return;
  }
  const result = await runPerformanceCampaign(evaluationRoot);
  console.log(`Performance run: ${result.runId}`);
  for (const project of result.projects) {
    const duration = project.statistics.timings.staticAnalysisMs;
    const rss = project.statistics.peakRssMiB;
    console.log(`${project.projectId}: median=${metric(duration.median)} ms p95=${metric(duration.p95)} ms peakRSS=${metric(rss.max)} MiB outliers=${project.statistics.outliers.count}`);
  }
  console.log(`Thresholds: ${result.thresholds.passed ? "passed" : "failed"}`);
  console.log(`Status: ${result.status}`);
  console.log(`Raw outputs: ${result.rawDirectory}`);
  console.log(`Processed outputs: ${result.processedDirectory}`);
  if (result.reviewRequired) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  if (error.runId) console.error(`Failed run preserved as: ${error.runId}`);
  if (error.rawDirectory) console.error(`Failure details: ${path.join(error.rawDirectory, "failure.json")}`);
  process.exitCode = 1;
});
