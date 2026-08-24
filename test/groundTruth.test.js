const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  canonicalize,
  corpusErrors,
  datasetSha256,
  readJson,
  validateGroundTruth,
} = require("../src/groundTruth");

const evaluationRoot = path.resolve(__dirname, "..");
const groundTruthPath = path.join(evaluationRoot, "ground-truth", "ground-truth.json");
const expectedDatasetHash = "68951480a3987ef7314631d41304076807fbd220e11e1b67910cb0e8ea70aae1";

test("the final 54-scenario ground truth validates", () => {
  const groundTruth = readJson(groundTruthPath);
  const result = validateGroundTruth(groundTruth, { evaluationRoot });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.datasetSha256, expectedDatasetHash);
});

test("the final dataset is balanced and preserves all three cohorts", () => {
  const groundTruth = readJson(groundTruthPath);
  const positive = groundTruth.scenarios.filter((scenario) => scenario.expected.contextuallyReachable);
  const negative = groundTruth.scenarios.filter((scenario) => !scenario.expected.contextuallyReachable);
  const counts = Object.fromEntries(groundTruth.projects.map((project) => [
    project.id,
    groundTruth.scenarios.filter((scenario) => scenario.projectId === project.id).length,
  ]));

  assert.deepEqual({ scenarios: groundTruth.scenarios.length, positive: positive.length, negative: negative.length }, {
    scenarios: 54,
    positive: 27,
    negative: 27,
  });
  assert.deepEqual(counts, {
    "effectiveness-core": 30,
    "adversarial-holdout": 12,
    "robustness-multipackage": 12,
  });
});

test("every scenario references existing source evidence inside its project", () => {
  const groundTruth = readJson(groundTruthPath);
  assert.deepEqual(corpusErrors(groundTruth, evaluationRoot), []);
});

test("canonical hashing is independent of object key order", () => {
  const groundTruth = readJson(groundTruthPath);
  const reordered = {
    scenarios: groundTruth.scenarios,
    projects: groundTruth.projects,
    classificationPolicy: groundTruth.classificationPolicy,
    schemaVersion: groundTruth.schemaVersion,
  };
  assert.equal(canonicalize(reordered), canonicalize(groundTruth));
  assert.equal(datasetSha256(reordered), expectedDatasetHash);
});
