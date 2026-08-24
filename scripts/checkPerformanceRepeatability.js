#!/usr/bin/env node

const path = require("node:path");
const { checkPerformanceRepeatability } = require("../src/performanceRepeatability");

const evaluationRoot = path.resolve(__dirname, "..");
const result = checkPerformanceRepeatability(evaluationRoot);
if (!result.valid) {
  console.error("Performance repeatability evidence is invalid:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  for (const campaign of result.campaigns) {
    if (campaign.status === "pending") console.log(`Campaign ${campaign.sequence}: pending`);
    else console.log(`Campaign ${campaign.sequence}: ${campaign.runId} p95=${campaign.p95StaticAnalysisMs} ms RSS=${campaign.peakRssBytes} bytes`);
  }
  console.log(`Status: ${result.complete ? "COMPLETE" : "PENDING PLANNED CAMPAIGN"}`);
  if (!result.complete) process.exitCode = 2;
}
