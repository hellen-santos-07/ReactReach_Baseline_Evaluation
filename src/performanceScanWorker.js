const { isMainThread, parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { extractVulnerablePackages } = require("reactreach/src/dependency/runAudit");
const { readJson } = require("./groundTruth");
const { loadEvaluationConfig } = require("./preflight");

/**
 * Resolve the analyser entry point from the public package API.
 *
 * The frozen v1.0.0 evaluation artefact predates that API, so the legacy
 * loader is retained only to keep the original evaluation reproducible.
 *
 * @param {object} packageApi - Value exported by `require("reactreach")`.
 * @param {Function} [loadLegacyApi] - Compatibility loader for ReactReach v1.0.0.
 * @returns {Function} The ReactReach project scanner.
 */
function resolveScanProject(
  packageApi,
  loadLegacyApi = () => require("reactreach/src/scanProject"),
) {
  if (typeof packageApi?.scanProject === "function") return packageApi.scanProject;

  const legacyApi = loadLegacyApi();
  if (typeof legacyApi?.scanProject === "function") return legacyApi.scanProject;

  const error = new TypeError("ReactReach does not expose a scanProject function");
  error.code = "INVALID_REACTREACH_API";
  throw error;
}

const scanProject = resolveScanProject(require("reactreach"));

function serializeError(error) {
  return {
    name: error.name,
    code: error.code ?? null,
    message: error.message,
    stack: error.stack ?? null,
  };
}

function validateWorkerData(data) {
  for (const field of ["evaluationRoot", "projectId"]) {
    if (typeof data?.[field] !== "string" || data[field].trim() === "") {
      const error = new TypeError(`workerData.${field} must be a non-empty string`);
      error.code = "INVALID_WORKER_DATA";
      throw error;
    }
  }
  return { evaluationRoot: data.evaluationRoot, projectId: data.projectId };
}

async function main(data = workerData, port = parentPort) {
  const { evaluationRoot, projectId } = validateWorkerData(data);
  const projectRoot = path.join(evaluationRoot, "generated-projects", projectId);
  const auditPath = path.join(evaluationRoot, "audit-data", `${projectId}.npm-audit.json`);
  const config = loadEvaluationConfig(evaluationRoot);
  const vulnerablePackages = extractVulnerablePackages(readJson(auditPath));
  const stageRss = [];
  const startedAt = new Date().toISOString();
  port.postMessage({ type: "scan-started", startedAt, rssBytes: process.memoryUsage.rss() });
  const result = await scanProject(projectRoot, config, {
    auditRunner: async () => vulnerablePackages,
    logger(event) {
      const checkpoint = {
        stage: event.stage,
        durationMs: event.durationMs ?? null,
        rssBytes: process.memoryUsage.rss(),
      };
      stageRss.push(checkpoint);
      port.postMessage({ type: "stage", ...checkpoint });
    },
  });
  const completedAt = new Date().toISOString();
  port.postMessage({
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
  port.close();
}

if (!isMainThread) {
  main().catch((error) => {
    parentPort.postMessage({ type: "scan-error", error: serializeError(error), rssBytes: process.memoryUsage.rss() });
    parentPort.close();
  });
}

module.exports = { main, resolveScanProject, serializeError, validateWorkerData };
