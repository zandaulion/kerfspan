import { prepareVectorGeometry } from './vector-geometry.js';
import { validateDesign } from './validation.js';

/**
 * Slat highlight fitting defines the cutting boundary before manufacturing
 * checks. Keep the editable raster separate so repairs store only their own
 * edits, rather than baking in and repeatedly expanding a straightened edge.
 * Whole-artwork simplification retains its separate guarded export workflow.
 */
export function validateManufacturingGeometry(mask, options, report) {
  const vectorOptions = options.vectorOptions;
  const prepared = vectorOptions?.slatHighlights?.regions?.length && vectorOptions.simplify !== true
    ? prepareVectorGeometry(mask, options.sheet, options.exactCircleHoles, vectorOptions)
    : null;
  const geometry = prepared?.rasterMask ?? mask;
  return { mask: geometry, prepared, validation: validateDesign(geometry, options, report) };
}
