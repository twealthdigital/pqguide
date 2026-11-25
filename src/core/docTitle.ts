/**
 * One consistent way to name a past question everywhere in the app.
 *
 * Older uploads were saved with titles like "CSC 101 Examination Paper", which
 * produced headings such as "CSC 101 — CSC 101 Examination Paper". These
 * helpers drop the repeated course code and the "Examination Paper" wording,
 * so a past question with no real title reads simply "CSC 101 Past Question".
 */

interface TitledDoc {
  courseCode: string;
  courseTitle: string;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GENERIC_ONLY = /^(?:(?:university\s+)?(?:examination|exam)\s+)?(?:past\s+questions?|papers?)$/i;
const GENERIC_SUFFIX =
  /\s*[-—–:]?\s*(?:(?:university\s+)?(?:examination|exam)\s+(?:past\s+questions?|papers?)|past\s+questions?|papers?)\s*$/i;

/** The real course title, or '' when there isn't one beyond the code / generic words. */
export const cleanCourseTitle = (doc: TitledDoc): string => {
  const code = (doc.courseCode || '').trim();
  let title = (doc.courseTitle || '').trim();

  if (code) {
    const codePattern = new RegExp(
      `^${escapeRegExp(code).replace(/\\?\s+/g, '\\s*')}(?:\\s*[-—–:]\\s*|\\s+|$)`,
      'i'
    );
    for (let i = 0; i < 3 && codePattern.test(title); i += 1) {
      title = title.replace(codePattern, '').trim();
    }
  }

  if (GENERIC_ONLY.test(title)) return '';
  title = title.replace(GENERIC_SUFFIX, '').trim();
  return GENERIC_ONLY.test(title) ? '' : title;
};

/** Text for under a course code: the real title, or "Past Question". */
export const courseSubtitle = (doc: TitledDoc): string =>
  cleanCourseTitle(doc) || 'Past Question';

/** Full heading: "GNS 101 — Use of English…" or "CSC 101 Past Question". */
export const courseHeading = (doc: TitledDoc): string => {
  const title = cleanCourseTitle(doc);
  const code = (doc.courseCode || '').trim();
  return title ? `${code} — ${title}` : `${code} Past Question`.trim();
};
