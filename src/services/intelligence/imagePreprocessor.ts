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
  isTornOrDamaged: boolean;
  isFadedPrinting: boolean;
  hasStrongShadows: boolean;
  hasStainsOrMarks: boolean;
  excessiveRotationDeg: number;
  hasCroppedEdgeText: boolean;
  hasFoldLinesOrCreases: boolean;
  isIncompleteCapture: boolean;
  unreadableRegionsCount: number;
  actionableWarnings: string[];
}

export interface QuadPoint {
  x: number;
  y: number;
}

export interface DocumentQuadResult {
  detected: boolean;
  corners: [QuadPoint, QuadPoint, QuadPoint, QuadPoint]; // TL, TR, BR, BL
  targetWidth: number;
  targetHeight: number;
}

export interface PreprocessedImageResult {
  ocrDataUrl: string;
  previewDataUrl: string;
  ocrBytes?: Uint8Array;
  ocrGray?: Uint8Array;
  rawRgba?: Uint8ClampedArray;
  rawGray?: Uint8Array;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  strategy: PreprocessingStrategy;
  appliedSteps: string[];
  qualityMetrics: ImageQualityAnalysis;
  isLikelyBlank: boolean;
  qrMatches: string[];
  perspectiveCorrected?: boolean;
  quadCorners?: [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
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
  const hasStrongShadows = shadowVariance >= 22;
  const isUnevenLighting = shadowVariance >= 13 || darkBorderFraction >= 0.25;
  const isBlurry = sharpnessScore < 9.5;
  const isLikelyBlank = blankRatio < 0.0012 && contrastSpread < 25;

  // Faded printing: visible strokes exist, but darkest ink percentile is shallow/pale
  const isFadedPrinting = !isLikelyBlank && p5 > 118 && contrastSpread < 92;

  // Cropped edge text: foreground ink strokes touching within 3px of page frame borders
  let borderInkHits = 0;
  let borderTotalChecks = 0;
  const edgeCut = Math.max(20, Math.min(135, p50 - 48));
  if (width >= 40 && height >= 40) {
    const marginPx = 3;
    for (let x = marginPx; x < width - marginPx; x += Math.max(1, Math.floor(width / 180))) {
      if (gray[marginPx * width + x] < edgeCut) borderInkHits += 1;
      if (gray[(height - 1 - marginPx) * width + x] < edgeCut) borderInkHits += 1;
      borderTotalChecks += 2;
    }
    for (let y = marginPx; y < height - marginPx; y += Math.max(1, Math.floor(height / 180))) {
      if (gray[y * width + marginPx] < edgeCut) borderInkHits += 1;
      if (gray[y * width + (width - 1 - marginPx)] < edgeCut) borderInkHits += 1;
      borderTotalChecks += 2;
    }
  }
  const borderInkRatio = borderTotalChecks > 0 ? borderInkHits / borderTotalChecks : 0;
  const hasCroppedEdgeText = borderInkRatio > 0.025 && borderInkRatio < 0.42 && darkBorderFraction < 0.22;

  // Stains / marks & unreadable degraded tiles on inner 8x8 grid
  let stainTiles = 0;
  let unreadableRegionsCount = 0;
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      const tx0 = xStart + gx * tileW;
      const ty0 = yStart + gy * tileH;
      const tx1 = Math.min(xEnd - 1, tx0 + tileW);
      const ty1 = Math.min(yEnd - 1, ty0 + tileH);
      let tSum = 0;
      let tGrad = 0;
      let tCount = 0;
      let midDarkCount = 0;
      for (let y = ty0 + 1; y < ty1; y += 2) {
        const off = y * width;
        for (let x = tx0 + 1; x < tx1; x += 2) {
          const c = gray[off + x];
          tSum += c;
          if (c < p50 - 24 && c > p5 + 22) midDarkCount += 1;
          const mag =
            Math.abs(gray[off + x + 1] - gray[off + x - 1]) +
            Math.abs(gray[(y + 1) * width + x] - gray[(y - 1) * width + x]);
          tGrad += mag;
          tCount += 1;
        }
      }
      if (tCount === 0) continue;
      const tMean = tSum / tCount;
      const meanGrad = tGrad / tCount;
      const stainFrac = midDarkCount / tCount;
      if (tMean < tileAvg - 22 && meanGrad < 12 && stainFrac > 0.28) {
        stainTiles += 1;
      }
      if (tMean < 105 && meanGrad < 8 && contrastSpread > 35) {
        unreadableRegionsCount += 1;
      }
    }
  }
  const hasStainsOrMarks = stainTiles >= 2;

  // Fold lines / creases: continuous subtle-to-medium vertical or horizontal shadow/ridge band
  let hasFoldLinesOrCreases = false;
  if (width >= 100 && height >= 100) {
    let creaseRows = 0;
    for (let y = Math.floor(height * 0.15); y < Math.floor(height * 0.85); y += 3) {
      let rowSum = 0;
      let bandDrop = 0;
      const off = y * width;
      for (let x = xStart; x < xEnd; x += 4) {
        rowSum += gray[off + x];
        if (gray[off + x] < tileAvg - 14 && gray[off + x] > 75) bandDrop += 1;
      }
      const n = Math.max(1, Math.floor((xEnd - xStart) / 4));
      if (rowSum / n < tileAvg - 12 && bandDrop / n > 0.62) {
        creaseRows += 1;
      }
    }
    let creaseCols = 0;
    for (let x = Math.floor(width * 0.15); x < Math.floor(width * 0.85); x += 3) {
      let colSum = 0;
      let bandDrop = 0;
      for (let y = yStart; y < yEnd; y += 4) {
        const val = gray[y * width + x];
        colSum += val;
        if (val < tileAvg - 14 && val > 75) bandDrop += 1;
      }
      const n = Math.max(1, Math.floor((yEnd - yStart) / 4));
      if (colSum / n < tileAvg - 12 && bandDrop / n > 0.62) {
        creaseCols += 1;
      }
    }
    hasFoldLinesOrCreases = creaseRows >= 2 || creaseCols >= 2;
  }

  // Torn / damaged outer corners or missing sheet chunks when inner paper is bright
  let darkCorners = 0;
  const cornerSz = Math.max(8, Math.floor(Math.min(width, height) * 0.06));
  const checkCornerMean = (cx0: number, cy0: number) => {
    let s = 0;
    let c = 0;
    for (let y = cy0; y < Math.min(height, cy0 + cornerSz); y += 2) {
      for (let x = cx0; x < Math.min(width, cx0 + cornerSz); x += 2) {
        s += gray[y * width + x];
        c += 1;
      }
    }
    return c > 0 ? s / c : 255;
  };
  const cornerMeans = [
    checkCornerMean(0, 0),
    checkCornerMean(Math.max(0, width - cornerSz), 0),
    checkCornerMean(0, Math.max(0, height - cornerSz)),
    checkCornerMean(Math.max(0, width - cornerSz), Math.max(0, height - cornerSz)),
  ];
  for (const cm of cornerMeans) {
    if (cm < tileAvg - 65) darkCorners += 1;
  }
  const isTornOrDamaged =
    tileAvg > 155 &&
    darkBorderFraction < 0.25 &&
    darkCorners >= 1 &&
    darkCorners <= 2 &&
    Math.max(...cornerMeans) - Math.min(...cornerMeans) > 65;

  const isIncompleteCapture =
    hasCroppedEdgeText || (darkCorners >= 2 && darkBorderFraction >= 0.35 && borderInkRatio > 0.04);

  const actionableWarnings: string[] = [];
  if (isLowResolution) {
    actionableWarnings.push(`Low resolution (${width}x${height}px) — re-capture closer or at higher DPI if small subscripts are unclear.`);
  }
  if (isBlurry) {
    actionableWarnings.push('Image blur detected; check small numbers, punctuation, and mathematical symbols.');
  }
  if (isFadedPrinting) {
    actionableWarnings.push('Faded printing or light ink detected; verify faint text lines.');
  }
  if (hasStrongShadows) {
    actionableWarnings.push('Strong shadow gradients detected across the page.');
  } else if (isUnevenLighting) {
    actionableWarnings.push('Uneven lighting detected; adaptive illumination correction applied.');
  }
  if (hasStainsOrMarks) {
    actionableWarnings.push('Stains, smudges, or dark blotch marks detected on the sheet.');
  }
  if (hasFoldLinesOrCreases) {
    actionableWarnings.push('Paper fold lines or creases detected across text area.');
  }
  if (isTornOrDamaged) {
    actionableWarnings.push('Possible torn corner or damaged page margin detected.');
  }
  if (hasCroppedEdgeText || isIncompleteCapture) {
    actionableWarnings.push('Text or sheet edges touch the frame boundary — page capture may be cropped or incomplete.');
  }
  if (unreadableRegionsCount > 0) {
    actionableWarnings.push(`${unreadableRegionsCount} heavily degraded/unreadable image region(s) flagged for review.`);
  }
  if (isLikelyBlank) {
    actionableWarnings.push('Page appears blank or nearly empty.');
  }

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
    isTornOrDamaged,
    isFadedPrinting,
    hasStrongShadows,
    hasStainsOrMarks,
    excessiveRotationDeg: 0,
    hasCroppedEdgeText,
    hasFoldLinesOrCreases,
    isIncompleteCapture,
    unreadableRegionsCount,
    actionableWarnings,
  };
}

/**
 * Detects a 4-corner quadrilateral paper document sheet framed by a darker/textured surface
 * (supports skewed, rotated, and trapezoidal camera photos).
 */
export function detectDocumentQuad(
  gray: Uint8Array,
  width: number,
  height: number
): DocumentQuadResult {
  const fallback: DocumentQuadResult = {
    detected: false,
    corners: [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: width - 1, y: height - 1 },
      { x: 0, y: height - 1 },
    ],
    targetWidth: width,
    targetHeight: height,
  };

  if (width < 180 || height < 180) return fallback;

  // Estimate inner sheet brightness vs outer ring brightness
  let innerSum = 0;
  let innerCount = 0;
  for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.7); y += 3) {
    const off = y * width;
    for (let x = Math.floor(width * 0.3); x < Math.floor(width * 0.7); x += 3) {
      innerSum += gray[off + x];
      innerCount += 1;
    }
  }
  const innerMean = innerCount > 0 ? innerSum / innerCount : 200;
  if (innerMean < 130) return fallback;

  // Outer perimeter ring check: only run 4-corner perspective warp when border contains dark background
  let borderDark = 0;
  let borderTotal = 0;
  const ringY = Math.max(3, Math.floor(height * 0.04));
  const ringX = Math.max(3, Math.floor(width * 0.04));
  const borderThresh = Math.max(70, Math.min(135, innerMean - 50));
  for (let y = 0; y < height; y += Math.max(2, Math.floor(height / 90))) {
    for (let x = 0; x < width; x += Math.max(2, Math.floor(width / 90))) {
      if (y < ringY || y >= height - ringY || x < ringX || x >= width - ringX) {
        if (gray[y * width + x] < borderThresh) borderDark += 1;
        borderTotal += 1;
      }
    }
  }
  if (borderTotal === 0 || borderDark / borderTotal < 0.28) {
    return fallback;
  }

  // Downsample to ~220px grid for fast flood-fill connected component + corner hull extraction
  const scale = Math.min(1, 220 / Math.max(width, height));
  const sw = Math.max(48, Math.round(width * scale));
  const sh = Math.max(48, Math.round(height * scale));
  const small = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy += 1) {
    const oy = Math.min(height - 1, Math.round((sy * (height - 1)) / Math.max(1, sh - 1)));
    const rowOff = oy * width;
    for (let sx = 0; sx < sw; sx += 1) {
      const ox = Math.min(width - 1, Math.round((sx * (width - 1)) / Math.max(1, sw - 1)));
      small[sy * sw + sx] = gray[rowOff + ox];
    }
  }

  // Build binary paper sheet mask & flood-fill from image center so desk glare spots are ignored
  const sheetThresh = Math.max(92, Math.min(150, innerMean - 48));
  const mask = new Uint8Array(sw * sh);
  for (let i = 0; i < mask.length; i += 1) {
    if (small[i] >= sheetThresh) mask[i] = 1;
  }

  // Find a seed near center
  let seedX = Math.floor(sw / 2);
  let seedY = Math.floor(sh / 2);
  if (mask[seedY * sw + seedX] === 0) {
    let found = false;
    for (let r = 1; r <= 12 && !found; r += 1) {
      for (let dy = -r; dy <= r && !found; dy += 1) {
        for (let dx = -r; dx <= r && !found; dx += 1) {
          const nx = seedX + dx;
          const ny = seedY + dy;
          if (nx >= 0 && nx < sw && ny >= 0 && ny < sh && mask[ny * sw + nx] === 1) {
            seedX = nx;
            seedY = ny;
            found = true;
          }
        }
      }
    }
    if (!found) return fallback;
  }

  const visited = new Uint8Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  let head = 0;
  let tail = 0;
  const startIdx = seedY * sw + seedX;
  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  // Include small dark ink islands inside paper by 1-pixel morphological closing neighborhood check
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % sw;
    const y = Math.floor(idx / sw);
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x + 1 < sw ? idx + 1 : -1,
      y > 0 ? idx - sw : -1,
      y + 1 < sh ? idx + sw : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue;
      if (mask[n] === 1) {
        visited[n] = 1;
        queue[tail++] = n;
      } else {
        // Bridge thin dark ink lines inside the page (if opposite side is bright paper)
        const nx = n % sw;
        const ny = Math.floor(n / sw);
        const nnx = nx + (nx - x);
        const nny = ny + (ny - y);
        if (
          nnx >= 0 &&
          nnx < sw &&
          nny >= 0 &&
          nny < sh &&
          mask[nny * sw + nnx] === 1 &&
          !visited[nny * sw + nnx]
        ) {
          visited[n] = 1;
          visited[nny * sw + nnx] = 1;
          queue[tail++] = nny * sw + nnx;
        }
      }
    }
  }

  const areaFrac = tail / (sw * sh);
  if (areaFrac < 0.16 || areaFrac > 0.94) return fallback;

  // Extract boundary pixels of the connected sheet component & find extreme quad corners
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  let tl: QuadPoint = { x: 0, y: 0 };
  let br: QuadPoint = { x: sw - 1, y: sh - 1 };
  let bl: QuadPoint = { x: 0, y: sh - 1 };
  let tr: QuadPoint = { x: sw - 1, y: 0 };

  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      if (!visited[y * sw + x]) continue;
      const isEdge =
        x === 0 ||
        x === sw - 1 ||
        y === 0 ||
        y === sh - 1 ||
        !visited[y * sw + (x - 1)] ||
        !visited[y * sw + (x + 1)] ||
        !visited[(y - 1) * sw + x] ||
        !visited[(y + 1) * sw + x];
      if (!isEdge) continue;
      const sum = x + y;
      const diff = x - y;
      if (sum < minSum) {
        minSum = sum;
        tl = { x, y };
      }
      if (sum > maxSum) {
        maxSum = sum;
        br = { x, y };
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        tr = { x, y };
      }
      if (diff < minDiff) {
        minDiff = diff;
        bl = { x, y };
      }
    }
  }

  const toOrig = (pt: QuadPoint): QuadPoint => ({
    x: Math.max(0, Math.min(width - 1, Math.round((pt.x * (width - 1)) / Math.max(1, sw - 1)))),
    y: Math.max(0, Math.min(height - 1, Math.round((pt.y * (height - 1)) / Math.max(1, sh - 1)))),
  });

  const oTl = toOrig(tl);
  const oTr = toOrig(tr);
  const oBr = toOrig(br);
  const oBl = toOrig(bl);

  // Verify convex quad geometry & reasonable dimensions
  const dist = (a: QuadPoint, b: QuadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  const topW = dist(oTl, oTr);
  const botW = dist(oBl, oBr);
  const leftH = dist(oTl, oBl);
  const rightH = dist(oTr, oBr);
  if (
    topW < width * 0.25 ||
    botW < width * 0.25 ||
    leftH < height * 0.25 ||
    rightH < height * 0.25
  ) {
    return fallback;
  }

  // Polygon shoelace area check
  const poly = [oTl, oTr, oBr, oBl];
  let shoelace = 0;
  for (let i = 0; i < 4; i += 1) {
    const next = poly[(i + 1) % 4];
    shoelace += poly[i].x * next.y - next.x * poly[i].y;
  }
  const quadArea = Math.abs(shoelace) / 2;
  const quadFrac = quadArea / (width * height);
  if (quadFrac < 0.16 || quadFrac > 0.94) {
    return fallback;
  }

  // Ensure all 4 cross products have consistent sign (strictly convex quad)
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    const c = poly[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-3) return fallback;
    const curSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = curSign;
    else if (sign !== curSign) return fallback;
  }

  // Slightly pad corners outward by 2px so edge text lines remain safely inside
  const padOut = (pt: QuadPoint, cx: number, cy: number): QuadPoint => ({
    x: Math.max(0, Math.min(width - 1, Math.round(pt.x + (pt.x < cx ? -2 : 2)))),
    y: Math.max(0, Math.min(height - 1, Math.round(pt.y + (pt.y < cy ? -2 : 2)))),
  });
  const cx = (oTl.x + oTr.x + oBr.x + oBl.x) / 4;
  const cy = (oTl.y + oTr.y + oBr.y + oBl.y) / 4;
  const padded: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] = [
    padOut(oTl, cx, cy),
    padOut(oTr, cx, cy),
    padOut(oBr, cx, cy),
    padOut(oBl, cx, cy),
  ];

  const targetWidth = Math.max(64, Math.round(Math.max(topW, botW)));
  const targetHeight = Math.max(64, Math.round(Math.max(leftH, rightH)));

  return {
    detected: true,
    corners: padded,
    targetWidth,
    targetHeight,
  };
}

/** Solves an 8x8 linear system Ax = b via Gaussian elimination with partial pivoting. */
function solveLinearSystem8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, idx) => [...row, b[idx]]);
  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r += 1) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }
    const diag = M[col][col];
    for (let k = col; k <= n; k += 1) {
      M[col][k] /= diag;
    }
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let k = col; k <= n; k += 1) {
        M[r][k] -= factor * M[col][k];
      }
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Rectifies a 4-corner perspective quadrilateral `[TL, TR, BR, BL]` into a rectangular
 * orthographic grayscale buffer using exact projective homography + bilinear sampling.
 */
export function warpPerspectiveGrayscale(
  gray: Uint8Array,
  width: number,
  height: number,
  corners: [QuadPoint, QuadPoint, QuadPoint, QuadPoint],
  targetWidth: number,
  targetHeight: number,
  fillValue = 250
): RawGrayBuffer {
  const dstPts: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] = [
    { x: 0, y: 0 },
    { x: targetWidth - 1, y: 0 },
    { x: targetWidth - 1, y: targetHeight - 1 },
    { x: 0, y: targetHeight - 1 },
  ];

  // Solve homography H mapping dst (u,v) -> src (x,y) for inverse bilinear lookup
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x: u, y: v } = dstPts[i];
    const { x, y } = corners[i];
    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    b.push(y);
  }

  const h = solveLinearSystem8(A, b);
  if (!h) {
    return resizeGrayscaleBilinear(gray, width, height, targetWidth, targetHeight);
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
  const out = new Uint8Array(targetWidth * targetHeight);
  out.fill(fillValue);

  for (let v = 0; v < targetHeight; v += 1) {
    const outOff = v * targetWidth;
    for (let u = 0; u < targetWidth; u += 1) {
      const denom = h6 * u + h7 * v + 1;
      if (Math.abs(denom) < 1e-8) continue;
      const sx = (h0 * u + h1 * v + h2) / denom;
      const sy = (h3 * u + h4 * v + h5) / denom;
      if (sx < 0 || sx >= width - 1 || sy < 0 || sy >= height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const r0 = y0 * width;
      const r1 = (y0 + 1) * width;
      const topVal = gray[r0 + x0] * (1 - fx) + gray[r0 + x0 + 1] * fx;
      const botVal = gray[r1 + x0] * (1 - fx) + gray[r1 + x0 + 1] * fx;
      out[outOff + u] = Math.round(topVal * (1 - fy) + botVal * fy);
    }
  }

  return { gray: out, width: targetWidth, height: targetHeight };
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
 * Estimates page tilt (-14 to +14 degrees) via coarse 1° + fine 0.25° gradient projection search.
 */
export function estimateSkewAngle(
  gray: Uint8Array,
  width: number,
  height: number
): number {
  if (width < 120 || height < 120) return 0;
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

  const edges = new Uint8Array(sw * sh);
  for (let y = 1; y < sh - 1; y += 1) {
    for (let x = 1; x < sw - 1; x += 1) {
      const d = Math.abs(small[(y + 1) * sw + x] - small[(y - 1) * sw + x]);
      if (d > 16) edges[y * sw + x] = d;
    }
  }

  const y0 = Math.floor(sh * 0.08);
  const y1 = Math.floor(sh * 0.92);
  const x0 = Math.floor(sw * 0.08);
  const x1 = Math.floor(sw * 0.92);

  const scoreAngle = (deg: number): number => {
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
    return score;
  };

  const zeroScore = scoreAngle(0);
  let coarseDeg = 0;
  let coarseScore = zeroScore;

  for (let deg = -14; deg <= 14; deg += 1) {
    if (deg === 0) continue;
    const score = scoreAngle(deg);
    if (score > coarseScore) {
      coarseScore = score;
      coarseDeg = deg;
    }
  }

  let bestDeg = coarseDeg;
  let bestScore = coarseScore;
  for (let deg = Math.max(-14.5, coarseDeg - 1.25); deg <= Math.min(14.5, coarseDeg + 1.25); deg += 0.25) {
    const score = scoreAngle(deg);
    if (score > bestScore) {
      bestScore = score;
      bestDeg = Number(deg.toFixed(2));
    }
  }

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

/**
 * Estimates smooth background paper illumination on a coarse grid using local upper-percentile
 * (paper surface estimate immune to dark text strokes) and divides uneven shadows/creases
 * smoothly before character contrast enhancement so tiny symbols and decimals remain intact.
 */
export function normalizeShadowIllumination(
  gray: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  if (width < 64 || height < 64) return gray.slice();
  const cell = Math.max(12, Math.round(Math.min(width, height) / 36));
  const gw = Math.max(4, Math.ceil(width / cell));
  const gh = Math.max(4, Math.ceil(height / cell));
  const coarseBg = new Float32Array(gw * gh);

  for (let gy = 0; gy < gh; gy += 1) {
    const y0 = gy * cell;
    const y1 = Math.min(height, y0 + cell);
    for (let gx = 0; gx < gw; gx += 1) {
      const x0 = gx * cell;
      const x1 = Math.min(width, x0 + cell);
      const samples: number[] = [];
      for (let y = y0; y < y1; y += 2) {
        const off = y * width;
        for (let x = x0; x < x1; x += 2) {
          samples.push(gray[off + x]);
        }
      }
      if (samples.length === 0) {
        coarseBg[gy * gw + gx] = 240;
      } else {
        samples.sort((a, b) => a - b);
        // 85th percentile estimates clean paper background even over dense text blocks
        const p85 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.85))];
        coarseBg[gy * gw + gx] = Math.max(48, p85);
      }
    }
  }

  // Smooth 3x3 average pass over coarse grid to prevent block seams across creases
  const smoothBg = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = Math.max(0, Math.min(gh - 1, gy + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.max(0, Math.min(gw - 1, gx + dx));
          sum += coarseBg[ny * gw + nx];
          cnt += 1;
        }
      }
      smoothBg[gy * gw + gx] = sum / cnt;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const fyGrid = (y + 0.5) / cell - 0.5;
    const gy0 = Math.max(0, Math.min(gh - 1, Math.floor(fyGrid)));
    const gy1 = Math.max(0, Math.min(gh - 1, gy0 + 1));
    const ty = Math.max(0, Math.min(1, fyGrid - gy0));
    const rowOff = y * width;
    for (let x = 0; x < width; x += 1) {
      const fxGrid = (x + 0.5) / cell - 0.5;
      const gx0 = Math.max(0, Math.min(gw - 1, Math.floor(fxGrid)));
      const gx1 = Math.max(0, Math.min(gw - 1, gx0 + 1));
      const tx = Math.max(0, Math.min(1, fxGrid - gx0));
      const topBg = smoothBg[gy0 * gw + gx0] * (1 - tx) + smoothBg[gy0 * gw + gx1] * tx;
      const botBg = smoothBg[gy1 * gw + gx0] * (1 - tx) + smoothBg[gy1 * gw + gx1] * tx;
      const localBg = Math.max(40, topBg * (1 - ty) + botBg * ty);
      const val = (gray[rowOff + x] * 248) / localBg;
      out[rowOff + x] = val <= 0 ? 0 : val >= 255 ? 255 : Math.round(val);
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

/** Decodes PNG/JPEG/WEBP bytes to RGBA + upright grayscale in Node (Sharp) or Browser (Canvas). */
export async function decodeBytesToRgbaAndGray(
  bytes: Uint8Array,
  mimeType = 'image/png'
): Promise<{
  rgba: Uint8ClampedArray;
  gray: Uint8Array;
  width: number;
  height: number;
  qrMatches: string[];
}> {
  const sharpFn = await getNodeSharp();
  if (sharpFn) {
    const { data, info } = await sharpFn(bytes)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const qrMatches: string[] = [];
    try {
      const qr = jsQR(clamped, width, height, { inversionAttempts: 'dontInvert' });
      if (qr?.data) qrMatches.push(qr.data);
    } catch {
      // Ignore QR error
    }
    return {
      rgba: clamped,
      gray: rgbaToGrayscale(clamped, width, height),
      width,
      height,
      qrMatches,
    };
  }
  if (typeof document !== 'undefined') {
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
        // Ignore
      }
      return {
        rgba: imgData.data,
        gray: rgbaToGrayscale(imgData.data, width, height),
        width,
        height,
        qrMatches,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  throw new Error('Neither sharp (Node) nor Canvas (browser) is available to decode images.');
}

/** Decodes PNG/JPEG/WEBP bytes to upright single-channel grayscale in Node (Sharp) or Browser (Canvas). */
export async function decodeBytesToGrayscale(
  bytes: Uint8Array,
  mimeType = 'image/png'
): Promise<{ gray: Uint8Array; width: number; height: number; qrMatches: string[] }> {
  const decoded = await decodeBytesToRgbaAndGray(bytes, mimeType);
  return {
    gray: decoded.gray,
    width: decoded.width,
    height: decoded.height,
    qrMatches: decoded.qrMatches,
  };
}

/** Encodes a grayscale buffer into a lossless PNG data URL + bytes in Node or Browser. */
export async function encodeGrayToPngDataUrl(
  gray: Uint8Array,
  width: number,
  height: number
): Promise<{ dataUrl: string; bytes: Uint8Array }> {
  const sharpFn = await getNodeSharp();
  if (sharpFn) {
    const pngBuf = await sharpFn(Buffer.from(gray), {
      raw: { width, height, channels: 1 },
    })
      .toColorspace('b-w')
      .png({ compressionLevel: 6 })
      .toBuffer();
    const bytes = new Uint8Array(pngBuf);
    return {
      dataUrl: uint8ToBase64DataUrl(bytes, 'image/png'),
      bytes,
    };
  }
  if (typeof document !== 'undefined') {
    return encodeGrayBrowser(gray, width, height, 'image/png');
  }
  throw new Error('Neither sharp (Node) nor Canvas (browser) is available to encode PNG images.');
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

  let width = 0;
  let height = 0;
  let gray: Uint8Array;
  let rawRgba: Uint8ClampedArray | undefined;
  let rawGrayCopy: Uint8Array | undefined;
  let qrMatches: string[] = [];

  const decoded = await decodeBytesToRgbaAndGray(sourceDecoded.bytes, sourceDecoded.mimeType);
  width = decoded.width;
  height = decoded.height;
  gray = decoded.gray;
  rawRgba = decoded.rgba;
  rawGrayCopy = decoded.gray.slice();
  qrMatches = decoded.qrMatches;

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

  // 1. Detect 4-corner quadrilateral perspective boundary first; fallback to rectangular crop
  let perspectiveCorrected = false;
  let quadCorners: [QuadPoint, QuadPoint, QuadPoint, QuadPoint] | undefined;
  const quad = detectDocumentQuad(gray, width, height);
  if (quad.detected) {
    const warped = warpPerspectiveGrayscale(
      gray,
      width,
      height,
      quad.corners,
      quad.targetWidth,
      quad.targetHeight,
      250
    );
    gray = warped.gray;
    width = warped.width;
    height = warped.height;
    perspectiveCorrected = true;
    quadCorners = quad.corners;
    appliedSteps.push('perspective_warp_4pt');
  } else {
    const cropBox = detectDocumentCropBox(gray, width, height);
    if (cropBox.cropped) {
      const cropped = cropGrayscale(gray, width, height, cropBox);
      gray = cropped.gray;
      width = cropped.width;
      height = cropped.height;
      appliedSteps.push('document_boundary_crop');
    }
  }

  const qualityMetrics = analyzeGrayscaleQuality(gray, width, height);
  // Preserve border/tear/stain inspection from pre-crop sheet analysis
  qualityMetrics.darkBorderFraction = preQuality.darkBorderFraction;
  if (preQuality.isTornOrDamaged) qualityMetrics.isTornOrDamaged = true;
  if (preQuality.isIncompleteCapture && !perspectiveCorrected) {
    qualityMetrics.isIncompleteCapture = true;
  }

  // 2. Estimate skew on native grid BEFORE resizing (supports up to ±14 degrees)
  const skewDeg = estimateSkewAngle(gray, width, height);
  qualityMetrics.skewAngleDeg = skewDeg;
  if (Math.abs(skewDeg) >= 4.5) {
    qualityMetrics.excessiveRotationDeg = skewDeg;
    qualityMetrics.actionableWarnings.push(
      `Excessive tilt/rotation (${skewDeg.toFixed(1)}°) detected; verify alignment after deskew.`
    );
  }
  qualityMetrics.actionableWarnings = Array.from(new Set(qualityMetrics.actionableWarnings));

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

  // 5. Flatten uneven lighting / flash falloff / fold shadows cleanly before local contrast enhancement
  if (qualityMetrics.isUnevenLighting || qualityMetrics.shadowVariance >= 9) {
    gray = normalizeShadowIllumination(gray, width, height);
    appliedSteps.push('illumination_divide');
  }

  // 6. Adaptive enhancement selection based on measured image quality
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

  // 7. Encode PNG lossless for OCR & compact preview JPEG (<= 1280px wide) for storage/UI
  let ocrDataUrl: string;
  let ocrBytes: Uint8Array;
  let previewDataUrl: string;

  const previewTargetW = Math.min(1280, width);
  const previewTargetH = Math.max(1, Math.round((height * previewTargetW) / Math.max(1, width)));

  const sharpFn = await getNodeSharp();
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
    ocrGray,
    rawRgba,
    rawGray: rawGrayCopy,
    width,
    height,
    originalWidth,
    originalHeight,
    strategy,
    appliedSteps,
    qualityMetrics,
    isLikelyBlank: qualityMetrics.isLikelyBlank,
    qrMatches,
    perspectiveCorrected,
    quadCorners,
  };
}
