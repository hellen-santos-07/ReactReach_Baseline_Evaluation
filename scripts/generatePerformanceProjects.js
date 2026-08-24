#!/usr/bin/env node

const path = require("node:path");
const { generatePerformanceProjects, validateAllGeneratedProjects } = require("../src/performanceProjects");

function printProject(project) {
  console.log(`${project.projectId}: ${project.sourceFileCount} files (${project.core.sourceFileCount} core + ${project.benign.sourceFileCount} benign); SHA-256 ${project.sourceTreeSha256}`);
}

function main() {
  const evaluationRoot = path.resolve(__dirname, "..");
  if (process.argv.includes("--check")) {
    const validation = validateAllGeneratedProjects(evaluationRoot);
    if (!validation.valid) {
      console.error("Generated performance projects are invalid:");
      for (const error of validation.errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("Generated performance projects match the deterministic plans.");
    for (const project of validation.projects) printProject({ projectId: project.projectId, ...project.summary });
    return;
  }
  const projects = generatePerformanceProjects(evaluationRoot);
  for (const project of projects) {
    console.log(`${project.created ? "Created" : "Verified"} ${project.projectId}.`);
    printProject(project);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
