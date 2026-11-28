import type {
  SignatureDetection,
  StampDetection,
} from '../../core/types';
import type { OcrWordBox } from './ocrEngine';

export interface SignatureStampInput {
  rgba?: Uint8ClampedArray;
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
  ocrText: string;
  wordBoxes?: OcrWordBox[];
}

function estimateThreshold(gray: Uint8Array): number {
  let sum = 0;
  const step = Math.max(1, Math.floor(gray.length / 7000));
  let count = 0;
  for (let i = 0; i < gray.length; i += step) {
    sum += gray[i];
    count += 1;
  }
  const mean = count > 0 ? sum / count : 225;
  return Math.max(90, Math.min(200, Math.round(mean * 0.76)));
}

function detectColoredStampsFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pageNumber: number,
  wordBoxes?: OcrWordBox[]
): StampDetection[] {
  if (rgba.length < width * height * 4) return [];

  // Downsample to grid cells (8x8 px) looking for chromatic stamp ink (blue/red/purple/green)
  const cell = 8;
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const chromaticGrid = new Uint8Array(gw * gh);

  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let chromaHits = 0;
      let samples = 0;
      const yEnd = Math.min(height, (gy + 1) * cell);
      const xEnd = Math.min(width, (gx + 1) * cell);

      for (let y = gy * cell; y < yEnd; y += 2) {
        for (let x = gx * cell; x < xEnd; x += 2) {
          const off = (y * width + x) * 4;
          const r = rgba[off];
          const g = rgba[off + 1];
          const b = rgba[off + 2];
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const chroma = maxC - minC;
          const brightness = (r + g + b) / 3;
          samples += 1;
          if (chroma >= 44 && brightness < 232 && brightness > 18) {
            chromaHits += 1;
          }
        }
      }
      if (samples > 0 && chromaHits / samples >= 0.16) {
        chromaticGrid[gy * gw + gx] = 1;
      }
    }
  }

  const visited = new Uint8Array(gw * gh);
  const stamps: StampDetection[] = [];
  let seq = 1;

  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const idx = gy * gw + gx;
      if (!chromaticGrid[idx] || visited[idx]) continue;

      const stack: Array<[number, number]> = [[gx, gy]];
      visited[idx] = 1;
      let minGx = gx;
      let maxGx = gx;
      let minGy = gy;
      let maxGy = gy;
      let cellCount = 0;

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        cellCount += 1;
        if (cx < minGx) minGx = cx;
        if (cx > maxGx) maxGx = cx;
        if (cy < minGy) minGy = cy;
        if (cy > maxGy) maxGy = cy;

        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
            const nIdx = ny * gw + nx;
            if (!visited[nIdx] && chromaticGrid[nIdx]) {
              visited[nIdx] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }

      const bbox = {
        x: minGx * cell,
        y: minGy * cell,
        width: Math.min(width - minGx * cell, (maxGx - minGx + 1) * cell),
        height: Math.min(height - minGy * cell, (maxGy - minGy + 1) * cell),
      };

      const minStampDim = Math.max(40, Math.round(width * 0.045));
      const maxStampDim = Math.round(width * 0.42);
      if (
        bbox.width < minStampDim ||
        bbox.height < minStampDim ||
        bbox.width > maxStampDim ||
        bbox.height > maxStampDim ||
        cellCount < 8
      ) {
        continue;
      }

      const aspect = bbox.width / bbox.height;
      const shape: StampDetection['shape'] =
        aspect >= 0.78 && aspect <= 1.28 ? 'circular' : aspect <= 2.8 ? 'rectangular' : 'irregular';

      const insideWords = (wordBoxes ?? [])
        .filter((w) => {
          const cx = (w.x0 + w.x1) / 2;
          const cy = (w.y0 + w.y1) / 2;
          return (
            cx >= bbox.x - 6 &&
            cx <= bbox.x + bbox.width + 6 &&
            cy >= bbox.y - 6 &&
            cy <= bbox.y + bbox.height + 6
          );
        })
        .map((w) => w.text)
        .join(' ')
        .trim();

      stamps.push({
        id: `p${pageNumber}-stamp-col-${seq++}`,
        pageNumber,
        shape,
        colorTone: 'colored',
        extractedText: insideWords || undefined,
        confidence: Number(Math.min(0.94, 0.62 + Math.min(0.3, cellCount / 120)).toFixed(2)),
        uncertain: !insideWords || insideWords.length < 4,
        bbox,
        note: 'Visual ink stamp/seal region detected. Stamp text and authenticity require manual admin verification.',
      });
    }
  }

  return stamps;
}

function detectMonochromeStamps(
  gray: Uint8Array,
  width: number,
  height: number,
  pageNumber: number,
  existingStamps: StampDetection[],
  ocrText: string,
  wordBoxes?: OcrWordBox[]
): StampDetection[] {
  if (width < 160 || height < 160 || gray.length < width * height) return [];
  const threshold = estimateThreshold(gray);
  const visited = new Uint8Array(width * height);
  const minDim = Math.max(48, Math.round(width * 0.06));
  const maxDim = Math.round(width * 0.38);

  const qx = new Int32Array(12000);
  const qy = new Int32Array(12000);
  const found: StampDetection[] = [];
  let seq = existingStamps.length + 1;

  for (let y = Math.round(height * 0.05); y < Math.round(height * 0.95); y += 3) {
    for (let x = Math.round(width * 0.05); x < Math.round(width * 0.95); x += 3) {
      const idx = y * width + x;
      if (visited[idx] || gray[idx] >= threshold) continue;

      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail += 1;
      visited[idx] = 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let darkCount = 0;
      let overflow = false;

      while (head < tail) {
        const px = qx[head];
        const py = qy[head];
        head += 1;
        darkCount += 1;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        if (maxX - minX > maxDim || maxY - minY > maxDim || tail >= qx.length - 8) {
          overflow = true;
          break;
        }

        const neighbors: Array<[number, number]> = [
          [px - 2, py],
          [px + 2, py],
          [px, py - 2],
          [px, py + 2],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
          const nIdx = ny * width + nx;
          if (!visited[nIdx] && gray[nIdx] < threshold) {
            visited[nIdx] = 1;
            qx[tail] = nx;
            qy[tail] = ny;
            tail += 1;
          }
        }
      }

      if (overflow) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < minDim || bh < minDim) continue;

      const aspect = bw / bh;
      if (aspect < 0.7 || aspect > 2.6) continue;

      // Avoid duplicating colored stamps already detected at same region
      const overlapsColored = existingStamps.some(
        (s) =>
          s.bbox &&
          Math.abs(s.bbox.x - minX) < bw * 0.6 &&
          Math.abs(s.bbox.y - minY) < bh * 0.6
      );
      if (overlapsColored) continue;

      // Check annular ring vs solid rectangular outline
      const cx = minX + bw / 2;
      const cy = minY + bh / 2;
      const rx = bw / 2;
      const ry = bh / 2;
      let ringSamples = 0;
      let ringDark = 0;
      let centerDark = 0;
      let centerSamples = 0;

      for (let yy = minY; yy <= maxY; yy += 2) {
        for (let xx = minX; xx <= maxX; xx += 2) {
          const rNorm = Math.sqrt(
            Math.pow((xx - cx) / Math.max(1, rx), 2) +
              Math.pow((yy - cy) / Math.max(1, ry), 2)
          );
          const isDark = gray[yy * width + xx] < threshold;
          if (rNorm >= 0.72 && rNorm <= 1.05) {
            ringSamples += 1;
            if (isDark) ringDark += 1;
          } else if (rNorm < 0.45) {
            centerSamples += 1;
            if (isDark) centerDark += 1;
          }
        }
      }

      const ringRatio = ringSamples > 0 ? ringDark / ringSamples : 0;
      const centerRatio = centerSamples > 0 ? centerDark / centerSamples : 0;
      const areaFill = (darkCount * 4) / (bw * bh);

      const isCircularSeal =
        aspect >= 0.78 && aspect <= 1.25 && ringRatio >= 0.36 && centerRatio < 0.42;
      const isRectangularStamp =
        !isCircularSeal &&
        areaFill >= 0.06 &&
        areaFill <= 0.38 &&
        /\b(approved|certified|registrar|hod|dean|official|stamp|received|department)\b/i.test(
          ocrText
        );

      if (!isCircularSeal && !isRectangularStamp) continue;

      const insideWords = (wordBoxes ?? [])
        .filter((w) => {
          const wx = (w.x0 + w.x1) / 2;
          const wy = (w.y0 + w.y1) / 2;
          return wx >= minX && wx <= maxX && wy >= minY && wy <= maxY;
        })
        .map((w) => w.text)
        .join(' ')
        .trim();

      found.push({
        id: `p${pageNumber}-stamp-mono-${seq++}`,
        pageNumber,
        shape: isCircularSeal ? 'circular' : 'rectangular',
        colorTone: 'monochrome',
        extractedText: insideWords || undefined,
        confidence: Number(Math.min(0.86, 0.55 + ringRatio * 0.35).toFixed(2)),
        uncertain: true,
        bbox: { x: minX, y: minY, width: bw, height: bh },
        note: 'Monochrome seal/stamp outline detected visually; requires human review (no legal authenticity claim).',
      });
    }
  }

  return found;
}

function detectSignaturesFromVisualAndAnchors(
  gray: Uint8Array,
  width: number,
  height: number,
  pageNumber: number,
  ocrText: string,
  wordBoxes?: OcrWordBox[]
): SignatureDetection[] {
  const detections: SignatureDetection[] = [];
  const threshold = estimateThreshold(gray);

  // Locate explicit signature anchor keywords via wordBoxes or OCR text
  const anchorWords = (wordBoxes ?? []).filter((w) =>
    /^(signature|signed|sign|hod|dean|examiner|registrar|lecturer|invigilator)[:.]?$/i.test(
      w.text.trim()
    )
  );

  // Inspect region around or above each signature anchor for cursive/ink stroke density
  for (let i = 0; i < anchorWords.length; i += 1) {
    const aw = anchorWords[i];
    const searchX0 = Math.max(0, aw.x0 - 40);
    const searchX1 = Math.min(width - 1, aw.x1 + Math.round(width * 0.28));
    const searchY0 = Math.max(0, aw.y0 - Math.round(height * 0.07));
    const searchY1 = Math.min(height - 1, aw.y1 + Math.round(height * 0.04));

    let darkPx = 0;
    let totalPx = 0;
    let activeCols = 0;

    for (let x = searchX0; x <= searchX1; x += 2) {
      let colDark = 0;
      for (let y = searchY0; y <= searchY1; y += 2) {
        totalPx += 1;
        if (gray[y * width + x] < threshold) {
          darkPx += 1;
          colDark += 1;
        }
      }
      if (colDark > 0) activeCols += 1;
    }

    const density = totalPx > 0 ? darkPx / totalPx : 0;
    const spanFraction =
      searchX1 > searchX0 ? (activeCols * 2) / (searchX1 - searchX0) : 0;

    const status: SignatureDetection['status'] =
      density >= 0.035 && spanFraction >= 0.25
        ? 'present'
        : density >= 0.015
        ? 'uncertain'
        : 'absent';

    detections.push({
      id: `p${pageNumber}-sig-anchor-${i + 1}`,
      pageNumber,
      status,
      confidence:
        status === 'present' ? 0.8 : status === 'uncertain' ? 0.52 : 0.78,
      bbox: {
        x: searchX0,
        y: searchY0,
        width: searchX1 - searchX0 + 1,
        height: searchY1 - searchY0 + 1,
      },
      anchorLabel: aw.text,
      note: 'Visual signature presence check only — never performs biometric verification.',
    });
  }

  // Fallback: scan bottom 25% of raster pages for isolated sweeping cursive signature clusters
  if (detections.length === 0 && width >= 160 && height >= 160 && gray.length >= width * height) {
    const startY = Math.round(height * 0.72);
    const endY = Math.round(height * 0.94);
    const bandH = Math.max(24, Math.round(height * 0.075));

    let bestBand: { y0: number; x0: number; x1: number; y1: number; score: number } | null = null;
    for (let y0 = startY; y0 + bandH <= endY; y0 += Math.round(bandH * 0.5)) {
      let minX = width;
      let maxX = 0;
      let dark = 0;
      const area = width * bandH;
      for (let y = y0; y < y0 + bandH; y += 2) {
        for (let x = Math.round(width * 0.08); x < Math.round(width * 0.92); x += 2) {
          if (gray[y * width + x] < threshold) {
            dark += 4;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      const spanW = maxX - minX + 1;
      const aspect = spanW / bandH;
      const fill = spanW > 0 ? dark / (spanW * bandH) : 0;

      // Ensure region is NOT covered by clean printed OCR words (high-confidence text)
      const overlappingHighConfWords = (wordBoxes ?? []).filter((w) => {
        const cy = (w.y0 + w.y1) / 2;
        return cy >= y0 && cy <= y0 + bandH && w.confidence >= 72;
      });

      if (
        spanW >= width * 0.12 &&
        spanW <= width * 0.48 &&
        aspect >= 2.2 &&
        fill >= 0.045 &&
        fill <= 0.3 &&
        dark < area * 0.25 &&
        overlappingHighConfWords.length === 0
      ) {
        const score = fill * aspect;
        if (!bestBand || score > bestBand.score) {
          bestBand = { y0, y1: y0 + bandH, x0: minX, x1: maxX, score };
        }
      }
    }

    if (bestBand) {
      detections.push({
        id: `p${pageNumber}-sig-stroke-1`,
        pageNumber,
        status: 'present',
        confidence: 0.68,
        bbox: {
          x: bestBand.x0,
          y: bestBand.y0,
          width: bestBand.x1 - bestBand.x0 + 1,
          height: bestBand.y1 - bestBand.y0 + 1,
        },
        note: 'Non-prose sweeping stroke cluster detected in lower margin (signature presence indicator only; not biometric verification).',
      });
    } else if (/\b(signature|signed\s*by|examiner'?s\s+signature)\b/i.test(ocrText)) {
      detections.push({
        id: `p${pageNumber}-sig-cue-1`,
        pageNumber,
        status: 'uncertain',
        confidence: 0.45,
        anchorLabel: 'Signature cue text found',
        note: 'Signature label detected in text; ink mark presence could not be isolated confidently.',
      });
    }
  }

  return detections;
}

export function detectSignaturesAndStamps(input: SignatureStampInput): {
  signatures: SignatureDetection[];
  stamps: StampDetection[];
} {
  const coloredStamps = input.rgba
    ? detectColoredStampsFromRgba(
        input.rgba,
        input.width,
        input.height,
        input.pageNumber,
        input.wordBoxes
      )
    : [];

  const monoStamps = detectMonochromeStamps(
    input.gray,
    input.width,
    input.height,
    input.pageNumber,
    coloredStamps,
    input.ocrText,
    input.wordBoxes
  );

  const signatures = detectSignaturesFromVisualAndAnchors(
    input.gray,
    input.width,
    input.height,
    input.pageNumber,
    input.ocrText,
    input.wordBoxes
  );

  return {
    signatures,
    stamps: [...coloredStamps, ...monoStamps],
  };
}
