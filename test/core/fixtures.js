import { RETAINED, createMask } from "../../web/core/mask.js";
import { placeSlatHighlights } from "../../web/core/slat-highlights.js";

/**
 * Creates a semantic mask from readable rows. `#` is retained material and
 * every other character is removed material.
 *
 * @param {string[] | string} source
 */
export function maskFromAscii(source) {
  const rows = Array.isArray(source)
    ? source
    : source.trim().split(/\r?\n/).map((row) => row.trim());
  if (rows.length === 0 || rows[0].length === 0 || rows.some((row) => row.length !== rows[0].length)) {
    throw new Error("ASCII fixture rows must form a non-empty rectangle");
  }
  const mask = createMask(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((value, x) => {
      if (value === "#") mask.data[y * mask.width + x] = RETAINED;
    });
  });
  return mask;
}

/**
 * A thick outer frame, a solid central payload, and a one-cell material bridge.
 * It is connected initially but the bridge disappears under modest erosion.
 */
export function narrowBridgeFixture() {
  const mask = createMask(15, 15);
  for (let y = 0; y < 15; y += 1) {
    for (let x = 0; x < 15; x += 1) {
      const frame = x < 3 || y < 3 || x >= 12 || y >= 12;
      const payload = x >= 6 && x <= 8 && y >= 6 && y <= 8;
      const bridge = x === 7 && y >= 9 && y <= 11;
      if (frame || payload || bridge) mask.data[y * mask.width + x] = RETAINED;
    }
  }
  return mask;
}

/** @param {Array<[number, number, number, number]>} pixels */
export function rgbaFixture(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { width: pixels.length, height: 1, data };
}

export function mixedSlatFixture() {
  const mask = createMask(320, 240);
  const sheet = { widthMm: 192, heightMm: 144 };
  const angle = -55 * Math.PI / 180;
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  const along = (x, y) => cosine * (x - 96) + sine * (y - 72);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const px = (x + 0.5) * 0.6; const py = (y + 0.5) * 0.6;
      const t = along(px, py);
      const across = -sine * (px - 96) + cosine * (py - 72);
      const width = t < -10 ? 3 : 9 + 1.5 * Math.sin(t * 1.3) + 0.5 * Math.cos(t * 3);
      const frame = x < 12 || y < 12 || x >= mask.width - 12 || y >= mask.height - 12;
      mask.data[y * mask.width + x] = frame || Math.abs(across) < width / 2 ? 1 : 0;
    }
  }
  const region = [];
  for (const [across, t] of [[-20, -150], [20, -150], [20, -12], [-20, -12]]) {
    region.push((96 - sine * across + cosine * t) / 192, (72 + cosine * across + sine * t) / 144);
  }
  const highlights = { version: 1, coordinateSpace: 'normalized-source', angleDeg: -55, regions: [region] };
  const placed = placeSlatHighlights(highlights, { width: 320, height: 240 },
    { x: 0, y: 0, width: 320, height: 240 },
    { xMm: 0, yMm: 0, widthMm: 192, heightMm: 144, rotationDeg: 0 });
  return { mask, sheet, highlights, placed, along };
}
