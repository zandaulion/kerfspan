import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, deserializeProject, serializeProject,
  normalizeSlatHighlights, placeSlatHighlights, prepareVectorGeometry, traceMaskContours,
} from '../../web/core/index.js';

import { mixedSlatFixture } from './fixtures.js';

test('only light runs become long lines; every shadow pixel and contour vertex survives', () => {
  const { mask, sheet, placed, along } = mixedSlatFixture();
  const original = traceMaskContours(mask);
  const fit = prepareVectorGeometry(mask, sheet, [], { simplify: false, slatHighlights: placed });
  assert.equal(fit.report.mode, 'slat-highlights');
  assert.equal(fit.report.status, 'simplified');
  assert.equal(fit.report.highlightRunCount, 2);
  assert.ok(fit.report.outputVertexCount < fit.report.sourceVertexCount * 0.6);
  const fittedPoints = new Set(fit.contours.flat().map((point) => `${point.x},${point.y}`));
  const shadowPoints = original.flat().filter((point) => along(point.x * 0.6, point.y * 0.6) >= -10);
  assert.ok(shadowPoints.length > 100, 'the shadow fixture must contain fine detail to protect');
  for (const point of shadowPoints) assert.ok(fittedPoints.has(`${point.x},${point.y}`));
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x]) assert.equal(fit.rasterMask.data[y * mask.width + x], 1,
        'straightening highlights must not shave retained material');
      if (along((x + 0.5) * 0.6, (y + 0.5) * 0.6) >= -10) {
        assert.equal(fit.rasterMask.data[y * mask.width + x], mask.data[y * mask.width + x]);
      }
    }
  }
  let longLightEdges = 0;
  for (const contour of fit.contours) for (let index = 0; index < contour.length; index += 1) {
    const first = contour[index]; const last = contour[(index + 1) % contour.length];
    const normalDelta = Math.abs(-(last.x - first.x) * Math.sin(-55 * Math.PI / 180) +
      (last.y - first.y) * Math.cos(-55 * Math.PI / 180)) * 0.6;
    if (along(first.x * 0.6, first.y * 0.6) < -10 && along(last.x * 0.6, last.y * 0.6) < -10 &&
        normalDelta < 1 && Math.hypot(first.x - last.x, first.y - last.y) * 0.6 > 40) longLightEdges += 1;
  }
  assert.equal(longLightEdges, 2);
});

test('missing or dark-only guidance preserves the original contours exactly', () => {
  const { mask, sheet } = mixedSlatFixture();
  const original = traceMaskContours(mask);
  const fit = prepareVectorGeometry(mask, sheet, [], {
    simplify: false, slatHighlights: { coordinateSpace: 'sheet-mm', angleDeg: -55, regions: [] },
  });
  assert.deepEqual(fit.contours, original);
});

test('an unchanged corner contact elsewhere in the panel cannot cancel light-run straightening', () => {
  const { mask, sheet, placed } = mixedSlatFixture();
  // Two diagonal pinholes in the solid frame produce a repeated contour
  // vertex. They stay exact and must not trigger a global fitting fallback.
  mask.data[3 * mask.width + 3] = 0;
  mask.data[4 * mask.width + 4] = 0;
  const original = traceMaskContours(mask);
  assert.ok(original.some((contour) => new Set(contour.map((point) => `${point.x},${point.y}`)).size < contour.length));
  const fit = prepareVectorGeometry(mask, sheet, [], { simplify: false, slatHighlights: placed });
  assert.equal(fit.report.status, 'simplified', fit.report.fallbackReason);
  assert.ok(fit.report.highlightRunCount >= 2);
  assert.ok(fit.report.maximumDeviationMm <= fit.report.appliedToleranceMm);
  assert.equal(fit.rasterMask.data[3 * mask.width + 3], 0);
  assert.equal(fit.rasterMask.data[4 * mask.width + 4], 0);
});

test('highlight regions survive project and candidate storage without shared mutation', () => {
  const { highlights } = mixedSlatFixture();
  const project = createProject({ editor: {
    slatHighlights: highlights,
    candidates: [{ id: 'synthetic-light-runs', name: 'Synthetic slats', slatHighlights: highlights }],
  } });
  const restored = deserializeProject(serializeProject(project));
  assert.deepEqual(restored.editor.slatHighlights, highlights);
  assert.deepEqual(restored.editor.candidates[0].slatHighlights, highlights);
  highlights.regions[0][0] = 90;
  assert.notEqual(project.editor.slatHighlights.regions[0][0], 90);
});

test('placement rotates and crops highlight guidance with the artwork', () => {
  const source = { version: 1, coordinateSpace: 'normalized-source', angleDeg: 0,
    regions: [[0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75]] };
  const placed = placeSlatHighlights(source, { width: 100, height: 100 },
    { x: 25, y: 25, width: 50, height: 50 },
    { xMm: 10, yMm: 20, widthMm: 40, heightMm: 40, rotationDeg: 90 });
  assert.equal(placed.angleDeg, 90);
  assert.deepEqual(placed.regions[0].map((value) => Math.round(value)), [50, 20, 50, 60, 10, 60, 10, 20]);
  assert.throws(() => normalizeSlatHighlights({ ...source, regions: [[NaN]] }), /Invalid slat/);
});
