// @ts-check

import { executeWorkerConversion, workerFailureCode, workerFailureMessage } from "./worker-protocol.js";

const scope = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis));

scope.onmessage = async (event) => {
  const request = event.data;
  const jobId = safeJobId(request);
  try {
    const result = await executeWorkerConversion(request, { onProgress(progress, phase) { scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 2, kind: "progress", jobId, progress, phase }); } });
    scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 2, kind: "result", jobId, result });
  } catch (cause) {
    scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 2, kind: "error", jobId, code: workerFailureCode(cause), message: workerFailureMessage(cause) });
  }
};

/** @param {unknown} value */
function safeJobId(value) { if (value === null || typeof value !== "object" || Array.isArray(value)) return ""; const descriptor=Object.getOwnPropertyDescriptor(value,"jobId"); return descriptor&&"value" in descriptor&&typeof descriptor.value==="string"?descriptor.value:""; }
// Failure text comes from worker-protocol's shared readers so a DOMException keeps its real
// message instead of collapsing to the historic "Worker conversion failed" placeholder.
