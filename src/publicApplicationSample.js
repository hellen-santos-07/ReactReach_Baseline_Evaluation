const path = require("node:path");
const { fork } = require("node:child_process");

function errorFromPayload(payload) {
  const error = new Error(payload?.message ?? "Public-application scan worker failed");
  error.name = payload?.name ?? "Error";
  error.code = payload?.code ?? null;
  error.filePath = payload?.filePath ?? null;
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function runPublicApplicationSample(options) {
  const {
    evaluationRoot,
    projectId,
    timeoutMs,
    forkProcess = fork,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;
  const workerPath = path.join(__dirname, "publicApplicationScanWorker.js");
  return new Promise((resolve, reject) => {
    let peakRssBytes = 0;
    let rssSampleCount = 0;
    let completedResult = null;
    let workerError = null;
    let settled = false;
    const worker = forkProcess(
      workerPath,
      [JSON.stringify({ evaluationRoot, projectId })],
      { stdio: ["ignore", "ignore", "inherit", "ipc"], windowsHide: true },
    );
    const timeout = setTimeoutFn(() => {
      if (settled) return;
      settled = true;
      worker.kill();
      const error = new Error(`Public-application scan ${projectId} exceeded ${timeoutMs} ms`);
      error.code = "PUBLIC_APPLICATION_TIMEOUT";
      reject(error);
    }, timeoutMs);
    worker.on("message", (message) => {
      if (Number.isFinite(message.rssBytes)) {
        peakRssBytes = Math.max(peakRssBytes, message.rssBytes);
        rssSampleCount++;
      }
      if (message.type === "scan-completed") completedResult = message.result;
      if (message.type === "scan-error") workerError = errorFromPayload(message.error);
    });
    worker.on("error", (error) => { workerError = error; });
    worker.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(timeout);
      if (code !== 0 && !workerError) workerError = new Error(`Public-application worker for ${projectId} exited with code ${code}`);
      if (workerError) reject(workerError);
      else if (!completedResult) reject(new Error(`Public-application worker for ${projectId} exited without a result`));
      else resolve({ ...completedResult, peakRssBytes, rssSampleCount });
    });
  });
}

module.exports = { errorFromPayload, runPublicApplicationSample };
