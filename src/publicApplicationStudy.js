const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { fileSha256, installedNpmVersion } = require("./preflight");

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const REACHABILITY_LEVELS = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function toPosix(value) {
  return value.replace(/\\/gu, "/");
}

function gitOutput(repositoryRoot, args) {
  const normalizedRoot = repositoryRoot.replace(/\\/gu, "/");
  return execFileSync(
    "git",
    ["-c", `safe.directory=${normalizedRoot}`, "-C", repositoryRoot, ...args],
    { encoding: "utf8" },
  ).trim();
}

function loadPublicApplicationConfig(evaluationRoot) {
  const configPath = path.join(evaluationRoot, "config", "public-applications.json");
  const config = readJson(configPath);
  const errors = validatePublicApplicationConfig(config);
  if (errors.length > 0) {
    const error = new Error(`Invalid public-application configuration:\n${errors.map((item) => `- ${item}`).join("\n")}`);
    error.code = "INVALID_PUBLIC_APPLICATION_CONFIG";
    throw error;
  }
  return { config, configPath };
}

function validatePublicApplicationConfig(config) {
  const errors = [];
  if (config?.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
  if (!Array.isArray(config?.projects) || config.projects.length < 2 || config.projects.length > 3) {
    errors.push("projects must contain two or three applications");
    return errors;
  }
  const ids = new Set();
  for (const [index, project] of config.projects.entries()) {
    const prefix = `projects[${index}]`;
    for (const field of [
      "id", "repository", "checkout", "branch", "commit", "commitDate", "license",
      "primaryLanguage", "applicationType", "originalLockfile", "npmLockfileOrigin",
    ]) {
      if (typeof project?.[field] !== "string" || project[field].trim() === "") {
        errors.push(`${prefix}.${field} must be a non-empty string`);
      }
    }
    if (ids.has(project.id)) errors.push(`${prefix}.id is duplicated`);
    ids.add(project.id);
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(project.id ?? "")) errors.push(`${prefix}.id is not filesystem-safe`);
    if (!/^[0-9a-f]{40}$/u.test(project.commit ?? "")) errors.push(`${prefix}.commit must be a full Git SHA`);
    if (!["repository", "generated-from-package-json"].includes(project.npmLockfileOrigin)) {
      errors.push(`${prefix}.npmLockfileOrigin is unsupported`);
    }
    if (project.npmInstallArguments !== undefined && !Array.isArray(project.npmInstallArguments)) {
      errors.push(`${prefix}.npmInstallArguments must be an array`);
    }
    if (project.applicationPath !== undefined) {
      const applicationPath = typeof project.applicationPath === "string"
        ? project.applicationPath.replace(/\\/gu, "/")
        : "";
      if (
        applicationPath.trim() === ""
        || path.posix.isAbsolute(applicationPath)
        || path.posix.normalize(applicationPath) === ".."
        || path.posix.normalize(applicationPath).startsWith("../")
      ) {
        errors.push(`${prefix}.applicationPath must be a safe relative path`);
      }
    }
  }
  return errors;
}

function resolveApplicationRoot(workspace, project) {
  const workspaceRoot = path.resolve(workspace);
  const applicationRoot = path.resolve(workspaceRoot, project.applicationPath ?? ".");
  const relative = path.relative(workspaceRoot, applicationRoot);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    const error = new Error(`${project.id} applicationPath escapes its isolated workspace`);
    error.code = "INVALID_APPLICATION_PATH";
    throw error;
  }
  return applicationRoot;
}

function listSourceFiles(projectRoot) {
  const sourceRoot = path.join(projectRoot, "src");
  if (!fs.existsSync(sourceRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(entryPath);
    }
  };
  visit(sourceRoot);
  return files.sort((left, right) => toPosix(path.relative(projectRoot, left)).localeCompare(toPosix(path.relative(projectRoot, right))));
}

function sourceTreeSha256(projectRoot) {
  const hash = crypto.createHash("sha256");
  const files = listSourceFiles(projectRoot);
  for (const filePath of files) {
    hash.update(toPosix(path.relative(projectRoot, filePath)));
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), fileCount: files.length };
}

function normalizeRepositoryUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

function inspectSourceCheckout(evaluationRoot, project) {
  const checkout = path.resolve(evaluationRoot, project.checkout);
  if (!fs.existsSync(checkout)) {
    const error = new Error(`Source checkout does not exist for ${project.id}: ${checkout}`);
    error.code = "SOURCE_CHECKOUT_NOT_FOUND";
    throw error;
  }
  const commit = gitOutput(checkout, ["rev-parse", "HEAD"]);
  const status = gitOutput(checkout, ["status", "--porcelain=v1"]);
  const branch = gitOutput(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const remote = gitOutput(checkout, ["config", "--get", "remote.origin.url"]);
  const commitDate = gitOutput(checkout, ["show", "-s", "--format=%cI", "HEAD"]);
  const errors = [];
  if (commit !== project.commit) errors.push(`expected commit ${project.commit}, received ${commit}`);
  if (status !== "") errors.push("working tree is not clean");
  if (branch !== project.branch) errors.push(`expected branch ${project.branch}, received ${branch}`);
  if (normalizeRepositoryUrl(remote) !== normalizeRepositoryUrl(project.repository)) {
    errors.push(`expected remote ${project.repository}, received ${remote}`);
  }
  if (commitDate !== project.commitDate) errors.push(`expected commit date ${project.commitDate}, received ${commitDate}`);
  if (errors.length > 0) {
    const error = new Error(`Invalid source checkout for ${project.id}: ${errors.join("; ")}`);
    error.code = "INVALID_SOURCE_CHECKOUT";
    throw error;
  }
  return { checkout, commit, status, branch, remote, commitDate };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  if (!acceptedExitCodes.includes(result.status)) {
    const error = new Error(
      `${command} ${args.join(" ")} exited with code ${result.status}`
      + (result.stderr?.trim() ? `\n${result.stderr.trim()}` : ""),
    );
    error.code = "COMMAND_FAILED";
    error.exitCode = result.status;
    throw error;
  }
  return result;
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return runCommand(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return runCommand("npm", args, options);
}

function materializeCheckout(sourceCheckout, commit, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archivePath = `${destination}.tar`;
  if (fs.existsSync(destination) || fs.existsSync(archivePath)) {
    const error = new Error(`Refusing to overwrite existing public-application workspace: ${destination}`);
    error.code = "PUBLIC_APPLICATION_WORKSPACE_EXISTS";
    throw error;
  }
  const normalizedSource = sourceCheckout.replace(/\\/gu, "/");
  execFileSync("git", [
    "-c", `safe.directory=${normalizedSource}`, "-C", sourceCheckout,
    "archive", "--format=tar", `--output=${archivePath}`, commit,
  ]);
  fs.mkdirSync(destination, { recursive: false });
  try {
    runCommand("tar", ["-xf", archivePath, "-C", destination]);
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
}

function auditSummary(auditReport) {
  const totals = auditReport?.metadata?.vulnerabilities ?? {};
  return {
    vulnerablePackageCount: Object.keys(auditReport?.vulnerabilities ?? {}).length,
    severityTotals: {
      info: totals.info ?? 0,
      low: totals.low ?? 0,
      moderate: totals.moderate ?? 0,
      high: totals.high ?? 0,
      critical: totals.critical ?? 0,
      total: totals.total ?? 0,
    },
  };
}

function prepareProject(evaluationRoot, configPath, project, options = {}) {
  const source = inspectSourceCheckout(evaluationRoot, project);
  const workspace = path.join(evaluationRoot, ".work", "public-applications", project.id);
  const frozenDirectory = path.join(evaluationRoot, "audit-data", "public-applications", project.id);
  if (fs.existsSync(frozenDirectory)) {
    const error = new Error(`Refusing to overwrite frozen inputs for ${project.id}`);
    error.code = "PUBLIC_APPLICATION_INPUTS_EXIST";
    throw error;
  }
  materializeCheckout(source.checkout, project.commit, workspace);
  const applicationRoot = resolveApplicationRoot(workspace, project);
  if (!fs.existsSync(applicationRoot) || !fs.statSync(applicationRoot).isDirectory()) {
    throw new Error(`${project.id} application root does not exist: ${applicationRoot}`);
  }
  const packageJsonPath = path.join(applicationRoot, "package.json");
  const originalLockfilePath = path.join(applicationRoot, project.originalLockfile);
  if (!fs.existsSync(packageJsonPath)) throw new Error(`${project.id} does not contain package.json`);
  if (!fs.existsSync(originalLockfilePath)) throw new Error(`${project.id} does not contain ${project.originalLockfile}`);

  const installArguments = [
    "install", "--package-lock-only", "--ignore-scripts", "--audit=false", "--fund=false",
    ...(project.npmInstallArguments ?? []),
  ];
  if (project.npmLockfileOrigin === "generated-from-package-json") {
    runNpm(installArguments, { cwd: applicationRoot });
  }
  const npmLockfilePath = path.join(applicationRoot, "package-lock.json");
  if (!fs.existsSync(npmLockfilePath)) throw new Error(`${project.id} did not produce package-lock.json`);

  const auditResult = runNpm(["audit", "--json"], {
    cwd: applicationRoot,
    acceptedExitCodes: [0, 1],
  });
  let auditReport;
  try {
    auditReport = JSON.parse(auditResult.stdout);
  } catch (error) {
    error.message = `${project.id} npm audit did not return valid JSON: ${error.message}`;
    throw error;
  }
  if (!auditReport || typeof auditReport.vulnerabilities !== "object") {
    throw new Error(`${project.id} npm audit output does not contain vulnerabilities`);
  }

  const sourceTree = sourceTreeSha256(applicationRoot);
  fs.mkdirSync(path.dirname(frozenDirectory), { recursive: true });
  fs.mkdirSync(frozenDirectory, { recursive: false });
  const frozenPackageJson = path.join(frozenDirectory, "source-package.json");
  const frozenOriginalLockfile = path.join(frozenDirectory, `source-${project.originalLockfile}`);
  const frozenNpmLockfile = path.join(frozenDirectory, "package-lock.json");
  const frozenAudit = path.join(frozenDirectory, "npm-audit.json");
  fs.copyFileSync(packageJsonPath, frozenPackageJson, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(originalLockfilePath, frozenOriginalLockfile, fs.constants.COPYFILE_EXCL);
  if (path.resolve(originalLockfilePath) !== path.resolve(npmLockfilePath)) {
    fs.copyFileSync(npmLockfilePath, frozenNpmLockfile, fs.constants.COPYFILE_EXCL);
  } else {
    fs.copyFileSync(originalLockfilePath, frozenNpmLockfile, fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(frozenAudit, auditResult.stdout.endsWith("\n") ? auditResult.stdout : `${auditResult.stdout}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  const metadataPath = path.join(frozenDirectory, "metadata.json");
  const metadata = {
    schemaVersion: "1.0.0",
    status: "frozen",
    projectId: project.id,
    repository: project.repository,
    branch: source.branch,
    commit: source.commit,
    commitDate: source.commitDate,
    license: project.license,
    primaryLanguage: project.primaryLanguage,
    applicationType: project.applicationType,
    checkout: project.checkout,
    applicationPath: project.applicationPath ?? ".",
    workspace: toPosix(path.relative(evaluationRoot, workspace)),
    analysisRoot: toPosix(path.relative(evaluationRoot, applicationRoot)),
    sourceFileCount: sourceTree.fileCount,
    sourceTreeSha256: sourceTree.sha256,
    originalLockfile: project.originalLockfile,
    npmLockfileOrigin: project.npmLockfileOrigin,
    packageJsonSha256: fileSha256(frozenPackageJson),
    originalLockfileSha256: fileSha256(frozenOriginalLockfile),
    npmLockfileSha256: fileSha256(frozenNpmLockfile),
    auditDataSha256: fileSha256(frozenAudit),
    configurationSha256: fileSha256(configPath),
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    nodeVersion: process.version,
    npmVersion: installedNpmVersion(),
    lifecycleScriptsExecuted: false,
    captureCommands: {
      lockfile: project.npmLockfileOrigin === "repository" ? null : `npm ${installArguments.join(" ")}`,
      audit: "npm audit --json",
    },
    audit: auditSummary(auditReport),
  };
  writeJson(metadataPath, metadata);
  return { projectId: project.id, workspace, applicationRoot, frozenDirectory, metadata };
}

function preparePublicApplicationInputs(evaluationRoot, options = {}) {
  const { config, configPath } = loadPublicApplicationConfig(evaluationRoot);
  return config.projects.map((project) => prepareProject(evaluationRoot, configPath, project, options));
}

function reachabilityCounts(findings) {
  const counts = Object.fromEntries(REACHABILITY_LEVELS.map((level) => [level, 0]));
  for (const finding of findings ?? []) {
    if (Object.hasOwn(counts, finding.reachability)) counts[finding.reachability]++;
  }
  return counts;
}

function manualReviewQueue(projectId, findings) {
  return (findings ?? [])
    .filter((finding) => ["CRITICAL", "HIGH"].includes(finding.reachability))
    .map((finding, index) => ({
      reviewId: `${projectId}-${String(index + 1).padStart(3, "0")}`,
      projectId,
      reachability: finding.reachability,
      packageName: finding.packageName ?? null,
      auditSeverity: finding.auditSeverity ?? null,
      sourceFile: finding.filePath ?? null,
      sinkFile: finding.sinkFilePath ?? finding.filePath ?? null,
      component: finding.component ?? null,
      childComponent: finding.childComponent ?? null,
      sinkType: finding.sinkType ?? null,
      sinkRuleId: finding.sinkRuleId ?? null,
      reasonCode: finding.reasonCode ?? null,
      reason: finding.reason ?? null,
      confidence: finding.confidence ?? null,
      sinkLocation: finding.sinkLoc ?? null,
      taintedPath: finding.taintedPath ?? [],
      componentPath: finding.componentPath ?? [],
      propagationPath: finding.propagationPath ?? [],
      reviewed: false,
      assessment: null,
      notes: null,
    }));
}

function safeGitOutput(repositoryRoot, args, errors, label) {
  try {
    return gitOutput(repositoryRoot, args);
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function runPublicApplicationPreflight(evaluationRoot, options = {}) {
  const { config, configPath } = loadPublicApplicationConfig(evaluationRoot);
  const errors = [];
  const npmVersion = installedNpmVersion();
  const evaluationCommit = safeGitOutput(evaluationRoot, ["rev-parse", "HEAD"], errors, "Evaluation commit");
  const evaluationStatus = safeGitOutput(evaluationRoot, ["status", "--porcelain=v1"], errors, "Evaluation status");
  if (options.requireEvaluationClean !== false && evaluationStatus) errors.push("Evaluation repository requires a clean working tree");

  const reactReachRoot = path.resolve(evaluationRoot, config.reactReachRoot);
  const reactReachCommit = safeGitOutput(reactReachRoot, ["rev-parse", "HEAD"], errors, "ReactReach commit");
  const reactReachStatus = safeGitOutput(reactReachRoot, ["status", "--porcelain=v1"], errors, "ReactReach status");
  if (options.requireReactReachClean !== false && reactReachStatus) errors.push("ReactReach requires a clean working tree");
  if (fs.existsSync(path.join(reactReachRoot, "package.json"))) {
    const actualVersion = readJson(path.join(reactReachRoot, "package.json")).version;
    if (actualVersion !== config.reactReachVersion) errors.push(`ReactReach version: expected ${config.reactReachVersion}, received ${actualVersion}`);
  } else {
    errors.push(`ReactReach repository does not exist: ${reactReachRoot}`);
  }

  const installedRoot = fs.realpathSync(path.dirname(require.resolve("reactreach/package.json")));
  if (fs.existsSync(reactReachRoot) && fs.realpathSync(reactReachRoot) !== installedRoot) {
    errors.push("Installed reactreach dependency does not resolve to the configured ReactReach repository");
  }

  const projects = [];
  for (const project of config.projects) {
    let source = null;
    try {
      source = inspectSourceCheckout(evaluationRoot, project);
    } catch (error) {
      errors.push(error.message);
    }
    const workspace = path.join(evaluationRoot, ".work", "public-applications", project.id);
    const applicationRoot = resolveApplicationRoot(workspace, project);
    const frozenDirectory = path.join(evaluationRoot, "audit-data", "public-applications", project.id);
    const metadataPath = path.join(frozenDirectory, "metadata.json");
    const requiredFiles = {
      packageJson: path.join(frozenDirectory, "source-package.json"),
      originalLockfile: path.join(frozenDirectory, `source-${project.originalLockfile}`),
      npmLockfile: path.join(frozenDirectory, "package-lock.json"),
      auditData: path.join(frozenDirectory, "npm-audit.json"),
      metadata: metadataPath,
    };
    for (const [label, filePath] of Object.entries(requiredFiles)) {
      if (!fs.existsSync(filePath)) errors.push(`${project.id} frozen ${label} does not exist`);
    }
    if (!fs.existsSync(workspace)) errors.push(`${project.id} isolated workspace does not exist`);
    if (!fs.existsSync(applicationRoot)) errors.push(`${project.id} isolated application root does not exist`);
    if (!fs.existsSync(metadataPath)) {
      projects.push({ projectId: project.id, valid: false });
      continue;
    }
    const metadata = readJson(metadataPath);
    const projectErrors = [];
    const equal = (label, actual, expected) => {
      if (actual !== expected) projectErrors.push(`${label}: expected ${expected}, received ${actual}`);
    };
    equal("commit", metadata.commit, project.commit);
    equal("repository", normalizeRepositoryUrl(metadata.repository), normalizeRepositoryUrl(project.repository));
    equal("application path", metadata.applicationPath, project.applicationPath ?? ".");
    equal("configuration SHA-256", metadata.configurationSha256, fileSha256(configPath));
    equal("Node version", metadata.nodeVersion, process.version);
    equal("npm version", metadata.npmVersion, npmVersion);
    equal("lifecycle script flag", metadata.lifecycleScriptsExecuted, false);
    if (fs.existsSync(requiredFiles.packageJson)) equal("package.json SHA-256", fileSha256(requiredFiles.packageJson), metadata.packageJsonSha256);
    if (fs.existsSync(requiredFiles.originalLockfile)) equal("original lockfile SHA-256", fileSha256(requiredFiles.originalLockfile), metadata.originalLockfileSha256);
    if (fs.existsSync(requiredFiles.npmLockfile)) equal("npm lockfile SHA-256", fileSha256(requiredFiles.npmLockfile), metadata.npmLockfileSha256);
    if (fs.existsSync(requiredFiles.auditData)) {
      equal("audit-data SHA-256", fileSha256(requiredFiles.auditData), metadata.auditDataSha256);
      try {
        const auditReport = readJson(requiredFiles.auditData);
        if (typeof auditReport?.vulnerabilities !== "object") projectErrors.push("audit data lacks a vulnerabilities object");
      } catch (error) {
        projectErrors.push(`audit data is not valid JSON: ${error.message}`);
      }
    }
    if (fs.existsSync(applicationRoot)) {
      const sourceTree = sourceTreeSha256(applicationRoot);
      equal("source tree SHA-256", sourceTree.sha256, metadata.sourceTreeSha256);
      equal("source file count", sourceTree.fileCount, metadata.sourceFileCount);
      const workspacePackageLock = path.join(applicationRoot, "package-lock.json");
      if (fs.existsSync(workspacePackageLock) && fs.existsSync(requiredFiles.npmLockfile)) {
        equal("workspace package-lock SHA-256", fileSha256(workspacePackageLock), metadata.npmLockfileSha256);
      }
    }
    if (source) equal("source commit", source.commit, metadata.commit);
    errors.push(...projectErrors.map((message) => `${project.id} ${message}`));
    projects.push({
      projectId: project.id,
      valid: projectErrors.length === 0 && source !== null,
      commit: metadata.commit ?? null,
      sourceFileCount: metadata.sourceFileCount ?? null,
      audit: metadata.audit ?? null,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    config,
    summary: {
      studyId: config.studyId,
      groundTruthAvailable: false,
      precisionRecallF1Computed: false,
      evaluationCommit,
      reactReachCommit,
      reactReachVersion: config.reactReachVersion,
      nodeVersion: process.version,
      npmVersion,
      configurationSha256: fileSha256(configPath),
      projects,
    },
  };
}

function serializeError(error) {
  return {
    name: error.name ?? "Error",
    code: error.code ?? null,
    message: error.message ?? String(error),
    filePath: error.filePath ?? null,
    stack: error.stack ?? null,
  };
}

module.exports = {
  REACHABILITY_LEVELS,
  auditSummary,
  inspectSourceCheckout,
  listSourceFiles,
  loadPublicApplicationConfig,
  manualReviewQueue,
  preparePublicApplicationInputs,
  reachabilityCounts,
  resolveApplicationRoot,
  runPublicApplicationPreflight,
  serializeError,
  sourceTreeSha256,
  validatePublicApplicationConfig,
};
