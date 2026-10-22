import { assertMask, assertSheet } from "./mask.js";
import { traceMaskContours } from "./svg.js";
import { separateCircleContours } from "./vector-dots.js";

const DXF_UNITS = Object.freeze({
  mm: { code: 4, millimetresPerUnit: 1, measurement: 1 },
  in: { code: 1, millimetresPerUnit: 25.4, measurement: 0 },
});

/**
 * Emits a deterministic ASCII DXF R12 (AC1009) file: one closed POLYLINE per
 * retained-material contour and an exact CIRCLE per matched Variable Dot hole.
 * R12 needs no object handles or class markers, which is what strict CAM
 * importers such as Vectric Aspire expect; a partial AutoCAD 2000 file
 * without them was rejected. Raster Y coordinates are flipped into Cartesian
 * DXF space so the visual orientation matches SVG output.
 *
 * @param {import('./mask.js').RasterMask} mask
 * @param {{widthMm:number,heightMm:number}} sheet
 * @param {{units?:'mm'|'in',precision?:number,exactCircleHoles?:Array<{cxMm:number,cyMm:number,radiusMm:number}>,preparedGeometry?:{contours:Array<Array<{x:number,y:number}>>,matchedCircles:Array<{cxMm:number,cyMm:number,radiusMm:number}>}}} [options]
 */
export function exportDxf(mask, sheet, options = {}) {
  assertMask(mask);
  assertSheet(sheet);
  const units = options.units ?? "mm";
  const unit = DXF_UNITS[units];
  if (!unit) throw new RangeError("DXF units must be 'mm' or 'in'");
  const precision = options.precision ?? 6;
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
    throw new RangeError("DXF precision must be an integer from 0 to 12");
  }

  const width = sheet.widthMm / unit.millimetresPerUnit;
  const height = sheet.heightMm / unit.millimetresPerUnit;
  const scaleX = width / mask.width;
  const scaleY = height / mask.height;
  const lines = [];
  const pair = (code, value) => {
    lines.push(String(code), String(value));
  };

  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1009");
  // Not part of R12 itself, but readers that know it use it to pick drawing
  // units, and R12 readers skip header variables they do not know.
  pair(9, "$INSUNITS");
  pair(70, unit.code);
  pair(9, "$EXTMIN");
  pair(10, "0");
  pair(20, "0");
  pair(30, "0");
  pair(9, "$EXTMAX");
  pair(10, formatNumber(width, precision));
  pair(20, formatNumber(height, precision));
  pair(30, "0");
  pair(0, "ENDSEC");

  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LTYPE");
  pair(70, 1);
  pair(0, "LTYPE");
  pair(2, "CONTINUOUS");
  pair(70, 0);
  pair(3, "Solid line");
  pair(72, 65);
  pair(73, 0);
  pair(40, "0");
  pair(0, "ENDTAB");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(70, 1);
  pair(0, "LAYER");
  pair(2, "CUT");
  pair(70, 0);
  pair(62, 7);
  pair(6, "CONTINUOUS");
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");

  pair(0, "SECTION");
  pair(2, "ENTITIES");
  const separated = options.preparedGeometry ??
    separateCircleContours(traceMaskContours(mask), mask, sheet, options.exactCircleHoles);
  for (const contour of separated.contours) {
    pair(0, "POLYLINE");
    pair(8, "CUT");
    pair(66, 1);
    pair(10, "0");
    pair(20, "0");
    pair(30, "0");
    pair(70, 1);
    for (const point of contour) {
      pair(0, "VERTEX");
      pair(8, "CUT");
      pair(10, formatNumber(point.x * scaleX, precision));
      pair(20, formatNumber(height - point.y * scaleY, precision));
      pair(30, "0");
    }
    pair(0, "SEQEND");
    pair(8, "CUT");
  }
  for (const circle of separated.matchedCircles) {
    pair(0, "CIRCLE");
    pair(8, "CUT");
    pair(10, formatNumber(circle.cxMm / unit.millimetresPerUnit, precision));
    pair(20, formatNumber(height - circle.cyMm / unit.millimetresPerUnit, precision));
    pair(30, "0");
    pair(40, formatNumber(circle.radiusMm / unit.millimetresPerUnit, precision));
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return `${lines.join("\n")}\n`;
}

export const maskToDxf = exportDxf;

function formatNumber(value, precision) {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
