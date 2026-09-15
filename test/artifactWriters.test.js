const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeNewJson, writeNewText } = require("../src/artifactWriters");

test("artifact writers create parent directories and preserve exact content", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-writers-"));
  try {
    const textPath = path.join(temporaryRoot, "nested", "value.txt");
    const jsonPath = path.join(temporaryRoot, "nested", "value.json");
    writeNewText(textPath, "value\n");
    writeNewJson(jsonPath, { value: 1 });
    assert.equal(fs.readFileSync(textPath, "utf8"), "value\n");
    assert.equal(fs.readFileSync(jsonPath, "utf8"), '{\n  "value": 1\n}\n');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("artifact writers refuse to overwrite an existing file", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactreach-writers-existing-"));
  const filePath = path.join(temporaryRoot, "value.txt");
  try {
    writeNewText(filePath, "first");
    assert.throws(() => writeNewText(filePath, "second"), (error) => error.code === "EEXIST");
    assert.equal(fs.readFileSync(filePath, "utf8"), "first");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
