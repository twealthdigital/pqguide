import type { FormExtractionResult, FormFieldItem } from '../../core/types';
import type { OcrWordBox } from './ocrEngine';

export interface FormRecognitionInput {
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
  ocrText: string;
  wordBoxes?: OcrWordBox[];
}

interface DetectedMarkBox {
  kind: 'checkbox' | 'radio';
  x: number;
  y: number;
  w: number;
  h: number;
  interiorFillRatio: number;
  status: 'filled' | 'unfilled' | 'ambiguous';
  confidence: number;
}

function estimateThreshold(gray: Uint8Array): number {
  let sum = 0;
  const step = Math.max(1, Math.floor(gray.length / 6000));
  let count = 0;
  for (let i = 0; i < gray.length; i += step) {
    sum += gray[i];
    count += 1;
  }
  const mean = count > 0 ? sum / count : 220;
  return Math.max(95, Math.min(202, Math.round(mean * 0.78)));
}

function detectVisualCheckboxes(
  gray: Uint8Array,
  width: number,
  height: number
): DetectedMarkBox[] {
  if (width < 120 || height < 120 || gray.length < width * height) {
    return [];
  }

  const threshold = estimateThreshold(gray);
  const visited = new Uint8Array(width * height);
  const minSize = Math.max(9, Math.round(width * 0.009));
  const maxSize = Math.max(26, Math.round(width * 0.045));

  const qx = new Int32Array(2048);
  const qy = new Int32Array(2048);
  const boxes: DetectedMarkBox[] = [];

  for (let y = 3; y < height - 3; y += 2) {
    const rowOff = y * width;
    for (let x = 3; x < width - 3; x += 2) {
      const idx = rowOff + x;
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
      let aborted = false;

      while (head < tail) {
        const px = qx[head];
        const py = qy[head];
        head += 1;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        if (
          maxX - minX > maxSize * 1.4 ||
          maxY - minY > maxSize * 1.4 ||
          tail >= qx.length - 8
        ) {
          aborted = true;
          break;
        }

        const neighbors: Array<[number, number]> = [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
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

      if (aborted) continue;

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < minSize || bh < minSize || bw > maxSize || bh > maxSize) continue;

      const aspect = bw / bh;
      if (aspect < 0.72 || aspect > 1.38) continue;

      // Measure top/bottom/left/right frame edges vs corner presence (square vs circle)
      let edgeHits = 0;
      let edgeTotal = 0;
      for (let xx = minX; xx <= maxX; xx += 1) {
        edgeTotal += 2;
        if (gray[minY * width + xx] < threshold || gray[(minY + 1) * width + xx] < threshold) {
          edgeHits += 1;
        }
        if (gray[maxY * width + xx] < threshold || gray[(maxY - 1) * width + xx] < threshold) {
          edgeHits += 1;
        }
      }
      for (let yy = minY; yy <= maxY; yy += 1) {
        edgeTotal += 2;
        if (gray[yy * width + minX] < threshold || gray[yy * width + minX + 1] < threshold) {
          edgeHits += 1;
        }
        if (gray[yy * width + maxX] < threshold || gray[yy * width + maxX - 1] < threshold) {
          edgeHits += 1;
        }
      }

      const borderContinuity = edgeTotal > 0 ? edgeHits / edgeTotal : 0;

      // Corner density discriminates square checkboxes from round radio circles
      const cornerOffsets = [
        [minX + 1, minY + 1],
        [maxX - 1, minY + 1],
        [minX + 1, maxY - 1],
        [maxX - 1, maxY - 1],
      ];
      let cornersDark = 0;
      for (const [cx, cy] of cornerOffsets) {
        if (gray[cy * width + cx] < threshold) cornersDark += 1;
      }

      const isSquareBox = borderContinuity >= 0.58 && cornersDark >= 2;
      const isRadioCircle = borderContinuity >= 0.34 && borderContinuity < 0.62 && cornersDark <= 1;

      if (!isSquareBox && !isRadioCircle) continue;

      // Check inner 55% box fill for checkmark / cross / shaded fill
      const padX = Math.max(2, Math.round(bw * 0.22));
      const padY = Math.max(2, Math.round(bh * 0.22));
      let innerTotal = 0;
      let innerDark = 0;
      for (let yy = minY + padY; yy <= maxY - padY; yy += 1) {
        for (let xx = minX + padX; xx <= maxX - padX; xx += 1) {
          innerTotal += 1;
          if (gray[yy * width + xx] < threshold) innerDark += 1;
        }
      }

      const interiorFillRatio = innerTotal > 0 ? innerDark / innerTotal : 0;

      let status: DetectedMarkBox['status'] = 'unfilled';
      let confidence = 0.85;
      if (interiorFillRatio >= 0.22) {
        status = 'filled';
        confidence = Math.min(0.95, 0.72 + interiorFillRatio * 0.25);
      } else if (interiorFillRatio >= 0.11) {
        status = 'ambiguous';
        confidence = 0.52;
      } else {
        status = 'unfilled';
        confidence = 0.88;
      }

      boxes.push({
        kind: isSquareBox ? 'checkbox' : 'radio',
        x: minX,
        y: minY,
        w: bw,
        h: bh,
        interiorFillRatio: Number(interiorFillRatio.toFixed(3)),
        status,
        confidence: Number(confidence.toFixed(2)),
      });
    }
  }

  return boxes;
}

function findLabelNearBox(
  box: DetectedMarkBox,
  wordBoxes: OcrWordBox[] | undefined
): string {
  if (!wordBoxes || wordBoxes.length === 0) return 'Unlabeled form mark';
  const lineCenterY = box.y + box.h / 2;
  const sameLineWords = wordBoxes
    .filter((w) => {
      const wy = (w.y0 + w.y1) / 2;
      return (
        Math.abs(wy - lineCenterY) <= Math.max(box.h * 1.15, 18) &&
        w.x0 >= box.x + box.w - 4 &&
        w.x0 <= box.x + box.w + 260
      );
    })
    .sort((a, b) => a.x0 - b.x0)
    .slice(0, 7);

  if (sameLineWords.length > 0) {
    return sameLineWords
      .map((w) => w.text)
      .join(' ')
      .replace(/^[^A-Za-z0-9]+/, '')
      .trim() || 'Form selection';
  }

  // Fallback: check label immediately to the left of the box
  const leftWords = wordBoxes
    .filter((w) => {
      const wy = (w.y0 + w.y1) / 2;
      return (
        Math.abs(wy - lineCenterY) <= Math.max(box.h * 1.15, 18) &&
        w.x1 <= box.x + 4 &&
        w.x1 >= box.x - 240
      );
    })
    .sort((a, b) => a.x0 - b.x0)
    .slice(-5);

  if (leftWords.length > 0) {
    return leftWords.map((w) => w.text).join(' ').trim();
  }

  return 'Unlabeled form mark';
}

function extractTextFormLines(
  ocrText: string,
  pageNumber: number
): FormFieldItem[] {
  const fields: FormFieldItem[] = [];
  const lines = ocrText.split(/\r?\n/);

  let seq = 1;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;

    // Text-encoded checkboxes: [x] Label, [ ] Label, ☑ Label, ☐ Label, (x) Option
    const checkboxMatch = line.match(
      /^(\[\s*([xX✓✔]?)\s*\]|\(\s*([xX✓✔]?)\s*\)|([☑☒✓✔☐]))\s+(.{2,90})$/
    );
    if (checkboxMatch) {
      const symbol = checkboxMatch[2] || checkboxMatch[3] || checkboxMatch[4] || '';
      const label = checkboxMatch[5].trim();
      const isChecked = /[xX✓✔☑☒]/.test(symbol);
      const kind = line.startsWith('(') ? 'radio' : 'checkbox';
      fields.push({
        id: `p${pageNumber}-txt-chk-${seq++}`,
        pageNumber,
        kind,
        label,
        checked: isChecked,
        status: isChecked ? 'filled' : 'unfilled',
        entrySource: 'mark',
        confidence: 0.88,
        uncertain: false,
      });
      continue;
    }

    // Standard academic/form fill-in lines: "Student Name: ________", "Matric No.: CSC/2021/014"
    const kvMatch = line.match(
      /^(Name|Student Name|Full Name|Candidate Name|Matric(?:\s*No\.?|ulation\s*Number)?|Reg(?:istration)?\s*No\.?|Department|Faculty|Course\s*Code|Course\s*Title|Level|Session|Semester|Date|Signature|Supervisor|Examiner|Email|Phone)\s*:\s*(.*)$/i
    );
    if (kvMatch) {
      const label = kvMatch[1].trim();
      const rawValue = kvMatch[2].trim();
      const cleanedValue = rawValue.replace(/[_\.\-]{3,}/g, '').trim();
      const isBlank =
        cleanedValue.length === 0 || /^[_\.\-\s]+$/.test(rawValue);

      fields.push({
        id: `p${pageNumber}-txt-fld-${seq++}`,
        pageNumber,
        kind: 'text_field',
        label,
        value: isBlank ? '' : cleanedValue,
        status: isBlank ? 'unfilled' : 'filled',
        entrySource: isBlank ? 'unknown' : 'printed',
        confidence: isBlank ? 0.9 : 0.84,
        uncertain: false,
      });
    }
  }

  return fields;
}

export function recognizeFormFields(
  input: FormRecognitionInput
): FormExtractionResult {
  const { gray, width, height, pageNumber, ocrText, wordBoxes } = input;
  const visualBoxes = detectVisualCheckboxes(gray, width, height);
  const textFields = extractTextFormLines(ocrText, pageNumber);

  const fields: FormFieldItem[] = [];
  const seenLabels = new Set<string>();

  for (const tf of textFields) {
    const key = `${tf.kind}:${tf.label.toLowerCase()}`;
    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      fields.push(tf);
    }
  }

  let visualIdx = 1;
  for (const box of visualBoxes) {
    const label = findLabelNearBox(box, wordBoxes);
    const normKey = `${box.kind}:${label.toLowerCase()}`;
    if (label !== 'Unlabeled form mark' && seenLabels.has(normKey)) {
      // Visual status takes precedence for checkbox fill accuracy when matched
      const existing = fields.find(
        (f) => f.kind === box.kind && f.label.toLowerCase() === label.toLowerCase()
      );
      if (existing) {
        existing.checked = box.status === 'filled';
        existing.status = box.status;
        existing.bbox = { x: box.x, y: box.y, width: box.w, height: box.h };
        existing.uncertain = box.status === 'ambiguous';
      }
      continue;
    }

    fields.push({
      id: `p${pageNumber}-vis-mark-${visualIdx++}`,
      pageNumber,
      kind: box.kind,
      label,
      checked: box.status === 'filled',
      status: box.status,
      entrySource: 'mark',
      confidence: box.confidence,
      uncertain: box.status === 'ambiguous' || label === 'Unlabeled form mark',
      bbox: { x: box.x, y: box.y, width: box.w, height: box.h },
    });
  }

  const filledCount = fields.filter((f) => f.status === 'filled').length;
  const unfilledCount = fields.filter((f) => f.status === 'unfilled').length;
  const ambiguousCount = fields.filter((f) => f.status === 'ambiguous').length;
  const isIncompleteForm =
    fields.length > 0 && unfilledCount > 0 && fields.some((f) => f.kind === 'text_field' && f.status === 'unfilled');

  const warnings: string[] = [];
  if (ambiguousCount > 0) {
    warnings.push(
      `Page ${pageNumber}: ${ambiguousCount} checkbox/form field(s) have ambiguous marks.`
    );
  }
  if (isIncompleteForm) {
    warnings.push(
      `Page ${pageNumber}: Incomplete form detected (${unfilledCount} unfilled field(s)).`
    );
  }

  return {
    detected: fields.length > 0,
    fields,
    totalFields: fields.length,
    filledCount,
    unfilledCount,
    ambiguousCount,
    isIncompleteForm,
    warnings,
  };
}
