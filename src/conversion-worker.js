// @ts-check

import { executeWorkerConversion } from "./worker-protocol.js";

const scope = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis));

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    const result = await executeWorkerConversion(request, { onProgress(progress, phase) { scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "progress", jobId: request?.jobId ?? "", progress, phase }); } });
    scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "result", jobId: request?.jobId ?? "", result });
  } catch (cause) {
    scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "error", jobId: request?.jobId ?? "", code: typeof cause?.code === "string" ? cause.code : "worker_failed", message: cause instanceof Error ? cause.message : "Worker conversion failed" });
  }
};
