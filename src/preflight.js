const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { extractVulnerablePackages } = require("reactreach/src/dependency/runAudit");
const { loadConfig } = require("reactreach/src/config");
const { listSinkRules } = require("reactreach/src/sinks/registry");
const {
  canonicalize,
  datasetSha256,
  readJson,
  validateGroundTruth,
} = require("./groundTruth");

const REQUIRED_REACTREACH_VERSION = "1.0.0";
const REQUIRED_REACTREACH_TAG = "v1.0.0";

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function dependencySetPayload(packageLock) {
  return Object.entries(packageLock.packages ?? {})
    .filter(([packagePath]) => packagePath !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packagePath, value]) => ({
      path: packagePath,
      version: value.version ?? null,
      resolved: value.resolved ?? null,
      integrity: value.integrity ?? null,
      dependencies: value.dependencies ?? {},
    }));
}

function dependencySetSha256(packageLock) {
  return sha256Buffer(JSON.stringify(dependencySetPayload(packageLock)));
}

function resolveInside(evaluationRoot, relativePath, label) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative path`);
  }
  const resolved = path.resolve(evaluationRoot, relativePath);
  const relative = path.relative(evaluationRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the evaluation repository`);
  }
  return resolved;
}

function gitOutput(repositoryRoot, args) {
  const normalizedRoot = repositoryRoot.replace(/\\/gu, "/");
  return execFileSync(
    "git",
    ["-c", `safe.directory=${normalizedRoot}`, "-C", repositoryRoot, ...args],
    { encoding: "utf8" },
  ).trim();
}

function installedNpmVersion() {
  const userAgentMatch = process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/u);
  if (userAgentMatch) return userAgentMatch[1];
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, "--version"], { encoding: "utf8" }).trim();
  }
  if (process.platform === "win32") {
    return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm --version"], { encoding: "utf8" }).trim();
  }
  return execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
}

function loadEvaluationConfig(evaluationRoot) {
  const configPath = path.join(evaluationRoot, "config", "reactreach-evaluation.config.json");
  const knownSinkIds = listSinkRules().map((rule) => rule.id);
  return loadConfig(evaluationRoot, { configPath }, knownSinkIds).config;
}

function checkEqual(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, received ${actual}`);
}

function requiredMetadataErrors(metadata, projectId) {
  const required = [
    "schemaVersion", "status", "projectId", "project", "packageLock", "packageLockSha256",
    "dependencySetSha256", "auditData", "auditDataSha256", "auditSnapshotOrigin", "capturedAt",
    "captureCommand", "groundTruth", "groundTruthDatasetSha256", "groundTruthFileSha256",
    "evaluationConfig", "evaluationConfigSha256", "sinkCatalog", "sinkCatalogSha256",
    "nodeVersion", "npmVersion", "reactReachRoot", "reactReachVersion", "reactReachTag",
    "reactReachCommit", "reactReachWorkingTreeClean",
  ];
  return required
    .filter((field) => metadata[field] === undefined)
    .map((field) => `Metadata for ${projectId} is missing ${field}`);
}

function validateProjectInputs(context, project) {
  const { evaluationRoot, errors, groundTruthDatasetHash, groundTruthFileHash, configHash, catalogHash } = context;
  const metadataPath = path.join(evaluationRoot, "audit-data", `${project.id}.metadata.json`);
  if (!fs.existsSync(metadataPath)) {
    errors.push(`Frozen metadata does not exist for project ${project.id}`);
    return null;
  }

  const metadata = readJson(metadataPath);
  errors.push(...requiredMetadataErrors(metadata, project.id));
  checkEqual(errors, `${project.id} metadata schema`, metadata.schemaVersion, "1.0.0");
  checkEqual(errors, `${project.id} metadata status`, metadata.status, "frozen");
  checkEqual(errors, `${project.id} metadata projectId`, metadata.projectId, project.id);
  checkEqual(errors, `${project.id} project path`, metadata.project, project.root);
  checkEqual(errors, `${project.id} package-lock path`, metadata.packageLock, `${project.root}/package-lock.json`);
  checkEqual(errors, `${project.id} audit-data path`, metadata.auditData, `audit-data/${project.id}.npm-audit.json`);
  checkEqual(errors, `${project.id} ground-truth path`, metadata.groundTruth, "ground-truth/ground-truth.json");
  checkEqual(errors, `${project.id} evaluation-config path`, metadata.evaluationConfig, "config/reactreach-evaluation.config.json");
  checkEqual(errors, `${project.id} sink-catalog path`, metadata.sinkCatalog, "config/sink-catalog.json");
  checkEqual(errors, `${project.id} ReactReach version`, metadata.reactReachVersion, REQUIRED_REACTREACH_VERSION);
  checkEqual(errors, `${project.id} ReactReach tag`, metadata.reactReachTag, REQUIRED_REACTREACH_TAG);
  checkEqual(errors, `${project.id} clean-working-tree requirement`, metadata.reactReachWorkingTreeClean, true);
  if (!new Set(["captured", "reused-equivalent-dependency-set"]).has(metadata.auditSnapshotOrigin)) {
    errors.push(`${project.id} uses an unsupported auditSnapshotOrigin: ${metadata.auditSnapshotOrigin}`);
  }

  for (const [field, expected] of [
    ["groundTruthDatasetSha256", groundTruthDatasetHash],
    ["groundTruthFileSha256", groundTruthFileHash],
    ["evaluationConfigSha256", configHash],
    ["sinkCatalogSha256", catalogHash],
    ["nodeVersion", process.version],
  ]) checkEqual(errors, `${project.id} ${field}`, metadata[field], expected);

  let packageLockPath;
  let auditDataPath;
  try {
    packageLockPath = resolveInside(evaluationRoot, metadata.packageLock, `${project.id} packageLock`);
    auditDataPath = resolveInside(evaluationRoot, metadata.auditData, `${project.id} auditData`);
  } catch (error) {
    errors.push(error.message);
    return metadata;
  }

  if (!fs.existsSync(packageLockPath)) errors.push(`${project.id} package lock does not exist`);
  if (!fs.existsSync(auditDataPath)) errors.push(`${project.id} audit data does not exist`);
  if (!fs.existsSync(packageLockPath) || !fs.existsSync(auditDataPath)) return metadata;

  checkEqual(errors, `${project.id} package-lock SHA-256`, fileSha256(packageLockPath), metadata.packageLockSha256);
  checkEqual(errors, `${project.id} audit-data SHA-256`, fileSha256(auditDataPath), metadata.auditDataSha256);

  const packageLock = readJson(packageLockPath);
  checkEqual(errors, `${project.id} dependency-set SHA-256`, dependencySetSha256(packageLock), metadata.dependencySetSha256);
  for (const vulnerablePackage of project.vulnerablePackages) {
    const locked = packageLock.packages?.[`node_modules/${vulnerablePackage.name}`];
    checkEqual(errors, `${project.id} locked ${vulnerablePackage.name} version`, locked?.version, vulnerablePackage.version);
  }

  const vulnerablePackages = extractVulnerablePackages(readJson(auditDataPath));
  for (const vulnerablePackage of project.vulnerablePackages) {
    if (!vulnerablePackages.has(vulnerablePackage.name)) {
      errors.push(`${project.id} frozen audit does not contain ${vulnerablePackage.name}`);
    }
  }

  if (metadata.auditSnapshotOrigin === "reused-equivalent-dependency-set") {
    if (!metadata.sourceAuditData) {
      errors.push(`${project.id} reused audit metadata is missing sourceAuditData`);
    } else {
      try {
        const sourceAuditPath = resolveInside(evaluationRoot, metadata.sourceAuditData, `${project.id} sourceAuditData`);
        if (!fs.existsSync(sourceAuditPath)) errors.push(`${project.id} source audit data does not exist`);
        else checkEqual(errors, `${project.id} reused audit SHA-256`, fileSha256(sourceAuditPath), metadata.auditDataSha256);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  return metadata;
}

function runPreflight(evaluationRoot, options = {}) {
  const errors = [];
  const npmVersion = installedNpmVersion();
  const evaluationCommit = gitOutput(evaluationRoot, ["rev-parse", "HEAD"]);
  const evaluationStatus = gitOutput(evaluationRoot, ["status", "--porcelain=v1"]);
  if (options.requireEvaluationClean !== false && evaluationStatus !== "") {
    errors.push("Evaluation repository requires a clean working tree");
  }
  const groundTruthPath = path.join(evaluationRoot, "ground-truth", "ground-truth.json");
  const configPath = path.join(evaluationRoot, "config", "reactreach-evaluation.config.json");
  const catalogPath = path.join(evaluationRoot, "config", "sink-catalog.json");
  const groundTruth = readJson(groundTruthPath);
  const validation = validateGroundTruth(groundTruth, { evaluationRoot });
  if (!validation.valid) errors.push(...validation.errors.map((error) => `Ground truth: ${error}`));

  const config = loadEvaluationConfig(evaluationRoot);
  const configFile = readJson(configPath);
  if (canonicalize(config) !== canonicalize(configFile)) errors.push("Loaded ReactReach configuration differs from the frozen config file");

  const frozenCatalog = readJson(catalogPath);
  const runtimeCatalog = listSinkRules();
  if (canonicalize(runtimeCatalog) !== canonicalize(frozenCatalog)) errors.push("Runtime sink catalog differs from the frozen sink catalog");

  const context = {
    evaluationRoot,
    errors,
    groundTruthDatasetHash: datasetSha256(groundTruth),
    groundTruthFileHash: fileSha256(groundTruthPath),
    configHash: fileSha256(configPath),
    catalogHash: fileSha256(catalogPath),
  };
  const metadata = groundTruth.projects
    .map((project) => validateProjectInputs(context, project))
    .filter(Boolean);
  for (const item of metadata) checkEqual(errors, `${item.projectId} npmVersion`, item.npmVersion, npmVersion);

  const repositoryRoots = [...new Set(metadata.map((item) => item.reactReachRoot))];
  if (repositoryRoots.length !== 1) errors.push("Projects do not reference one common ReactReach root");
  for (const relativeRoot of repositoryRoots) {
    const repositoryRoot = path.resolve(evaluationRoot, relativeRoot);
    if (!fs.existsSync(repositoryRoot)) {
      errors.push(`ReactReach repository does not exist: ${relativeRoot}`);
      continue;
    }
    const commit = gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
    const status = gitOutput(repositoryRoot, ["status", "--porcelain=v1"]);
    const packageMetadata = readJson(path.join(repositoryRoot, "package.json"));
    let taggedCommit = null;
    try {
      taggedCommit = gitOutput(repositoryRoot, ["rev-list", "-n", "1", REQUIRED_REACTREACH_TAG]);
    } catch {
      errors.push(`ReactReach tag does not exist: ${REQUIRED_REACTREACH_TAG}`);
    }
    checkEqual(errors, "ReactReach package version", packageMetadata.version, REQUIRED_REACTREACH_VERSION);
    if (taggedCommit !== null) checkEqual(errors, `ReactReach ${REQUIRED_REACTREACH_TAG} commit`, commit, taggedCommit);
    for (const item of metadata.filter((entry) => entry.reactReachRoot === relativeRoot)) {
      checkEqual(errors, `${item.projectId} ReactReach commit`, commit, item.reactReachCommit);
      checkEqual(errors, `${item.projectId} installed version`, packageMetadata.version, item.reactReachVersion);
      checkEqual(errors, `${item.projectId} evaluated tag`, item.reactReachTag, REQUIRED_REACTREACH_TAG);
      if (item.reactReachWorkingTreeClean === true && status !== "") {
        errors.push(`${item.projectId} requires a clean ReactReach working tree`);
      }
    }
    const installedRoot = fs.realpathSync(path.dirname(require.resolve("reactreach/package.json")));
    if (fs.realpathSync(repositoryRoot) !== installedRoot) {
      errors.push("Installed reactreach dependency does not resolve to the frozen ReactReach repository");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      projects: groundTruth.projects.length,
      scenarios: groundTruth.scenarios.length,
      groundTruthDatasetSha256: context.groundTruthDatasetHash,
      groundTruthFileSha256: context.groundTruthFileHash,
      evaluationConfigSha256: context.configHash,
      sinkCatalogSha256: context.catalogHash,
      reactReachCommit: metadata[0]?.reactReachCommit ?? null,
      reactReachVersion: metadata[0]?.reactReachVersion ?? null,
      reactReachTag: metadata[0]?.reactReachTag ?? null,
      evaluationCommit,
      nodeVersion: process.version,
      npmVersion,
    },
    config,
  };
}

module.exports = {
  dependencySetPayload,
  dependencySetSha256,
  fileSha256,
  installedNpmVersion,
  loadEvaluationConfig,
  REQUIRED_REACTREACH_TAG,
  REQUIRED_REACTREACH_VERSION,
  runPreflight,
};
