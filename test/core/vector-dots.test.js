import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMask,
  intactCircleHoles,
  normalizeVectorDots,
  placeVectorDots,
  REMOVED,
} from '../../web/core/index.js';

const descriptor = {
  version: 1,
  coordinateSpace: 'normalized-source',
  radiusSpace: 'normalized-source-width',
  circles: [[0.25, 0.5, 0.05]],
};

test('Variable Dot geometry follows the artwork crop and physical placement', () => {
  const placed = placeVectorDots(
    descriptor,
    { width: 100, height: 200 },
    { x: 10, y: 20, width: 80, height: 160 },
    { xMm: 30, yMm: 40, widthMm: 160, heightMm: 320 },
  );

  assert.deepEqual(placed, [{ cxMm: 60, cyMm: 200, radiusMm: 10 }]);
});

test('Variable Dot centres rotate with the artwork while circles remain circular', () => {
  const placed = placeVectorDots(
    descriptor,
    { width: 100, height: 200 },
    { x: 10, y: 20, width: 80, height: 160 },
    { xMm: 30, yMm: 40, widthMm: 160, heightMm: 320, rotationDeg: 90 },
  );

  assert.ok(Math.abs(placed[0].cxMm - 110) < 1e-9);
  assert.ok(Math.abs(placed[0].cyMm - 150) < 1e-9);
  assert.equal(placed[0].radiusMm, 10);
});

test('Variable Dot descriptors fail closed when a primitive is malformed', () => {
  assert.throws(() => normalizeVectorDots({ ...descriptor, circles: [[0.5, 0.5, -1]] }), /Invalid/);
  assert.equal(normalizeVectorDots(null), null);
});

test('only circles still cut cleanly in the mask stay exact', () => {
  const mask = createMask(100, 50, 1);
  const sheet = { widthMm: 100, heightMm: 50 };
  const circles = [
    { cxMm: 25, cyMm: 25, radiusMm: 8 },
    { cxMm: 75, cyMm: 25, radiusMm: 8 },
  ];
  for (const circle of circles) {
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (Math.hypot(x + 0.5 - circle.cxMm, y + 0.5 - circle.cyMm) <= circle.radiusMm) {
          mask.data[y * mask.width + x] = REMOVED;
        }
      }
    }
  }
  assert.deepEqual(intactCircleHoles(circles, mask, sheet), circles);

  // A removal stroke reaching into the second dot leaves it to the raster.
  for (let x = 82; x < 95; x += 1) mask.data[25 * mask.width + x] = REMOVED;
  assert.deepEqual(intactCircleHoles(circles, mask, sheet), [circles[0]]);
});
