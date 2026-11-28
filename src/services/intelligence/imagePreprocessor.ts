import jsQR from 'jsqr';
import type { PageImageQualityMetrics } from '../../core/types';

export type PreprocessingStrategy =
  | 'clean_digital'
  | 'soft_sauvola_enhanced'
  | 'deblur_contrast';

export interface ImageQualityAnalysis extends PageImageQualityMetrics {
  width: number;
  height: number;
  contrastSpread: number;
  medianIntensity: number;
  shadowVariance: number;
  sharpnessScore: number;
  darkBorderFraction: number;
  blankRatio: number;
  isLowResolution: boolean;
  isVeryLarge: boolean;
  isUnevenLighting: boolean;
  isBlurry: boolean;
  isLikelyBlank: boolean;
}

export interface PreprocessedImageResult {
  ocrDataUrl: string;
  previewDataUrl: string;
  ocrBytes?: Uint8Array;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  strategy: PreprocessingStrategy;
  appliedSteps: string[];
  qualityMetrics: ImageQualityAnalysis;
  isLikelyBlank: boolean;
  qrMatches: string[];
}

interface RawGrayBuffer {
  gray: Uint8Array;
  width: number;
  height: number;
  rgba?: Uint8ClampedArray;
}

interface SharpLikeInstance {
  rotate(angle?: number, options?: { background?: { r: number; g: number; b: number } }): SharpLikeInstance;
  extract(region: { left: number; top: number; width: number; height: number }): SharpLikeInstance;
  resize(options: { width?: number; height?: number; fit?: string; kernel?: string }): SharpLikeInstance;
  grayscale(): SharpLikeInstance;
  toColorspace(space: string): SharpLikeInstance;
  normalize(options?: { lower?: number; upper?: number }): SharpLikeInstance;
  sharpen(options?: { sigma?: number; m1?: number; m2?: number }): SharpLikeInstance;
  ensureAlpha(): SharpLikeInstance;
  raw(): SharpLikeInstance;
  png(options?: { compressionLevel?: number }): SharpLikeInstance;
  jpeg(options?: { quality?: number; mozjpeg?: boolean }): SharpLikeInstance;
  metadata(): Promise<{ width?: number; height?: number }>;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number; channels: number };
  }>;
  toBuffer(): Promise<Buffer>;
}

type SharpFactory = (
  input?: Uint8Array | Buffer,
  options?: { raw?: { width: number; height: number; channels: 1 | 3 | 4 } }
) => SharpLikeInstance;

let cachedSharpFactory: SharpFactory | null | undefined;

async function getNodeSharp(): Promise<SharpFactory | null> {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return null;
  }
  if (cachedSharpFactory !== undefined) {
    return cachedSharpFactory;
  }
  try {
    // Runtime-only dynamic import prevents Vite client bundler from trying to inline sharp native binaries.
    const dynamicImport = new Function('mod', 'return import(mod)') as (
      mod: string
    ) => Promise<{ default?: SharpFactory }>;
    const mod = await dynamicImport('sharp');
    cachedSharpFactory = mod.default ?? (mod as unknown as SharpFactory);
    return cachedSharpFactory;
  } catch {
    cachedSharpFactory = null;
    return null;
  }
}

export function uint8ToBase64DataUrl(bytes: Uint8Array, mimeType: string): string {
  if (typeof Buffer !== 'undefined') {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function dataUrlToUint8Array(dataUrl: string): {
  bytes: Uint8Array;
  mimeType: string;
} {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Expected base64 data URL.');
  }
  const mimeType = match[1] || 'image/png';
  const b64 = match[2];
  if (typeof Buffer !== 'undefined') {
    return {
      bytes: new Uint8Array(Buffer.from(b64, 'base64')),
      mimeType,
    };
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return { bytes: out, mimeType };
}

function rgbaToGrayscale(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    // White composite over alpha so transparent PNGs never become black backgrounds
    const a = rgba[p + 3] / 255;
    const r = rgba[p] * a + 255 * (1 - a);
    const g = rgba[p + 1] * a + 255 * (1 - a);
    const b = rgba[p + 2] * a + 255 * (1 - a);
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

function grayToRgba(gray: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    const v = gray[i];
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
    rgba[p + 3] = 255;
  }
  return rgba;
}

/** Computes percentiles, shadow variance across a coarse grid, sharpness, and blankness. */
export function analyzeGrayscaleQuality(
  gray: Uint8Array,
  width: number,
  height: number
): ImageQualityAnalysis {
  const hist = new Uint32Array(256);
  const total = Math.max(1, gray.length);
  const step = total > 800_000 ? 2 : 1;
  let sampled = 0;
  for (let i = 0; i < gray.length; i += step) {
    hist[gray[i]] += 1;
    sampled += 1;
  }
  const percentile = (q: number): number => {
    const target = Math.max(1, Math.floor(sampled * q));
    let acc = 0;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };

  const p5 = percentile(0.05);
  const p50 = percentile(0.5);
  const p95 = percentile(0.95);
  const contrastSpread = Math.max(0, p95 - p5);

  // Tile local brightness across an 8x8 grid in the inner 80% of the page
  const gridMeans: number[] = [];
  const xStart = Math.floor(width * 0.1);
  const xEnd = Math.max(xStart + 8, Math.floor(width * 0.9));
  const yStart = Math.floor(height * 0.1);
  const yEnd = Math.max(yStart + 8, Math.floor(height * 0.9));
  const tileW = Math.max(4, Math.floor((xEnd - xStart) / 8));
  const tileH = Math.max(4, Math.floor((yEnd - yStart) / 8));

  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      let sum = 0;
      let count = 0;
      const tx0 = xStart + gx * tileW;
      const ty0 = yStart + gy * tileH;
      for (let y = ty0; y < Math.min(yEnd, ty0 + tileH); y += 2) {
        const rowOff = y * width;
        for (let x = tx0; x < Math.min(xEnd, tx0 + tileW); x += 2) {
          sum += gray[rowOff + x];
          count += 1;
        }
      }
      if (count > 0) gridMeans.push(sum / count);
    }
  }
  const tileAvg =
    gridMeans.length > 0 ? gridMeans.reduce((a, b) => a + b, 0) / gridMeans.length : p50;
  const shadowVariance =
    gridMeans.length > 1
      ? Math.sqrt(
          gridMeans.reduce((acc, m) => acc + (m - tileAvg) * (m - tileAvg), 0) /
            gridMeans.length
        )
      : 0;

  // Edge/stroke sharpness metric & foreground ink density on inner region
  let gradSum = 0;
  let gradSamples = 0;
  let inkPixels = 0;
  const inkCutoff = Math.max(15, tileAvg - Math.max(22, shadowVariance * 0.8));
  const strideY = height > 1200 ? 2 : 1;
  const strideX = width > 1200 ? 2 : 1;
  for (let y = yStart + 1; y < yEnd - 1; y += strideY) {
    const rowOff = y * width;
    for (let x = xStart + 1; x < xEnd - 1; x += strideX) {
      const c = gray[rowOff + x];
      const gxDiff = Math.abs(gray[rowOff + x + 1] - gray[rowOff + x - 1]);
      const gyDiff = Math.abs(gray[(y + 1) * width + x] - gray[(y - 1) * width + x]);
      const mag = gxDiff + gyDiff;
      if (mag > 18) {
        gradSum += mag;
      }
      if (c < inkCutoff) {
        inkPixels += 1;
      }
      gradSamples += 1;
    }
  }
  const sharpnessScore = gradSamples > 0 ? Number((gradSum / gradSamples).toFixed(2)) : 0;
  const blankRatio = gradSamples > 0 ? Number((inkPixels / gradSamples).toFixed(5)) : 0;

  // Measure dark border margin around the perimeter (desk / table framing a white page)
  let borderDark = 0;
  let borderSamples = 0;
  const bandY = Math.max(2, Math.floor(height * 0.06));
  const bandX = Math.max(2, Math.floor(width * 0.06));
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 120))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 120))) {
      const inOuter =
        y < bandY || y >= height - bandY || x < bandX || x >= width - bandX;
      if (!inOuter) continue;
      if (gray[y * width + x] < Math.min(120, Math.max(55, p50 - 55))) {
        borderDark += 1;
      }
      borderSamples += 1;
    }
  }
  const darkBorderFraction = borderSamples > 0 ? borderDark / borderSamples : 0;

  const isLowResolution = width < 1200 || height < 1000;
  const isVeryLarge = width > 2800 || height > 3600;
  const isUnevenLighting = shadowVariance >= 13 || darkBorderFraction >= 0.25;
  const isBlurry = sharpnessScore < 9.5;
  const isLikelyBlank = blankRatio < 0.0012 && contrastSpread < 25;

  return {
    width,
    height,
    contrastSpread,
    contrastScore: contrastSpread,
    medianIntensity: p50,
    shadowVariance: Number(shadowVariance.toFixed(2)),
    sharpnessScore,
    darkBorderFraction: Number(darkBorderFraction.toFixed(2)),
    blankRatio,
    isLowResolution,
    isVeryLarge,
    isUnevenLighting,
    isBlurry,
    isLikelyBlank,
  };
}

/**
 * Detects a bright document sheet framed by a darker table/desk surface.
 * Only trims margins when outer rows/columns are substantially darker than inner content,
 * so normal white-margin scans are left untouched.
 */
export function detectDocumentCropBox(
  gray: Uint8Array,
  width: number,
  height: number
): { left: number; top: number; width: number; height: number; cropped: boolean } {
  if (width < 120 || height < 120) {
    return { left: 0, top: 0, width, height, cropped: false };
  }
  // Check center region median to make sure document is predominantly bright paper
  let innerSum = 0;
  let innerCount = 0;
  for (let y = Math.floor(height * 0.25); y < Math.floor(height * 0.75); y += 2) {
    const off = y * width;
    for (let x = Math.floor(width * 0.25); x < Math.floor(width * 0.75); x += 2) {
      innerSum += gray[off + x];
      innerCount += 1;
    }
  }
  const innerMean = innerCount > 0 ? innerSum / innerCount : 200;
  if (innerMean < 135) {
    return { left: 0, top: 0, width, height, cropped: false };
  }

  const brightThresh = Math.max(95, Math.min(138, innerMean - 55));
  const rowFrac = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let bright = 0;
    const off = y * width;
    for (let x = 0; x < width; x += 2) {
      if (gray[off + x] >= brightThresh) bright += 1;
    }
    rowFrac[y] = bright / Math.ceil(width / 2);
  }

  let top = 0;
  let bottom = height - 1;
  while (top < height - 40 && rowFrac[top] < 0.35) top += 1;
  while (bottom > top + 40 && rowFrac[bottom] < 0.35) bottom -= 1;

  const colFrac = new Float32Array(width);
  const spanH = Math.max(1, Math.ceil((bottom - top + 1) / 2));
  for (let x = 0; x < width; x += 1) {
    let bright = 0;
    for (let y = top; y <= bottom; y += 2) {
      if (gray[y * width + x] >= brightThresh) bright += 1;
    }
    colFrac[x] = bright / spanH;
  }

  let left = 0;
  let right = width - 1;
  while (left < width - 40 && colFrac[left] < 0.35) left += 1;
  while (right > left + 40 && colFrac[right] < 0.35) right -= 1;

  // Add slight safety margin outward if trimmed so edge characters are never sliced
  if (top > 4) top = Math.max(0, top - 4);
  if (bottom < height - 5) bottom = Math.min(height - 1, bottom + 4);
  if (left > 4) left = Math.max(0, left - 4);
  if (right < width - 5) right = Math.min(width - 1, right + 4);

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  const trimmedPixels = width * height - cw * ch;
  const trimmedFraction = trimmedPixels / (width * height);

  if (trimmedFraction < 0.06 || cw < width * 0.4 || ch < height * 0.3) {
    return { left: 0, top: 0, width, height, cropped: false };
  }
  return { left, top, width: cw, height: ch, cropped: true };
}

/**
 * Estimates slight page tilt (-7.5 to +7.5 degrees) by maximizing squared horizontal
 * gradient projection variance across scanlines on the central document region.
 */
export function estimateSkewAngle(
  gray: Uint8Array,
  width: number,
  height: number
): number {
  if (width < 120 || height < 120) return 0;
  // Work on a compact sample grid (max ~420px wide) for sub-15ms skew estimation
  const stepX = Math.max(1, Math.floor(width / 360));
  const stepY = Math.max(1, Math.floor(height / 420));
  const sw = Math.max(32, Math.floor(width / stepX));
  const sh = Math.max(32, Math.floor(height / stepY));
  const small = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy += 1) {
    const oy = Math.min(height - 1, sy * stepY);
    for (let sx = 0; sx < sw; sx += 1) {
      small[sy * sw + sx] = gray[oy * width + Math.min(width - 1, sx * stepX)];
    }
  }

  // Precompute vertical edge magnitude
  const edges = new Uint8Array(sw * sh);
  for (let y = 1; y < sh - 1; y += 1) {
    for (let x = 1; x < sw - 1; x += 1) {
      const d = Math.abs(small[(y + 1) * sw + x] - small[(y - 1) * sw + x]);
      if (d > 16) edges[y * sw + x] = d;
    }
  }

  let bestDeg = 0;
  let bestScore = -1;
  let zeroScore = 0;
  const y0 = Math.floor(sh * 0.08);
  const y1 = Math.floor(sh * 0.92);
  const x0 = Math.floor(sw * 0.08);
  const x1 = Math.floor(sw * 0.92);

  for (let deg = -7.5; deg <= 7.5; deg += 0.5) {
    const tan = Math.tan((deg * Math.PI) / 180);
    const bins = new Float64Array(sh);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const edge = edges[y * sw + x];
        if (edge === 0) continue;
        const py = Math.round(y - (x - sw / 2) * tan);
        if (py >= 0 && py < sh) {
          bins[py] += edge;
        }
      }
    }
    let score = 0;
    for (let i = 0; i < sh; i += 1) {
      score += bins[i] * bins[i];
    }
    if (Math.abs(deg) < 0.01) zeroScore = score;
    if (score > bestScore) {
      bestScore = score;
      bestDeg = deg;
    }
  }

  // Only deskew if non-zero angle meaningfully improves line alignment over 0 deg
  if (Math.abs(bestDeg) < 0.5 || bestScore < zeroScore * 1.04) {
    return 0;
  }
  return bestDeg;
}

export function cropGrayscale(
  gray: Uint8Array,
  width: number,
  height: number,
  box: { left: number; top: number; width: number; height: number }
): RawGrayBuffer {
  const out = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y += 1) {
    const srcOff = (box.top + y) * width + box.left;
    out.set(gray.subarray(srcOff, srcOff + box.width), y * box.width);
  }
  return { gray: out, width: box.width, height: box.height };
}

export function resizeGrayscaleBilinear(
  gray: Uint8Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number
): RawGrayBuffer {
  if (width === targetWidth && height === targetHeight) {
    return { gray: gray.slice(), width, height };
  }
  const out = new Uint8Array(targetWidth * targetHeight);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(height - 1.0001, y * scaleY);
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    const row0 = y0 * width;
    const row1 = y1 * width;
    const outRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(width - 1.0001, x * scaleX);
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const topVal = gray[row0 + x0] * (1 - fx) + gray[row0 + x1] * fx;
      const botVal = gray[row1 + x0] * (1 - fx) + gray[row1 + x1] * fx;
      out[outRow + x] = Math.round(topVal * (1 - fy) + botVal * fy);
    }
  }
  return { gray: out, width: targetWidth, height: targetHeight };
}

export function rotateGrayscaleArbitrary(
  gray: Uint8Array,
  width: number,
  height: number,
  angleDeg: number,
  fillValue = 245
): RawGrayBuffer {
  if (Math.abs(angleDeg) < 0.25) {
    return { gray: gray.slice(), width, height };
  }
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const out = new Uint8Array(width * height);
  out.fill(fillValue);
  for (let y = 0; y < height; y += 1) {
    const dy = y - cy;
    const outOff = y * width;
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      if (sx < 0 || sx >= width - 1 || sy < 0 || sy >= height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const r0 = y0 * width;
      const r1 = (y0 + 1) * width;
      const topVal = gray[r0 + x0] * (1 - fx) + gray[r0 + x0 + 1] * fx;
      const botVal = gray[r1 + x0] * (1 - fx) + gray[r1 + x0 + 1] * fx;
      out[outOff + x] = Math.round(topVal * (1 - fy) + botVal * fy);
    }
  }
  return { gray: out, width, height };
}

export function rotateGrayscaleQuarterTurns(
  gray: Uint8Array,
  width: number,
  height: number,
  quarterTurns: 1 | 2 | 3
): RawGrayBuffer {
  if (quarterTurns === 2) {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i += 1) {
      out[i] = gray[gray.length - 1 - i];
    }
    return { gray: out, width, height };
  }
  const outW = height;
  const outH = width;
  const out = new Uint8Array(outW * outH);
  if (quarterTurns === 1) {
    // 90 degrees clockwise
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[x * outW + (outW - 1 - y)] = gray[y * width + x];
      }
    }
  } else {
    // 270 degrees clockwise (90 CCW)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[(outH - 1 - x) * outW + y] = gray[y * width + x];
      }
    }
  }
  return { gray: out, width: outW, height: outH };
}

/** 3x3 Unsharp mask enhancement that sharpens text strokes without heavy ringing. */
export function applyUnsharpMask(
  gray: Uint8Array,
  width: number,
  height: number,
  amount = 0.75
): Uint8Array {
  if (width < 3 || height < 3 || amount <= 0) return gray.slice();
  const out = new Uint8Array(gray.length);
  out.set(gray);
  for (let y = 1; y < height - 1; y += 1) {
    const r0 = (y - 1) * width;
    const r1 = y * width;
    const r2 = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const blur =
        (gray[r0 + x - 1] +
          2 * gray[r0 + x] +
          gray[r0 + x + 1] +
          2 * gray[r1 + x - 1] +
          4 * gray[r1 + x] +
          2 * gray[r1 + x + 1] +
          gray[r2 + x - 1] +
          2 * gray[r2 + x] +
          gray[r2 + x + 1]) /
        16;
      const val = gray[r1 + x] + amount * (gray[r1 + x] - blur);
      out[r1 + x] = val <= 0 ? 0 : val >= 255 ? 255 : Math.round(val);
    }
  }
  return out;
}

/** Gentle percentile contrast normalization for clean digital scans/screenshots. */
export function applyPercentileContrastStretch(
  gray: Uint8Array,
  lowPercentile = 0.01,
  highPercentile = 0.96
): Uint8Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const findP = (q: number): number => {
    const target = Math.max(1, Math.floor(gray.length * q));
    let acc = 0;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const lo = findP(lowPercentile);
  const hi = Math.max(lo + 20, findP(highPercentile));
  const span = hi - lo;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const scaled = ((gray[i] - lo) * 255) / span;
    out[i] = scaled <= 0 ? 0 : scaled >= 255 ? 255 : Math.round(scaled);
  }
  return out;
}

/**
 * Anti-aliased Soft Sauvola local normalization:
 * Neutralizes paper creases, camera flash falloff, and uneven shadows while keeping
 * smooth anti-aliased grayscale ink strokes so small low-res glyphs stay intact.
 */
export function applySoftSauvolaNormalization(
  gray: Uint8Array,
  width: number,
  height: number,
  options?: { halfWin?: number; k?: number }
): Uint8Array {
  const halfWin = options?.halfWin ?? Math.max(12, Math.min(24, Math.round(width / 110)));
  const k = options?.k ?? 0.055;
  const rowPitch = width + 1;
  const S = new Float64Array(rowPitch * (height + 1));
  const S2 = new Float64Array(rowPitch * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rs = 0;
    let rs2 = 0;
    const srcRow = (y - 1) * width;
    const prevRow = (y - 1) * rowPitch;
    const curRow = y * rowPitch;
    for (let x = 1; x <= width; x += 1) {
      const p = gray[srcRow + x - 1];
      rs += p;
      rs2 += p * p;
      S[curRow + x] = S[prevRow + x] + rs;
      S2[curRow + x] = S2[prevRow + x] + rs2;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = y > halfWin ? y - halfWin : 0;
    const y1 = y + halfWin < height ? y + halfWin : height - 1;
    const rTop = y0 * rowPitch;
    const rBot = (y1 + 1) * rowPitch;
    const outOff = y * width;
    for (let x = 0; x < width; x += 1) {
      const x0 = x > halfWin ? x - halfWin : 0;
      const x1 = x + halfWin < width ? x + halfWin : width - 1;
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const sum = S[rBot + x1 + 1] - S[rTop + x1 + 1] - S[rBot + x0] + S[rTop + x0];
      const sum2 = S2[rBot + x1 + 1] - S2[rTop + x1 + 1] - S2[rBot + x0] + S2[rTop + x0];
      const mean = sum / area;
      const variance = sum2 / area - mean * mean;
      const std = variance > 0 ? Math.sqrt(variance) : 0;
      const px = gray[outOff + x];
      const thresh = mean * (1 + k * (std / 128 - 1));
      // Push paper background smoothly to clean white while suppressing faint crease specks
      const bgCutoff = thresh + 4;
      if (px >= bgCutoff) {
        out[outOff + x] = 255;
      } else {
        const darkness = (bgCutoff - px) / Math.max(18, std + 12);
        const v = Math.round(255 - darkness * 255);
        out[outOff + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

export function selectPreprocessingStrategy(
  quality: ImageQualityAnalysis,
  override?: PreprocessingStrategy
): PreprocessingStrategy {
  if (override) return override;
  if (quality.isBlurry && !quality.isUnevenLighting) {
    return 'deblur_contrast';
  }
  if (quality.isUnevenLighting || quality.contrastSpread < 95 || quality.isLowResolution) {
    return 'soft_sauvola_enhanced';
  }
  return 'clean_digital';
}

async function decodeBytesBrowser(
  bytes: Uint8Array,
  mimeType: string
): Promise<{
  gray: Uint8Array;
  width: number;
  height: number;
  qrMatches: string[];
}> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode uploaded image.'));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const qrMatches: string[] = [];
    try {
      const qr = jsQR(imgData.data, width, height, { inversionAttempts: 'dontInvert' });
      if (qr?.data) qrMatches.push(qr.data);
    } catch {
      // Ignore QR decoder failures on noisy backgrounds
    }
    return {
      gray: rgbaToGrayscale(imgData.data, width, height),
      width,
      height,
      qrMatches,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function encodeGrayBrowser(
  gray: Uint8Array,
  width: number,
  height: number,
  format: 'image/png' | 'image/jpeg',
  quality = 0.9
): Promise<{ dataUrl: string; bytes: Uint8Array }> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  const rgba = grayToRgba(gray);
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  const dataUrl =
    format === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl,
    bytes: dataUrlToUint8Array(dataUrl).bytes,
  };
}

/**
 * Full adaptive preprocessing pipeline working seamlessly in Browser and Node.js.
 * Selects crop, orientation/deskew, resolution normalization, sharpening, and soft
 * illumination correction dynamically from measured image quality.
 */
export async function preprocessImageForOcr(input: {
  bytes?: Uint8Array;
  imageDataUrl?: string;
  mimeType?: string;
  strategyOverride?: PreprocessingStrategy;
  quarterTurns?: 0 | 1 | 2 | 3;
}): Promise<PreprocessedImageResult> {
  const sourceDecoded = input.bytes
    ? { bytes: input.bytes, mimeType: input.mimeType || 'image/png' }
    : input.imageDataUrl
      ? dataUrlToUint8Array(input.imageDataUrl)
      : null;

  if (!sourceDecoded) {
    throw new Error('No image bytes or data URL provided to image preprocessor.');
  }

  const sharpFn = await getNodeSharp();
  let width = 0;
  let height = 0;
  let gray: Uint8Array;
  let qrMatches: string[] = [];

  if (sharpFn) {
    // Auto-orient EXIF & decode to RGBA so QR scanning & alpha compositing work identically
    const { data, info } = await sharpFn(sourceDecoded.bytes)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    width = info.width;
    height = info.height;
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    try {
      const qr = jsQR(clamped, width, height, { inversionAttempts: 'dontInvert' });
      if (qr?.data) qrMatches.push(qr.data);
    } catch {
      // Ignore QR error
    }
    gray = rgbaToGrayscale(clamped, width, height);
  } else if (typeof document !== 'undefined') {
    const decoded = await decodeBytesBrowser(sourceDecoded.bytes, sourceDecoded.mimeType);
    width = decoded.width;
    height = decoded.height;
    gray = decoded.gray;
    qrMatches = decoded.qrMatches;
  } else {
    throw new Error('Neither sharp (Node) nor Canvas (browser) is available to decode images.');
  }

  const originalWidth = width;
  const originalHeight = height;
  const appliedSteps: string[] = [];

  if (input.quarterTurns && input.quarterTurns > 0) {
    const rot = rotateGrayscaleQuarterTurns(gray, width, height, input.quarterTurns);
    gray = rot.gray;
    width = rot.width;
    height = rot.height;
    appliedSteps.push(`rotate_${input.quarterTurns * 90}deg`);
  }

  const preQuality = analyzeGrayscaleQuality(gray, width, height);

  // 1. Auto-crop dark surrounding borders (table/desk backgrounds around white sheet)
  const cropBox = detectDocumentCropBox(gray, width, height);
  if (cropBox.cropped) {
    const cropped = cropGrayscale(gray, width, height, cropBox);
    gray = cropped.gray;
    width = cropped.width;
    height = cropped.height;
    appliedSteps.push('document_boundary_crop');
  }

  const qualityMetrics = analyzeGrayscaleQuality(gray, width, height);
  // Preserve border flag from uncropped inspection when crop happened
  qualityMetrics.darkBorderFraction = preQuality.darkBorderFraction;

  // 2. Estimate skew on native grid BEFORE resizing
  const skewDeg = estimateSkewAngle(gray, width, height);
  qualityMetrics.skewAngleDeg = skewDeg;

  // 3. Adaptive resolution scaling BEFORE sub-pixel rotation so tiny strokes are never blurred first
  const maxAllowedWidth = 2600;
  const maxAllowedHeight = 3500;
  let targetWidth = width;
  let targetHeight = height;
  if (width < 1500) {
    const scaleFactor = Math.min(4.5, 2200 / Math.max(1, width));
    targetWidth = Math.min(maxAllowedWidth, Math.round(width * scaleFactor));
    targetHeight = Math.min(maxAllowedHeight, Math.round(height * scaleFactor));
    if (targetWidth > width) {
      appliedSteps.push(`upscale_${(targetWidth / width).toFixed(1)}x`);
    }
  } else if (width > maxAllowedWidth || height > maxAllowedHeight) {
    const down = Math.min(maxAllowedWidth / width, maxAllowedHeight / height);
    targetWidth = Math.max(1, Math.round(width * down));
    targetHeight = Math.max(1, Math.round(height * down));
    appliedSteps.push('cap_large_resolution');
  }

  if (targetWidth !== width || targetHeight !== height) {
    if (sharpFn) {
      const resized = await sharpFn(Buffer.from(gray), {
        raw: { width, height, channels: 1 },
      })
        .resize({ width: targetWidth, height: targetHeight, kernel: 'lanczos3' })
        .toColorspace('b-w')
        .raw()
        .toBuffer({ resolveWithObject: true });
      width = resized.info.width;
      height = resized.info.height;
      const ch = resized.info.channels || 1;
      if (ch === 1) {
        gray = new Uint8Array(resized.data);
      } else {
        const single = new Uint8Array(width * height);
        for (let i = 0; i < single.length; i += 1) single[i] = resized.data[i * ch];
        gray = single;
      }
    } else {
      const resized = resizeGrayscaleBilinear(gray, width, height, targetWidth, targetHeight);
      gray = resized.gray;
      width = resized.width;
      height = resized.height;
    }
  }

  // 4. Deskew tilted lines on the upscaled canvas to keep thin strokes crisp
  if (Math.abs(skewDeg) >= 0.5) {
    const deskewed = rotateGrayscaleArbitrary(
      gray,
      width,
      height,
      -skewDeg,
      Math.min(250, Math.max(200, qualityMetrics.medianIntensity))
    );
    gray = deskewed.gray;
    appliedSteps.push(`deskew_${skewDeg > 0 ? '-' : '+'}${Math.abs(skewDeg).toFixed(1)}deg`);
  }

  // 4. Adaptive enhancement selection based on measured image quality
  const strategy = selectPreprocessingStrategy(qualityMetrics, input.strategyOverride);
  let ocrGray: Uint8Array;
  let previewGray: Uint8Array;

  if (strategy === 'soft_sauvola_enhanced') {
    const sharpened = applyUnsharpMask(gray, width, height, qualityMetrics.isBlurry ? 1.15 : 0.7);
    appliedSteps.push(qualityMetrics.isBlurry ? 'unsharp_deblur' : 'mild_sharpen');
    ocrGray = applySoftSauvolaNormalization(sharpened, width, height, {
      halfWin: Math.max(14, Math.min(22, Math.round(width / 115))),
      k: qualityMetrics.isLowResolution ? 0.05 : 0.065,
    });
    appliedSteps.push('soft_sauvola_shadow_removal');
    previewGray = ocrGray;
  } else if (strategy === 'deblur_contrast') {
    const deblurred = applyUnsharpMask(gray, width, height, 1.35);
    appliedSteps.push('strong_unsharp_deblur');
    ocrGray = applyPercentileContrastStretch(deblurred, 0.015, 0.96);
    appliedSteps.push('adaptive_contrast_stretch');
    previewGray = ocrGray;
  } else {
    ocrGray = applyPercentileContrastStretch(gray, 0.005, 0.98);
    ocrGray = applyUnsharpMask(ocrGray, width, height, 0.45);
    appliedSteps.push('grayscale_contrast_clean', 'light_sharpen');
    previewGray = ocrGray;
  }

  // 5. Encode PNG lossless for OCR & compact preview JPEG (<= 1280px wide) for storage/UI
  let ocrDataUrl: string;
  let ocrBytes: Uint8Array;
  let previewDataUrl: string;

  const previewTargetW = Math.min(1280, width);
  const previewTargetH = Math.max(1, Math.round((height * previewTargetW) / Math.max(1, width)));

  if (sharpFn) {
    const pngBuf = await sharpFn(Buffer.from(ocrGray), {
      raw: { width, height, channels: 1 },
    })
      .toColorspace('b-w')
      .png({ compressionLevel: 6 })
      .toBuffer();
    ocrBytes = new Uint8Array(pngBuf);
    ocrDataUrl = uint8ToBase64DataUrl(ocrBytes, 'image/png');

    const prevBuf = await sharpFn(Buffer.from(previewGray), {
      raw: { width, height, channels: 1 },
    })
      .resize({ width: previewTargetW, height: previewTargetH })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    previewDataUrl = uint8ToBase64DataUrl(new Uint8Array(prevBuf), 'image/jpeg');
  } else {
    const ocrEnc = await encodeGrayBrowser(ocrGray, width, height, 'image/png');
    ocrDataUrl = ocrEnc.dataUrl;
    ocrBytes = ocrEnc.bytes;
    const prevScaled =
      previewTargetW < width
        ? resizeGrayscaleBilinear(previewGray, width, height, previewTargetW, previewTargetH)
        : { gray: previewGray, width, height };
    const prevEnc = await encodeGrayBrowser(
      prevScaled.gray,
      prevScaled.width,
      prevScaled.height,
      'image/jpeg',
      0.86
    );
    previewDataUrl = prevEnc.dataUrl;
  }

  return {
    ocrDataUrl,
    previewDataUrl,
    ocrBytes,
    width,
    height,
    originalWidth,
    originalHeight,
    strategy,
    appliedSteps,
    qualityMetrics,
    isLikelyBlank: qualityMetrics.isLikelyBlank,
    qrMatches,
  };
}
