const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");
const {
  resolveScanProject,
  serializeError,
  validateWorkerData,
} = require("../src/performanceScanWorker");

test("worker resolves scanProject from the public ReactReach API", () => {
  const scanProject = async () => ({ findings: [] });
  let legacyLoaded = false;
  assert.equal(resolveScanProject({ scanProject }, () => {
    legacyLoaded = true;
    return {};
  }), scanProject);
  assert.equal(legacyLoaded, false);
});

test("worker retains compatibility with the historical ReactReach v1.0.0 API", () => {
  const scanProject = async () => ({ findings: [] });
  assert.equal(resolveScanProject({}, () => ({ scanProject })), scanProject);
});

test("worker rejects ReactReach packages without a scanner", () => {
  assert.throws(() => resolveScanProject({}, () => ({})), (error) => (
    error instanceof TypeError && error.code === "INVALID_REACTREACH_API"
  ));
});

test("worker data accepts non-empty evaluation and project identifiers", () => {
  const data = { evaluationRoot: "C:/evaluation", projectId: "performance-50" };
  assert.deepEqual(validateWorkerData(data), data);
});

test("worker data rejects missing, non-string, empty, and whitespace-only fields", () => {
  for (const data of [
    undefined,
    {},
    { evaluationRoot: "", projectId: "performance-50" },
    { evaluationRoot: "C:/evaluation", projectId: "   " },
    { evaluationRoot: 42, projectId: "performance-50" },
    { evaluationRoot: "C:/evaluation", projectId: null },
  ]) {
    assert.throws(() => validateWorkerData(data), (error) => (
      error instanceof TypeError && error.code === "INVALID_WORKER_DATA"
    ));
  }
});

test("worker errors retain stable serializable fields", () => {
  const error = new Error("failure");
  error.code = "TEST_FAILURE";
  assert.deepEqual(serializeError(error), {
    name: "Error",
    code: "TEST_FAILURE",
    message: "failure",
    stack: error.stack,
  });
});

test("the worker reports invalid data without attempting a scan", async () => {
  const workerPath = path.join(__dirname, "..", "src", "performanceScanWorker.js");
  const messages = [];
  const worker = new Worker(workerPath, {
    workerData: { evaluationRoot: "", projectId: "performance-50" },
  });
  worker.on("message", (message) => messages.push(message));

  const exitCode = await new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("exit", resolve);
  });

  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "scan-error");
  assert.equal(messages[0].error.code, "INVALID_WORKER_DATA");
  assert.match(messages[0].error.message, /evaluationRoot/u);
});

test("the worker completes a generated-project scan", async () => {
  const workerPath = path.join(__dirname, "..", "src", "performanceScanWorker.js");
  const evaluationRoot = path.join(__dirname, "..");
  const messages = [];
  const worker = new Worker(workerPath, {
    workerData: { evaluationRoot, projectId: "performance-50" },
  });
  worker.on("message", (message) => messages.push(message));

  const exitCode = await new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("exit", resolve);
  });

  assert.equal(exitCode, 0);
  assert.equal(messages.some((message) => message.type === "scan-error"), false);
  assert.equal(messages[0].type, "scan-started");
  const completed = messages.find((message) => message.type === "scan-completed");
  assert.ok(completed);
  assert.equal(completed.result.projectId, "performance-50");
  assert.equal(completed.result.sourceFileCount, 50);
  assert.ok(completed.result.stageRss.length > 0);
});
