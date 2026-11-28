import type { LanguageAnalysisResult } from '../../core/types';

export interface InstalledLanguageRegistry {
  installedCodes: string[];
}

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  fra: 'French',
  spa: 'Spanish',
  deu: 'German',
  por: 'Portuguese',
  yor: 'Yoruba',
  ibo: 'Igbo',
  hau: 'Hausa',
  ara: 'Arabic',
  ell: 'Greek',
  rus: 'Russian / Cyrillic',
};

const KNOWN_LOCAL_TESSDATA_PACKAGES: Array<{ code: string; pkg: string; file: string }> = [
  { code: 'eng', pkg: '@tesseract.js-data/eng', file: 'eng.traineddata.gz' },
  { code: 'yor', pkg: '@tesseract.js-data/yor', file: 'yor.traineddata.gz' },
];

let cachedNodeInstalledLangs: string[] | null = null;

/**
 * Normalizes decomposed Unicode combining diacritics (common after OCR splitting sub-dots
 * or tone marks across Nigerian Yoruba/Igbo orthography) into clean NFC characters.
 */
export function normalizeNigerianDiacriticsNfc(text: string): string {
  if (!text) return text;
  // Remove accidental whitespace OCR inserts before combining dot-below / tonal marks
  const collapsedSpaces = text.replace(/([A-Za-z])\s+([\u0300-\u036F\u0323])/g, '$1$2');
  return collapsedSpaces.normalize('NFC');
}

/**
 * Warms installed local traineddata detection asynchronously in Node without bundling `node:fs` into Vite client.
 */
export async function refreshInstalledOcrLanguagesNode(): Promise<string[]> {
  if (
    typeof process === 'undefined' ||
    typeof process.versions?.node !== 'string' ||
    typeof window !== 'undefined'
  ) {
    return getInstalledOcrLanguages();
  }
  try {
    const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    const [fsMod, pathMod, moduleMod] = await Promise.all([
      dynImport('node:fs'),
      dynImport('node:path'),
      dynImport('node:module'),
    ]);
    const fs = fsMod as typeof import('node:fs');
    const path = pathMod as typeof import('node:path');
    const { createRequire } = moduleMod as typeof import('node:module');
    const req = createRequire(path.resolve(process.cwd(), 'package.json'));
    const found = new Set<string>(['eng']);
    for (const entry of KNOWN_LOCAL_TESSDATA_PACKAGES) {
      try {
        const pkgDir = path.dirname(req.resolve(`${entry.pkg}/package.json`));
        if (
          fs.existsSync(path.join(pkgDir, '4.0.0_best_int', entry.file)) ||
          fs.existsSync(path.join(pkgDir, '4.0.0', entry.file))
        ) {
          found.add(entry.code);
        }
      } catch {
        const fallbackDir = path.resolve(process.cwd(), 'node_modules', entry.pkg);
        if (
          fs.existsSync(path.join(fallbackDir, '4.0.0_best_int', entry.file)) ||
          fs.existsSync(path.join(fallbackDir, '4.0.0', entry.file))
        ) {
          found.add(entry.code);
        }
      }
    }
    cachedNodeInstalledLangs = Array.from(found);
  } catch {
    // Keep default
  }
  return getInstalledOcrLanguages();
}

/**
 * Detects locally installed Tesseract traineddata packages (`eng` + `@tesseract.js-data/yor` bundled),
 * or honors `OCR_INSTALLED_LANGUAGES` override. Always keeps English (`eng`) first as default.
 */
export function getInstalledOcrLanguages(): string[] {
  if (typeof process !== 'undefined' && process.env?.OCR_INSTALLED_LANGUAGES) {
    const parsed = process.env.OCR_INSTALLED_LANGUAGES.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length > 0) {
      const unique = Array.from(new Set(parsed));
      if (!unique.includes('eng')) unique.unshift('eng');
      return unique;
    }
  }
  if (cachedNodeInstalledLangs) return cachedNodeInstalledLangs;
  // `@tesseract.js-data/eng` and `@tesseract.js-data/yor` are installed project dependencies
  return ['eng', 'yor'];
}

/**
 * Resolves the active Tesseract language string for OCR (`eng` default, or `eng+yor` when Yoruba cues exist).
 */
export function selectTesseractLanguageParam(
  hintText?: string,
  installedOcrModels: string[] = getInstalledOcrLanguages()
): string {
  if (!hintText || hintText.trim().length < 4) return 'eng';
  const normalized = normalizeNigerianDiacriticsNfc(hintText);
  const yorubaHits =
    (normalized.match(/[ẹọṣńǹẸỌṢŃǸ]/g) || []).length +
    (normalized.match(/\b(yorùbá|ìbéèrè|ìdáhùn|àpẹẹrẹ|ẹ̀kọ́|ọ̀rọ̀)\b/gi) || []).length;
  if (yorubaHits >= 2 && installedOcrModels.includes('yor')) {
    return 'eng+yor';
  }
  return 'eng';
}

export function analyzeDocumentLanguages(
  text: string,
  installedOcrModels: string[] = getInstalledOcrLanguages()
): LanguageAnalysisResult {
  const sample = normalizeNigerianDiacriticsNfc(text || '');
  const detected: LanguageAnalysisResult['detectedLanguages'] = [];
  const warnings: string[] = [];

  const nonAsciiArabic = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const nonAsciiCyrillic = (sample.match(/[\u0400-\u04FF]/g) || []).length;
  // Exclude common isolated math symbols when estimating prose Greek script
  const nonMathGreek = (sample.match(/[\u0370-\u037D\u0386-\u03CE]/g) || []).length;

  const yorubaDiacritics =
    (sample.match(/[ẹọṣńǹẸỌṢŃǸ]/g) || []).length +
    (sample.match(/\b(yorùbá|ìbéèrè|ìdáhùn|àpẹẹrẹ|ẹ̀kọ́|ọ̀rọ̀|àwọn|nínú)\b/gi) || []).length;
  const igboDiacritics =
    (sample.match(/[ịụṅỊỤṄ]/g) || []).length +
    (sample.match(/\b(ajụjụ|azịza|kọwaa|mahadum|akwụkwọ|ọnụọgụgụ)\b/gi) || []).length;
  const hausaMarkers =
    (sample.match(/[ɓɗƙƴƁƊƘƳ]/g) || []).length * 2 +
    (sample.match(/\b(tambaya|tambayoyi|amsa|rubuta|bayyana|jami['’]?ar|karatu|lokaci)\b/gi) || []).length;

  const frenchMarkers =
    (sample.match(/[àâçéèêëîïôùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŸŒÆ]/g) || []).length +
    (sample.match(/\b(les|des|une|pour|avec|dans|est|sont|exercice|question)\b/gi) || []).length;
  const spanishMarkers =
    (sample.match(/[ñáíóúü¿¡ÑÁÍÓÚÜ]/g) || []).length +
    (sample.match(/\b(los|las|para|con|una|preguntas|examen|sobre)\b/gi) || []).length;
  const germanMarkers =
    (sample.match(/[äöüßÄÖÜ]/g) || []).length +
    (sample.match(/\b(der|die|das|und|mit|aufgabe|prüfung|für)\b/gi) || []).length;
  const portugueseMarkers =
    (sample.match(/[ãõçáéíóúâêôÃÕÇ]/g) || []).length +
    (sample.match(/\b(para|com|uma|questão|exame|não)\b/gi) || []).length;

  const englishStopwords = (
    sample.match(
      /\b(the|and|of|to|in|is|for|with|question|answer|explain|calculate|university|department|course)\b/gi
    ) || []
  ).length;

  const totalTokens = Math.max(1, sample.split(/\s+/).filter(Boolean).length);

  if (englishStopwords >= 2 || detected.length === 0) {
    const conf = Math.min(0.98, 0.55 + englishStopwords / Math.max(8, totalTokens));
    detected.push({
      code: 'eng',
      name: LANGUAGE_NAMES.eng,
      confidence: Number(conf.toFixed(2)),
      script: 'Latin',
      installedInOcrEngine: installedOcrModels.includes('eng'),
    });
  }

  const candidates: Array<{
    code: string;
    hits: number;
    minHits: number;
    script: string;
  }> = [
    { code: 'fra', hits: frenchMarkers, minHits: 4, script: 'Latin + French diacritics' },
    { code: 'spa', hits: spanishMarkers, minHits: 4, script: 'Latin + Spanish diacritics' },
    { code: 'deu', hits: germanMarkers, minHits: 4, script: 'Latin + German umlauts' },
    { code: 'por', hits: portugueseMarkers, minHits: 4, script: 'Latin + Portuguese diacritics' },
    { code: 'yor', hits: yorubaDiacritics, minHits: 2, script: 'Latin + Yoruba subdots/tones' },
    { code: 'ibo', hits: igboDiacritics, minHits: 2, script: 'Latin + Igbo subdots' },
    { code: 'hau', hits: hausaMarkers, minHits: 2, script: 'Latin + Hausa hooked letters' },
    { code: 'ara', hits: nonAsciiArabic, minHits: 6, script: 'Arabic' },
    { code: 'rus', hits: nonAsciiCyrillic, minHits: 6, script: 'Cyrillic' },
    { code: 'ell', hits: nonMathGreek, minHits: 6, script: 'Greek' },
  ];

  for (const c of candidates) {
    if (c.hits >= c.minHits) {
      const conf = Math.min(0.95, 0.5 + c.hits / Math.max(12, totalTokens * 0.35));
      detected.push({
        code: c.code,
        name: LANGUAGE_NAMES[c.code] || c.code,
        confidence: Number(conf.toFixed(2)),
        script: c.script,
        installedInOcrEngine: installedOcrModels.includes(c.code),
      });
    }
  }

  detected.sort((a, b) => b.confidence - a.confidence);

  // Keep English as primary when English confidence is competitive, unless non-English dominates
  const engItem = detected.find((d) => d.code === 'eng');
  const topItem = detected[0];
  const primary =
    engItem && topItem && topItem.code !== 'eng' && engItem.confidence >= topItem.confidence - 0.1
      ? 'English'
      : topItem?.name ?? 'English';

  const unsupportedLanguages = detected
    .filter((d) => !d.installedInOcrEngine)
    .map((d) => `${d.name} (${d.code})`);

  if (unsupportedLanguages.length > 0) {
    const nigerianWithoutTess = detected.filter(
      (d) => !d.installedInOcrEngine && (d.code === 'hau' || d.code === 'ibo')
    );
    if (nigerianWithoutTess.length > 0) {
      warnings.push(
        `Detected ${nigerianWithoutTess.map((d) => `${d.name} (${d.code})`).join(', ')}: upstream Tesseract lacks official ${nigerianWithoutTess.map((d) => d.code).join('/')} traineddata; route to Surya OCR or Vision OCR for full diacritic fidelity.`
      );
    }
    const otherUnsupported = unsupportedLanguages.filter(
      (lbl) => !lbl.includes('(hau)') && !lbl.includes('(ibo)')
    );
    if (otherUnsupported.length > 0) {
      warnings.push(
        `Detected language(s) without locally installed Tesseract traineddata: ${otherUnsupported.join(', ')}. Configure OCR_INSTALLED_LANGUAGES or route via Surya/Vision OCR.`
      );
    }
  }

  return {
    primaryLanguage: primary,
    detectedLanguages: detected,
    installedOcrModels,
    unsupportedLanguages,
    preservesDiacritics: true,
    warnings,
  };
}
