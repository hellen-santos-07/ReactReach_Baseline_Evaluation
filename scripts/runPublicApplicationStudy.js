#!/usr/bin/env node

const path = require("node:path");
const { runPublicApplicationStudy } = require("../src/publicApplicationRun");

async function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  const result = await runPublicApplicationStudy(evaluationRoot);
  console.log(JSON.stringify({
    runId: result.runId,
    status: result.status,
    summary: path.relative(evaluationRoot, result.summaryPath).replace(/\\/gu, "/"),
    manualReview: path.relative(evaluationRoot, result.reviewPath).replace(/\\/gu, "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
