const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { extractVulnerablePackages } = require("reactreach/src/dependency/runAudit");
const { datasetSha256, readJson } = require("./groundTruth");
const {
  dependencySetSha256,
  fileSha256,
  runPreflight,
} = require("./preflight");
const {
  PERFORMANCE_CONFIG,
  PROJECT_MANIFEST,
  loadPerformanceConfig,
  validateAllGeneratedProjects,
} = require("./performanceProjects");
const {
  PERFORMANCE_BENCHMARK_CONFIG,
  loadPerformanceBenchmarkConfig,
} = require("./performanceProtocol");

const GENERATOR_SCRIPT = path.join("scripts", "generatePerformanceProjects.js");
const SOURCE_AUDIT = path.join("audit-data", "effectiveness-core.npm-audit.json");
const GROUND_TRUTH = path.join("ground-truth", "ground-truth.json");
const EVALUATION_CONFIG = path.join("config", "reactreach-evaluation.config.json");
const SINK_CATALOG = path.join("config", "sink-catalog.json");

function toPosix(value) {
  return value.replace(/\\/gu, "/");
}

function relativeProjectRoot(config, project) {
  return toPosix(path.join(config.generatedRoot, project.id));
}

function performancePaths(evaluationRoot, config, project) {
  const projectRelative = relativeProjectRoot(config, project);
  return {
    projectRelative,
    projectRoot: path.join(evaluationRoot, projectRelative),
    packageJsonRelative: `${projectRelative}/package.json`,
    packageLockRelative: `${projectRelative}/package-lock.json`,
    manifestRelative: `${projectRelative}/${PROJECT_MANIFEST}`,
    auditRelative: `audit-data/${project.id}.npm-audit.json`,
    metadataRelative: `audit-data/${project.id}.metadata.json`,
  };
}

function fixedScenarioCount(groundTruth) {
  return groundTruth.scenarios.filter((scenario) => scenario.projectId === "effectiveness-core").length;
}

function createFreezeContext(evaluationRoot, options = {}) {
  const basePreflight = (options.preflightRunner ?? runPreflight)(evaluationRoot);
  if (!basePreflight.valid) {
    throw new Error(`Base evaluation preflight failed:\n${basePreflight.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const config = loadPerformanceConfig(evaluationRoot);
  const benchmarkConfig = loadPerformanceBenchmarkConfig(evaluationRoot);
  const generated = validateAllGeneratedProjects(evaluationRoot);
  if (!generated.valid) {
    throw new Error(`Generated performance projects are invalid:\n${generated.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const groundTruth = readJson(path.join(evaluationRoot, GROUND_TRUTH));
  const sourceAuditPath = path.join(evaluationRoot, SOURCE_AUDIT);
  const coreLockPath = path.join(evaluationRoot, config.coreProject, "package-lock.json");
  const coreDependencySetSha256 = dependencySetSha256(readJson(coreLockPath));
  return {
    basePreflight,
    config,
    benchmarkConfig,
    generated,
    groundTruth,
    sourceAuditPath,
    sourceAuditSha256: fileSha256(sourceAuditPath),
    coreDependencySetSha256,
    performanceConfigSha256: fileSha256(path.join(evaluationRoot, PERFORMANCE_CONFIG)),
    generatorScriptSha256: fileSha256(path.join(evaluationRoot, GENERATOR_SCRIPT)),
    performanceBenchmarkConfigSha256: fileSha256(path.join(evaluationRoot, PERFORMANCE_BENCHMARK_CONFIG)),
  };
}

function buildMetadata(evaluationRoot, context, project, capturedAt) {
  const { config, basePreflight, groundTruth } = context;
  const paths = performancePaths(evaluationRoot, config, project);
  const generatedProject = context.generated.projects.find((item) => item.projectId === project.id);
  const packageLock = readJson(path.join(evaluationRoot, paths.packageLockRelative));
  const dependencyHash = dependencySetSha256(packageLock);
  if (dependencyHash !== context.coreDependencySetSha256) {
    throw new Error(`${project.id} dependency set differs from the frozen core dependency set`);
  }
  return {
    schemaVersion: "1.0.0",
    status: "frozen",
    purpose: "performance",
    projectId: project.id,
    project: paths.projectRelative,
    targetSourceFiles: project.targetSourceFiles,
    sourceFileCount: generatedProject.summary.sourceFileCount,
    coreSourceFiles: generatedProject.summary.core.sourceFileCount,
    benignSourceFiles: generatedProject.summary.benign.sourceFileCount,
    fixedScenarioGroundTruthProjectId: "effectiveness-core",
    fixedScenarioCount: fixedScenarioCount(groundTruth),
    sourceTreeSha256: generatedProject.summary.sourceTreeSha256,
    coreSourceTreeSha256: generatedProject.summary.core.sourceTreeSha256,
    performanceManifest: paths.manifestRelative,
    performanceManifestSha256: fileSha256(path.join(evaluationRoot, paths.manifestRelative)),
    performanceConfig: toPosix(PERFORMANCE_CONFIG),
    performanceConfigSha256: context.performanceConfigSha256,
    generatorScript: toPosix(GENERATOR_SCRIPT),
    generatorScriptSha256: context.generatorScriptSha256,
    packageJson: paths.packageJsonRelative,
    packageJsonSha256: fileSha256(path.join(evaluationRoot, paths.packageJsonRelative)),
    packageLock: paths.packageLockRelative,
    packageLockSha256: fileSha256(path.join(evaluationRoot, paths.packageLockRelative)),
    dependencySetSha256: dependencyHash,
    auditData: paths.auditRelative,
    auditDataSha256: context.sourceAuditSha256,
    auditSnapshotOrigin: "reused-equivalent-dependency-set",
    sourceAuditData: toPosix(SOURCE_AUDIT),
    capturedAt,
    captureCommand: "npm run evaluation:metadata:refresh",
    groundTruth: toPosix(GROUND_TRUTH),
    groundTruthDatasetSha256: datasetSha256(groundTruth),
    groundTruthFileSha256: fileSha256(path.join(evaluationRoot, GROUND_TRUTH)),
    evaluationConfig: toPosix(EVALUATION_CONFIG),
    evaluationConfigSha256: fileSha256(path.join(evaluationRoot, EVALUATION_CONFIG)),
    sinkCatalog: toPosix(SINK_CATALOG),
    sinkCatalogSha256: fileSha256(path.join(evaluationRoot, SINK_CATALOG)),
    nodeVersion: basePreflight.summary.nodeVersion,
    npmVersion: basePreflight.summary.npmVersion,
    environment: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model.trim() ?? null,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    reactReachRoot: "../ReactReach",
    reactReachVersion: basePreflight.summary.reactReachVersion,
    reactReachTag: basePreflight.summary.reactReachTag,
    reactReachCommit: basePreflight.summary.reactReachCommit,
    reactReachWorkingTreeClean: true,
  };
}

function writeNewJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function freezePerformanceInputs(evaluationRoot, options = {}) {
  const context = createFreezeContext(evaluationRoot, options);
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  const outputs = context.config.projects.map((project) => {
    const paths = performancePaths(evaluationRoot, context.config, project);
    return { project, paths, metadata: buildMetadata(evaluationRoot, context, project, capturedAt) };
  });
  for (const output of outputs) {
    for (const relative of [output.paths.auditRelative, output.paths.metadataRelative]) {
      if (fs.existsSync(path.join(evaluationRoot, relative))) {
        const error = new Error(`Refusing to overwrite frozen performance input: ${toPosix(relative)}`);
        error.code = "PERFORMANCE_INPUT_EXISTS";
        throw error;
      }
    }
  }
  for (const output of outputs) {
    fs.copyFileSync(
      context.sourceAuditPath,
      path.join(evaluationRoot, output.paths.auditRelative),
      fs.constants.COPYFILE_EXCL,
    );
    writeNewJson(path.join(evaluationRoot, output.paths.metadataRelative), output.metadata);
  }
  return outputs.map((output) => output.metadata);
}

function checkEqual(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, received ${actual}`);
}

function requiredMetadataFields(metadata, projectId) {
  const fields = [
    "schemaVersion", "status", "purpose", "projectId", "project", "targetSourceFiles",
    "sourceFileCount", "coreSourceFiles", "benignSourceFiles", "fixedScenarioGroundTruthProjectId",
    "fixedScenarioCount", "sourceTreeSha256", "coreSourceTreeSha256", "performanceManifest",
    "performanceManifestSha256", "performanceConfig", "performanceConfigSha256", "generatorScript",
    "generatorScriptSha256", "packageJson", "packageJsonSha256", "packageLock", "packageLockSha256",
    "dependencySetSha256", "auditData", "auditDataSha256", "auditSnapshotOrigin", "sourceAuditData",
    "capturedAt", "captureCommand", "groundTruth", "groundTruthDatasetSha256", "groundTruthFileSha256",
    "evaluationConfig", "evaluationConfigSha256", "sinkCatalog", "sinkCatalogSha256", "nodeVersion",
    "npmVersion", "environment", "reactReachRoot", "reactReachVersion", "reactReachTag",
    "reactReachCommit", "reactReachWorkingTreeClean",
  ];
  return fields.filter((field) => metadata[field] === undefined).map((field) => `${projectId} metadata is missing ${field}`);
}

function validatePerformanceMetadata(evaluationRoot, context, project, errors) {
  const paths = performancePaths(evaluationRoot, context.config, project);
  const metadataPath = path.join(evaluationRoot, paths.metadataRelative);
  const auditPath = path.join(evaluationRoot, paths.auditRelative);
  if (!fs.existsSync(metadataPath)) {
    errors.push(`${project.id} frozen metadata does not exist`);
    return null;
  }
  if (!fs.existsSync(auditPath)) errors.push(`${project.id} frozen audit does not exist`);
  const metadata = readJson(metadataPath);
  errors.push(...requiredMetadataFields(metadata, project.id));
  const generated = context.generated.projects.find((item) => item.projectId === project.id).summary;
  const expected = {
    schemaVersion: "1.0.0",
    status: "frozen",
    purpose: "performance",
    projectId: project.id,
    project: paths.projectRelative,
    targetSourceFiles: project.targetSourceFiles,
    sourceFileCount: generated.sourceFileCount,
    coreSourceFiles: generated.core.sourceFileCount,
    benignSourceFiles: generated.benign.sourceFileCount,
    fixedScenarioGroundTruthProjectId: "effectiveness-core",
    fixedScenarioCount: fixedScenarioCount(context.groundTruth),
    sourceTreeSha256: generated.sourceTreeSha256,
    coreSourceTreeSha256: generated.core.sourceTreeSha256,
    performanceManifest: paths.manifestRelative,
    performanceManifestSha256: fileSha256(path.join(evaluationRoot, paths.manifestRelative)),
    performanceConfig: toPosix(PERFORMANCE_CONFIG),
    performanceConfigSha256: context.performanceConfigSha256,
    generatorScript: toPosix(GENERATOR_SCRIPT),
    generatorScriptSha256: context.generatorScriptSha256,
    packageJson: paths.packageJsonRelative,
    packageJsonSha256: fileSha256(path.join(evaluationRoot, paths.packageJsonRelative)),
    packageLock: paths.packageLockRelative,
    packageLockSha256: fileSha256(path.join(evaluationRoot, paths.packageLockRelative)),
    dependencySetSha256: dependencySetSha256(readJson(path.join(evaluationRoot, paths.packageLockRelative))),
    auditData: paths.auditRelative,
    auditDataSha256: context.sourceAuditSha256,
    auditSnapshotOrigin: "reused-equivalent-dependency-set",
    sourceAuditData: toPosix(SOURCE_AUDIT),
    captureCommand: "npm run evaluation:metadata:refresh",
    groundTruth: toPosix(GROUND_TRUTH),
    groundTruthDatasetSha256: datasetSha256(context.groundTruth),
    groundTruthFileSha256: fileSha256(path.join(evaluationRoot, GROUND_TRUTH)),
    evaluationConfig: toPosix(EVALUATION_CONFIG),
    evaluationConfigSha256: fileSha256(path.join(evaluationRoot, EVALUATION_CONFIG)),
    sinkCatalog: toPosix(SINK_CATALOG),
    sinkCatalogSha256: fileSha256(path.join(evaluationRoot, SINK_CATALOG)),
    nodeVersion: context.basePreflight.summary.nodeVersion,
    npmVersion: context.basePreflight.summary.npmVersion,
    reactReachRoot: "../ReactReach",
    reactReachVersion: context.basePreflight.summary.reactReachVersion,
    reactReachTag: context.basePreflight.summary.reactReachTag,
    reactReachCommit: context.basePreflight.summary.reactReachCommit,
    reactReachWorkingTreeClean: true,
  };
  for (const [field, value] of Object.entries(expected)) checkEqual(errors, `${project.id} ${field}`, metadata[field], value);
  if (typeof metadata.capturedAt !== "string" || Number.isNaN(Date.parse(metadata.capturedAt))) errors.push(`${project.id} capturedAt is not an ISO timestamp`);
  if (!metadata.environment || typeof metadata.environment !== "object") errors.push(`${project.id} environment is invalid`);
  checkEqual(errors, `${project.id} dependency-set equivalence`, metadata.dependencySetSha256, context.coreDependencySetSha256);
  if (fs.existsSync(auditPath)) {
    checkEqual(errors, `${project.id} audit SHA-256`, fileSha256(auditPath), metadata.auditDataSha256);
    checkEqual(errors, `${project.id} reused audit bytes`, fileSha256(auditPath), context.sourceAuditSha256);
    const vulnerablePackages = extractVulnerablePackages(readJson(auditPath));
    if (!vulnerablePackages.has("marked")) errors.push(`${project.id} audit does not contain marked`);
  }
  const packageLock = readJson(path.join(evaluationRoot, paths.packageLockRelative));
  checkEqual(errors, `${project.id} marked version`, packageLock.packages?.["node_modules/marked"]?.version, "0.3.19");
  return metadata;
}

function runPerformancePreflight(evaluationRoot, options = {}) {
  const errors = [];
  let context;
  try {
    context = createFreezeContext(evaluationRoot, options);
  } catch (error) {
    return { valid: false, errors: [error.message], summary: null };
  }
  const metadata = context.config.projects.map((project) => validatePerformanceMetadata(evaluationRoot, context, project, errors)).filter(Boolean);
  const commonCoreHashes = new Set(metadata.map((item) => item.coreSourceTreeSha256));
  const commonDependencyHashes = new Set(metadata.map((item) => item.dependencySetSha256));
  const commonAuditHashes = new Set(metadata.map((item) => item.auditDataSha256));
  if (commonCoreHashes.size !== 1) errors.push("Performance projects do not share one core source-tree hash");
  if (commonDependencyHashes.size !== 1) errors.push("Performance projects do not share one dependency-set hash");
  if (commonAuditHashes.size !== 1) errors.push("Performance projects do not share one audit-data hash");
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      projects: metadata.map((item) => ({
        projectId: item.projectId,
        sourceFileCount: item.sourceFileCount,
        coreSourceFiles: item.coreSourceFiles,
        benignSourceFiles: item.benignSourceFiles,
        sourceTreeSha256: item.sourceTreeSha256,
      })),
      coreSourceTreeSha256: metadata[0]?.coreSourceTreeSha256 ?? null,
      dependencySetSha256: metadata[0]?.dependencySetSha256 ?? null,
      auditDataSha256: metadata[0]?.auditDataSha256 ?? null,
      performanceConfigSha256: context.performanceConfigSha256,
      performanceBenchmarkConfigSha256: context.performanceBenchmarkConfigSha256,
      generatorScriptSha256: context.generatorScriptSha256,
      evaluationConfigSha256: context.basePreflight.summary.evaluationConfigSha256,
      sinkCatalogSha256: context.basePreflight.summary.sinkCatalogSha256,
      groundTruthDatasetSha256: context.basePreflight.summary.groundTruthDatasetSha256,
      evaluationCommit: context.basePreflight.summary.evaluationCommit,
      nodeVersion: context.basePreflight.summary.nodeVersion,
      npmVersion: context.basePreflight.summary.npmVersion,
      environment: metadata[0]?.environment ?? null,
      reactReachVersion: context.basePreflight.summary.reactReachVersion,
      reactReachTag: context.basePreflight.summary.reactReachTag,
      reactReachCommit: context.basePreflight.summary.reactReachCommit,
    },
  };
}

module.exports = {
  buildMetadata,
  createFreezeContext,
  freezePerformanceInputs,
  performancePaths,
  runPerformancePreflight,
};
