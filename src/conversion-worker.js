// @ts-check

import { executeWorkerConversion } from "./worker-protocol.js";

const scope = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (globalThis));

scope.onmessage = async (event) => {
  const request = event.data;
  const jobId = safeJobId(request);
  try {
    const result = await executeWorkerConversion(request, { onProgress(progress, phase) { scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "progress", jobId, progress, phase }); } });
    scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "result", jobId, result });
  } catch (cause) {
    scope.postMessage({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "error", jobId, code: errorCode(cause), message: errorMessage(cause) });
  }
};

/** @param {unknown} value */
function safeJobId(value) { if (value === null || typeof value !== "object" || Array.isArray(value)) return ""; const descriptor=Object.getOwnPropertyDescriptor(value,"jobId"); return descriptor&&"value" in descriptor&&typeof descriptor.value==="string"?descriptor.value:""; }
/** @param {unknown} value */
function errorCode(value) { if (value === null || typeof value !== "object") return "worker_failed"; const descriptor=Object.getOwnPropertyDescriptor(value,"code"); return descriptor&&"value" in descriptor&&typeof descriptor.value==="string"?descriptor.value.slice(0,128):"worker_failed"; }
/** @param {unknown} value */
function errorMessage(value){if(value&&typeof value==="object"){const descriptor=Object.getOwnPropertyDescriptor(value,"message");if(descriptor&&"value" in descriptor&&typeof descriptor.value==="string")return descriptor.value.slice(0,4096);}return"Worker conversion failed";}
