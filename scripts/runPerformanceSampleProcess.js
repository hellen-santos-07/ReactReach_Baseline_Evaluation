#!/usr/bin/env node

const path = require("node:path");
const { runPerformanceSampleProcess } = require("../src/performanceSampleProcess");

function serializeError(error) {
  return {
    name: error.name,
    code: error.code ?? null,
    message: error.message,
    stack: error.stack ?? null,
  };
}

function deliver(message, exitCode = 0) {
  process.exitCode = exitCode;
  if (process.send) {
    process.send(message, () => process.disconnect());
  } else {
    console.log(JSON.stringify(message));
  }
}

async function main() {
  const evaluationRoot = path.resolve(process.argv[2]);
  const projectId = process.argv[3];
  const rssSampleIntervalMs = Number(process.argv[4]);
  if (!projectId || !Number.isInteger(rssSampleIntervalMs) || rssSampleIntervalMs <= 0) {
    throw new Error("Usage: runPerformanceSampleProcess.js <evaluation-root> <project-id> <rss-interval-ms>");
  }
  const result = await runPerformanceSampleProcess({ evaluationRoot, projectId, rssSampleIntervalMs });
  deliver({ type: "sample-result", result });
}

main().catch((error) => deliver({ type: "sample-error", error: serializeError(error) }, 1));
