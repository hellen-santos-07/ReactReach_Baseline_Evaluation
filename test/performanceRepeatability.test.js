const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  checkPerformanceRepeatability,
  validateRepeatabilityConfig,
} = require("../src/performanceRepeatability");

const evaluationRoot = path.resolve(__dirname, "..");

test("repeatability protocol requires three report-all campaigns", () => {
  const valid = {
    schemaVersion: "1.0.0",
    requiredCampaigns: 3,
    selectionPolicy: "report-all-completed-campaigns",
    aggregationPolicy: "per-campaign-primary-pooled-descriptive-only",
    thresholdPolicy: "every-campaign-must-pass",
    campaigns: [
      { sequence: 1, status: "completed", runId: "run-1", reactReachCommit: "a".repeat(40) },
      { sequence: 2, status: "completed", runId: "run-2", reactReachCommit: "b".repeat(40) },
      { sequence: 3, status: "pending", runId: null, reactReachCommit: null },
    ],
  };
  assert.equal(validateRepeatabilityConfig(valid).valid, true);
  valid.campaigns[1].runId = "run-1";
  assert.equal(validateRepeatabilityConfig(valid).valid, false);
});

test("the committed repeatability plan verifies all three final campaigns", () => {
  const result = checkPerformanceRepeatability(evaluationRoot);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.complete, true);
  assert.deepEqual(result.campaigns.map((campaign) => campaign.status), ["completed", "completed", "completed"]);
  assert.ok(result.campaigns.every((campaign) => campaign.verified === true));
  assert.equal(result.everyThresholdPassed, true);
});
