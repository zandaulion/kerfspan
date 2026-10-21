import test from "node:test";
import assert from "node:assert/strict";

import { createMask, REMOVED, validateDesign } from "../../web/core/index.js";

// A coarse raster, like an 800 mm panel at about 0.6 mm per cell, where
// limit-sized dots and gaps lose up to a cell to stair-stepping.
const sheet = { widthMm: 120, heightMm: 60 };
const options = {
  sheet,
  kerfMm: 1.2,
  minimumWebMm: 3,
  minimumOpeningMm: 2,
  anchorBoundary: false,
  requireAnchored: false,
  requireSingleComponent: true,
};

function dotGrid({ pitchMm, diameterMm, smallDiameterMm = diameterMm }) {
  const mask = createMask(200, 100, 1);
  const scale = mask.width / sheet.widthMm;
  const circles = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const small = (row + column) % 2 === 1;
      circles.push({
        cxMm: 20 + column * pitchMm,
        cyMm: 20 + row * pitchMm,
        radiusMm: (small ? smallDiameterMm : diameterMm) / 2,
      });
    }
  }
  for (const circle of circles) {
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        const dx = (x + 0.5) / scale - circle.cxMm;
        const dy = (y + 0.5) / scale - circle.cyMm;
        if (Math.hypot(dx, dy) <= circle.radiusMm) mask.data[y * mask.width + x] = REMOVED;
      }
    }
  }
  return { mask, circles };
}

const codes = (validation) => validation.issues.map((entry) => entry.code).sort();

test("limit-sized exact dots are not failed by their raster approximation", () => {
  const { mask, circles } = dotGrid({ pitchMm: 8.5, diameterMm: 5.5, smallDiameterMm: 2 });
  const rasterOnly = validateDesign(mask, options);
  assert.ok(codes(rasterOnly).length > 0, "the raster alone should show the false positives");
  const exact = validateDesign(mask, { ...options, exactCircleHoles: circles });
  assert.deepEqual(codes(exact), []);
});

test("exact dots that really break the limits are still reported", () => {
  const tight = dotGrid({ pitchMm: 8, diameterMm: 5.5 });
  const gapCheck = validateDesign(tight.mask, { ...options, exactCircleHoles: tight.circles });
  const gap = gapCheck.issues.find((entry) => entry.code === "MIN_CUT_GAP");
  assert.ok(gap, "a 2.5 mm gap must be reported");
  assert.ok(Math.abs(gap.details.gapMm - 2.5) < 1e-6, `exact gap, got ${gap.details.gapMm}`);

  const tiny = dotGrid({ pitchMm: 8.5, diameterMm: 5.5, smallDiameterMm: 1.6 });
  const openingCheck = validateDesign(tiny.mask, { ...options, exactCircleHoles: tiny.circles });
  assert.ok(codes(openingCheck).includes("MIN_OPENING_UNCUTTABLE"), "a 1.6 mm dot must be reported");
});
