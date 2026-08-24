const path = require("node:path");
const { readJson } = require("./groundTruth");

const PERFORMANCE_BENCHMARK_CONFIG = path.join("config", "performance-benchmark.json");

function validatePerformanceBenchmarkConfig(config) {
  const errors = [];
  const exact = {
    schemaVersion: "1.0.0",
    executionModel: "fresh-process-per-sample",
    sequential: true,
    warmupRuns: 3,
    measuredRuns: 30,
    rssSampleIntervalMs: 5,
    sampleTimeoutMs: 120000,
    primaryDuration: "staticAnalysisMs",
    auditLatency: "frozen-local-injection-excluded",
    p95Method: "nearest-rank",
    sampleStandardDeviation: true,
  };
  for (const [field, expected] of Object.entries(exact)) {
    if (config?.[field] !== expected) errors.push(`${field} must be ${expected}`);
  }
  if (config?.outliers?.method !== "tukey-1.5-iqr") errors.push("outliers.method must be tukey-1.5-iqr");
  if (config?.outliers?.excludeAutomatically !== false) errors.push("outliers.excludeAutomatically must be false");
  const expectedTimings = [
    "auditMs", "parseMs", "dependenciesMs", "componentsMs", "sinksMs", "graphMs",
    "reachabilityMs", "staticAnalysisMs", "reportMs", "totalMs",
  ];
  if (!Array.isArray(config?.retainedTimings) || JSON.stringify(config.retainedTimings) !== JSON.stringify(expectedTimings)) {
    errors.push("retainedTimings differs from the frozen timing fields");
  }
  if (config?.thresholds?.projectId !== "performance-500") errors.push("thresholds.projectId must be performance-500");
  if (config?.thresholds?.p95StaticAnalysisMsBelow !== 30000) errors.push("p95 threshold must be 30000 ms");
  if (config?.thresholds?.peakRssBytesBelow !== 536870912) errors.push("RSS threshold must be 536870912 bytes");
  return { valid: errors.length === 0, errors };
}

function loadPerformanceBenchmarkConfig(evaluationRoot) {
  const config = readJson(path.join(evaluationRoot, PERFORMANCE_BENCHMARK_CONFIG));
  const validation = validatePerformanceBenchmarkConfig(config);
  if (!validation.valid) throw new Error(`Invalid performance benchmark config:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  return config;
}

function assertNumbers(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} must contain at least one finite number`);
  }
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function medianSorted(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function nearestRank(values, probability) {
  assertNumbers(values, "nearest-rank values");
  if (!(probability > 0 && probability <= 1)) throw new Error("Nearest-rank probability must be in (0, 1]");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(probability * sorted.length) - 1];
}

function sampleStandardDeviation(values) {
  assertNumbers(values, "standard-deviation values");
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((total, value) => total + ((value - average) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function describe(values) {
  assertNumbers(values, "descriptive-statistics values");
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: mean(values),
    sampleStandardDeviation: sampleStandardDeviation(values),
    median: medianSorted(sorted),
    p95: nearestRank(values, 0.95),
  };
}

function tukeyBounds(values) {
  assertNumbers(values, "Tukey values");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const lowerHalf = sorted.slice(0, middle);
  const upperHalf = sorted.slice(sorted.length % 2 === 0 ? middle : middle + 1);
  const q1 = lowerHalf.length ? medianSorted(lowerHalf) : sorted[0];
  const q3 = upperHalf.length ? medianSorted(upperHalf) : sorted[sorted.length - 1];
  const iqr = q3 - q1;
  return { q1, q3, iqr, lower: q1 - (1.5 * iqr), upper: q3 + (1.5 * iqr) };
}

function outlierIndexes(values) {
  const bounds = tukeyBounds(values);
  return {
    bounds,
    indexes: values.flatMap((value, index) => value < bounds.lower || value > bounds.upper ? [index] : []),
  };
}

function summarizeMeasuredSamples(samples, config) {
  if (samples.length !== config.measuredRuns) {
    throw new Error(`Expected ${config.measuredRuns} measured samples, received ${samples.length}`);
  }
  const timings = {};
  for (const field of config.retainedTimings) timings[field] = describe(samples.map((sample) => sample.timings[field]));
  const rss = describe(samples.map((sample) => sample.peakRssBytes));
  const outliers = outlierIndexes(samples.map((sample) => sample.timings[config.primaryDuration]));
  return {
    sampleCount: samples.length,
    timings,
    peakRssBytes: rss,
    peakRssMiB: {
      count: rss.count,
      min: rss.min / (1024 ** 2),
      max: rss.max / (1024 ** 2),
      mean: rss.mean / (1024 ** 2),
      sampleStandardDeviation: rss.sampleStandardDeviation === null ? null : rss.sampleStandardDeviation / (1024 ** 2),
      median: rss.median / (1024 ** 2),
      p95: rss.p95 / (1024 ** 2),
    },
    outliers: {
      method: config.outliers.method,
      excludedAutomatically: false,
      bounds: outliers.bounds,
      measurementIndexes: outliers.indexes.map((index) => samples[index].measurementIndex),
      count: outliers.indexes.length,
    },
  };
}

function evaluateThresholds(projectSummaries, config) {
  const summary = projectSummaries.find((project) => project.projectId === config.thresholds.projectId);
  if (!summary) throw new Error(`Threshold project ${config.thresholds.projectId} is missing`);
  const p95 = summary.statistics.timings.staticAnalysisMs.p95;
  const peak = summary.statistics.peakRssBytes.max;
  return {
    projectId: summary.projectId,
    p95StaticAnalysisMs: {
      observed: p95,
      requiredBelow: config.thresholds.p95StaticAnalysisMsBelow,
      passed: p95 < config.thresholds.p95StaticAnalysisMsBelow,
    },
    peakRssBytes: {
      observed: peak,
      requiredBelow: config.thresholds.peakRssBytesBelow,
      passed: peak < config.thresholds.peakRssBytesBelow,
    },
    passed: p95 < config.thresholds.p95StaticAnalysisMsBelow && peak < config.thresholds.peakRssBytesBelow,
  };
}

module.exports = {
  PERFORMANCE_BENCHMARK_CONFIG,
  describe,
  evaluateThresholds,
  loadPerformanceBenchmarkConfig,
  nearestRank,
  outlierIndexes,
  sampleStandardDeviation,
  summarizeMeasuredSamples,
  tukeyBounds,
  validatePerformanceBenchmarkConfig,
};
