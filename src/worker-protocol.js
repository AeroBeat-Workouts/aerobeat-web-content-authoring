// @ts-check

import { cloneData, deepFreeze, isPlainRecord, prefixedSha256 } from "./canonical.js";
import { parseBeatMapDifficulty } from "./beatmap.js";
import { convertDifficulty } from "./converter.js";
import { semanticParityHash } from "./parity.js";
import { validateAuthoredPackage } from "./validator.js";

export const authoringWorkerProtocolVersion = 1;

/** @typedef {Parameters<typeof convertDifficulty>[1]} WorkerConversionOptions */
/** @typedef {"v2" | "v3" | "v4"} BeatMapFormat */

/**
 * Execute one structured-clone-safe conversion request in Worker-compatible code.
 *
 * @param {unknown} request
 * @param {{signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}} [runtime]
 */
export async function executeWorkerConversion(request, runtime = {}) {
  const normalized = narrowRequest(request);
  checkAbort(runtime.signal);
  runtime.onProgress?.(0.05, "parsing");
  const sourceSummary = parseBeatMapDifficulty(normalized.difficultyBytes, normalized.format);
  normalized.options.sourceDifficultyHash = await prefixedSha256(normalized.difficultyBytes);
  checkAbort(runtime.signal);
  const converted = await convertDifficulty(sourceSummary, normalized.options, (progress, phase) => { checkAbort(runtime.signal); runtime.onProgress?.(progress, phase); });
  checkAbort(runtime.signal);
  const validation = await validateAuthoredPackage(converted.package);
  if (!validation.valid) throw workerError("package_validation_failed", validation.issues.map((entry) => entry.code).join(", "));
  runtime.onProgress?.(0.9, "validating");
  const parityHash = await semanticParityHash(converted.package);
  return deepFreeze({ schema: "aerobeat/authoring_worker_result", version: 1, jobId: normalized.jobId, package: cloneData(converted.package), packageHash: validation.packageHash, sourceHash: converted.sourceHash, semanticParityHash: parityHash, traces: cloneData(converted.traces) });
}

/**
 * Inline Worker adapter for deterministic Node tests and browsers without Worker.
 */
export function createInlineAuthoringWorkerAdapter() {
  let destroyed = false;
  return Object.freeze({
    kind: "inline",
    /** @param {unknown} request @param {{signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}} [runtime] */
    async convert(request, runtime = {}) { if (destroyed) throw workerError("worker_destroyed", "Worker adapter is destroyed"); await Promise.resolve(); return executeWorkerConversion(request, runtime); },
    destroy() { destroyed = true; }
  });
}

/**
 * Browser module Worker adapter. Every request gets one disposable Worker, so abort,
 * replacement and destroy cannot deliver stale completion.
 *
 * @param {{workerFactory?: () => Worker}} [options]
 */
export function createBrowserAuthoringWorkerAdapter(options = {}) {
  const workerFactory = options.workerFactory ?? (() => new Worker(new URL("./conversion-worker.js", import.meta.url), { type: "module", name: "aerobeat-content-authoring" }));
  const active = new Set(); let destroyed = false;
  return Object.freeze({
    kind: "worker",
    /** @param {unknown} request @param {{signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}} [runtime] */
    convert(request, runtime = {}) {
      if (destroyed) return Promise.reject(workerError("worker_destroyed", "Worker adapter is destroyed"));
      return new Promise((resolve, reject) => {
        const worker = workerFactory(); active.add(worker); let settled = false;
        const finish = (action, value) => { if (settled) return; settled = true; runtime.signal?.removeEventListener("abort", abort); worker.terminate(); active.delete(worker); action(value); };
        const abort = () => finish(reject, workerError("operation_aborted", "Conversion was cancelled"));
        runtime.signal?.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event) => {
          const message = event.data;
          if (!isPlainRecord(message) || message.version !== 1) return;
          if (message.kind === "progress") runtime.onProgress?.(Number(message.progress), String(message.phase));
          else if (message.kind === "result") finish(resolve, message.result);
          else if (message.kind === "error") finish(reject, workerError(String(message.code ?? "worker_failed"), String(message.message ?? "Worker conversion failed")));
        };
        worker.onerror = (event) => finish(reject, workerError("worker_failed", event.message || "Worker conversion failed"));
        const clone = cloneData(request);
        const bytes = isPlainRecord(clone) && clone.difficultyBytes instanceof Uint8Array ? clone.difficultyBytes : null;
        worker.postMessage(clone, bytes ? [bytes.buffer] : []);
        if (runtime.signal?.aborted) abort();
      });
    },
    destroy() { destroyed = true; for (const worker of active) worker.terminate(); active.clear(); }
  });
}

/** @param {unknown} request @returns {{jobId: string, difficultyBytes: Uint8Array, format: BeatMapFormat, options: WorkerConversionOptions}} */
function narrowRequest(request) {
  if (!isPlainRecord(request) || request.schema !== "aerobeat/authoring_worker_request" || request.version !== 1 || request.kind !== "convert" || typeof request.jobId !== "string" || !request.jobId || !(request.difficultyBytes instanceof Uint8Array) || !isPlainRecord(request.manifest) || !isPlainRecord(request.options)) throw workerError("worker_request_invalid", "Worker request shape is invalid");
  const major = Number(request.manifest.sourceFormatMajor); const format = major === 2 ? "v2" : major === 3 ? "v3" : major === 4 ? "v4" : null;
  if (!format) throw workerError("source_format_unsupported", "Only Beat Saber v2, v3 and v4 are supported");
  return { jobId: request.jobId, difficultyBytes: Uint8Array.from(request.difficultyBytes), format, options: /** @type {WorkerConversionOptions} */ (cloneData(request.options)) };
}
/** @param {AbortSignal | undefined} signal */
function checkAbort(signal) { if (signal?.aborted) throw workerError("operation_aborted", "Conversion was cancelled"); }
/** @param {string} code @param {string} message */
function workerError(code, message) { const error = new Error(message); error.name = "AeroAuthoringWorkerError"; Object.assign(error, { code }); return error; }
