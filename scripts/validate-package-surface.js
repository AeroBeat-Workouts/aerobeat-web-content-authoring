// @ts-check

import assert from "node:assert/strict";
import * as publicApi from "../src/index.js";
import {
  aeroWebContentAuthoringContractVersion,
  aeroWebContentAuthoringPackageId,
  aeroWebContentAuthoringServiceId,
  authoringWorkerProtocolVersion,
  createAeroWebContentAuthoringServiceDescriptor,
  executeWorkerConversion,
  recipeDefinitions,
  rulesetDefinitions
} from "../src/index.js";

const descriptor = createAeroWebContentAuthoringServiceDescriptor();
assert.equal(aeroWebContentAuthoringPackageId, "aero.web.content-authoring");
assert.equal(aeroWebContentAuthoringServiceId, "aero.content.authoring");
assert.equal(aeroWebContentAuthoringContractVersion, 1);
assert.equal(authoringWorkerProtocolVersion, 2, "the only public authoring Worker protocol generation is v2");
assert.deepEqual(Object.keys(publicApi).filter((name)=>name.toLowerCase().includes("workerprotocolversion")),["authoringWorkerProtocolVersion"],"the root surface must not export a v1 or legacy Worker protocol alias");
const staleV1Request={schema:"aerobeat/authoring_worker_request",version:1,kind:"convert",jobId:"surface-v1-rejection",manifest:null,difficultyBytes:new Uint8Array(),options:null};
await assert.rejects(()=>executeWorkerConversion(staleV1Request),(error)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="worker_request_invalid"),"the public executor must reject an exact-shape v1 request before reading stale payload fields");
assert.equal(descriptor.implementationState, "implemented");
for (const capability of ["providerNeutralSourceInput", "conversionWorker", "cancellation", "localPersistence", "packageExport"]) assert.equal(descriptor.capabilities[capability], true, `${capability} must be implemented`);
assert.equal(descriptor.capabilities.sharedArrayBufferRequired, false);
assert.deepEqual(recipeDefinitions.map((entry) => entry.recipeId), ["row_family_balanced_height_v1", "cut_family_source_height_v1"]);
assert.deepEqual(rulesetDefinitions.map((entry) => entry.rulesetId), ["boxing_semantic_track_v1", "boxing_spatial_grid_v1"]);
assert.ok(Object.isFrozen(descriptor));
console.log("Content-authoring implemented package surface validation passed.");
