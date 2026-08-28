// @ts-check

import assert from "node:assert/strict";
import {
  aeroWebContentAuthoringContractVersion,
  aeroWebContentAuthoringPackageId,
  aeroWebContentAuthoringServiceId,
  authoringWorkerProtocolVersion,
  createAeroWebContentAuthoringServiceDescriptor,
  recipeDefinitions,
  rulesetDefinitions
} from "../src/index.js";

const descriptor = createAeroWebContentAuthoringServiceDescriptor();
assert.equal(aeroWebContentAuthoringPackageId, "aero.web.content-authoring");
assert.equal(aeroWebContentAuthoringServiceId, "aero.content.authoring");
assert.equal(aeroWebContentAuthoringContractVersion, 1);
assert.equal(authoringWorkerProtocolVersion, 1);
assert.equal(descriptor.implementationState, "implemented");
for (const capability of ["providerNeutralSourceInput", "conversionWorker", "cancellation", "localPersistence", "packageExport"]) assert.equal(descriptor.capabilities[capability], true, `${capability} must be implemented`);
assert.equal(descriptor.capabilities.sharedArrayBufferRequired, false);
assert.deepEqual(recipeDefinitions.map((entry) => entry.recipeId), ["row_family_balanced_height_v1", "cut_family_source_height_v1"]);
assert.deepEqual(rulesetDefinitions.map((entry) => entry.rulesetId), ["boxing_semantic_track_v1", "boxing_spatial_grid_v1"]);
assert.ok(Object.isFrozen(descriptor));
console.log("Content-authoring implemented package surface validation passed.");
