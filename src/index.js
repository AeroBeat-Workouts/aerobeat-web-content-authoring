// @ts-check

export { parseBeatMapDifficulty, AuthoringParseError } from "./beatmap.js";
export { canonicalJson, prefixedSha256, sha256Hex } from "./canonical.js";
export { convertDifficulty } from "./converter.js";
export { canonicalConverterProfile, converterProfileClass, normalizeConverterProfile, prototypeReachConverterProfile } from "./converter-profile.js";
export {
  boxingPrototypeContractId,
  cutFamilyRecipeId,
  recipeDefinitions,
  rowFamilyRecipeId,
  rulesetDefinitions,
  semanticTrackRulesetId,
  spatialGridRulesetId
} from "./definitions.js";
export { exportAuthoredPackage, inspectAuthoredPackageExport } from "./export.js";
export { semanticParityHash, semanticParityProjection } from "./parity.js";
export {
  authoringDatabaseName,
  authoringDatabaseVersion,
  authoringPersistenceNamespace,
  createIndexedDbPersistenceAdapter,
  createMemoryPersistenceAdapter
} from "./persistence.js";
export { createAeroWebContentAuthoringService } from "./service.js";
export { prepareSourceMaterial } from "./source-material.js";
export { validateAuthoredPackage } from "./validator.js";
export {
  authoringWorkerProtocolVersion,
  createBrowserAuthoringWorkerAdapter,
  createInlineAuthoringWorkerAdapter,
  executeWorkerConversion
} from "./worker-protocol.js";

/** @type {"aero.web.content-authoring"} */
export const aeroWebContentAuthoringPackageId = "aero.web.content-authoring";
/** @type {"aero.content.authoring"} */
export const aeroWebContentAuthoringServiceId = "aero.content.authoring";
/** @type {1} */
export const aeroWebContentAuthoringContractVersion = 1;

export function createAeroWebContentAuthoringServiceDescriptor() {
  return Object.freeze({
    packageId: aeroWebContentAuthoringPackageId,
    serviceId: aeroWebContentAuthoringServiceId,
    contractVersion: aeroWebContentAuthoringContractVersion,
    implementationState: "implemented",
    capabilities: Object.freeze({
      providerNeutralSourceInput: true,
      conversionWorker: true,
      cancellation: true,
      localPersistence: true,
      packageExport: true,
      sharedArrayBufferRequired: false
    })
  });
}
