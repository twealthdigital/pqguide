/**
 * Real OCR Accuracy Measurement Utilities (Levenshtein CER & WER).
 * Computes genuine character error rate and word error rate against ground-truth
 * reference text without synthetic inflation or mocked OCR results.
 */

export interface OcrAccuracyMetrics {
  cer: number; // Character Error Rate (0.0 = exact match, lower is better)
  wer: number; // Word Error Rate (0.0 = exact match, lower is better)
  charEditDistance: number;
  refCharCount: number;
  wordEditDistance: number;
  refWordCount: number;
}

function levenshteinDistance<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Int32Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    const cur = new Int32Array(n + 1);
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j += 1) {
      const cost = ai === b[j - 1] ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    prev = cur;
  }

  return prev[n];
}

export function normalizeOcrComparisonText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeCerAndWer(
  referenceText: string,
  hypothesisText: string,
  options?: { caseSensitive?: boolean }
): OcrAccuracyMetrics {
  const normRef = normalizeOcrComparisonText(referenceText);
  const normHyp = normalizeOcrComparisonText(hypothesisText);
  const ref = options?.caseSensitive ? normRef : normRef.toLowerCase();
  const hyp = options?.caseSensitive ? normHyp : normHyp.toLowerCase();

  const refChars = Array.from(ref);
  const hypChars = Array.from(hyp);
  const charEditDistance = levenshteinDistance(refChars, hypChars);
  const refCharCount = refChars.length;
  const cer = refCharCount > 0 ? charEditDistance / refCharCount : hypChars.length > 0 ? 1 : 0;

  const refWords = ref ? ref.split(/\s+/).filter(Boolean) : [];
  const hypWords = hyp ? hyp.split(/\s+/).filter(Boolean) : [];
  const wordEditDistance = levenshteinDistance(refWords, hypWords);
  const refWordCount = refWords.length;
  const wer = refWordCount > 0 ? wordEditDistance / refWordCount : hypWords.length > 0 ? 1 : 0;

  return {
    cer: Number(cer.toFixed(4)),
    wer: Number(wer.toFixed(4)),
    charEditDistance,
    refCharCount,
    wordEditDistance,
    refWordCount,
  };
}
