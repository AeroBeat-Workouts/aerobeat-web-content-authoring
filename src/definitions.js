// @ts-check

import { deepFreeze } from "./canonical.js";

export const boxingPrototypeContractId = "aerobeat.boxing.prototype.v1";
export const rowFamilyRecipeId = "row_family_balanced_height_v1";
export const cutFamilyRecipeId = "cut_family_source_height_v1";
export const semanticTrackRulesetId = "boxing_semantic_track_v1";
export const spatialGridRulesetId = "boxing_spatial_grid_v1";
export const recipeVersion = "1.0.0";
export const rulesetVersion = "1.0.0";
export const timingWindowMs = 180;
export const freshnessMs = 150;
export const straightQualificationMs = 100;
export const punchMinSpacingMs = 360;
// z2tx — product rule: no punch or guard beat may appear outside the center
// columns (columns 1-2 of the canonical 4-column grid). Punches are already
// center-only via spatialTarget; this candidate list is restricted to the three
// fully-center adjacent pairs so a guard whose only legal pair would be an edge
// pair ([0,1]/[2,3] and their row siblings) drops through the existing
// guard_no_legal_pair trace rather than emitting an edge-column target.
export const guardPairs = deepFreeze([[1, 2], [5, 6], [9, 10]]);
export const reachSubcellsPerBeat = deepFreeze({ Easy: 3, Normal: 3.5, Hard: 4, Expert: 5, ExpertPlus: 6 });

export const recipeDefinitions = deepFreeze([
  {
    contractId: boxingPrototypeContractId,
    recipeId: rowFamilyRecipeId,
    version: recipeVersion,
    label: "Row Family / Balanced Height",
    familyRule: { top: "uppercut", middle: "straight", bottom: "hook" },
    heightRule: "balance_generated_rows",
    punchMinSpacingMs,
    guardTimingWindowMs: timingWindowMs,
    obstacleTimingWindowMs: timingWindowMs,
    freshnessMs,
    straightQualificationMs,
    reachSubcellsPerBeat,
    initialWristCells: { left: 5, right: 6 }
  },
  {
    contractId: boxingPrototypeContractId,
    recipeId: cutFamilyRecipeId,
    version: recipeVersion,
    label: "Cut Family / Source Height",
    familyRule: { up: "uppercut", horizontal: "hook", other: "straight" },
    heightRule: "prefer_source_row_promote_bottom_uppercut",
    normalizeOutwardHooks: true,
    punchMinSpacingMs,
    guardTimingWindowMs: timingWindowMs,
    obstacleTimingWindowMs: timingWindowMs,
    freshnessMs,
    straightQualificationMs,
    reachSubcellsPerBeat,
    initialWristCells: { left: 5, right: 6 }
  }
]);

export const rulesetDefinitions = deepFreeze([
  {
    contractId: boxingPrototypeContractId,
    rulesetId: semanticTrackRulesetId,
    version: rulesetVersion,
    timingWindowMs,
    evidenceFreshnessMs: freshnessMs,
    straightQualificationMs,
    hookAndUppercutQualification: "target-cell-and-cardinal-direction",
    semanticClassifiers: "authoritative"
  },
  {
    contractId: boxingPrototypeContractId,
    rulesetId: spatialGridRulesetId,
    version: rulesetVersion,
    timingWindowMs,
    evidenceFreshnessMs: freshnessMs,
    straightQualificationMs,
    hookAndUppercutQualification: "target-cell-and-cardinal-direction",
    semanticClassifiers: "shadow-only",
    subgrid: { columns: 8, rows: 6, cellOrder: "top-left-row-major" }
  }
]);

export const supportedModifiers = deepFreeze(["no_squats", "no_weaves", "any_punch", "crossed_guard", "cross_body"]);
