import type { ExtractedFormula, MathExpressionKind } from '../../core/types';
import type { OcrWordBox } from './ocrEngine';

export interface MathOcrAdapter {
  name: string;
  recognizeFormulaRegion(input: {
    gray?: Uint8Array;
    width?: number;
    height?: number;
    rawText?: string;
  }): Promise<{ latex: string; confidence: number; uncertain?: boolean }>;
}

export interface MathExtractionInput {
  text: string;
  pageNumber: number;
  wordBoxes?: OcrWordBox[];
  adapter?: MathOcrAdapter;
}

const GREEK_TO_LATEX: Array<[RegExp, string]> = [
  [/α/g, '\\alpha'],
  [/β/g, '\\beta'],
  [/γ/g, '\\gamma'],
  [/δ/g, '\\delta'],
  [/Δ/g, '\\Delta'],
  [/ε/g, '\\epsilon'],
  [/θ/g, '\\theta'],
  [/Θ/g, '\\Theta'],
  [/λ/g, '\\lambda'],
  [/Λ/g, '\\Lambda'],
  [/μ/g, '\\mu'],
  [/π/g, '\\pi'],
  [/Π/g, '\\Pi'],
  [/ρ/g, '\\rho'],
  [/σ/g, '\\sigma'],
  [/Σ/g, '\\Sigma'],
  [/τ/g, '\\tau'],
  [/φ/g, '\\phi'],
  [/Φ/g, '\\Phi'],
  [/ω/g, '\\omega'],
  [/Ω/g, '\\Omega'],
  [/≤/g, '\\leq'],
  [/≥/g, '\\geq'],
  [/≠/g, '\\neq'],
  [/≈/g, '\\approx'],
  [/±/g, '\\pm'],
  [/×/g, '\\times'],
  [/÷/g, '\\div'],
  [/∞/g, '\\infty'],
  [/∂/g, '\\partial'],
  [/∇/g, '\\nabla'],
  [/∑/g, '\\sum'],
  [/∫/g, '\\int'],
  [/√\(([^)]+)\)/g, '\\sqrt{$1}'],
  [/√([A-Za-z0-9]+)/g, '\\sqrt{$1}'],
];

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  'ⁿ': 'n',
  '⁺': '+',
  '⁻': '-',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  'ᵢ': 'i',
  'ₙ': 'n',
};

function replaceUnicodeSupSub(input: string): string {
  let out = input.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁺⁻]+/g, (m) => {
    const mapped = m
      .split('')
      .map((c) => SUPERSCRIPT_MAP[c] || c)
      .join('');
    return `^{${mapped}}`;
  });
  out = out.replace(/[₀₁₂₃₄₅₆₇₈₉ᵢₙ]+/g, (m) => {
    const mapped = m
      .split('')
      .map((c) => SUBSCRIPT_MAP[c] || c)
      .join('');
    return `_{${mapped}}`;
  });
  return out;
}

export function classifyMathKind(raw: string, latex: string): MathExpressionKind {
  if (/\\begin\{[bp]?matrix\}|\[\[.+?\]\]/i.test(latex) || /\[\[.+,.+\]\]/.test(raw)) {
    return 'matrix';
  }
  if (/\\int|\\sum|∑|∫|\\lim/i.test(latex) || /[∑∫]/.test(raw)) {
    return 'integral_summation';
  }
  if (/\\sqrt|√/.test(latex) || /√|\bsqrt\(/i.test(raw)) {
    return 'radical';
  }
  if (/\\frac\s*\{/i.test(latex) || /\([^()]+\)\s*\/\s*\([^()]+\)|\b\d+\/\d+\b/.test(raw)) {
    return 'fraction';
  }
  if (/(\\times\s*10\^|\b\d+(?:\.\d+)?\s*[x×*]\s*10\^|\b\d+(?:\.\d+)?e[+-]?\d+\b)/i.test(raw)) {
    return 'scientific_notation';
  }
  if (/\^\{|\^[A-Za-z0-9(]|⁰|¹|²|³/.test(latex) || /[⁰¹²³⁴⁵⁶⁷⁸⁹]|\^[0-9A-Za-z]/.test(raw)) {
    return 'power_superscript';
  }
  if (/_\{|_[A-Za-z0-9]|[₀₁₂₃₄₅₆₇₈₉]/.test(latex) || /[₀₁₂₃₄₅₆₇₈₉]/.test(raw)) {
    return 'subscript';
  }
  if (/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|rho|sigma|tau|phi|omega|Delta|Sigma|Omega)/i.test(latex) || /[αβγδΔθλμπρστφωΩ]/i.test(raw)) {
    return 'greek_notation';
  }
  if (/[A-Za-z]\s*[=<>≤≥≠]/.test(raw) || /[+-/*]\s*[A-Za-z]/.test(raw)) {
    return 'algebraic';
  }
  return 'general_equation';
}

export function convertRawEquationToLatex(raw: string): string {
  let expr = raw.trim();
  expr = replaceUnicodeSupSub(expr);

  // Nested or bracketed matrix syntax [[a, b], [c, d]]
  const matrixMatch = expr.match(/\[\s*(\[[^\]]+\](?:\s*,\s*\[[^\]]+\])+)\s*\]/);
  if (matrixMatch) {
    const rowStrings = matrixMatch[1]
      .split(/\]\s*,\s*\[/)
      .map((r) => r.replace(/^\[|\]$/g, '').split(',').map((c) => c.trim()).join(' & '));
    const latexMat = `\\begin{bmatrix} ${rowStrings.join(' \\\\ ')} \\end{bmatrix}`;
    expr = expr.replace(matrixMatch[0], latexMat);
  }

  // Scientific notation: 6.02 x 10^23 -> 6.02 \times 10^{23}
  expr = expr.replace(
    /(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*10\^\{?([+-]?\d+)\}?/gi,
    '$1 \\times 10^{$2}'
  );

  // Explicit parenthesized / numeric fractions -> \frac{a}{b}
  expr = expr.replace(
    /\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g,
    '\\frac{$1}{$2}'
  );
  expr = expr.replace(
    /(?<![A-Za-z0-9_\\])\b([A-Za-z0-9]+)\s*\/\s*([A-Za-z0-9]+)\b(?![./])/g,
    (full, num: string, den: string) => {
      // Avoid rewriting dates like 2024/2025 or course codes CSC/101
      if (num.length >= 3 && den.length >= 3 && (/^[A-Z]+$/.test(num) || /^\d{4}$/.test(num))) {
        return full;
      }
      return `\\frac{${num}}{${den}}`;
    }
  );

  // sqrt(...) -> \sqrt{...}
  expr = expr.replace(/\bsqrt\s*\(([^)]+)\)/gi, '\\sqrt{$1}');

  // Caret exponents x^2 or x^(n+1) -> x^{2} / x^{n+1}
  expr = expr.replace(/\^\(([^)]+)\)/g, '^{$1}');
  expr = expr.replace(/\^([A-Za-z0-9+-]+)/g, '^{$1}');

  // Greek and operator substitutions
  for (const [pattern, replacement] of GREEK_TO_LATEX) {
    expr = expr.replace(pattern, replacement);
  }

  return expr.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Reconstructs 2D spatial mathematical layout (superscripts, subscripts, and stacked fractions)
 * directly from OCR word bounding boxes so x^2 or stacked a/b is not blindly flattened.
 */
function extract2DMathFromWordBoxes(
  wordBoxes: OcrWordBox[],
  pageNumber: number
): ExtractedFormula[] {
  if (!wordBoxes || wordBoxes.length < 3) return [];

  // Group words into horizontal bands
  const sorted = [...wordBoxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const bands: OcrWordBox[][] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const band = bands.find((b) => {
      const avgY = b.reduce((s, item) => s + (item.y0 + item.y1) / 2, 0) / b.length;
      const avgH = b.reduce((s, item) => s + Math.max(8, item.y1 - item.y0), 0) / b.length;
      return Math.abs(cy - avgY) <= avgH * 0.95;
    });
    if (band) band.push(w);
    else bands.push([w]);
  }

  // A raised exponent or lowered subscript sorts before the rest of its line (smaller y0) and can
  // sit outside that line's vertical tolerance, so it ends up as a band of its own and is never
  // seen as a script. Re-attach small single-token bands to the line they overlap and touch.
  for (let bi = bands.length - 1; bi >= 0; bi -= 1) {
    if (bands[bi].length !== 1) continue;
    const token = bands[bi][0];
    const tokenH = token.y1 - token.y0;
    let bestIndex = -1;
    let bestGap = Infinity;

    for (let oi = 0; oi < bands.length; oi += 1) {
      const other = bands[oi];
      if (oi === bi || other.length < 2) continue;
      const heights = other.map((o) => o.y1 - o.y0).sort((a, b) => a - b);
      const lineH = heights[Math.floor(heights.length / 2)] || 16;
      if (tokenH > lineH * 0.82) continue;

      const lineTop = Math.min(...other.map((o) => o.y0));
      const lineBottom = Math.max(...other.map((o) => o.y1));
      const verticalOverlap = Math.min(lineBottom, token.y1) - Math.max(lineTop, token.y0);
      if (verticalOverlap < tokenH * 0.2) continue;

      const horizontalGap = Math.min(
        ...other.map((o) => Math.max(o.x0 - token.x1, token.x0 - o.x1, 0))
      );
      if (horizontalGap > lineH * 0.8) continue;

      if (horizontalGap < bestGap) {
        bestGap = horizontalGap;
        bestIndex = oi;
      }
    }

    if (bestIndex >= 0) {
      bands[bestIndex].push(token);
      bands.splice(bi, 1);
    }
  }

  const formulas: ExtractedFormula[] = [];
  let seq = 1;

  // 1. Check pairs of vertically adjacent short bands for stacked fractions (numerator above denominator)
  for (let i = 0; i + 1 < bands.length; i += 1) {
    const topBand = bands[i].sort((a, b) => a.x0 - b.x0);
    const botBand = bands[i + 1].sort((a, b) => a.x0 - b.x0);
    if (topBand.length > 4 || botBand.length > 4) continue;

    const topX0 = topBand[0].x0;
    const topX1 = topBand[topBand.length - 1].x1;
    const botX0 = botBand[0].x0;
    const botX1 = botBand[botBand.length - 1].x1;

    const overlapX = Math.max(0, Math.min(topX1, botX1) - Math.max(topX0, botX0));
    const minWidth = Math.max(8, Math.min(topX1 - topX0, botX1 - botX0));
    const topBottomY = Math.max(...topBand.map((w) => w.y1));
    const botTopY = Math.min(...botBand.map((w) => w.y0));
    const vertGap = botTopY - topBottomY;
    const avgH = Math.max(10, topBand[0].y1 - topBand[0].y0);

    const topStr = topBand.map((w) => w.text).join(' ').trim();
    const botStr = botBand.map((w) => w.text).join(' ').trim();

    if (
      overlapX / minWidth >= 0.45 &&
      vertGap >= 1 &&
      vertGap <= avgH * 1.3 &&
      topStr.length <= 24 &&
      botStr.length <= 24 &&
      /[A-Za-z0-9]/.test(topStr) &&
      /[A-Za-z0-9]/.test(botStr) &&
      (/^[A-Za-z0-9+\-*/()]+$/.test(topStr.replace(/\s+/g, '')) ||
        /^[A-Za-z0-9+\-*/()]+$/.test(botStr.replace(/\s+/g, '')))
    ) {
      const meanConf =
        [...topBand, ...botBand].reduce((s, w) => s + w.confidence, 0) /
        (topBand.length + botBand.length);
      formulas.push({
        id: `p${pageNumber}-2d-frac-${seq++}`,
        pageNumber,
        rawText: `(${topStr}) / (${botStr})`,
        latex: `\\frac{${topStr}}{${botStr}}`,
        displayMode: true,
        kind: 'fraction',
        uncertain: meanConf < 68,
        uncertaintyReason:
          meanConf < 68
            ? `Low OCR confidence (${Math.round(meanConf)}%) on stacked fraction components.`
            : undefined,
        sourceMethod: '2d_layout_ocr',
        confidence: Number((meanConf / 100).toFixed(2)),
        bbox: {
          x: Math.min(topX0, botX0),
          y: Math.min(...topBand.map((w) => w.y0)),
          width: Math.max(topX1, botX1) - Math.min(topX0, botX0),
          height: Math.max(...botBand.map((w) => w.y1)) - Math.min(...topBand.map((w) => w.y0)),
        },
      });
    }
  }

  // 2. Check intra-band superscript / subscript shifts
  for (const band of bands) {
    if (band.length < 2) continue;
    const ordered = [...band].sort((a, b) => a.x0 - b.x0);
    const hasMathSignals = ordered.some((w) => /[=+\-*/^∑∫√α-ωΑ-Ω]/.test(w.text));
    if (!hasMathSignals) continue;

    const heights = ordered.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] || 16;
    const medianMidY =
      ordered.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / ordered.length;

    let built = '';
    let detectedScript = false;
    let lowestConf = 100;

    for (let i = 0; i < ordered.length; i += 1) {
      const w = ordered[i];
      if (w.confidence < lowestConf) lowestConf = w.confidence;
      const wh = w.y1 - w.y0;
      const midY = (w.y0 + w.y1) / 2;

      if (
        i > 0 &&
        wh <= medianH * 0.82 &&
        midY < medianMidY - medianH * 0.22 &&
        /^[A-Za-z0-9+\-()]+$/.test(w.text)
      ) {
        built += `^{${w.text}}`;
        detectedScript = true;
      } else if (
        i > 0 &&
        wh <= medianH * 0.82 &&
        midY > medianMidY + medianH * 0.22 &&
        /^[A-Za-z0-9ijkmn+-]+$/.test(w.text)
      ) {
        built += `_{${w.text}}`;
        detectedScript = true;
      } else {
        built += (built && !built.endsWith('}') ? ' ' : ' ') + w.text;
      }
    }

    if (detectedScript) {
      const cleaned = built.trim();
      const latex = convertRawEquationToLatex(cleaned);
      const minX = Math.min(...ordered.map((w) => w.x0));
      const minY = Math.min(...ordered.map((w) => w.y0));
      const maxX = Math.max(...ordered.map((w) => w.x1));
      const maxY = Math.max(...ordered.map((w) => w.y1));
      formulas.push({
        id: `p${pageNumber}-2d-script-${seq++}`,
        pageNumber,
        rawText: cleaned,
        latex,
        displayMode: false,
        kind: classifyMathKind(cleaned, latex),
        uncertain: lowestConf < 68,
        uncertaintyReason:
          lowestConf < 68
            ? `Low OCR confidence (${Math.round(lowestConf)}%) on superscript/subscript token.`
            : undefined,
        sourceMethod: '2d_layout_ocr',
        confidence: Number((lowestConf / 100).toFixed(2)),
        bbox: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        },
      });
    }
  }

  return formulas;
}

export async function extractMathFormulasAdvanced(
  input: MathExtractionInput
): Promise<ExtractedFormula[]> {
  const { text, pageNumber, wordBoxes, adapter } = input;
  const results: ExtractedFormula[] = [];
  const seen = new Set<string>();

  // Pass A: 2D bounding-box spatial formulas
  if (wordBoxes && wordBoxes.length > 0) {
    const twoD = extract2DMathFromWordBoxes(wordBoxes, pageNumber);
    for (const f of twoD) {
      const key = f.latex.replace(/\s+/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        results.push(f);
      }
    }
  }

  // Pass B: Dedicated LaTeX / Equation / Symbolic text parser
  const lines = text.split(/\r?\n/);
  let seq = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 3) continue;
    // Skip ordinary non-equation headings/question stems unless they embed clear equations
    if (/^(table|figure|section|instructions?|department|university)\b/i.test(line)) {
      continue;
    }

    // Explicit LaTeX blocks ($...$ or $$...$$)
    const latexDelimMatches = line.match(/\$\$[^$]+\$\$|\$[^$]+\$/g);
    if (latexDelimMatches) {
      for (const m of latexDelimMatches) {
        const inner = m.replace(/^\$\$?|\$\$?$/g, '').trim();
        if (!inner) continue;
        const key = inner.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          id: `p${pageNumber}-tex-${seq++}`,
          pageNumber,
          rawText: m,
          latex: inner,
          displayMode: m.startsWith('$$'),
          kind: classifyMathKind(inner, inner),
          uncertain: false,
          sourceMethod: 'text_regex',
          confidence: 0.96,
        });
      }
      continue;
    }

    const hasMathOperator =
      /[=<>≤≥≠≈∑∫√∂∇±×÷∞α-ωΑ-Ω⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/.test(line) ||
      /\bsqrt\s*\(|\[\[.+,.+\]\]|\b10\^[+-]?\d+|\b[a-zA-Z]\^[0-9a-zA-Z({]/.test(line);

    if (!hasMathOperator) continue;

    // Avoid ordinary prose lines that happen to contain a hyphen or single '=' outside math
    const wordCount = line.split(/\s+/).length;
    const looksLikeProse =
      wordCount > 14 &&
      !/[∑∫√∂∇α-ωΑ-Ω⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]|\\frac|\^|\[\[/.test(line);
    if (looksLikeProse) continue;

    // Extract clean equation segment if line begins with "Q1. Solve:" or "(a) Find x if ..."
    const cleanExpr = line
      .replace(/^(?:\(?\d+[.)]?|\([a-z]\)|solve|evaluate|simplify|integrate|differentiate|find|prove\s+that)\s*[:\-]?\s*/i, '')
      .trim();

    if (cleanExpr.length < 3 || !/[0-9A-Za-zα-ωΑ-Ω]/.test(cleanExpr)) continue;

    let latex = convertRawEquationToLatex(cleanExpr);
    let sourceMethod: ExtractedFormula['sourceMethod'] = 'text_regex';
    let confidence = 0.85;
    let uncertain = false;
    let uncertaintyReason: string | undefined;

    if (adapter) {
      const adapted = await adapter.recognizeFormulaRegion({ rawText: cleanExpr });
      if (adapted.latex) {
        latex = adapted.latex;
        confidence = adapted.confidence;
        uncertain = Boolean(adapted.uncertain);
        sourceMethod = 'math_adapter';
      }
    } else {
      // Flag flattened/ambiguous OCR formulas (e.g., "x2 + y2 = r2" or ambiguous '?' / garbled tokens)
      if (/[?□]/.test(cleanExpr)) {
        uncertain = true;
        uncertaintyReason = 'Formula contains unrecognized/garbled symbol placeholders.';
        confidence = 0.52;
      } else if (
        /\b[a-zA-Z][23]\s*[+\-=]/.test(cleanExpr) &&
        !/[\^⁰¹²³]/.test(cleanExpr)
      ) {
        uncertain = true;
        uncertaintyReason =
          'Possible flattened exponent (e.g., "x2" instead of "x^2"); verify manually.';
        confidence = 0.64;
      }
    }

    const key = latex.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      id: `p${pageNumber}-math-${seq++}`,
      pageNumber,
      rawText: cleanExpr,
      latex,
      displayMode: wordCount <= 8 || /[∑∫\[\]=]/.test(cleanExpr),
      kind: classifyMathKind(cleanExpr, latex),
      uncertain,
      uncertaintyReason,
      sourceMethod,
      confidence: Number(confidence.toFixed(2)),
    });
  }

  return results;
}

/**
 * Formats mathematical sub-expressions inside prose/questions as inline KaTeX (`$...$`)
 * without altering course codes, years, or already delimited `$...$` / `$$...$$` spans.
 */
export function injectInlineLatexIntoText(line: string): string {
  if (!line || /\$[^$]+\$/.test(line)) return line;

  // Preserve whole-line standalone pure equations vs inline expressions
  const trimmed = line.trim();
  if (/^\[\[[^\]]+\]\]$/.test(trimmed)) {
    return `$${convertRawEquationToLatex(trimmed)}$`;
  }

  // Split around math-rich tokens/segments and wrap cleanly
  let out = line;

  // 1) Convert Unicode sup/sub tokens like x², H₂O, 10⁻³ or caret tokens like x^2, a^(n+1), H_2O
  out = out.replace(
    /\b([A-Za-z0-9()]+(?:\^(?:\{[^}]+\}|\([^)]+\)|[A-Za-z0-9+-]+)|_\{[^}]+\}|_[A-Za-z0-9]+|[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁺⁻₀₁₂₃₄₅₆₇₈₉ᵢₙ]+)+)(?=\s|$|[.,;?!:=+\-*/)])/g,
    (match) => `$${convertRawEquationToLatex(match)}$`
  );

  // 2) If a short inline equation exists outside $...$, e.g. "where F = ma and v = u + at" or "(a + b) / (c + d)"
  const segments = out.split(/(\$[^$\n]+?\$)/g);
  const rewritten = segments
    .map((seg, idx) => {
      if (idx % 2 === 1) return seg; // already inside $...$
      let s = seg;
      // sqrt(...) or √(...)
      s = s.replace(/\b(sqrt\s*\([^)]+\))/gi, (m) => `$${convertRawEquationToLatex(m)}$`);
      s = s.replace(/(√\([^)]+\)|√[A-Za-z0-9]+)/g, (m) => `$${convertRawEquationToLatex(m)}$`);
      // Explicit algebraic fraction (num)/(den)
      s = s.replace(/\(([^()]{1,32})\)\s*\/\s*\(([^()]{1,32})\)/g, (m) => `$${convertRawEquationToLatex(m)}$`);
      // Integrals / summations / Greek math symbols with adjacent variables
      s = s.replace(
        /([∑∫∂∇±×÷≤≥≠≈α-ωΑ-Ω](?:\s*[A-Za-z0-9_^{}()+\-*/=,.]+){0,4})/g,
        (m) => {
          const clean = m.trim();
          if (!clean) return m;
          const lead = m.startsWith(' ') ? ' ' : '';
          const trail = m.endsWith(' ') ? ' ' : '';
          return `${lead}$${convertRawEquationToLatex(clean)}$${trail}`;
        }
      );
      return s;
    })
    .join('');

  // Merge adjacent $a$ = $b$ or $a$ + $b$ when separated only by math operator so KaTeX renders one cohesive expression
  return rewritten.replace(/\$\s*([=+\-*/<>≤≥≠≈])\s*\$/g, ' $1 ');
}
