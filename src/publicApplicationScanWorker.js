const { isMainThread, parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const { extractVulnerablePackages } = require("reactreach/src/dependency/runAudit");
const { loadEvaluationConfig } = require("./preflight");
const {
  loadPublicApplicationConfig,
  reachabilityCounts,
  resolveApplicationRoot,
  serializeError,
} = require("./publicApplicationStudy");

function resolveScanProject(packageApi, loadLegacyApi = () => require("reactreach/src/scanProject")) {
  if (typeof packageApi?.scanProject === "function") return packageApi.scanProject;
  const legacyApi = loadLegacyApi();
  if (typeof legacyApi?.scanProject === "function") return legacyApi.scanProject;
  const error = new TypeError("ReactReach does not expose a scanProject function");
  error.code = "INVALID_REACTREACH_API";
  throw error;
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

async function main(data = workerData, port = parentPort, dependencies = {}) {
  const { evaluationRoot, projectId } = validateWorkerData(data);
  const { config: studyConfig } = loadPublicApplicationConfig(evaluationRoot);
  const project = studyConfig.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    const error = new Error(`Unknown public application: ${projectId}`);
    error.code = "UNKNOWN_PUBLIC_APPLICATION";
    throw error;
  }
  const workspace = path.join(evaluationRoot, ".work", "public-applications", projectId);
  const projectRoot = resolveApplicationRoot(workspace, project);
  const auditPath = path.join(evaluationRoot, "audit-data", "public-applications", projectId, "npm-audit.json");
  const auditReport = JSON.parse(require("node:fs").readFileSync(auditPath, "utf8"));
  const vulnerablePackages = extractVulnerablePackages(auditReport);
  const analyserConfig = loadEvaluationConfig(evaluationRoot);
  const scanProject = dependencies.scanProject ?? resolveScanProject(require("reactreach"));
  const stageRss = [];
  const startedAt = new Date().toISOString();
  port.postMessage({ type: "scan-started", startedAt, rssBytes: process.memoryUsage.rss() });
  const result = await scanProject(projectRoot, analyserConfig, {
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
    rssBytes: process.memoryUsage.rss(),
    result: {
      schemaVersion: "1.0.0",
      projectId,
      startedAt,
      completedAt,
      report: result.report,
      findings: result.findings,
      diagnostics: result.diagnostics ?? [],
      timings: result.timings ?? {},
      reachabilityCounts: reachabilityCounts(result.findings),
      stageRss,
    },
  });
  port.close();
}

function processPort() {
  return {
    postMessage(message) {
      if (typeof process.send === "function") process.send(message);
    },
    close() {
      if (process.connected) process.disconnect();
    },
  };
}

function processWorkerData(value = process.argv[2]) {
  try {
    return JSON.parse(value);
  } catch (cause) {
    const error = new TypeError(`Unable to parse public-application worker data: ${cause.message}`);
    error.code = "INVALID_WORKER_DATA";
    throw error;
  }
}

if (!isMainThread) {
  main().catch((error) => {
    parentPort.postMessage({ type: "scan-error", error: serializeError(error), rssBytes: process.memoryUsage.rss() });
    parentPort.close();
  });
} else if (require.main === module) {
  const port = processPort();
  Promise.resolve().then(() => main(processWorkerData(), port)).catch((error) => {
    port.postMessage({ type: "scan-error", error: serializeError(error), rssBytes: process.memoryUsage.rss() });
    port.close();
  });
}

module.exports = { main, processWorkerData, resolveScanProject, validateWorkerData };
