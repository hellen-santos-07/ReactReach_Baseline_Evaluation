#!/usr/bin/env node

const path = require("node:path");
const { readJson, validateGroundTruth } = require("../src/groundTruth");

const requestedPath = process.argv[2] ?? path.join("ground-truth", "ground-truth.json");
const groundTruthPath = path.resolve(process.cwd(), requestedPath);
const evaluationRoot = path.resolve(__dirname, "..");

try {
  const result = validateGroundTruth(readJson(groundTruthPath), { evaluationRoot });
  if (!result.valid) {
    console.error(`Ground truth is invalid (${groundTruthPath}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Ground truth is valid: ${groundTruthPath}`);
    console.log(`Dataset SHA-256: ${result.datasetSha256}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
