#!/usr/bin/env node

const path = require("node:path");
const { preparePublicApplicationInputs } = require("../src/publicApplicationStudy");

function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  const prepared = preparePublicApplicationInputs(evaluationRoot);
  console.log(JSON.stringify({
    status: "prepared",
    projects: prepared.map((item) => ({
      projectId: item.projectId,
      workspace: path.relative(evaluationRoot, item.workspace).replace(/\\/gu, "/"),
      frozenDirectory: path.relative(evaluationRoot, item.frozenDirectory).replace(/\\/gu, "/"),
      commit: item.metadata.commit,
      sourceFileCount: item.metadata.sourceFileCount,
      audit: item.metadata.audit,
    })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
