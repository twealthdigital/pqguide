import type { StudyMaterial } from '../core/types';

const PAGE = { width: 210, height: 297, margin: 18 };
const INK = [26, 27, 32] as const;
const BODY = [58, 61, 71] as const;
const MUTED = [104, 108, 120] as const;

/** jsPDF's built in fonts only cover Latin-1, so swap the common extras. */
const clean = (text: string): string =>
  text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\u0009\u000A\u0020-\u00FF\u2013\u2014\u2022]/g, '');

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const materialFileName = (material: StudyMaterial): string =>
  `${slug(material.courseCode)}-${slug(material.title)}.pdf`;

/**
 * Builds the guide as a PDF in the browser and saves it, so it can be read
 * offline. jsPDF is loaded only when someone taps download.
 */
export async function downloadMaterialPdf(material: StudyMaterial): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const contentWidth = PAGE.width - PAGE.margin * 2;
  const bottomLimit = PAGE.height - PAGE.margin - 6;
  let y = PAGE.margin;

  const color = (c: readonly [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = PAGE.margin;
    }
  };

  const writeLines = (
    text: string,
    opts: { size: number; lineHeight: number; style?: 'normal' | 'bold'; indent?: number; tone?: readonly [number, number, number] }
  ) => {
    const { size, lineHeight, style = 'normal', indent = 0, tone = BODY } = opts;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    color(tone);
    const lines = doc.splitTextToSize(clean(text), contentWidth - indent) as string[];
    lines.forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, PAGE.margin + indent, y);
      y += lineHeight;
    });
  };

  // Title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  color(MUTED);
  doc.text('PQGUIDE STUDY GUIDE', PAGE.margin, y);
  y += 8;

  writeLines(material.title, { size: 19, lineHeight: 8, style: 'bold', tone: INK });
  y += 1;
  writeLines(
    `${material.courseCode} (${material.level}): ${material.courseTitle}`,
    { size: 10.5, lineHeight: 5.5, tone: MUTED }
  );
  y += 2;

  doc.setDrawColor(220, 222, 228);
  doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
  y += 7;

  writeLines(material.summary, { size: 11, lineHeight: 6 });
  y += 5;

  // Sections
  material.sections.forEach((section, index) => {
    ensureSpace(22);
    writeLines(`${index + 1}. ${section.heading}`, {
      size: 13,
      lineHeight: 6.5,
      style: 'bold',
      tone: INK,
    });
    y += 1.5;

    section.paragraphs?.forEach((p) => {
      writeLines(p, { size: 10.5, lineHeight: 5.6 });
      y += 2;
    });

    section.points?.forEach((point) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      const lines = doc.splitTextToSize(clean(point), contentWidth - 7) as string[];
      ensureSpace(5.6);
      doc.setFillColor(INK[0], INK[1], INK[2]);
      doc.circle(PAGE.margin + 1.6, y - 1.3, 0.7, 'F');
      color(BODY);
      lines.forEach((line) => {
        ensureSpace(5.6);
        doc.text(line, PAGE.margin + 6, y);
        y += 5.6;
      });
      y += 1.4;
    });

    y += 5;
  });

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    color(MUTED);
    doc.text('PQGuide: free past questions and study guides', PAGE.margin, PAGE.height - 10);
    doc.text(`Page ${i} of ${pageCount}`, PAGE.width - PAGE.margin, PAGE.height - 10, {
      align: 'right',
    });
  }

  doc.save(materialFileName(material));
}
