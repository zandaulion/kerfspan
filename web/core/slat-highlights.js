import { pointFromArtworkPlacement } from './placement.js';
import { assertMask, assertSheet } from './mask.js';
import { createRectangularFrameMask } from './frame.js';
import { analyzeConnectivity } from './connectivity.js';
import { erodeMaskPhysical } from './morphology.js';

/** Light-tone regions from the generator; never inferred from thin shadows. */
export function normalizeSlatHighlights(input) {
  if (input == null) return null;
  if (input.version !== 1 || input.coordinateSpace !== 'normalized-source' ||
      !Number.isFinite(input.angleDeg) || Math.abs(input.angleDeg) > 90 ||
      !Array.isArray(input.regions) || input.regions.length > 100_000) {
    throw new RangeError('Unsupported slat highlight geometry');
  }
  const regions = input.regions.map((region) => {
    if (!Array.isArray(region) || region.length !== 8 ||
        region.some((value) => !Number.isFinite(value) || Math.abs(value) > 100)) {
      throw new RangeError('Invalid slat highlight region');
    }
    return region.slice();
  });
  const result = { version: 1, coordinateSpace: 'normalized-source', angleDeg: input.angleDeg, regions };
  if (input.pattern != null) {
    const { origin, pitch, count, minimumWeb, minimumOpening } = input.pattern;
    if (!Array.isArray(origin) || origin.length !== 2 || origin.some((value) => !Number.isFinite(value) || Math.abs(value) > 100) ||
        ![pitch, minimumWeb, minimumOpening].every((value) => Number.isFinite(value) && value > 0 && value <= 100) ||
        !Number.isInteger(count) || count < 1 || count > 100_000) {
      throw new RangeError('Invalid slat manufacturing pattern');
    }
    result.pattern = { origin: origin.slice(), pitch, count, minimumWeb, minimumOpening };
  }
  return result;
}

/** Use the same crop, scale and rotation as the original slat raster. */
export function placeSlatHighlights(input, sourceSize, bounds, placement) {
  const source = normalizeSlatHighlights(input);
  if (!source || !sourceSize || !bounds || !placement) return null;
  const pointOnSheet = (x, y) => pointFromArtworkPlacement(placement,
    (x * sourceSize.width - bounds.x) / bounds.width,
    (y * sourceSize.height - bounds.y) / bounds.height);
  const placed = {
    coordinateSpace: 'sheet-mm',
    angleDeg: source.angleDeg + (placement.rotationDeg || 0),
    regions: source.regions.map((region) => {
      const result = [];
      for (let index = 0; index < 8; index += 2) {
        const point = pointOnSheet(region[index], region[index + 1]);
        result.push(point.x, point.y);
      }
      return result;
    }),
  };
  if (source.pattern) {
    const scale = placement.widthMm * sourceSize.width / bounds.width;
    placed.pattern = {
      origin: pointOnSheet(...source.pattern.origin), count: source.pattern.count,
      pitchMm: source.pattern.pitch * scale,
      minimumWebMm: source.pattern.minimumWeb * scale,
      minimumOpeningMm: source.pattern.minimumOpening * scale,
      footprint: [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => pointOnSheet(x, y)),
    };
  }
  return placed;
}

/** Enforce continuous minimum-width bands on the final manufacturing grid. */
export function enforceSlatMinimumWidths(mask, sheet, guide, {
  minimumWebMm = 3, minimumOpeningMm = 3, frame = { enabled: false },
} = {}) {
  assertMask(mask);
  assertSheet(sheet);
  const pattern = guide?.pattern;
  if (!pattern) return mask;
  const angle = guide.angleDeg * Math.PI / 180;
  const nx = -Math.sin(angle); const ny = Math.cos(angle);
  const pixelX = sheet.widthMm / mask.width; const pixelY = sheet.heightMm / mask.height;
  const cellAcross = Math.abs(nx) * pixelX + Math.abs(ny) * pixelY;
  const web = Math.max(minimumWebMm, pattern.minimumWebMm);
  const opening = Math.max(minimumOpeningMm, pattern.minimumOpeningMm);
  if (pattern.pitchMm + 1e-9 < web + opening + 3 * cellAcross) {
    const error = new RangeError('Slats need a wider bar pitch to preserve the minimum metal and cut widths at this resolution.');
    error.code = 'SLAT_PITCH_TOO_SMALL';
    throw error;
  }
  const [corner, right, , bottom] = pattern.footprint;
  const ux = right.x - corner.x; const uy = right.y - corner.y;
  const vx = bottom.x - corner.x; const vy = bottom.y - corner.y;
  const widthSquared = ux * ux + uy * uy; const heightSquared = vx * vx + vy * vy;
  const originAcross = nx * pattern.origin.x + ny * pattern.origin.y;
  const output = { ...mask, data: Uint8Array.from(mask.data) };
  // Include one extra cell projection so the conservative full-width core
  // stays connected along diagonals instead of becoming isolated core dots.
  const halfWeb = (web + 2 * cellAcross) / 2;
  const halfOpening = (opening + cellAcross) / 2;
  for (let y = 0; y < mask.height; y += 1) {
    const py = (y + 0.5) * pixelY;
    for (let x = 0; x < mask.width; x += 1) {
      const px = (x + 0.5) * pixelX;
      const dx = px - corner.x; const dy = py - corner.y;
      const u = (dx * ux + dy * uy) / widthSquared;
      const v = (dx * vx + dy * vy) / heightSquared;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const across = nx * px + ny * py - originAcross;
      const bar = Math.round(across / pattern.pitchMm);
      const slot = Math.floor(across / pattern.pitchMm);
      if (bar >= 0 && bar < pattern.count && Math.abs(across - bar * pattern.pitchMm) <= halfWeb) {
        output.data[y * mask.width + x] = 1;
      } else if (slot >= 0 && slot + 1 < pattern.count &&
          Math.abs(across - (slot + 0.5) * pattern.pitchMm) <= halfOpening) {
        output.data[y * mask.width + x] = 0;
      }
    }
  }
  // Clipping an angled slot against the frame can leave a separate needle or
  // corner fragment. Omit any generated cut that cannot contain the opening
  // diameter; never leave hundreds of uncuttable fragments for manual repair.
  const frameMask = createRectangularFrameMask(mask.width, mask.height, frame, sheet);
  const removed = { ...mask, data: Uint8Array.from(output.data, (value, index) =>
    value === 0 && frameMask.data[index] === 0 ? 1 : 0) };
  const cuts = analyzeConnectivity(removed, { connectivity: 8, anchorBoundary: false });
  const core = erodeMaskPhysical(removed, opening / 2, sheet);
  const surviving = new Uint8Array(cuts.componentCount + 1);
  for (let index = 0; index < core.data.length; index += 1) {
    if (core.data[index]) surviving[cuts.labels[index]] = 1;
  }
  for (let index = 0; index < output.data.length; index += 1) {
    if (cuts.labels[index] > 0 && !surviving[cuts.labels[index]]) output.data[index] = 1;
  }
  return output;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

/**
 * Replace only long, nearly parallel chains inside known light regions.
 * Every other contour point is retained verbatim, including shadow detail,
 * transitions, frame corners and supports that turn across the slat direction.
 * Endpoints remain original vertices so the normal topology/deviation guard
 * can validate the result without granting a larger error budget to shadows.
 */
export function straightenSlatHighlightContours(contours, mask, sheet, guide) {
  const scaleX = sheet.widthMm / mask.width; const scaleY = sheet.heightMm / mask.height;
  const cell = Math.hypot(scaleX, scaleY);
  // A source edge may have crossed both the generator and placement grids.
  // This budget is used only in light runs, never on a shadow contour.
  const toleranceMm = cell * 2;
  if (!guide || guide.coordinateSpace !== 'sheet-mm' || !Number.isFinite(guide.angleDeg)) {
    return { contours, replacedRuns: 0, toleranceMm };
  }
  const angle = guide.angleDeg * Math.PI / 180;
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  const project = (x, y) => ({ across: -sine * x + cosine * y, along: cosine * x + sine * y });
  const rectangles = (guide.regions ?? []).map((region) => {
    const corners = [];
    for (let index = 0; index < 8; index += 2) corners.push(project(region[index], region[index + 1]));
    return {
      minAcross: Math.min(...corners.map((point) => point.across)) + cell * 0.5,
      maxAcross: Math.max(...corners.map((point) => point.across)) - cell * 0.5,
      minAlong: Math.min(...corners.map((point) => point.along)) + cell * 2,
      maxAlong: Math.max(...corners.map((point) => point.along)) - cell * 2,
    };
  }).filter((box) => box.maxAcross > box.minAcross && box.maxAlong > box.minAlong);
  const bucketWidth = Math.max(cell * 4, rectangles[0] ? rectangles[0].maxAcross - rectangles[0].minAcross : cell);
  const buckets = new Map();
  for (const box of rectangles) {
    for (let bucket = Math.floor(box.minAcross / bucketWidth); bucket <= Math.floor(box.maxAcross / bucketWidth); bucket += 1) {
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(box);
    }
  }
  const inLight = (point) => (buckets.get(Math.floor(point.across / bucketWidth)) ?? []).some((box) =>
    point.across >= box.minAcross && point.across <= box.maxAcross &&
    point.along >= box.minAlong && point.along <= box.maxAlong);
  const occurrences = new Map();
  for (const contour of contours) for (const point of contour) {
    const key = `${point.x},${point.y}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const repeated = (point) => occurrences.get(`${point.x},${point.y}`) > 1;
  let replacedRuns = 0;
  const fitted = contours.map((contour) => {
    const points = contour.map((point, index) => {
      const physical = { x: point.x * scaleX, y: point.y * scaleY };
      const projected = project(physical.x, physical.y);
      const protectsCorner = repeated(point) || repeated(contour[(index + 1) % contour.length]) ||
        repeated(contour[(index + contour.length - 1) % contour.length]);
      return { source: point, physical, ...projected, light: !protectsCorner && inLight(projected) };
    });
    // Preserve the original start vertex as well as cyclic order. Contours
    // that touch at a raster corner must keep the same nesting reference.
    const ordered = points;
    const output = [];
    for (let start = 0; start < ordered.length;) {
      let end = start;
      let low = ordered[start].across; let high = low; let direction = 0;
      while (ordered[start].light && end + 1 < ordered.length && ordered[end + 1].light) {
        const next = ordered[end + 1];
        const delta = next.along - ordered[end].along;
        const nextLow = Math.min(low, next.across); const nextHigh = Math.max(high, next.across);
        if (nextHigh - nextLow > toleranceMm || (direction && delta * direction < -cell * 0.25)) break;
        if (Math.abs(delta) > cell * 0.25 && !direction) direction = Math.sign(delta);
        low = nextLow; high = nextHigh; end += 1;
      }
      const first = ordered[start]; const last = ordered[end];
      const straight = end - start >= 3 && Math.abs(last.along - first.along) >= cell * 12 &&
        Math.abs(last.across - first.across) <= toleranceMm &&
        ordered.slice(start, end + 1).every((point) => distanceToSegment(point.physical, first.physical, last.physical) <= toleranceMm);
      if (straight) {
        // Retained material lies to the right of each traced edge. Keep the
        // outward envelope rather than cutting through pixel peaks with a
        // centre chord: highlight straightening must not shave a thin web.
        const envelope = [];
        for (let index = start; index <= end; index += 1) {
          const next = ordered[index];
          while (envelope.length >= 2) {
            const a = envelope[envelope.length - 2].physical;
            const b = envelope[envelope.length - 1].physical;
            const c = next.physical;
            const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (turn > 1e-9) break;
            envelope.pop();
          }
          envelope.push(next);
        }
        let edge = 0; let bounded = true;
        for (let index = start; index <= end; index += 1) {
          if (edge + 1 < envelope.length - 1 && ordered[index] === envelope[edge + 1]) edge += 1;
          if (distanceToSegment(ordered[index].physical, envelope[edge].physical, envelope[edge + 1].physical) > toleranceMm + 1e-9) {
            bounded = false; break;
          }
        }
        if (bounded) {
          output.push(...envelope.map((point) => point.source));
          if (envelope.length < end - start + 1) replacedRuns += 1;
        } else {
          for (let index = start; index <= end; index += 1) output.push(ordered[index].source);
        }
      } else {
        for (let index = start; index <= end; index += 1) output.push(ordered[index].source);
      }
      start = end + 1;
    }
    return output;
  });
  return { contours: fitted, replacedRuns, toleranceMm };
}
