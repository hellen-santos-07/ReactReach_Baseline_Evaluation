#!/usr/bin/env node

const path = require("node:path");
const { runSemgrepBaseline } = require("../src/semgrepBaseline");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function formatMetric(value) {
  return value === null ? "undefined" : value.toFixed(3);
}

function printGroup(label, group) {
  console.log(`\n${label} (${group.scenarioCount} scenarios; ${group.positiveCount} positive, ${group.negativeCount} negative)`);
  console.log(`  TP=${group.confusion.TP} FP=${group.confusion.FP} TN=${group.confusion.TN} FN=${group.confusion.FN}`);
  console.log(`  precision=${formatMetric(group.precision)} recall=${formatMetric(group.recall)} F1=${formatMetric(group.f1)} accuracy=${formatMetric(group.accuracy)}`);
}

try {
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = runSemgrepBaseline({
    evaluationRoot,
    runId: argumentValue("--run-id"),
    semgrepExecutable: argumentValue("--semgrep-bin"),
  });
  console.log(`Semgrep baseline run: ${result.runId}`);
  printGroup("Characterization", result.summary.groups.characterization);
  printGroup("Holdout", result.summary.groups.holdout);
  printGroup("Primary dataset", result.summary.groups.primary);
  printGroup("Supplemental robustness", result.summary.groups.robustness);
  printGroup("Extended dataset", result.summary.groups.extended);
  console.log(`\nFindings: ${result.summary.findingCount}`);
  console.log(`Unmatched findings: ${result.summary.unmatchedFindingCount}`);
  console.log(`Ambiguous findings: ${result.summary.ambiguousFindingCount}`);
  console.log(`Status: ${result.status}`);
  console.log(`Raw outputs: ${result.rawDirectory}`);
  console.log(`Processed outputs: ${result.processedDirectory}`);
  if (result.status !== "completed") process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  if (error.runId) console.error(`Failed run preserved as: ${error.runId}`);
  if (error.rawDirectory) console.error(`Failure details: ${path.join(error.rawDirectory, "failure.json")}`);
  process.exitCode = 1;
}
