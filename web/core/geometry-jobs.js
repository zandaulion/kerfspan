import { applyCapsuleBridges } from "./bridges.js";
import { kerfErosionMm } from "./geometry-contract.js";
import { erodeMaskPhysical } from "./morphology.js";
import {
  applySmallOpeningRepairPlan,
  measureRepairEffects,
  planManufacturingRepairs,
} from "./repairs.js";
import { suggestKerfAwareBridges } from "./suggestions.js";
import { validateDesign } from "./validation.js";
import { prepareVectorGeometry, vectorManufacturingValidationRegressed } from "./vector-geometry.js";
import { materializeBridgeStrategy } from "./feature-guidance.js";
import { validateManufacturingGeometry } from "./manufacturing-geometry.js";
import { encodeMask } from "./project.js";

function geometryOnlyStrategy(strategy) {
  if (!strategy) return strategy;
  return materializeBridgeStrategy({ ...strategy, featureGuidance: null });
}

function finishedPreview(mask, options) {
  const lossMm = kerfErosionMm(options.kerfMm, options.geometryInterpretation);
  return lossMm > 0
    ? erodeMaskPhysical(mask, lossMm / 2, options.sheet)
    : { ...mask, data: Uint8Array.from(mask.data) };
}

function planSupports(payload, report) {
  const { mask, config, validation } = payload;
  const strategy = materializeBridgeStrategy(config.strategy);
  let usedImageFallback = false;
  let plan;
  report("components", "Finding retained-material components and candidate connections…");
  try {
    plan = suggestKerfAwareBridges(mask, { ...config, strategy });
  } catch (featureError) {
    if (!strategy?.featureAt) throw featureError;
    usedImageFallback = true;
    report("fallback", "Image guidance failed; preserving detail with structural placement…");
    try {
      plan = suggestKerfAwareBridges(mask, {
        ...config,
        strategy: { ...strategy, featureAt: null, detailAt: strategy.fallbackDetailAt },
      });
    } catch {
      plan = suggestKerfAwareBridges(mask, {
        ...config,
        strategy: geometryOnlyStrategy(config.strategy),
      });
    }
  }
  report("checking", "Checking the proposed supports against finished connectivity…");
  const proposed = applyCapsuleBridges(mask, plan.bridges, config.sheet);
  const supportSimulation = validateDesign(proposed, validation);
  return { plan, supportSimulation, usedImageFallback };
}

/** Executes one structured-clone-safe geometry task inside a Worker or test. */
export function executeGeometryJob(type, payload, report = () => {}) {
  if (type === "encode-project-masks") {
    return {
      sourceMask: payload.sourceMask ? encodeMask(payload.sourceMask) : null,
      baseMask: payload.baseMask ? encodeMask(payload.baseMask) : null,
    };
  }
  if (type === "vector-prepare" || type === "vector-preview") {
    report("simplifying", "Preparing physical-tolerance vector contours…");
    const prepared = prepareVectorGeometry(
      payload.mask,
      payload.sheet,
      payload.exactCircleHoles,
      payload.options,
    );
    // Draft previews fit the same paths without silently running a complete
    // manufacturing review after every creative edit. Checked previews and
    // cutting exports use vector-prepare and share its post-fit checks.
    const changesRasterResult = prepared.rasterMask !== payload.mask;
    if (type === "vector-preview") return { prepared, changesRasterResult, postFitValidation: null };
    let postFitValidation = null;
    if (changesRasterResult) {
      report("checking", "Rasterizing the actual vector output and rechecking manufacturing constraints…");
      postFitValidation = validateDesign(prepared.rasterMask, payload.validationOptions);
    }
    // A Slats baseline may already describe fitted paths. If a later fit is
    // rejected, independently check the raw fallback before releasing it.
    const fallbackValidation = prepared.report.mode === 'slat-highlights' && changesRasterResult &&
      payload.baselineValidation && vectorManufacturingValidationRegressed(payload.baselineValidation, postFitValidation)
      ? validateDesign(payload.mask, payload.validationOptions) : null;
    return { prepared, changesRasterResult, postFitValidation, fallbackValidation };
  }
  if (type === "validate") {
    report("checking", "Checking connectivity, openings, and finished metal widths…");
    const checked = validateManufacturingGeometry(payload.mask, payload.options, report);
    return checked.prepared
      ? { ...checked.validation, preparedGeometry: checked.prepared }
      : checked.validation;
  }
  if (type === "repair") {
    report("planning", "Testing local corrections against the complete blocker set…");
    const proposal = planManufacturingRepairs(payload.mask, {
      ...payload.options,
      bridgeStrategy: materializeBridgeStrategy(payload.options.bridgeStrategy),
    });
    return {
      proposal,
      finishedMask: finishedPreview(proposal.preparedGeometry?.rasterMask ?? proposal.mask, payload.options),
    };
  }
  if (type === "repair-evaluate") {
    report("checking", "Rechecking the selected repair choices against every blocker…");
    const candidate = applySmallOpeningRepairPlan(payload.mask, payload.plan);
    const before = validateManufacturingGeometry(payload.mask, payload.options);
    const after = validateManufacturingGeometry(candidate, payload.options);
    const beforeValidation = before.validation;
    const afterValidation = after.validation;
    return {
      candidate,
      preparedGeometry: after.prepared,
      finishedMask: finishedPreview(after.mask, payload.options),
      beforeValidation,
      afterValidation,
      effects: measureRepairEffects(before.mask, after.mask, {
        sheet: payload.options.sheet,
        beforeValidation,
        afterValidation,
      }),
    };
  }
  if (type === "support") return planSupports(payload, report);
  throw new RangeError(`Unknown geometry job: ${type}`);
}
