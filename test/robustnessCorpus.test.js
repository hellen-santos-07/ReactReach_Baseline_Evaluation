const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const evaluationRoot = path.resolve(__dirname, "..");
const projectRoot = path.join(evaluationRoot, "corpus", "robustness-multipackage");
const finalGroundTruth = require("../ground-truth/ground-truth.json");
const robustness = {
  scenarios: finalGroundTruth.scenarios.filter((scenario) => scenario.projectId === "robustness-multipackage"),
};
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const complexityTiers = [
  "complexity-simple",
  "complexity-intermediate",
  "complexity-realistic",
];

function normalize(relativePath) {
  return relativePath.replaceAll("\\", "/");
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
    })
    .filter((filePath) => sourceExtensions.has(path.extname(filePath)));
}

test("the robustness corpus remains balanced, multi-package and complexity-stratified", () => {
  const scenarios = robustness.scenarios;
  assert.equal(scenarios.length, 12);
  assert.equal(scenarios.filter((scenario) => scenario.expected.contextuallyReachable).length, 6);
  assert.equal(scenarios.filter((scenario) => !scenario.expected.contextuallyReachable).length, 6);

  for (const packageName of ["dompurify", "serialize-javascript"]) {
    assert.equal(
      scenarios.filter((scenario) => scenario.packageName === packageName).length,
      6,
      `${packageName} must contribute six scenarios`,
    );
  }

  for (const tier of complexityTiers) {
    assert.equal(
      scenarios.filter((scenario) => scenario.tags.includes(tier)).length,
      4,
      `${tier} must contain four scenarios`,
    );
  }

  for (const scenario of scenarios) {
    assert.equal(
      complexityTiers.filter((tier) => scenario.tags.includes(tier)).length,
      1,
      `${scenario.id} must declare exactly one complexity tier`,
    );
  }
});

test("each robustness scenario is an isolated, self-contained module graph", () => {
  const scenarioDirectories = new Set();

  for (const scenario of robustness.scenarios) {
    const normalizedSource = normalize(scenario.sourceFile);
    const match = normalizedSource.match(/^src\/scenarios\/([^/]+)\//u);
    assert.ok(match, `${scenario.id} must live below src/scenarios/<scenario>/`);

    const scenarioPrefix = `src/scenarios/${match[1]}/`;
    const scenarioDirectory = path.join(projectRoot, "src", "scenarios", match[1]);
    scenarioDirectories.add(match[1]);
    assert.ok(fs.statSync(scenarioDirectory).isDirectory());

    const files = sourceFiles(scenarioDirectory);
    const relativeFiles = files
      .map((filePath) => normalize(path.relative(projectRoot, filePath)))
      .sort();
    const evidenceFiles = scenario.evidence.lines
      .map((line) => normalize(line.file ?? scenario.sourceFile))
      .sort();

    assert.deepEqual(
      evidenceFiles,
      relativeFiles,
      `${scenario.id} evidence must cover every source module in its isolated graph`,
    );

    const tier = complexityTiers.find((candidate) => scenario.tags.includes(candidate));
    if (tier === "complexity-simple") assert.equal(files.length, 1, `${scenario.id} must have one module`);
    if (tier === "complexity-intermediate") {
      assert.ok(files.length >= 2 && files.length <= 3, `${scenario.id} must have two or three modules`);
    }
    if (tier === "complexity-realistic") assert.ok(files.length >= 4, `${scenario.id} must have at least four modules`);

    const combinedSource = files.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
    assert.ok(
      combinedSource.includes(`"${scenario.packageName}"`) || combinedSource.includes(`'${scenario.packageName}'`),
      `${scenario.id} must import or require ${scenario.packageName}`,
    );

    for (const evidenceFile of evidenceFiles) {
      assert.ok(evidenceFile.startsWith(scenarioPrefix), `${scenario.id} evidence must not cross scenario folders`);
    }

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf8");
      const relativeSpecifiers = [...source.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*["'](\.[^"']+)["']/gu)]
        .map((matchResult) => matchResult[1]);
      for (const specifier of relativeSpecifiers) {
        const resolved = path.resolve(path.dirname(filePath), specifier);
        const relativeToScenario = path.relative(scenarioDirectory, resolved);
        assert.ok(
          relativeToScenario !== ".." && !relativeToScenario.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeToScenario),
          `${scenario.id} contains a cross-scenario import: ${specifier}`,
        );
      }
    }
  }

  assert.equal(scenarioDirectories.size, 12, "each robustness scenario must have its own folder");
});
