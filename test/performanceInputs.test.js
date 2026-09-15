const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  createFreezeContext,
  performancePaths,
  runPerformancePreflight,
} = require("../src/performanceInputs");

test("performancePaths derives deterministic project and audit locations", () => {
  const evaluationRoot = path.resolve("evaluation-root");
  const paths = performancePaths(
    evaluationRoot,
    { generatedRoot: "generated-projects" },
    { id: "performance-50" },
  );

  assert.equal(paths.projectRelative, "generated-projects/performance-50");
  assert.equal(paths.projectRoot, path.join(evaluationRoot, "generated-projects", "performance-50"));
  assert.equal(paths.packageJsonRelative, "generated-projects/performance-50/package.json");
  assert.equal(paths.packageLockRelative, "generated-projects/performance-50/package-lock.json");
  assert.equal(paths.auditRelative, "audit-data/performance-50.npm-audit.json");
  assert.equal(paths.metadataRelative, "audit-data/performance-50.metadata.json");
});

test("performance input setup reports a failed base preflight before reading frozen inputs", () => {
  const options = { preflightRunner: () => ({ valid: false, errors: ["simulated failure"] }) };

  assert.throws(() => createFreezeContext("missing-root", options), /simulated failure/u);
  assert.deepEqual(runPerformancePreflight("missing-root", options), {
    valid: false,
    errors: ["Base evaluation preflight failed:\n- simulated failure"],
    summary: null,
  });
});
