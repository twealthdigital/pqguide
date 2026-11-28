# Real-document OCR fixtures

Drop **real** photographed or scanned pages here, each with a hand-verified transcription:

    exam_page_01.jpg      <- the real image (png, jpg, jpeg or webp)
    exam_page_01.txt      <- the exact text printed on it, typed and checked by a person

`npm test` runs every pair through the scanner (local OCR only, Vision off) and prints the
measured Character Error Rate (CER) and Word Error Rate (WER). Nothing is asserted about
accuracy for these files, because the numbers depend on your documents; read the report.

Guidance for useful fixtures: low-resolution phone photos, skewed or curved pages, uneven
lighting and shadows, two-column papers, tables, and maths. Do not commit documents that
contain personal data.
