// @ts-check

/**
 * Truthful capability state for the browser content-authoring service scaffold.
 *
 * @typedef {Readonly<{
 *   providerNeutralSourceInput: boolean,
 *   conversionWorker: boolean,
 *   cancellation: boolean,
 *   localPersistence: boolean,
 *   packageExport: boolean
 * }>} AeroWebContentAuthoringCapabilities
 */

/**
 * Public descriptor for the browser content-authoring service boundary.
 *
 * @typedef {Readonly<{
 *   packageId: "aero.web.content-authoring",
 *   serviceId: "aero.content.authoring",
 *   contractVersion: 1,
 *   implementationState: "scaffold",
 *   capabilities: AeroWebContentAuthoringCapabilities
 * }>} AeroWebContentAuthoringServiceDescriptor
 */

/** @type {"aero.web.content-authoring"} */
export const aeroWebContentAuthoringPackageId = "aero.web.content-authoring";

/** @type {"aero.content.authoring"} */
export const aeroWebContentAuthoringServiceId = "aero.content.authoring";

/** @type {1} */
export const aeroWebContentAuthoringContractVersion = 1;

/**
 * Creates a frozen, truthful descriptor for the scaffold-only public service.
 *
 * @returns {AeroWebContentAuthoringServiceDescriptor}
 */
export function createAeroWebContentAuthoringServiceDescriptor() {
  return Object.freeze({
    packageId: aeroWebContentAuthoringPackageId,
    serviceId: aeroWebContentAuthoringServiceId,
    contractVersion: aeroWebContentAuthoringContractVersion,
    implementationState: "scaffold",
    capabilities: Object.freeze({
      providerNeutralSourceInput: true,
      conversionWorker: false,
      cancellation: false,
      localPersistence: false,
      packageExport: false
    })
  });
}
