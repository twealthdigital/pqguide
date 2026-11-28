import jsQR from 'jsqr';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  PlanarYUVLuminanceSource,
  Result,
} from '@zxing/library';
import type { QrCodeMatch } from '../../core/types';

export interface BarcodeQrScanInput {
  rgba?: Uint8ClampedArray;
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
}

export function isSafeBarcodePayload(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed) return true;
  if (/<\s*script|javascript:|data:text\/html|vbscript:|file:\/\//i.test(trimmed)) {
    return false;
  }
  if (/^http:\/\//i.test(trimmed)) {
    return false;
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)/i.test(trimmed)) {
    return false;
  }
  return true;
}

function rotateGrayClockwise(
  gray: Uint8Array,
  width: number,
  height: number,
  turns: 0 | 1 | 2 | 3
): { gray: Uint8Array; width: number; height: number } {
  if (turns === 0) return { gray, width, height };
  if (turns === 2) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[(height - 1 - y) * width + (width - 1 - x)] = gray[y * width + x];
      }
    }
    return { gray: out, width, height };
  }
  if (turns === 1) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[x * height + (height - 1 - y)] = gray[y * width + x];
      }
    }
    return { gray: out, width: height, height: width };
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[(width - 1 - x) * height + y] = gray[y * width + x];
    }
  }
  return { gray: out, width: height, height: width };
}

function mapRotatedBboxBack(
  bbox: { x: number; y: number; width: number; height: number },
  origW: number,
  origH: number,
  turns: 0 | 1 | 2 | 3
): { x: number; y: number; width: number; height: number } {
  if (turns === 0) return bbox;
  if (turns === 2) {
    return {
      x: Math.max(0, origW - (bbox.x + bbox.width)),
      y: Math.max(0, origH - (bbox.y + bbox.height)),
      width: bbox.width,
      height: bbox.height,
    };
  }
  if (turns === 1) {
    return {
      x: Math.max(0, bbox.y),
      y: Math.max(0, origH - (bbox.x + bbox.width)),
      width: bbox.height,
      height: bbox.width,
    };
  }
  return {
    x: Math.max(0, origW - (bbox.y + bbox.height)),
    y: Math.max(0, bbox.x),
    width: bbox.height,
    height: bbox.width,
  };
}

function grayToRgba(gray: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    const p = i * 4;
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
    rgba[p + 3] = 255;
  }
  return rgba;
}

function buildZxingReader(): MultiFormatReader {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.PDF_417,
    BarcodeFormat.AZTEC,
  ]);
  reader.setHints(hints);
  return reader;
}

function decodeZxingSingle(
  reader: MultiFormatReader,
  gray: Uint8Array,
  width: number,
  height: number
): Result | null {
  if (width < 16 || height < 16 || gray.length < width * height) return null;
  const clamped = new Uint8ClampedArray(gray);
  const source = new PlanarYUVLuminanceSource(
    clamped,
    width,
    height,
    0,
    0,
    width,
    height,
    false
  );
  try {
    return reader.decode(new BinaryBitmap(new HybridBinarizer(source)));
  } catch {
    try {
      return reader.decode(new BinaryBitmap(new GlobalHistogramBinarizer(source)));
    } catch {
      return null;
    }
  } finally {
    reader.reset();
  }
}

function resultToBbox(
  result: Result,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | undefined {
  const pts = result.getResultPoints();
  if (!pts || pts.length === 0) return undefined;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const p of pts) {
    if (!p) continue;
    const px = p.getX();
    const py = p.getY();
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (maxX < minX || maxY < minY) return undefined;
  const pad = 16;
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const w = Math.min(width - x, Math.max(24, Math.ceil(maxX - minX + pad * 2)));
  const h = Math.min(height - y, Math.max(24, Math.ceil(maxY - minY + pad * 2)));
  return { x, y, width: w, height: h };
}

function formatName(fmt: BarcodeFormat): string {
  switch (fmt) {
    case BarcodeFormat.QR_CODE:
      return 'QR_CODE';
    case BarcodeFormat.CODE_128:
      return 'CODE_128';
    case BarcodeFormat.CODE_39:
      return 'CODE_39';
    case BarcodeFormat.CODE_93:
      return 'CODE_93';
    case BarcodeFormat.EAN_13:
      return 'EAN_13';
    case BarcodeFormat.EAN_8:
      return 'EAN_8';
    case BarcodeFormat.UPC_A:
      return 'UPC_A';
    case BarcodeFormat.UPC_E:
      return 'UPC_E';
    case BarcodeFormat.ITF:
      return 'ITF';
    case BarcodeFormat.CODABAR:
      return 'CODABAR';
    case BarcodeFormat.DATA_MATRIX:
      return 'DATA_MATRIX';
    case BarcodeFormat.PDF_417:
      return 'PDF_417';
    case BarcodeFormat.AZTEC:
      return 'AZTEC';
    default:
      return 'BARCODE';
  }
}

function eraseBboxWhite(
  gray: Uint8Array,
  width: number,
  height: number,
  bbox: { x: number; y: number; width: number; height: number }
): void {
  const xEnd = Math.min(width, bbox.x + bbox.width);
  const yEnd = Math.min(height, bbox.y + bbox.height);
  for (let y = Math.max(0, bbox.y); y < yEnd; y += 1) {
    const off = y * width;
    for (let x = Math.max(0, bbox.x); x < xEnd; x += 1) {
      gray[off + x] = 255;
    }
  }
}

/**
 * Detects dense 1D bar-cluster stripes that failed decoding (e.g. torn/smudged barcode)
 * so damaged codes are reported explicitly instead of silently ignored.
 */
function detectUnreadableBarcodeRegions(
  workingGray: Uint8Array,
  width: number,
  height: number
): Array<{ x: number; y: number; width: number; height: number }> {
  if (width < 120 || height < 80 || workingGray.length < width * height) return [];
  const regions: Array<{ x: number; y: number; width: number; height: number }> = [];
  const bandH = Math.max(24, Math.round(height * 0.05));

  for (let y0 = 0; y0 + bandH <= height; y0 += Math.round(bandH * 0.6)) {
    const midY = y0 + Math.floor(bandH / 2);
    // Count crisp black-white horizontal transitions along midY and midY-4/midY+4
    let transitions = 0;
    let firstX = -1;
    let lastX = -1;
    let prevDark = workingGray[midY * width] < 130;

    for (let x = 1; x < width; x += 1) {
      const d0 = workingGray[midY * width + x] < 130;
      const d1 = workingGray[Math.max(0, midY - 4) * width + x] < 130;
      const d2 = workingGray[Math.min(height - 1, midY + 4) * width + x] < 130;
      const verticalBarConsistency = d0 === d1 && d0 === d2;

      if (d0 !== prevDark && verticalBarConsistency) {
        transitions += 1;
        if (firstX === -1) firstX = x;
        lastX = x;
      }
      prevDark = d0;
    }

    if (transitions >= 22 && firstX >= 0 && lastX - firstX >= 45 && lastX - firstX <= width * 0.72) {
      const candidate = {
        x: Math.max(0, firstX - 8),
        y: y0,
        width: Math.min(width - Math.max(0, firstX - 8), lastX - firstX + 16),
        height: bandH,
      };
      const overlaps = regions.some(
        (r) => Math.abs(r.x - candidate.x) < 40 && Math.abs(r.y - candidate.y) < bandH
      );
      if (!overlaps) regions.push(candidate);
    }
  }

  return regions;
}

export function scanBarcodesAndQrFromBuffer(
  input: BarcodeQrScanInput
): QrCodeMatch[] {
  const { gray, width, height, pageNumber, rgba } = input;
  if (width < 16 || height < 16 || gray.length < width * height) return [];

  const results: QrCodeMatch[] = [];
  const seenKeys = new Set<string>();
  const workingGray = new Uint8Array(gray);
  const reader = buildZxingReader();

  // Pass 1: jsQR on 0° native RGBA/gray (fast & tolerant to perspective skew)
  for (let pass = 0; pass < 3; pass += 1) {
    const jsQrRgba = pass === 0 && rgba ? rgba : grayToRgba(workingGray);
    const decoded = jsQR(jsQrRgba, width, height, {
      inversionAttempts: 'attemptBoth',
    });
    if (!decoded || !decoded.data) break;
    const payload = decoded.data.trim();
    const loc = decoded.location;
    const minX = Math.max(
      0,
      Math.floor(Math.min(loc.topLeftCorner.x, loc.bottomLeftCorner.x)) - 12
    );
    const maxX = Math.min(
      width,
      Math.ceil(Math.max(loc.topRightCorner.x, loc.bottomRightCorner.x)) + 12
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(loc.topLeftCorner.y, loc.topRightCorner.y)) - 12
    );
    const maxY = Math.min(
      height,
      Math.ceil(Math.max(loc.bottomLeftCorner.y, loc.bottomRightCorner.y)) + 12
    );
    const bbox = {
      x: minX,
      y: minY,
      width: Math.max(16, maxX - minX),
      height: Math.max(16, maxY - minY),
    };
    const safe = isSafeBarcodePayload(payload);
    const key = `QR_CODE:${payload}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      results.push({
        pageNumber,
        payload,
        isSafeUrl: safe,
        format: 'QR_CODE',
        bbox,
        rotationDeg: 0,
        warning: safe
          ? undefined
          : 'Decoded QR payload references a potentially unsafe scheme or private network target (not executed).',
      });
    }
    eraseBboxWhite(workingGray, width, height, bbox);
  }

  // Pass 2: Multi-format ZXing across 0°, 90°, 180°, 270° with iterative region masking for multi-code pages
  const rotations: Array<{ turns: 0 | 1 | 2 | 3; deg: number }> = [
    { turns: 0, deg: 0 },
    { turns: 1, deg: 90 },
    { turns: 2, deg: 180 },
    { turns: 3, deg: 270 },
  ];

  for (const rot of rotations) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const rotated = rotateGrayClockwise(workingGray, width, height, rot.turns);
      const decoded = decodeZxingSingle(
        reader,
        rotated.gray,
        rotated.width,
        rotated.height
      );
      if (!decoded) break;

      const payload = decoded.getText().trim();
      const fmt = formatName(decoded.getBarcodeFormat());
      const rotBbox = resultToBbox(decoded, rotated.width, rotated.height);
      const origBbox = rotBbox
        ? mapRotatedBboxBack(rotBbox, width, height, rot.turns)
        : undefined;

      const key = `${fmt}:${payload}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const safe = isSafeBarcodePayload(payload);
        results.push({
          pageNumber,
          payload,
          isSafeUrl: safe,
          format: fmt,
          bbox: origBbox,
          rotationDeg: rot.deg,
          warning: safe
            ? undefined
            : `Decoded ${fmt} payload points to a blocked/unsafe URL scheme (neutralized).`,
        });
      }

      if (origBbox) {
        eraseBboxWhite(workingGray, width, height, origBbox);
      } else {
        break;
      }
    }
  }

  // Pass 3: Report leftover dense barcode-like bar runs that could not be decoded cleanly
  const damagedRegions = detectUnreadableBarcodeRegions(workingGray, width, height);
  for (const reg of damagedRegions) {
    results.push({
      pageNumber,
      payload: '[Unreadable or damaged barcode detected]',
      isSafeUrl: true,
      format: 'UNKNOWN_BARCODE',
      bbox: reg,
      unreadableDetected: true,
      warning: `Page ${pageNumber}: Dense barcode-like bar pattern detected at (${reg.x},${reg.y}) could not be decoded cleanly.`,
    });
  }

  return results;
}
