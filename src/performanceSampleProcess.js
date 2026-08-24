const path = require("node:path");
const { Worker } = require("node:worker_threads");

function errorFromPayload(payload) {
  const error = new Error(payload?.message ?? "Performance scan worker failed");
  error.name = payload?.name ?? "Error";
  error.code = payload?.code ?? null;
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function runPerformanceSampleProcess(options) {
  const {
    evaluationRoot,
    projectId,
    rssSampleIntervalMs,
    WorkerClass = Worker,
    rssReader = () => process.memoryUsage.rss(),
  } = options;
  const workerPath = path.join(__dirname, "performanceScanWorker.js");
  return new Promise((resolve, reject) => {
    let peakRssBytes = rssReader();
    let rssSampleCount = 1;
    let completedResult = null;
    let workerError = null;
    const sampleRss = () => {
      peakRssBytes = Math.max(peakRssBytes, rssReader());
      rssSampleCount++;
    };
    const interval = setInterval(sampleRss, rssSampleIntervalMs);
    const worker = new WorkerClass(workerPath, { workerData: { evaluationRoot, projectId } });
    const finish = () => {
      clearInterval(interval);
      sampleRss();
      if (workerError) reject(workerError);
      else if (!completedResult) reject(new Error(`Performance worker for ${projectId} exited without a result`));
      else resolve({ ...completedResult, peakRssBytes, rssSampleCount });
    };
    worker.on("message", (message) => {
      if (Number.isFinite(message.rssBytes)) peakRssBytes = Math.max(peakRssBytes, message.rssBytes);
      if (message.type === "scan-completed") completedResult = message.result;
      if (message.type === "scan-error") workerError = errorFromPayload(message.error);
    });
    worker.on("error", (error) => { workerError = error; });
    worker.on("exit", (code) => {
      if (code !== 0 && !workerError) workerError = new Error(`Performance worker for ${projectId} exited with code ${code}`);
      finish();
    });
  });
}

module.exports = {
  errorFromPayload,
  runPerformanceSampleProcess,
};
