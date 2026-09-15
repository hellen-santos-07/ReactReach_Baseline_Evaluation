const fs = require("node:fs");
const path = require("node:path");

function writeNewText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { encoding: "utf8", flag: "wx" });
}

function writeNewJson(filePath, value) {
  writeNewText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = { writeNewJson, writeNewText };
