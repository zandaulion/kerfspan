import { pointFromArtworkPlacement } from './placement.js';

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
  return { version: 1, coordinateSpace: 'normalized-source', angleDeg: input.angleDeg, regions };
}

/** Use the same crop, scale and rotation as the original slat raster. */
export function placeSlatHighlights(input, sourceSize, bounds, placement) {
  const source = normalizeSlatHighlights(input);
  if (!source || !sourceSize || !bounds || !placement) return null;
  return {
    coordinateSpace: 'sheet-mm',
    angleDeg: source.angleDeg + (placement.rotationDeg || 0),
    regions: source.regions.map((region) => {
      const result = [];
      for (let index = 0; index < 8; index += 2) {
        const point = pointFromArtworkPlacement(placement,
          (region[index] * sourceSize.width - bounds.x) / bounds.width,
          (region[index + 1] * sourceSize.height - bounds.y) / bounds.height);
        result.push(point.x, point.y);
      }
      return result;
    }),
  };
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
