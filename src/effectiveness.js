const path = require("node:path");
const { scanProject } = require("reactreach/src/scanProject");
const { extractVulnerablePackages } = require("reactreach/src/dependency/runAudit");

const POSITIVE_TIERS = new Set(["CRITICAL", "HIGH"]);

function normalizeRelative(filePath, projectRoot) {
  return path.relative(projectRoot, filePath).replace(/\\/gu, "/");
}

function findingIdentityMatchesScenario(finding, scenario, projectRoot) {
  if (finding.packageName !== scenario.packageName) return false;
  if (normalizeRelative(finding.filePath, projectRoot) !== scenario.sourceFile.replace(/\\/gu, "/")) return false;
  if (scenario.matching.component !== null && finding.component !== scenario.matching.component) return false;
  return true;
}

function secondaryFieldsMatch(finding, scenario) {
  if (finding.reachability !== scenario.expected.tier) return false;
  if (scenario.matching.sinkRuleId !== null && finding.sinkRuleId !== scenario.matching.sinkRuleId) return false;
  return finding.reasonCode === scenario.expected.reasonCode;
}

function findingExactlyMatchesScenario(finding, scenario, projectRoot) {
  return findingIdentityMatchesScenario(finding, scenario, projectRoot)
    && secondaryFieldsMatch(finding, scenario);
}

function summarizeFinding(finding, projectRoot) {
  return {
    packageName: finding.packageName,
    sourceFile: normalizeRelative(finding.filePath, projectRoot),
    component: finding.component ?? null,
    sinkRuleId: finding.sinkRuleId ?? null,
    reasonCode: finding.reasonCode,
    tier: finding.reachability,
  };
}

function uniqueValue(findings, selector) {
  const values = [...new Set(findings.map(selector))];
  return values.length === 1 ? values[0] : null;
}

function secondaryFidelity(scenario, findings) {
  const tierMatch = findings.some((finding) => finding.reachability === scenario.expected.tier);
  const reasonCodeMatch = findings.some((finding) => finding.reasonCode === scenario.expected.reasonCode);
  const sinkRuleMatch = scenario.matching.sinkRuleId === null
    ? null
    : findings.some((finding) => finding.sinkRuleId === scenario.matching.sinkRuleId);
  const exactMatch = findings.some((finding) => secondaryFieldsMatch(finding, scenario));
  return { tierMatch, sinkRuleMatch, reasonCodeMatch, exactMatch };
}

function outcome(expectedPositive, predictedPositive) {
  if (expectedPositive && predictedPositive) return "TP";
  if (!expectedPositive && predictedPositive) return "FP";
  if (!expectedPositive && !predictedPositive) return "TN";
  return "FN";
}

function evaluateScenarios(scenarios, findings, projectRoot) {
  const associatedPositiveFindingIndexes = new Set();
  const rows = scenarios.map((scenario) => {
    const identityCandidates = findings
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => findingIdentityMatchesScenario(finding, scenario, projectRoot));
    const positiveCandidates = identityCandidates
      .filter(({ finding }) => POSITIVE_TIERS.has(finding.reachability));
    for (const candidate of positiveCandidates) associatedPositiveFindingIndexes.add(candidate.index);

    const expectedPositive = scenario.expected.contextuallyReachable;
    const predictedPositive = positiveCandidates.length > 0;
    const representativeCandidates = (predictedPositive ? positiveCandidates : identityCandidates)
      .map(({ finding }) => finding);
    const fidelity = secondaryFidelity(scenario, representativeCandidates);
    const predictedTier = uniqueValue(representativeCandidates, (finding) => finding.reachability);
    return {
      scenarioId: scenario.id,
      projectId: scenario.projectId ?? null,
      packageName: scenario.packageName,
      sourceFile: scenario.sourceFile?.replace(/\\/gu, "/") ?? null,
      component: scenario.matching?.component ?? null,
      expectedTier: scenario.expected.tier,
      expectedPositive,
      predictedTier,
      predictedTiers: [...new Set(representativeCandidates.map((finding) => finding.reachability))],
      predictedPositive,
      outcome: outcome(expectedPositive, predictedPositive),
      exactTierMatch: fidelity.tierMatch,
      reasonCode: uniqueValue(representativeCandidates, (finding) => finding.reasonCode),
      sinkRuleId: uniqueValue(representativeCandidates, (finding) => finding.sinkRuleId ?? null),
      secondary: fidelity,
      findingCount: identityCandidates.length,
      positiveFindingCount: positiveCandidates.length,
      findings: identityCandidates.map(({ finding }) => summarizeFinding(finding, projectRoot)),
    };
  });

  const unexpectedPositiveFindings = findings
    .filter((finding, index) => POSITIVE_TIERS.has(finding.reachability) && !associatedPositiveFindingIndexes.has(index))
    .map((finding) => summarizeFinding(finding, projectRoot));

  return {
    rows,
    unexpectedPositiveFindings,
    reviewRequired: unexpectedPositiveFindings.length > 0,
  };
}

function safeDivide(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function calculateMetrics(rows) {
  const confusion = { TP: 0, FP: 0, TN: 0, FN: 0 };
  for (const row of rows) confusion[row.outcome]++;
  const precision = safeDivide(confusion.TP, confusion.TP + confusion.FP);
  const recall = safeDivide(confusion.TP, confusion.TP + confusion.FN);
  return {
    confusion,
    precision,
    recall,
    f1: precision === null || recall === null ? null : safeDivide(2 * precision * recall, precision + recall),
    accuracy: safeDivide(confusion.TP + confusion.TN, rows.length),
    specificity: safeDivide(confusion.TN, confusion.TN + confusion.FP),
  };
}

function fidelityMetric(rows, field) {
  const applicable = rows.filter((row) => row.secondary?.[field] !== null);
  const matches = applicable.filter((row) => row.secondary[field] === true).length;
  return {
    matches,
    total: applicable.length,
    accuracy: safeDivide(matches, applicable.length),
  };
}

function calculateSecondaryMetrics(rows) {
  return {
    tier: fidelityMetric(rows, "tierMatch"),
    sinkRule: fidelityMetric(rows, "sinkRuleMatch"),
    reasonCode: fidelityMetric(rows, "reasonCodeMatch"),
    exact: fidelityMetric(rows, "exactMatch"),
  };
}

function evaluatePresenceBaseline(scenarios, vulnerablePackages) {
  return scenarios.map((scenario) => {
    const predictedPositive = vulnerablePackages.has(scenario.packageName);
    return {
      scenarioId: scenario.id,
      projectId: scenario.projectId ?? null,
      packageName: scenario.packageName,
      sourceFile: scenario.sourceFile?.replace(/\\/gu, "/") ?? null,
      component: scenario.matching?.component ?? null,
      expectedPositive: scenario.expected.contextuallyReachable,
      predictedPositive,
      outcome: outcome(scenario.expected.contextuallyReachable, predictedPositive),
    };
  });
}

async function scanWithFrozenAudit(projectRoot, auditData, options = {}) {
  const vulnerablePackages = extractVulnerablePackages(auditData);
  const scanner = options.scanner ?? scanProject;
  const result = await scanner(projectRoot, options.config ?? {}, {
    auditRunner: async () => vulnerablePackages,
    logger: options.logger ?? null,
  });
  return { ...result, vulnerablePackages };
}

module.exports = {
  POSITIVE_TIERS,
  calculateMetrics,
  calculateSecondaryMetrics,
  evaluatePresenceBaseline,
  evaluateScenarios,
  findingIdentityMatchesScenario,
  findingExactlyMatchesScenario,
  normalizeRelative,
  outcome,
  safeDivide,
  scanWithFrozenAudit,
};
