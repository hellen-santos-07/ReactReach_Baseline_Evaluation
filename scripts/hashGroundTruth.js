#!/usr/bin/env node

const path = require("node:path");
const { datasetSha256, readJson } = require("../src/groundTruth");

const requestedPath = process.argv[2] ?? path.join("ground-truth", "ground-truth.json");
const groundTruthPath = path.resolve(process.cwd(), requestedPath);

try {
  console.log(datasetSha256(readJson(groundTruthPath)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
