// Traffic-color analyzer for Waze map screenshots.
// Classifies each pixel into a jam level by its color (HSV), and summarizes.
// The color ranges are a first guess — stage 2 will calibrate them on real screenshots.

export const LEVELS = [
  { id: 1, name: 'קל',        color: '#f9d71c', weight: 1 }, // yellow
  { id: 2, name: 'בינוני',     color: '#f5a623', weight: 2 }, // orange
  { id: 3, name: 'כבד',       color: '#e53935', weight: 3 }, // red
  { id: 4, name: 'עומד',      color: '#8b1a1a', weight: 4 }, // dark red
];

export const DEFAULT_CALIBRATION = {
  minSat: 0.55,   // below this = map background / regular roads
  yellow: [42, 65],
  orange: [20, 42],
  redLow: 345,    // red wraps around 0°
  redHigh: 20,
  brightV: 0.55,  // red with V >= this = heavy, below = standstill
  darkV: 0.22,
};

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function classify(r, g, b, cal = DEFAULT_CALIBRATION) {
  const [h, s, v] = rgb2hsv(r, g, b);
  if (s < cal.minSat || v < cal.darkV) return 0;
  const isRed = h >= cal.redLow || h < cal.redHigh;
  if (isRed) return v >= cal.brightV ? 3 : 4;
  if (v < 0.6) return 0;
  if (h >= cal.orange[0] && h < cal.orange[1]) return 2;
  if (h >= cal.yellow[0] && h < cal.yellow[1]) return 1;
  return 0;
}

/**
 * Analyze an image (HTMLImageElement / ImageBitmap / canvas).
 * roi: optional {x,y,w,h} in 0..1 fractions of the image.
 * Returns stats + an overlay canvas highlighting detected jam pixels.
 */
export function analyzeImage(img, { roi = null, cal = DEFAULT_CALIBRATION, maxSide = 900 } = {}) {
  const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(W0, H0));
  const W = Math.round(W0 * scale), H = Math.round(H0 * scale);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;

  const r = roi || { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.floor(r.x * W), y0 = Math.floor(r.y * H);
  const x1 = Math.ceil((r.x + r.w) * W), y1 = Math.ceil((r.y + r.h) * H);

  const counts = [0, 0, 0, 0, 0];
  let total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (!inside) { px[i] *= 0.25; px[i + 1] *= 0.25; px[i + 2] *= 0.25; continue; }
      total++;
      const c = classify(px[i], px[i + 1], px[i + 2], cal);
      counts[c]++;
      if (c === 0) { // dim non-jam pixels so detected jams stand out
        const gray = (px[i] + px[i + 1] + px[i + 2]) / 3 * 0.45 + 120;
        px[i] = px[i + 1] = px[i + 2] = gray;
      } else {
        const hex = LEVELS[c - 1].color;
        px[i] = parseInt(hex.slice(1, 3), 16);
        px[i + 1] = parseInt(hex.slice(3, 5), 16);
        px[i + 2] = parseInt(hex.slice(5, 7), 16);
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  if (roi) { ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); }

  const jam = counts[1] + counts[2] + counts[3] + counts[4];
  const weighted = LEVELS.reduce((s, L) => s + L.weight * counts[L.id], 0);
  return {
    total,
    counts,
    coveragePct: total ? (jam / total) * 100 : 0,                  // % of area painted with jam colors
    severity: jam ? weighted / jam : 0,                             // 1..4 average severity of jam pixels
    index: total ? Math.min(100, (weighted / total) * 100 * 4) : 0, // single 0..100 "load" score
    overlay: cv,
  };
}

/** Turn stats into a verdict using the location's thresholds */
export function verdict(stats, th = { low: 8, high: 25 }) {
  if (stats.index < th.low) return { level: 'ok', text: 'זורם', color: '#33c46b' };
  if (stats.index < th.high) return { level: 'mid', text: 'עומס בינוני', color: '#f5a623' };
  return { level: 'high', text: 'עומס כבד', color: '#e53935' };
}
