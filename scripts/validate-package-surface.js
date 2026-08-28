// @ts-check

import { readFileSync } from "node:fs";
import {
  aeroWebContentAuthoringContractVersion,
  aeroWebContentAuthoringPackageId,
  aeroWebContentAuthoringServiceId,
  createAeroWebContentAuthoringServiceDescriptor
} from "../src/index.js";

const fixture = JSON.parse(readFileSync("fixtures/deterministic-conversion-placeholder.json", "utf8"));
const descriptor = createAeroWebContentAuthoringServiceDescriptor();

const failures = [];
if (aeroWebContentAuthoringPackageId !== "aero.web.content-authoring") failures.push("unexpected package ID");
if (aeroWebContentAuthoringServiceId !== "aero.content.authoring") failures.push("unexpected service ID");
if (aeroWebContentAuthoringContractVersion !== 1) failures.push("unexpected contract version");
if (descriptor.implementationState !== "scaffold") failures.push("scaffold must report truthful implementation state");
if (!descriptor.capabilities.providerNeutralSourceInput) failures.push("provider-neutral input boundary must be declared");
for (const capability of ["conversionWorker", "cancellation", "localPersistence", "packageExport"]) {
  if (descriptor.capabilities[capability] !== false) failures.push(`${capability} must remain false in scaffold`);
}
if (!Object.isFrozen(descriptor) || !Object.isFrozen(descriptor.capabilities)) failures.push("descriptor must be deeply frozen at its public nested object");
if (fixture.fixtureId !== "aero.web.content-authoring.placeholder.v1") failures.push("unexpected deterministic fixture ID");
if (fixture.expected.implementationState !== descriptor.implementationState) failures.push("fixture and public descriptor disagree");
if (fixture.sourceMaterial.provider !== "normalized-fixture") failures.push("fixture must remain provider-neutral");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Content-authoring package surface scaffold check passed.");
