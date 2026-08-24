const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  calculateMetrics,
  calculateSecondaryMetrics,
  evaluatePresenceBaseline,
  evaluateScenarios,
  safeDivide,
} = require("../src/effectiveness");

test("metric calculation follows the frozen confusion-matrix definitions", () => {
  const rows = [
    { outcome: "TP" },
    { outcome: "TP" },
    { outcome: "FP" },
    { outcome: "TN" },
    { outcome: "FN" },
  ];
  const metrics = calculateMetrics(rows);
  assert.deepEqual(metrics.confusion, { TP: 2, FP: 1, TN: 1, FN: 1 });
  assert.equal(metrics.precision, 2 / 3);
  assert.equal(metrics.recall, 2 / 3);
  assert.equal(metrics.f1, 2 / 3);
  assert.equal(metrics.accuracy, 3 / 5);
  assert.equal(metrics.specificity, 1 / 2);
});

test("zero denominators produce null instead of an invented zero", () => {
  assert.equal(safeDivide(0, 0), null);
  const metrics = calculateMetrics([{ outcome: "TN" }]);
  assert.equal(metrics.precision, null);
  assert.equal(metrics.recall, null);
  assert.equal(metrics.f1, null);
});

test("multiple findings still produce one binary classification and remain available for review", () => {
  const root = path.resolve("project");
  const scenario = {
    id: "ambiguous-case",
    packageName: "pkg",
    sourceFile: "src/App.jsx",
    expected: { tier: "HIGH", contextuallyReachable: true, reasonCode: "PROPAGATED_SINK_FLOW" },
    matching: { component: "App", sinkRuleId: "inner-html" },
  };
  const finding = {
    packageName: "pkg",
    filePath: path.join(root, "src", "App.jsx"),
    component: "App",
    sinkRuleId: "inner-html",
    reasonCode: "PROPAGATED_SINK_FLOW",
    reachability: "HIGH",
  };
  const result = evaluateScenarios([scenario], [finding, { ...finding }], root);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].outcome, "TP");
  assert.equal(result.rows[0].positiveFindingCount, 2);
  assert.equal(result.rows[0].findings.length, 2);
  assert.equal(result.rows[0].secondary.exactMatch, true);
});

test("a positive finding on a negative scenario is counted as a false positive even with a different reason code", () => {
  const root = path.resolve("project");
  const scenario = {
    id: "negative-case",
    packageName: "pkg",
    sourceFile: "src/App.jsx",
    expected: { tier: "MEDIUM", contextuallyReachable: false, reasonCode: "NO_PROVEN_SINK_PATH" },
    matching: { component: "App", sinkRuleId: null },
  };
  const falsePositive = {
    packageName: "pkg",
    filePath: path.join(root, "src", "App.jsx"),
    component: "App",
    sinkRuleId: "inner-html",
    reasonCode: "PROPAGATED_SINK_FLOW",
    reachability: "HIGH",
  };
  const result = evaluateScenarios([scenario], [falsePositive], root);
  assert.equal(result.rows[0].outcome, "FP");
  assert.equal(result.rows[0].predictedTier, "HIGH");
  assert.deepEqual(result.unexpectedPositiveFindings, []);
  assert.equal(result.reviewRequired, false);
  assert.equal(result.rows[0].secondary.tierMatch, false);
});

test("a positive binary prediction remains a TP when secondary explanation fields differ", () => {
  const root = path.resolve("project");
  const scenario = {
    id: "positive-different-explanation",
    packageName: "pkg",
    sourceFile: "src/App.jsx",
    expected: { tier: "HIGH", contextuallyReachable: true, reasonCode: "PROPAGATED_SINK_FLOW" },
    matching: { component: "App", sinkRuleId: "inner-html" },
  };
  const finding = {
    packageName: "pkg",
    filePath: path.join(root, "src", "App.jsx"),
    component: "App",
    sinkRuleId: "eval",
    reasonCode: "DIRECT_SINK_FLOW",
    reachability: "CRITICAL",
  };
  const result = evaluateScenarios([scenario], [finding], root);
  assert.equal(result.rows[0].outcome, "TP");
  assert.deepEqual(result.rows[0].secondary, {
    tierMatch: false,
    sinkRuleMatch: false,
    reasonCodeMatch: false,
    exactMatch: false,
  });
  assert.deepEqual(calculateSecondaryMetrics(result.rows).tier, { matches: 0, total: 1, accuracy: 0 });
});

test("an unmatched positive finding requires manual review", () => {
  const root = path.resolve("project");
  const scenario = {
    id: "known-negative",
    packageName: "pkg",
    sourceFile: "src/Known.jsx",
    expected: { tier: "NONE", contextuallyReachable: false, reasonCode: "UNUSED_IMPORT" },
    matching: { component: "Known", sinkRuleId: null },
  };
  const unexpected = {
    packageName: "pkg",
    filePath: path.join(root, "src", "Unexpected.jsx"),
    component: "Unexpected",
    sinkRuleId: "eval",
    reasonCode: "DIRECT_SINK_FLOW",
    reachability: "CRITICAL",
  };
  const result = evaluateScenarios([scenario], [unexpected], root);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.unexpectedPositiveFindings.length, 1);
});

test("the npm audit presence baseline predicts from vulnerable package presence", () => {
  const scenarios = [
    { id: "positive", packageName: "marked", expected: { contextuallyReachable: true } },
    { id: "negative", packageName: "marked", expected: { contextuallyReachable: false } },
    { id: "absent", packageName: "other", expected: { contextuallyReachable: false } },
  ];
  const rows = evaluatePresenceBaseline(scenarios, new Map([["marked", {}]]));
  assert.deepEqual(rows.map((row) => row.outcome), ["TP", "FP", "TN"]);
});
