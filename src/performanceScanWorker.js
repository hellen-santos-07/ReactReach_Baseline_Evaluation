const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { scanProject } = require("reactreach/src/scanProject");
const { extractVulnerablePackages } = require("reactreach/src/dependency/runAudit");
const { readJson } = require("./groundTruth");
const { loadEvaluationConfig } = require("./preflight");

function serializeError(error) {
  return {
    name: error.name,
    code: error.code ?? null,
    message: error.message,
    stack: error.stack ?? null,
  };
}

async function main() {
  const { evaluationRoot, projectId } = workerData;
  const projectRoot = path.join(evaluationRoot, "generated-projects", projectId);
  const auditPath = path.join(evaluationRoot, "audit-data", `${projectId}.npm-audit.json`);
  const config = loadEvaluationConfig(evaluationRoot);
  const vulnerablePackages = extractVulnerablePackages(readJson(auditPath));
  const stageRss = [];
  const startedAt = new Date().toISOString();
  parentPort.postMessage({ type: "scan-started", startedAt, rssBytes: process.memoryUsage.rss() });
  const result = await scanProject(projectRoot, config, {
    auditRunner: async () => vulnerablePackages,
    logger(event) {
      const checkpoint = {
        stage: event.stage,
        durationMs: event.durationMs ?? null,
        rssBytes: process.memoryUsage.rss(),
      };
      stageRss.push(checkpoint);
      parentPort.postMessage({ type: "stage", ...checkpoint });
    },
  });
  const completedAt = new Date().toISOString();
  parentPort.postMessage({
    type: "scan-completed",
    result: {
      schemaVersion: "1.0.0",
      projectId,
      startedAt,
      completedAt,
      timings: result.timings,
      sourceFileCount: result.report.summary.sourceFiles,
      componentCount: result.report.summary.components,
      sinkCount: result.report.summary.sinks,
      findingCount: result.findings.length,
      diagnosticCount: result.diagnostics.length,
      diagnostics: result.diagnostics,
      stageRss,
    },
    rssBytes: process.memoryUsage.rss(),
  });
  parentPort.close();
}

main().catch((error) => {
  parentPort.postMessage({ type: "scan-error", error: serializeError(error), rssBytes: process.memoryUsage.rss() });
  parentPort.close();
});
