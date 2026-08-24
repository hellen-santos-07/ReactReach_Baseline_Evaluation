const path = require("node:path");
const { fork } = require("node:child_process");

function errorFromChild(message, stderr, exitCode) {
  const payload = message?.error;
  const suffix = stderr.trim() ? `\nChild stderr:\n${stderr.trim()}` : "";
  const error = new Error(`${payload?.message ?? `Performance sample process exited with code ${exitCode}`}${suffix}`);
  error.name = payload?.name ?? "Error";
  error.code = payload?.code ?? "PERFORMANCE_SAMPLE_FAILED";
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function runIsolatedPerformanceSample(evaluationRoot, projectId, options = {}) {
  const rssSampleIntervalMs = options.rssSampleIntervalMs;
  const timeoutMs = options.timeoutMs;
  const childScript = path.join(__dirname, "..", "scripts", "runPerformanceSampleProcess.js");
  return new Promise((resolve, reject) => {
    const child = fork(
      childScript,
      [evaluationRoot, projectId, String(rssSampleIntervalMs)],
      { cwd: evaluationRoot, silent: true },
    );
    let message = null;
    let stderr = "";
    let settled = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("message", (value) => { message = value; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0 && message?.type === "sample-result") resolve(message.result);
      else reject(errorFromChild(message, stderr, code));
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = new Error(`Performance sample ${projectId} exceeded ${timeoutMs} ms`);
      error.code = "PERFORMANCE_SAMPLE_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
}

module.exports = {
  errorFromChild,
  runIsolatedPerformanceSample,
};
