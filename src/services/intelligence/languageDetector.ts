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

/**
 * Returns locally configured/cached Tesseract language codes without performing
 * unexpected runtime network downloads. Defaults safely to ['eng'].
 */
export function getInstalledOcrLanguages(): string[] {
  if (typeof process !== 'undefined' && process.env?.OCR_INSTALLED_LANGUAGES) {
    const parsed = process.env.OCR_INSTALLED_LANGUAGES.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length > 0) return Array.from(new Set(parsed));
  }
  return ['eng'];
}

export function analyzeDocumentLanguages(
  text: string,
  installedOcrModels: string[] = getInstalledOcrLanguages()
): LanguageAnalysisResult {
  const sample = text || '';
  const detected: LanguageAnalysisResult['detectedLanguages'] = [];
  const warnings: string[] = [];

  const nonAsciiArabic = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const nonAsciiCyrillic = (sample.match(/[\u0400-\u04FF]/g) || []).length;
  // Exclude common isolated math symbols when estimating prose Greek script
  const nonMathGreek = (sample.match(/[\u0370-\u037D\u0386-\u03CE]/g) || []).length;

  const yorubaDiacritics = (sample.match(/[ẹọṣńǹẸỌṢŃǸ]/g) || []).length;
  const igboDiacritics = (sample.match(/[ịụṅỊỤṄ]/g) || []).length;
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

  // Sort detected languages by confidence descending
  detected.sort((a, b) => b.confidence - a.confidence);

  // If a non-English language clearly dominates by markers, make it primary
  const primary = detected[0]?.name ?? 'English';
  const unsupportedLanguages = detected
    .filter((d) => !d.installedInOcrEngine)
    .map((d) => `${d.name} (${d.code})`);

  if (unsupportedLanguages.length > 0) {
    warnings.push(
      `Detected language(s) without locally installed OCR traineddata: ${unsupportedLanguages.join(', ')}. Configure OCR_INSTALLED_LANGUAGES and local tessdata cache to support dedicated multi-language OCR.`
    );
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
