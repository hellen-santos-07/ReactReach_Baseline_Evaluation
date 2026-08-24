const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./groundTruth");
const { verifyPerformanceRun } = require("./performanceResultVerification");

const REPEATABILITY_CONFIG = path.join("config", "performance-repeatability.json");

function validateRepeatabilityConfig(config) {
  const errors = [];
  if (config?.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
  if (config?.requiredCampaigns !== 3) errors.push("requiredCampaigns must be 3");
  if (config?.selectionPolicy !== "report-all-completed-campaigns") errors.push("selectionPolicy must prohibit run selection");
  if (config?.aggregationPolicy !== "per-campaign-primary-pooled-descriptive-only") errors.push("aggregationPolicy must keep per-campaign results primary");
  if (config?.thresholdPolicy !== "every-campaign-must-pass") errors.push("thresholdPolicy must require every campaign to pass");
  if (!Array.isArray(config?.campaigns) || config.campaigns.length !== config?.requiredCampaigns) {
    errors.push("campaigns must contain exactly three planned campaigns");
    return { valid: false, errors };
  }
  const runIds = new Set();
  for (const [index, campaign] of config.campaigns.entries()) {
    if (campaign.sequence !== index + 1) errors.push(`campaign ${index + 1} has an invalid sequence`);
    if (!new Set(["completed", "pending"]).has(campaign.status)) errors.push(`campaign ${index + 1} has an invalid status`);
    if (campaign.status === "completed") {
      if (typeof campaign.runId !== "string" || !campaign.runId) errors.push(`campaign ${index + 1} requires a runId`);
      if (typeof campaign.reactReachCommit !== "string" || !/^[0-9a-f]{40}$/u.test(campaign.reactReachCommit)) {
        errors.push(`campaign ${index + 1} requires a full ReactReach commit`);
      }
      if (runIds.has(campaign.runId)) errors.push(`campaign ${index + 1} duplicates run ${campaign.runId}`);
      runIds.add(campaign.runId);
    } else if (campaign.runId !== null || campaign.reactReachCommit !== null) {
      errors.push(`pending campaign ${index + 1} must use null runId and reactReachCommit`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function checkPerformanceRepeatability(evaluationRoot, options = {}) {
  const configPath = path.join(evaluationRoot, REPEATABILITY_CONFIG);
  const config = readJson(configPath);
  const validation = validateRepeatabilityConfig(config);
  if (!validation.valid) return { valid: false, complete: false, errors: validation.errors, campaigns: [] };

  const verifier = options.verifier ?? verifyPerformanceRun;
  const campaigns = [];
  const errors = [];
  for (const campaign of config.campaigns) {
    if (campaign.status === "pending") {
      campaigns.push({ ...campaign });
      continue;
    }
    const verification = verifier(evaluationRoot, campaign.runId);
    if (!verification.valid) {
      errors.push(...verification.errors.map((error) => `${campaign.runId}: ${error}`));
      campaigns.push({ ...campaign, verified: false });
      continue;
    }
    const statisticsPath = path.join(
      evaluationRoot,
      "results",
      "processed",
      "performance",
      campaign.runId,
      "statistics.json",
    );
    if (!fs.existsSync(statisticsPath)) {
      errors.push(`${campaign.runId}: statistics.json is missing`);
      campaigns.push({ ...campaign, verified: false });
      continue;
    }
    const statistics = readJson(statisticsPath);
    if (statistics.frozenInputs?.reactReachCommit !== campaign.reactReachCommit) {
      errors.push(`${campaign.runId}: declared ReactReach commit differs from statistics`);
    }
    campaigns.push({
      ...campaign,
      verified: true,
      thresholdsPassed: statistics.thresholds?.passed === true,
      p95StaticAnalysisMs: statistics.thresholds?.p95StaticAnalysisMs?.observed ?? null,
      peakRssBytes: statistics.thresholds?.peakRssBytes?.observed ?? null,
    });
  }

  const completed = campaigns.filter((campaign) => campaign.status === "completed");
  const complete = completed.length === config.requiredCampaigns;
  const everyThresholdPassed = completed.every((campaign) => campaign.thresholdsPassed === true);
  if (complete && !everyThresholdPassed) errors.push("At least one completed campaign failed a threshold");
  return {
    valid: errors.length === 0,
    complete,
    errors,
    campaigns,
    everyThresholdPassed,
  };
}

module.exports = {
  REPEATABILITY_CONFIG,
  checkPerformanceRepeatability,
  validateRepeatabilityConfig,
};
