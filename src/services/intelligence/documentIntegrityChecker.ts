import type {
  AcademicDocFormat,
  DocumentIntegrityReport,
  ExtractedPageContent,
} from '../../core/types';

export interface IntegrityCheckInput {
  pages: ExtractedPageContent[];
  detectedFormat: AcademicDocFormat;
}

function build3Shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const set = new Set<string>();
  for (let i = 0; i + 2 < words.length; i += 1) {
    set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return set;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function extractPrintedPageMarker(text: string): {
  printedNumber: number | null;
  totalExpected: number | null;
  rawMarker?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { printedNumber: null, totalExpected: null };

  // Inspect first 3 and last 4 lines for printed page numbers. Headers are read top-down and the
  // footer bottom-up, so the line nearest the page edge wins over a stray "Page N" mention in
  // repeated body or header text.
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const edgeLines = [...lines.slice(0, 3), ...lines.slice(-4).reverse()];

  for (const line of edgeLines) {
    const pageOfMatch = line.match(
      /\bpage\s+(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})\b/i
    );
    if (pageOfMatch) {
      return {
        printedNumber: Number(pageOfMatch[1]),
        totalExpected: Number(pageOfMatch[2]),
        rawMarker: pageOfMatch[0],
      };
    }

    const pageMatch = line.match(/^(?:page|p\.?|pg\.?)\s*[-:]?\s*(\d{1,3})$/i);
    if (pageMatch) {
      return {
        printedNumber: Number(pageMatch[1]),
        totalExpected: null,
        rawMarker: pageMatch[0],
      };
    }

    const dashedPageMatch = line.match(/^[-–—]\s*(\d{1,3})\s*[-–—]$/);
    if (dashedPageMatch) {
      return {
        printedNumber: Number(dashedPageMatch[1]),
        totalExpected: null,
        rawMarker: dashedPageMatch[0],
      };
    }
  }

  return { printedNumber: null, totalExpected: null };
}

export function inspectDocumentIntegrity(
  input: IntegrityCheckInput
): DocumentIntegrityReport {
  const { pages } = input;
  const warnings: string[] = [];

  // 1. Duplicate / repeated page detection via 3-word shingle Jaccard
  const duplicatePagePairs: Array<{
    pageA: number;
    pageB: number;
    similarity: number;
  }> = [];
  const shingles = pages.map((p) => build3Shingles(p.text));

  for (let i = 0; i < pages.length; i += 1) {
    if (shingles[i].size < 5) continue;
    for (let j = i + 1; j < pages.length; j += 1) {
      if (shingles[j].size < 5) continue;
      const sim = jaccardSimilarity(shingles[i], shingles[j]);
      if (sim >= 0.85) {
        duplicatePagePairs.push({
          pageA: pages[i].pageNumber,
          pageB: pages[j].pageNumber,
          similarity: Number(sim.toFixed(2)),
        });
      }
    }
  }

  if (duplicatePagePairs.length > 0) {
    warnings.push(
      `Repeated/duplicate page content detected (${duplicatePagePairs
        .map((d) => `p.${d.pageA}≈p.${d.pageB} (${Math.round(d.similarity * 100)}%)`)
        .join(', ')}).`
    );
  }

  // 2. Printed page numbering, missing pages, out-of-order, inconsistent numbering
  const printedPageNumbers: DocumentIntegrityReport['printedPageNumbers'] = [];
  const expectedTotals = new Set<number>();

  for (const p of pages) {
    const marker = extractPrintedPageMarker(p.text);
    printedPageNumbers.push({
      pageIndex: p.pageNumber,
      printedNumber: marker.printedNumber,
      rawMarker: marker.rawMarker,
    });
    if (marker.totalExpected && marker.totalExpected > 0 && marker.totalExpected < 500) {
      expectedTotals.add(marker.totalExpected);
    }
  }

  const numbered = printedPageNumbers.filter((x) => x.printedNumber !== null);
  let outOfOrderDetected = false;
  for (let i = 1; i < numbered.length; i += 1) {
    if (numbered[i].printedNumber! < numbered[i - 1].printedNumber!) {
      outOfOrderDetected = true;
      break;
    }
  }

  if (outOfOrderDetected) {
    warnings.push(
      'Printed page markers appear out of sequence; original file order was preserved for admin review.'
    );
  }

  const missingPageNumbers: number[] = [];
  if (numbered.length >= 2) {
    const nums = numbered.map((n) => n.printedNumber!);
    const minP = Math.min(1, ...nums);
    const maxExpected = Math.max(
      ...nums,
      ...(expectedTotals.size > 0 ? Array.from(expectedTotals) : [0])
    );
    const presentSet = new Set(nums);
    for (let n = minP; n <= maxExpected; n += 1) {
      if (!presentSet.has(n)) {
        missingPageNumbers.push(n);
      }
    }
  } else if (expectedTotals.size === 1) {
    const [expectedMax] = Array.from(expectedTotals);
    const presentSet = new Set(numbered.map((n) => n.printedNumber!));
    for (let n = 1; n <= expectedMax; n += 1) {
      if (!presentSet.has(n)) missingPageNumbers.push(n);
    }
  }

  if (missingPageNumbers.length > 0) {
    warnings.push(
      `Possible missing printed page number(s): ${missingPageNumbers.join(', ')}.`
    );
  }

  const inconsistentNumberingDetected =
    expectedTotals.size > 1 ||
    (numbered.length >= 2 && numbered.length < pages.length && pages.length >= 3);
  if (inconsistentNumberingDetected) {
    warnings.push(
      'Inconsistent or partial printed page numbering detected across pages.'
    );
  }

  // 3. Blank, cropped/incomplete, damaged/corrupted pages
  const blankPages: number[] = [];
  const incompleteOrCroppedPages: number[] = [];
  const damagedOrCorruptedPages: number[] = [];

  for (const p of pages) {
    const qm = p.qualityMetrics;
    const isBlank =
      p.text.trim().length < 12 &&
      p.diagrams.length === 0 &&
      p.tables.length === 0 &&
      (qm?.blankRatio ?? 0.99) >= 0.96;

    if (isBlank) {
      blankPages.push(p.pageNumber);
    }
    if (p.isIncomplete || qm?.hasCroppedEdgeText || qm?.isIncompleteCapture) {
      incompleteOrCroppedPages.push(p.pageNumber);
    }
    if (
      p.processingStatus === 'failed' ||
      qm?.isTornOrDamaged ||
      (qm?.unreadableRegionsCount ?? 0) >= 3
    ) {
      damagedOrCorruptedPages.push(p.pageNumber);
    }
  }

  if (blankPages.length > 0) {
    warnings.push(`Blank or near-empty page(s) detected: ${blankPages.join(', ')}.`);
  }
  if (incompleteOrCroppedPages.length > 0) {
    warnings.push(
      `Incomplete or edge-cropped page(s): ${incompleteOrCroppedPages.join(', ')}.`
    );
  }
  if (damagedOrCorruptedPages.length > 0) {
    warnings.push(
      `Damaged, torn, or failed page(s): ${damagedOrCorruptedPages.join(', ')}.`
    );
  }

  const isComplete =
    missingPageNumbers.length === 0 &&
    !outOfOrderDetected &&
    incompleteOrCroppedPages.length === 0 &&
    damagedOrCorruptedPages.length === 0;

  return {
    isComplete,
    hasDuplicatePages: duplicatePagePairs.length > 0,
    duplicatePagePairs,
    missingPageNumbers,
    outOfOrderDetected,
    inconsistentNumberingDetected,
    printedPageNumbers,
    blankPages,
    incompleteOrCroppedPages,
    damagedOrCorruptedPages,
    warnings,
  };
}
