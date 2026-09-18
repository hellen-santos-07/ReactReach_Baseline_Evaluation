#!/usr/bin/env node

const path = require("node:path");
const { runPublicApplicationPreflight } = require("../src/publicApplicationStudy");

function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = runPublicApplicationPreflight(evaluationRoot);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
