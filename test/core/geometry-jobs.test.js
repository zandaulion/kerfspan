import assert from 'node:assert/strict';
import test from 'node:test';

import { FINISHED_BOUNDARY_CAM } from '../../web/core/geometry-contract.js';
import { executeGeometryJob } from '../../web/core/geometry-jobs.js';
import { prepareVectorGeometry } from '../../web/core/vector-geometry.js';
import { countValidationLocations, validateDesign } from '../../web/core/validation.js';
import { maskFromAscii, mixedSlatFixture } from './fixtures.js';

const validationOptions = {
  sheet: { widthMm: 5, heightMm: 5 },
  kerfMm: 0,
  minimumWebMm: 1,
  minimumOpeningMm: 1,
  geometryInterpretation: FINISHED_BOUNDARY_CAM,
  anchorBoundary: false,
  requireAnchored: false,
  requireSingleComponent: true,
};

test('background validation is deterministic and structured-clone safe', () => {
  const mask = maskFromAscii([
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ]);
  const phases = [];
  const first = executeGeometryJob('validate', { mask, options: validationOptions }, (phase) => phases.push(phase));
  const second = executeGeometryJob('validate', { mask, options: validationOptions });
  assert.deepEqual(first, second);
  assert.deepEqual(phases, ['checking', 'connectivity', 'post-kerf', 'openings', 'webs']);
  assert.doesNotThrow(() => structuredClone(first));
});

test('project masks are RLE encoded by the background worker task', () => {
  const sourceMask = maskFromAscii(['##..#']);
  const baseMask = maskFromAscii(['#.#.#']);
  const result = executeGeometryJob('encode-project-masks', { sourceMask, baseMask });

  assert.deepEqual(result.sourceMask.runs, [2, 2, 1]);
  assert.deepEqual(result.baseMask.runs, [1, 1, 1, 1, 1]);
  assert.doesNotThrow(() => structuredClone(result));
});

test('vector preparation and post-fit manufacturing validation stay off-thread and cloneable', () => {
  const rows = Array.from({ length: 20 }, (_, y) => (
    Array.from({ length: 20 }, (_, x) => (
      y >= 2 && y < 18 && x >= 2 && x < 10 + (y % 2) ? '#' : '.'
    )).join('')
  ));
  const mask = maskFromAscii(rows);
  const phases = [];
  const result = executeGeometryJob('vector-prepare', {
    mask,
    sheet: { widthMm: 200, heightMm: 200 },
    exactCircleHoles: [],
    options: { simplify: true, toleranceMm: 6 },
    validationOptions: {
      ...validationOptions,
      sheet: { widthMm: 200, heightMm: 200 },
      minimumWebMm: 0,
      minimumOpeningMm: 0,
    },
  }, (phase) => phases.push(phase));

  assert.equal(result.prepared.report.status, 'simplified');
  assert.equal(result.changesRasterResult, true);
  assert.ok(result.postFitValidation);
  assert.deepEqual(phases, ['simplifying', 'checking']);
  assert.doesNotThrow(() => structuredClone(result));
});

test('draft vector previews share export fitting without running manufacturing review', () => {
  const mask = maskFromAscii(['####', '####', '####', '####']);
  const phases = [];
  const result = executeGeometryJob('vector-preview', {
    mask,
    sheet: { widthMm: 4, heightMm: 4 },
    options: { simplify: true, toleranceMm: 0.5 },
  }, (phase) => phases.push(phase));
  assert.equal(result.prepared.report.outputVertexCount, 4);
  assert.equal(result.postFitValidation, null);
  assert.deepEqual(phases, ['simplifying']);
  assert.doesNotThrow(() => structuredClone(result));
});

test('background support planning returns a proposal and finished-connectivity check', () => {
  const mask = maskFromAscii(['#...#']);
  const result = executeGeometryJob('support', {
    mask,
    config: {
      sheet: { widthMm: 5, heightMm: 1 },
      widthMm: 1,
      anchorBoundary: false,
      requireSingleComponent: true,
      minimumWebMm: 0,
      kerfMm: 0,
      geometryInterpretation: FINISHED_BOUNDARY_CAM,
      maxPasses: 4,
      strategy: { mode: 'smart', kind: 'line-art', level: 2, featureGuidance: null },
    },
    validation: {
      ...validationOptions,
      sheet: { widthMm: 5, heightMm: 1 },
      minimumWebMm: 0,
      minimumOpeningMm: 0,
    },
  });
  assert.equal(result.plan.bridges.length, 1);
  assert.equal(result.supportSimulation.postKerf.componentCount, 1);
  assert.doesNotThrow(() => structuredClone(result));
});

test('repair evaluation keeps its candidate and measurements cloneable', () => {
  const mask = maskFromAscii([
    '#####',
    '##.##',
    '#####',
    '#####',
    '#####',
  ]);
  const plan = {
    items: [{
      id: 'opening-1',
      action: 'close',
      availableActions: { close: true, enlarge: false, merge: false },
      edits: { close: { keep: [7], remove: [] } },
    }],
  };
  const result = executeGeometryJob('repair-evaluate', {
    mask,
    plan,
    options: validationOptions,
  });
  assert.equal(result.candidate.data[7], 1);
  assert.ok(result.effects.addedAreaMm2 > 0);
  assert.doesNotThrow(() => structuredClone(result));
});

test('Slats validation and an unchanged repair plan check the displayed straight paths', () => {
  const { mask, sheet, placed } = mixedSlatFixture();
  const vectorOptions = { simplify: false, slatHighlights: placed };
  const options = { ...validationOptions, sheet, minimumWebMm: 3, minimumOpeningMm: 2, vectorOptions };
  const original = Uint8Array.from(mask.data);
  const prepared = prepareVectorGeometry(mask, sheet, [], vectorOptions);
  const expected = validateDesign(prepared.rasterMask, options);
  const checked = executeGeometryJob('validate', { mask, options });
  const { preparedGeometry, ...validation } = checked;
  assert.deepEqual(validation, expected);
  assert.deepEqual(preparedGeometry.contours, prepared.contours);
  assert.notEqual(countValidationLocations(expected, 'warning'),
    countValidationLocations(validateDesign(mask, options), 'warning'), 'fixture must expose the raster/vector mismatch');

  const { proposal, finishedMask } = executeGeometryJob('repair', { mask, options: {
    ...options, strategy: 'balanced', categories: { slivers: false, gaps: false, webs: false },
    targetWebMm: 3.4, targetOpeningMm: 2.4, bridgeWidthMm: 4,
  } });
  assert.equal(proposal.items.length, 0);
  assert.deepEqual(proposal.beforeValidation, expected);
  assert.deepEqual(proposal.afterValidation, expected);
  assert.deepEqual(proposal.preparedGeometry.contours, prepared.contours);
  assert.deepEqual(finishedMask.data, prepared.rasterMask.data);
  assert.deepEqual(proposal.mask.data, original, 'fitting must not be baked into editable repair pixels');
  assert.deepEqual(mask.data, original);
  assert.equal(proposal.outcome.effects.changedCells, 0);
  assert.equal(proposal.validationContract.vectorProcessing.mode, 'slat-highlights');
  assert.doesNotThrow(() => structuredClone(proposal));
});

test('Slats repair overrides recheck the fitted candidate while retaining real opening errors', () => {
  const { mask, sheet, placed } = mixedSlatFixture();
  const pinhole = 4 * mask.width + 4;
  mask.data[pinhole] = 0;
  const options = { ...validationOptions, sheet, minimumWebMm: 2, minimumOpeningMm: 2,
    vectorOptions: { simplify: false, slatHighlights: placed } };
  const plan = { items: [{ action: 'close', edits: { close: { keep: [pinhole], remove: [] } } }] };
  const result = executeGeometryJob('repair-evaluate', { mask, plan, options });
  assert.equal(countValidationLocations(result.beforeValidation, 'error'), 1);
  assert.equal(result.beforeValidation.errors[0].code, 'MIN_OPENING_UNCUTTABLE');
  assert.equal(countValidationLocations(result.afterValidation, 'error'), 0);
  const expected = prepareVectorGeometry(result.candidate, sheet, [], options.vectorOptions);
  assert.deepEqual(result.preparedGeometry.contours, expected.contours);
  assert.deepEqual(result.afterValidation, validateDesign(expected.rasterMask, options));
  assert.deepEqual(result.finishedMask.data, expected.rasterMask.data);
  assert.equal(mask.data[pinhole], 0, 'preview changes must not alter the active design');
  assert.equal(result.candidate.data[pinhole], 1);
});

test('a rejected Slats fit checks its raster fallback independently of the fitted baseline', () => {
  const { mask, sheet, placed } = mixedSlatFixture();
  const options = { ...validationOptions, sheet, minimumWebMm: 10, minimumOpeningMm: 2 };
  const result = executeGeometryJob('vector-prepare', {
    mask, sheet, options: { simplify: false, slatHighlights: placed },
    validationOptions: options, baselineValidation: { valid: true, issues: [] },
  });
  assert.equal(result.postFitValidation.valid, false);
  assert.deepEqual(result.fallbackValidation, validateDesign(mask, options));
  assert.equal(result.fallbackValidation.valid, false, 'an approved fitted baseline cannot approve a failing raw fallback');
});

test('unknown background jobs fail closed', () => {
  assert.throws(() => executeGeometryJob('unknown', {}), /Unknown geometry job/);
});
