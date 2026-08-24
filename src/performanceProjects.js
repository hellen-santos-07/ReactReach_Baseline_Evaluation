const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalize, readJson } = require("./groundTruth");

const PERFORMANCE_CONFIG = path.join("config", "performance-projects.json");
const PROJECT_MANIFEST = "performance-project.json";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toPosix(value) {
  return value.replace(/\\/gu, "/");
}

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveInside(evaluationRoot, relativePath, label) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) throw new Error(`${label} must be relative`);
  const resolved = path.resolve(evaluationRoot, relativePath);
  if (!isWithin(evaluationRoot, resolved)) throw new Error(`${label} escapes the evaluation repository`);
  return resolved;
}

function listFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  visit(root);
  return files;
}

function listSourceFiles(root, extensions) {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  return listFiles(root).filter((filePath) => allowed.has(path.extname(filePath).toLowerCase()));
}

function fileEntries(root, files) {
  return files
    .map((filePath) => {
      const data = fs.readFileSync(filePath);
      return {
        path: toPosix(path.relative(root, filePath)),
        bytes: data.length,
        sha256: sha256(data),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sourceTreeSha256(entries) {
  return sha256(Buffer.from(canonicalize(entries), "utf8"));
}

function validatePerformanceConfig(config) {
  const errors = [];
  if (config?.schemaVersion !== "1.0.0") errors.push("Performance config schemaVersion must be 1.0.0");
  if (config?.generatorVersion !== "1.0.0") errors.push("Performance generatorVersion must be 1.0.0");
  for (const field of ["coreProject", "coreSourceRoot", "generatedRoot", "benignTemplateVersion"]) {
    if (typeof config?.[field] !== "string" || config[field] === "") errors.push(`Performance config ${field} must be a non-empty string`);
  }
  if (!Array.isArray(config?.sourceExtensions) || config.sourceExtensions.length === 0) {
    errors.push("Performance config sourceExtensions must be a non-empty array");
  }
  if (!Array.isArray(config?.projects) || config.projects.length === 0) {
    errors.push("Performance config projects must be a non-empty array");
  } else {
    const ids = new Set();
    const targets = new Set();
    for (const project of config.projects) {
      if (typeof project.id !== "string" || !/^performance-[1-9][0-9]*$/u.test(project.id)) errors.push(`Invalid performance project id: ${project.id}`);
      if (ids.has(project.id)) errors.push(`Duplicate performance project id: ${project.id}`);
      ids.add(project.id);
      if (!Number.isInteger(project.targetSourceFiles) || project.targetSourceFiles <= 0) {
        errors.push(`Invalid source-file target for ${project.id}`);
      }
      if (targets.has(project.targetSourceFiles)) errors.push(`Duplicate source-file target: ${project.targetSourceFiles}`);
      targets.add(project.targetSourceFiles);
    }
  }
  return { valid: errors.length === 0, errors };
}

function loadPerformanceConfig(evaluationRoot) {
  const configPath = path.join(evaluationRoot, PERFORMANCE_CONFIG);
  const config = readJson(configPath);
  const validation = validatePerformanceConfig(config);
  if (!validation.valid) throw new Error(`Invalid performance config:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  for (const field of ["coreProject", "coreSourceRoot", "generatedRoot"]) resolveInside(evaluationRoot, config[field], field);
  return config;
}

function benignSource(index) {
  const suffix = String(index).padStart(4, "0");
  return `export function Benign${suffix}({ value }) {\n` +
    "  const text = value == null ? \"\" : String(value);\n" +
    `  return <section data-performance-fixture="${suffix}">{text}</section>;\n` +
    "}\n";
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function projectPackageFiles(evaluationRoot, config, project) {
  const sourcePackage = readJson(path.join(evaluationRoot, config.coreProject, "package.json"));
  const sourceLock = readJson(path.join(evaluationRoot, config.coreProject, "package-lock.json"));
  const packageName = `reactreach-rq04-${project.id}`;
  const packageJson = {
    ...sourcePackage,
    name: packageName,
    description: `Controlled ReactReach RQ04 performance project with ${project.targetSourceFiles} source files`,
  };
  const packageLock = JSON.parse(JSON.stringify(sourceLock));
  packageLock.name = packageName;
  if (packageLock.packages?.[""]) packageLock.packages[""].name = packageName;
  return { packageJson: jsonText(packageJson), packageLock: jsonText(packageLock) };
}

function buildProjectPlan(evaluationRoot, config, project) {
  const coreSourceRoot = resolveInside(evaluationRoot, config.coreSourceRoot, "coreSourceRoot");
  const generatedRoot = resolveInside(evaluationRoot, config.generatedRoot, "generatedRoot");
  const projectRoot = path.join(generatedRoot, project.id);
  if (!isWithin(generatedRoot, projectRoot)) throw new Error(`Project ${project.id} escapes generatedRoot`);
  const coreFiles = listSourceFiles(coreSourceRoot, config.sourceExtensions);
  const benignCount = project.targetSourceFiles - coreFiles.length;
  if (benignCount < 0) throw new Error(`${project.id} target is smaller than the ${coreFiles.length}-file core`);

  const sourceFiles = new Map();
  for (const sourcePath of coreFiles) {
    const relative = toPosix(path.relative(coreSourceRoot, sourcePath));
    sourceFiles.set(`src/core/${relative}`, fs.readFileSync(sourcePath));
  }
  for (let index = 1; index <= benignCount; index++) {
    sourceFiles.set(`src/benign/Benign${String(index).padStart(4, "0")}.jsx`, Buffer.from(benignSource(index), "utf8"));
  }

  const generatedEntries = [...sourceFiles.entries()]
    .map(([relative, data]) => ({ path: relative, bytes: data.length, sha256: sha256(data) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const coreEntries = fileEntries(coreSourceRoot, coreFiles);
  const manifest = {
    schemaVersion: "1.0.0",
    generatorVersion: config.generatorVersion,
    benignTemplateVersion: config.benignTemplateVersion,
    projectId: project.id,
    targetSourceFiles: project.targetSourceFiles,
    sourceRoot: "src",
    core: {
      source: config.coreSourceRoot,
      destination: "src/core",
      sourceFileCount: coreFiles.length,
      sourceTreeSha256: sourceTreeSha256(coreEntries),
    },
    benign: {
      destination: "src/benign",
      sourceFileCount: benignCount,
      fileNamePattern: "BenignNNNN.jsx",
    },
    sourceFileCount: generatedEntries.length,
    sourceTreeSha256: sourceTreeSha256(generatedEntries),
  };
  const packages = projectPackageFiles(evaluationRoot, config, project);
  return { project, projectRoot, sourceFiles, manifest, ...packages };
}

function compareFile(errors, filePath, expected, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    errors.push(`${label} is missing`);
    return;
  }
  const actual = fs.readFileSync(filePath);
  if (!actual.equals(Buffer.isBuffer(expected) ? expected : Buffer.from(expected, "utf8"))) errors.push(`${label} differs from the deterministic generator output`);
}

function validateGeneratedProject(evaluationRoot, config, project) {
  const plan = buildProjectPlan(evaluationRoot, config, project);
  const errors = [];
  if (!fs.existsSync(plan.projectRoot) || !fs.statSync(plan.projectRoot).isDirectory()) {
    return { valid: false, errors: [`Generated project ${project.id} does not exist`], summary: plan.manifest };
  }
  compareFile(errors, path.join(plan.projectRoot, "package.json"), plan.packageJson, `${project.id} package.json`);
  compareFile(errors, path.join(plan.projectRoot, "package-lock.json"), plan.packageLock, `${project.id} package-lock.json`);
  compareFile(errors, path.join(plan.projectRoot, PROJECT_MANIFEST), jsonText(plan.manifest), `${project.id} manifest`);

  const actualProjectFiles = listFiles(plan.projectRoot)
    .map((filePath) => toPosix(path.relative(plan.projectRoot, filePath)))
    .sort();
  const expectedProjectFiles = ["package.json", "package-lock.json", PROJECT_MANIFEST, ...plan.sourceFiles.keys()].sort();
  if (canonicalize(actualProjectFiles) !== canonicalize(expectedProjectFiles)) {
    errors.push(`${project.id} project-file set differs from the deterministic plan`);
  }

  const sourceRoot = path.join(plan.projectRoot, "src");
  if (!fs.existsSync(sourceRoot)) errors.push(`${project.id} source root is missing`);
  else {
    const actualFiles = listSourceFiles(sourceRoot, config.sourceExtensions)
      .map((filePath) => toPosix(path.relative(plan.projectRoot, filePath)))
      .sort();
    const expectedFiles = [...plan.sourceFiles.keys()].sort();
    if (canonicalize(actualFiles) !== canonicalize(expectedFiles)) errors.push(`${project.id} source-file set differs from the deterministic plan`);
    for (const [relative, data] of plan.sourceFiles) compareFile(errors, path.join(plan.projectRoot, relative), data, `${project.id} ${relative}`);
  }
  return { valid: errors.length === 0, errors, summary: plan.manifest };
}

function writeNew(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, { flag: "wx" });
}

function generateProject(evaluationRoot, config, project) {
  const plan = buildProjectPlan(evaluationRoot, config, project);
  if (fs.existsSync(plan.projectRoot)) {
    const validation = validateGeneratedProject(evaluationRoot, config, project);
    if (!validation.valid) throw new Error(`Refusing to overwrite divergent ${project.id}:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
    return { projectId: project.id, created: false, ...validation.summary };
  }
  fs.mkdirSync(plan.projectRoot, { recursive: false });
  writeNew(path.join(plan.projectRoot, "package.json"), plan.packageJson);
  writeNew(path.join(plan.projectRoot, "package-lock.json"), plan.packageLock);
  for (const [relative, data] of plan.sourceFiles) writeNew(path.join(plan.projectRoot, relative), data);
  writeNew(path.join(plan.projectRoot, PROJECT_MANIFEST), jsonText(plan.manifest));
  return { projectId: project.id, created: true, ...plan.manifest };
}

function generatePerformanceProjects(evaluationRoot) {
  const config = loadPerformanceConfig(evaluationRoot);
  fs.mkdirSync(resolveInside(evaluationRoot, config.generatedRoot, "generatedRoot"), { recursive: true });
  return config.projects.map((project) => generateProject(evaluationRoot, config, project));
}

function validateAllGeneratedProjects(evaluationRoot) {
  const config = loadPerformanceConfig(evaluationRoot);
  const projects = config.projects.map((project) => ({ projectId: project.id, ...validateGeneratedProject(evaluationRoot, config, project) }));
  return {
    valid: projects.every((project) => project.valid),
    errors: projects.flatMap((project) => project.errors),
    projects,
  };
}

module.exports = {
  PERFORMANCE_CONFIG,
  PROJECT_MANIFEST,
  benignSource,
  buildProjectPlan,
  fileEntries,
  generatePerformanceProjects,
  listSourceFiles,
  loadPerformanceConfig,
  sourceTreeSha256,
  validateAllGeneratedProjects,
  validateGeneratedProject,
  validatePerformanceConfig,
};
