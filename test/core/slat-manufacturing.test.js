import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesignMask, enforceSlatMinimumWidths, prepareVectorGeometry,
  validateDesign, countValidationLocations, normalizeSlatHighlights, placeSlatHighlights,
  createProject, serializeProject, deserializeProject, placeMaskOnSheet } from '../../web/core/index.js';
import { unsafeSlatFixture } from './fixtures.js';

test('Slats enforce 3 mm metal and openings on the final grid at every orientation', () => {
  for (const angle of [-75, -55, -30, 0, 45, 90]) {
    const { mask, sheet, guide } = unsafeSlatFixture(angle);
    const frame = { enabled: true, thicknessMm: 6 };
    const safe = enforceSlatMinimumWidths(mask, sheet, guide, { frame });
    const built = buildDesignMask(safe, { sheet, frame, bridges: [] }).mask;
    const prepared = prepareVectorGeometry(built, sheet, [], { simplify: false, slatHighlights: guide });
    const validation = validateDesign(prepared.rasterMask, { sheet, minimumWebMm: 3, minimumOpeningMm: 3,
      kerfMm: 1.2, geometryInterpretation: 'finished-boundary-cam-v1', requireSingleComponent: true,
      requireAnchored: false, anchorBoundary: false });
    assert.equal(countValidationLocations(validation, 'error'), 0,
      `${angle} degrees: ${JSON.stringify(validation.errors.map((issue) => ({ code: issue.code, details: issue.details })))}`);
    assert.equal(validation.minimumWebCore.componentCount, 1, `${angle} degrees must retain a connected full-width core`);
    assert.ok(safe.data.some((value, index) => value !== mask.data[index]), 'the fixture must need correction');
    let detailedPixels = 0;
    const radians = angle * Math.PI / 180;
    for (let y = 30; y < mask.height - 30; y += 1) for (let x = 30; x < mask.width - 30; x += 1) {
      const along = Math.cos(radians) * (x + 0.5) / 2 + Math.sin(radians) * (y + 0.5) / 2;
      const width = 1.5 + 7 * (0.5 + 0.5 * Math.sin(along / 11)) ** 2;
      if (width >= 4.5 && width <= 5.5) {
        assert.equal(safe.data[y * mask.width + x], mask.data[y * mask.width + x],
          'tone detail that fits between the manufacturing floors must stay exact');
        detailedPixels += 1;
      }
    }
    assert.ok(detailedPixels > 100);
    // A second rebuild must not accumulate broadening or alter tone again.
    assert.deepEqual(enforceSlatMinimumWidths(safe, sheet, guide, { frame }).data, safe.data);
  }
});

test('Slats manufacturing metadata follows crop and rotation and survives project storage', () => {
  const source = { version: 1, coordinateSpace: 'normalized-source', angleDeg: -55, regions: [],
    pattern: { origin: [0.25, 0.5], pitch: 0.1, count: 12, minimumWeb: 0.03, minimumOpening: 0.03 } };
  const project = createProject({ editor: { slatHighlights: source } });
  const restored = deserializeProject(serializeProject(project));
  assert.deepEqual(restored.editor.slatHighlights, source);
  const placed = placeSlatHighlights(source, { width: 1000, height: 500 },
    { x: 100, y: 50, width: 800, height: 400 },
    { xMm: 10, yMm: 20, widthMm: 80, heightMm: 40, rotationDeg: 90 });
  assert.equal(placed.pattern.pitchMm, 10);
  assert.equal(placed.pattern.minimumWebMm, 3);
  assert.equal(placed.pattern.minimumOpeningMm, 3);
  assert.equal(placed.angleDeg, 35);
  assert.deepEqual(placed.pattern.origin, { x: 50, y: 15 });
  assert.throws(() => normalizeSlatHighlights({ ...source, pattern: { ...source.pattern, pitch: NaN } }), /Invalid slat manufacturing/);
});

test('Slats use separate profile widths below 3 mm without a hidden generator floor', () => {
  for (const minimumWebMm of [2, 3]) {
    const { mask: source, sheet, guide } = unsafeSlatFixture();
    const mask = placeMaskOnSheet(source, sheet, { longEdgePx: 480, frame: { enabled: false }, fitToFrame: false }).mask;
    const frame = { enabled: true, thicknessMm: 6 };
    guide.pattern.minimumWebMm = minimumWebMm;
    guide.pattern.minimumOpeningMm = 2;
    const safe = enforceSlatMinimumWidths(mask, sheet, guide, { frame });
    const explicit = enforceSlatMinimumWidths(mask, sheet, guide, { minimumWebMm, minimumOpeningMm: 2, frame });
    assert.deepEqual(safe.data, explicit.data, 'omitting overrides must use the stored profile limits');
    guide.pattern.minimumWebMm = 3;
    guide.pattern.minimumOpeningMm = 3;
    assert.deepEqual(enforceSlatMinimumWidths(mask, sheet, guide, { minimumWebMm, minimumOpeningMm: 2, frame }).data, safe.data,
      'the current profile must override limits from an older saved render');
    const built = buildDesignMask(safe, { sheet, frame, bridges: [] }).mask;
    const options = { sheet, minimumWebMm, minimumOpeningMm: 2, kerfMm: 1.2,
      geometryInterpretation: 'finished-boundary-cam-v1', requireSingleComponent: true,
      requireAnchored: false, anchorBoundary: false };
    const validation = validateDesign(built, options);
    assert.equal(countValidationLocations(validation, 'error'), 0);
    assert.equal(validation.minimumWebCore.componentCount, 1);
    if (minimumWebMm === 2) {
      const stricter = validateDesign(built, { ...options, minimumWebMm: 3 });
      assert.ok(stricter.errors.some((issue) => issue.code === 'MIN_CUT_GAP'),
        'the 2 mm profile must allow narrower metal than a hardcoded 3 mm floor');
    }
  }
});

test('too little pitch is rejected instead of generating overlapping minimum-width bands', () => {
  const { mask, sheet, guide } = unsafeSlatFixture(-55);
  guide.pattern.pitchMm = 6;
  assert.throws(() => enforceSlatMinimumWidths(mask, sheet, guide), /wider bar pitch/);
  assert.equal(enforceSlatMinimumWidths(mask, sheet, { ...guide, pattern: null }), mask,
    'legacy renders stay unchanged until they are regenerated with manufacturing metadata');
});
