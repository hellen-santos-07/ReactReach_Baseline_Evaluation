const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");

const DEFAULT_SCHEMA_PATH = path.join(__dirname, "..", "schemas", "ground-truth.schema.json");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (cause) {
    const error = new Error(`Unable to read JSON file ${filePath}: ${cause.message}`);
    error.code = "INVALID_JSON_FILE";
    error.cause = cause;
    throw error;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function datasetPayload(groundTruth) {
  return {
    classificationPolicy: groundTruth.classificationPolicy,
    projects: groundTruth.projects,
    scenarios: groundTruth.scenarios,
  };
}

function datasetSha256(groundTruth) {
  return crypto
    .createHash("sha256")
    .update(canonicalize(datasetPayload(groundTruth)), "utf8")
    .digest("hex");
}

function createSchemaValidator(schema = readJson(DEFAULT_SCHEMA_PATH), referencedSchemas = []) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  for (const referencedSchema of referencedSchemas) ajv.addSchema(referencedSchema);
  return ajv.compile(schema);
}

function schemaErrors(validator, value) {
  if (validator(value)) return [];
  return validator.errors.map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message}`;
  });
}

function semanticErrors(groundTruth) {
  const errors = [];
  const projects = Array.isArray(groundTruth.projects) ? groundTruth.projects : [];
  const scenarios = Array.isArray(groundTruth.scenarios) ? groundTruth.scenarios : [];
  const projectIds = new Set();
  const scenarioIds = new Set();
  const scenarioIdentityComponents = new Map();

  for (const project of projects) {
    if (project === null || typeof project !== "object" || Array.isArray(project)) continue;
    if (projectIds.has(project.id)) errors.push(`Duplicate project id: ${project.id}`);
    projectIds.add(project.id);

    const packageNames = new Set();
    for (const vulnerablePackage of project.vulnerablePackages ?? []) {
      if (packageNames.has(vulnerablePackage.name)) {
        errors.push(`Project ${project.id} declares package ${vulnerablePackage.name} more than once`);
      }
      packageNames.add(vulnerablePackage.name);
    }
  }

  const packagesByProject = new Map(projects
    .filter((project) => project !== null && typeof project === "object" && !Array.isArray(project))
    .map((project) => [
      project.id,
      new Set((project.vulnerablePackages ?? [])
        .filter((item) => item !== null && typeof item === "object" && !Array.isArray(item))
        .map((item) => item.name)),
    ]));

  for (const scenario of scenarios) {
    if (scenario === null || typeof scenario !== "object" || Array.isArray(scenario)) continue;
    if (scenarioIds.has(scenario.id)) errors.push(`Duplicate scenario id: ${scenario.id}`);
    scenarioIds.add(scenario.id);

    if ([scenario.projectId, scenario.packageName, scenario.sourceFile].every((value) => typeof value === "string")) {
      const identityBase = JSON.stringify([
        scenario.projectId,
        scenario.packageName,
        scenario.sourceFile.replace(/\\/gu, "/"),
      ]);
      const component = scenario.matching?.component ?? null;
      const existingComponents = scenarioIdentityComponents.get(identityBase) ?? [];
      if (existingComponents.some((existing) => existing === null || component === null || existing === component)) {
        errors.push(`Scenario ${scenario.id} duplicates or overlaps a binary matching identity`);
      }
      existingComponents.push(component);
      scenarioIdentityComponents.set(identityBase, existingComponents);
    }

    if (!projectIds.has(scenario.projectId)) {
      errors.push(`Scenario ${scenario.id} references unknown project ${scenario.projectId}`);
    } else if (!packagesByProject.get(scenario.projectId).has(scenario.packageName)) {
      errors.push(`Scenario ${scenario.id} uses package ${scenario.packageName}, which is not declared by project ${scenario.projectId}`);
    }

    for (const range of scenario.evidence?.lines ?? []) {
      if (range.end < range.start) {
        errors.push(`Scenario ${scenario.id} has an evidence range ending before it starts`);
      }
    }
  }

  return errors;
}

function isWithin(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function corpusErrors(groundTruth, evaluationRoot) {
  if (!evaluationRoot) return [];
  const errors = [];
  const projects = Array.isArray(groundTruth.projects) ? groundTruth.projects : [];
  const scenarios = Array.isArray(groundTruth.scenarios) ? groundTruth.scenarios : [];
  const projectRoots = new Map();

  for (const project of projects) {
    if (project === null || typeof project !== "object" || typeof project.root !== "string") continue;
    const projectRoot = path.resolve(evaluationRoot, project.root);
    if (path.isAbsolute(project.root) || !isWithin(evaluationRoot, projectRoot)) {
      errors.push(`Project ${project.id} root must be a relative path inside the evaluation repository`);
      continue;
    }
    projectRoots.set(project.id, projectRoot);
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      errors.push(`Project ${project.id} root does not exist: ${project.root}`);
    }
  }

  for (const scenario of scenarios) {
    if (scenario === null || typeof scenario !== "object" || typeof scenario.sourceFile !== "string") continue;
    const projectRoot = projectRoots.get(scenario.projectId);
    if (!projectRoot) continue;
    const sourcePath = path.resolve(projectRoot, scenario.sourceFile);
    if (path.isAbsolute(scenario.sourceFile) || !isWithin(projectRoot, sourcePath)) {
      errors.push(`Scenario ${scenario.id} sourceFile must remain inside its project`);
      continue;
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      errors.push(`Scenario ${scenario.id} source file does not exist: ${scenario.sourceFile}`);
      continue;
    }
    for (const range of scenario.evidence?.lines ?? []) {
      const evidenceFile = range.file ?? scenario.sourceFile;
      const evidencePath = path.resolve(projectRoot, evidenceFile);
      if (path.isAbsolute(evidenceFile) || !isWithin(projectRoot, evidencePath)) {
        errors.push(`Scenario ${scenario.id} evidence file must remain inside its project`);
        continue;
      }
      if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
        errors.push(`Scenario ${scenario.id} evidence file does not exist: ${evidenceFile}`);
        continue;
      }
      const lineCount = fs.readFileSync(evidencePath, "utf8").split(/\r?\n/u).length;
      if (range.end > lineCount) {
        errors.push(`Scenario ${scenario.id} evidence ends at line ${range.end}, but ${evidenceFile} has ${lineCount} lines`);
      }
    }
  }

  return errors;
}

function validateGroundTruth(groundTruth, options = {}) {
  const validator = options.validator ?? createSchemaValidator(options.schema);
  const errors = schemaErrors(validator, groundTruth);
  errors.push(...semanticErrors(groundTruth));
  errors.push(...corpusErrors(groundTruth, options.evaluationRoot));

  return { valid: errors.length === 0, errors, datasetSha256: datasetSha256(groundTruth) };
}

module.exports = {
  DEFAULT_SCHEMA_PATH,
  canonicalize,
  corpusErrors,
  createSchemaValidator,
  datasetPayload,
  datasetSha256,
  readJson,
  semanticErrors,
  validateGroundTruth,
};
