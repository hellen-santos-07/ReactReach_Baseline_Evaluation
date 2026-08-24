#!/usr/bin/env node

const path = require("node:path");
const { runFinalEvaluation } = require("../src/finalEvaluation");

function formatMetric(value) {
  return value === null ? "undefined" : value.toFixed(3);
}

function printGroup(label, group) {
  const reactReach = group.reactReach;
  const baseline = group.baseline;
  console.log(`\n${label} (${group.scenarioCount} scenarios; ${group.positiveCount} positive, ${group.negativeCount} negative)`);
  console.log(`  ReactReach: TP=${reactReach.confusion.TP} FP=${reactReach.confusion.FP} TN=${reactReach.confusion.TN} FN=${reactReach.confusion.FN}`);
  console.log(`    precision=${formatMetric(reactReach.precision)} recall=${formatMetric(reactReach.recall)} F1=${formatMetric(reactReach.f1)} accuracy=${formatMetric(reactReach.accuracy)}`);
  console.log(`  npm audit presence: TP=${baseline.confusion.TP} FP=${baseline.confusion.FP} TN=${baseline.confusion.TN} FN=${baseline.confusion.FN}`);
  console.log(`    precision=${formatMetric(baseline.precision)} recall=${formatMetric(baseline.recall)} F1=${formatMetric(baseline.f1)} accuracy=${formatMetric(baseline.accuracy)}`);
}

async function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = await runFinalEvaluation(evaluationRoot);
  console.log(`\nRun: ${result.runId}`);
  printGroup("Characterization", result.metrics.characterization);
  printGroup("Holdout", result.metrics.holdout);
  if (result.metrics.robustness) {
    printGroup("Primary dataset", result.metrics.primary);
    printGroup("Supplemental robustness", result.metrics.robustness);
    printGroup("Extended dataset", result.metrics.extended);
  } else {
    printGroup("Complete dataset", result.metrics.complete);
  }
  console.log(`\nStatus: ${result.status}`);
  console.log(`Unexpected positive findings: ${result.unexpectedPositiveFindings.length}`);
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
