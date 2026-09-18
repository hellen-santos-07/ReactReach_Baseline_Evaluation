const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runPublicApplicationStudy } = require("../src/publicApplicationRun");
const { runPublicApplicationSample } = require("../src/publicApplicationSample");
const {
  auditSummary,
  manualReviewQueue,
  reachabilityCounts,
  resolveApplicationRoot,
  sourceTreeSha256,
  validatePublicApplicationConfig,
} = require("../src/publicApplicationStudy");

function project(id) {
  return {
    id,
    repository: `https://github.com/example/${id}`,
    checkout: `../${id}`,
    branch: "main",
    commit: "a".repeat(40),
    commitDate: "2026-01-01T00:00:00Z",
    license: "MIT",
    primaryLanguage: "TypeScript",
    applicationType: "test fixture",
    originalLockfile: "package-lock.json",
    npmLockfileOrigin: "repository",
  };
}

test("public-application configuration requires two or three projects", () => {
  assert.match(validatePublicApplicationConfig({ schemaVersion: "1.0.0", projects: [project("one")] })[0], /two or three/u);
  assert.deepEqual(validatePublicApplicationConfig({
    schemaVersion: "1.0.0",
    projects: [project("one"), project("two"), project("three")],
  }), []);
});

test("public-application configuration accepts only safe application subdirectories", () => {
  const nested = project("nested");
  nested.applicationPath = "client";
  assert.deepEqual(validatePublicApplicationConfig({
    schemaVersion: "1.0.0",
    projects: [nested, project("two")],
  }), []);
  nested.applicationPath = "../outside";
  assert.match(validatePublicApplicationConfig({
    schemaVersion: "1.0.0",
    projects: [nested, project("two")],
  })[0], /safe relative path/u);
});

test("application roots remain inside the isolated workspace", () => {
  const root = path.resolve("workspace");
  assert.equal(resolveApplicationRoot(root, { id: "nested", applicationPath: "client" }), path.join(root, "client"));
  assert.throws(
    () => resolveApplicationRoot(root, { id: "escape", applicationPath: "../outside" }),
    { code: "INVALID_APPLICATION_PATH" },
  );
});

test("source-tree fingerprint covers sorted JavaScript and TypeScript sources", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-public-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.tsx"), "export const A = () => null;\n");
  fs.writeFileSync(path.join(root, "src", "nested", "b.js"), "export const b = 1;\n");
  fs.writeFileSync(path.join(root, "README.md"), "ignored\n");
  const first = sourceTreeSha256(root);
  fs.writeFileSync(path.join(root, "README.md"), "also ignored\n");
  assert.deepEqual(sourceTreeSha256(root), first);
  fs.appendFileSync(path.join(root, "src", "a.tsx"), "// changed\n");
  assert.equal(sourceTreeSha256(root).fileCount, 2);
  assert.notEqual(sourceTreeSha256(root).sha256, first.sha256);
});

test("reachability counts include all levels even when absent", () => {
  assert.deepEqual(reachabilityCounts([
    { reachability: "CRITICAL" },
    { reachability: "HIGH" },
    { reachability: "HIGH" },
    { reachability: "NONE" },
  ]), { CRITICAL: 1, HIGH: 2, MEDIUM: 0, LOW: 0, NONE: 1 });
});

test("manual-review queue contains only CRITICAL and HIGH without accuracy labels", () => {
  const queue = manualReviewQueue("example", [
    { reachability: "CRITICAL", packageName: "unsafe", filePath: "src/A.jsx" },
    { reachability: "MEDIUM", packageName: "maybe", filePath: "src/B.jsx" },
    { reachability: "HIGH", packageName: "unsafe", filePath: "src/C.jsx", sinkType: "eval" },
  ]);
  assert.equal(queue.length, 2);
  assert.deepEqual(queue.map((item) => item.reviewId), ["example-001", "example-002"]);
  assert.equal(queue[0].reviewed, false);
  assert.equal(queue[0].assessment, null);
  assert.equal(Object.hasOwn(queue[0], "truePositive"), false);
  assert.deepEqual(queue[0].taintedPath, []);
});

test("npm-audit summary preserves vulnerable-package and severity counts", () => {
  assert.deepEqual(auditSummary({
    vulnerabilities: { alpha: {}, beta: {} },
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 3, critical: 4, total: 10 } },
  }), {
    vulnerablePackageCount: 2,
    severityTotals: { info: 0, low: 1, moderate: 2, high: 3, critical: 4, total: 10 },
  });
});

test("successful public-application samples cancel their timeout", async () => {
  const timeoutToken = { type: "timeout" };
  let clearedTimeout = null;
  const worker = new EventEmitter();
  worker.kill = () => {};
  const forkProcess = () => {
    queueMicrotask(() => {
      worker.emit("message", { type: "scan-completed", rssBytes: 20, result: { findings: [] } });
      worker.emit("exit", 0);
    });
    return worker;
  };
  const result = await runPublicApplicationSample({
    evaluationRoot: "fixture",
    projectId: "success",
    timeoutMs: 1000,
    forkProcess,
    setTimeoutFn: () => timeoutToken,
    clearTimeoutFn: (token) => { clearedTimeout = token; },
  });
  assert.equal(clearedTimeout, timeoutToken);
  assert.equal(result.peakRssBytes, 20);
});

test("study output explicitly omits accuracy metrics and retains parse failures", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-public-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projects = [project("success"), project("parse-failure")];
  const preflight = {
    valid: true,
    errors: [],
    config: { projects, timeoutMs: 1000 },
    summary: { npmVersion: "11.6.2", groundTruthAvailable: false, precisionRecallF1Computed: false },
  };
  const finding = {
    reachability: "HIGH",
    packageName: "unsafe",
    auditSeverity: "high",
    filePath: path.join(root, "src", "App.jsx"),
    component: "App",
    reason: "test",
  };
  const sampleRunner = async ({ projectId }) => {
    if (projectId === "parse-failure") {
      const error = new SyntaxError("unsupported syntax");
      error.code = "PARSE_FAILED";
      error.filePath = "src/problem.ts";
      throw error;
    }
    return {
      report: {
        projectPath: root,
        scannedAt: "2026-01-01T00:00:00.000Z",
        configuration: {},
        diagnostics: [],
        timings: { totalMs: 12.5 },
        summary: { vulnerablePackages: 1, sourceFiles: 1, components: 1, cogNodes: 1, cogEdges: 0, sinks: 1, findings: 1 },
        packages: [],
        analyzedFiles: [finding.filePath],
        findings: [finding],
      },
      findings: [finding],
      diagnostics: [],
      timings: { totalMs: 12.5 },
      reachabilityCounts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, NONE: 0 },
      peakRssBytes: 100,
      rssSampleCount: 2,
    };
  };
  const result = await runPublicApplicationStudy(root, {
    preflightRunner: () => preflight,
    sampleRunner,
    runId: "fixture-run",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const summary = JSON.parse(fs.readFileSync(result.summaryPath, "utf8"));
  assert.equal(summary.status, "completed-with-errors");
  assert.equal(summary.groundTruthAvailable, false);
  assert.equal(summary.precisionRecallF1Computed, false);
  assert.equal(Object.hasOwn(summary, "precision"), false);
  assert.equal(summary.projects[1].parsingError.code, "PARSE_FAILED");
  const review = JSON.parse(fs.readFileSync(result.reviewPath, "utf8"));
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].assessment, null);
});
