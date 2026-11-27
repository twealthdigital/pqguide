import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface AiServiceDeps {
  env?: Record<string, string | undefined>;
}

export type AcademicAiMode =
  | 'find_archive'
  | 'exam_prep'
  | 'generate_practice'
  | 'explain_answer'
  | 'step_solution'
  | 'math_diagram';

export interface GroundedPastQuestionSummary {
  id: string;
  schoolCode: string;
  courseCode: string;
  courseTitle: string;
  level: string;
  session: string;
  semester: string;
  questions: string[];
}

export interface GroundedMaterialSummary {
  id: string;
  courseCode: string;
  title: string;
  summary: string;
  headings: string[];
}

export interface GroundedStudentDocSummary {
  id: string;
  title: string;
  courseCode: string;
  summary: string;
  headings: string[];
  formulas: Array<{ latex: string; displayMode: boolean }>;
  tablesCount: number;
  diagramsCount: number;
  excerpt: string;
}

export interface GroundedAcademicContextPayload {
  activeSchoolCode: string;
  pastQuestions: GroundedPastQuestionSummary[];
  materials: GroundedMaterialSummary[];
  studentDocuments: GroundedStudentDocSummary[];
  performanceSummary?: {
    totalAttempts: number;
    averageScore: number | null;
    weakCourses: string[];
  };
}

export interface StructuredAiBlock {
  type: 'paragraph' | 'math' | 'steps' | 'table' | 'chart' | 'diagram' | 'practice_question';
  title?: string;
  text?: string;
  latex?: string;
  displayMode?: boolean;
  steps?: string[];
  headers?: string[];
  rows?: string[][];
  chartKind?: 'bar' | 'line';
  chartSeries?: Array<{ label: string; value: number }>;
  diagramPreset?: 'free_body_incline' | 'cell_mitosis' | 'ohm_circuit' | 'binary_tree';
  diagramCaption?: string;
  question?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

export interface StructuredAiCitation {
  kind: 'past_question' | 'study_material' | 'student_document' | 'performance';
  id: string;
  label: string;
}

export interface StructuredAiStudyResponse {
  headline: string;
  summary: string;
  groundedInArchive: boolean;
  providerUsed: 'gemini' | 'deterministic_grounded';
  modelUsed?: string;
  blocks: StructuredAiBlock[];
  citations: StructuredAiCitation[];
  suggestedFollowUp?: string;
}

const GEMINI_MODEL = 'gemini-4-hydrogen';

const STOP_WORDS = new Set([
  'me',
  'my',
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'give',
  'show',
  'find',
  'past',
  'question',
  'questions',
  'answer',
  'answers',
  'material',
  'materials',
  'note',
  'notes',
  'study',
  'help',
  'explain',
  'solve',
  'step',
]);

function scoreRelevance(queryTerms: string[], text: string): number {
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2)
  );
  let score = 0;
  for (const term of queryTerms) {
    if (tokens.has(term)) score += 1;
  }
  return score;
}

function buildDeterministicStudyResponse(params: {
  prompt: string;
  mode: AcademicAiMode;
  context: GroundedAcademicContextPayload;
  providerReason?: string;
}): StructuredAiStudyResponse {
  const rawPrompt = params.prompt.trim();
  const terms = rawPrompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  const explicitCourseMatch = rawPrompt.match(/\b([a-z]{3})\s?(\d{3})\b/i);
  const explicitCourseNorm = explicitCourseMatch
    ? `${explicitCourseMatch[1].toUpperCase()} ${explicitCourseMatch[2]}`
    : null;
  const matchesCourseFilter = (code: string) =>
    !explicitCourseNorm || code.trim().toUpperCase().replace(/\s+/g, ' ') === explicitCourseNorm;

  const matchedPqs = params.context.pastQuestions
    .filter((pq) => matchesCourseFilter(pq.courseCode))
    .map((pq) => ({
      pq,
      score: scoreRelevance(
        terms,
        `${pq.courseCode} ${pq.courseTitle} ${pq.session} ${pq.semester} ${pq.questions.join(' ')}`
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.pq);

  const matchedMaterials = params.context.materials
    .filter((m) => matchesCourseFilter(m.courseCode))
    .map((m) => ({
      m,
      score: scoreRelevance(terms, `${m.courseCode} ${m.title} ${m.summary} ${m.headings.join(' ')}`),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.m);

  const matchedDocs = params.context.studentDocuments
    .filter((d) => matchesCourseFilter(d.courseCode))
    .map((d) => ({
      d,
      score: scoreRelevance(
        terms,
        `${d.courseCode} ${d.title} ${d.summary} ${d.headings.join(' ')} ${d.excerpt}`
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.d);

  const citations: StructuredAiCitation[] = [
    ...matchedPqs.map((pq) => ({
      kind: 'past_question' as const,
      id: pq.id,
      label: `${pq.courseCode} (${pq.session} · ${pq.schoolCode})`,
    })),
    ...matchedMaterials.map((m) => ({
      kind: 'study_material' as const,
      id: m.id,
      label: `${m.courseCode} Guide: ${m.title}`,
    })),
    ...matchedDocs.map((d) => ({
      kind: 'student_document' as const,
      id: d.id,
      label: `Library Doc: ${d.title}`,
    })),
  ];

  const blocks: StructuredAiBlock[] = [];
  const lower = rawPrompt.toLowerCase();

  // Check if query asks for physics / biology / math formulas or diagrams
  if (lower.includes('incline') || lower.includes('newton') || lower.includes('friction') || lower.includes('force')) {
    blocks.push({
      type: 'diagram',
      title: 'Free-Body Diagram on an Inclined Plane',
      diagramPreset: 'free_body_incline',
      diagramCaption: 'Weight component mg sin(theta) pulls parallel to slope; normal reaction N = mg cos(theta).',
    });
    blocks.push({
      type: 'math',
      title: 'Resultant Acceleration Formula',
      latex: 'a = g(\\sin\\theta - \\mu\\cos\\theta)',
      displayMode: true,
    });
  } else if (lower.includes('ohm') || lower.includes('circuit') || lower.includes('resistor') || lower.includes('current')) {
    blocks.push({
      type: 'diagram',
      title: 'Series DC Circuit Schematic',
      diagramPreset: 'ohm_circuit',
      diagramCaption: 'Voltage source V driving current I across load resistor R.',
    });
    blocks.push({
      type: 'math',
      title: "Ohm's Law & Power Dissipation",
      latex: 'V = I R, \\quad P = I^2 R = \\frac{V^2}{R}',
      displayMode: true,
    });
  } else if (lower.includes('cell') || lower.includes('mitosis') || lower.includes('biology')) {
    blocks.push({
      type: 'diagram',
      title: 'Eukaryotic Cell & Mitosis Schematic',
      diagramPreset: 'cell_mitosis',
      diagramCaption: 'Schematic showing nucleus, membrane, and dividing chromatids.',
    });
  } else if (lower.includes('quadratic') || /\bx\^2\b/.test(lower)) {
    blocks.push({
      type: 'math',
      title: 'Quadratic Formula',
      latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      displayMode: true,
    });
    blocks.push({
      type: 'steps',
      title: 'Step-by-Step Solution Workflow',
      steps: [
        'Write the equation in standard form ax^2 + bx + c = 0.',
        'Compute the discriminant D = b^2 - 4ac to determine root type.',
        'Substitute a, b, and sqrt(D) into the quadratic formula and simplify both roots.',
      ],
    });
  }

  if (matchedPqs.length > 0) {
    blocks.push({
      type: 'table',
      title: `Matching ${params.context.activeSchoolCode} Past Question Papers Found`,
      headers: ['Course', 'Session', 'Level', 'Indexed Questions'],
      rows: matchedPqs.map((pq) => [
        `${pq.courseCode} — ${pq.courseTitle}`,
        pq.session,
        pq.level,
        String(pq.questions.length),
      ]),
    });

    if (params.mode === 'generate_practice' || params.mode === 'exam_prep') {
      const samplePq = matchedPqs[0];
      if (samplePq.questions[0]) {
        blocks.push({
          type: 'practice_question',
          title: `Grounded Practice Prompt (${samplePq.courseCode})`,
          question: samplePq.questions[0],
          answer: `Review ${samplePq.courseCode} (${samplePq.session}) worked breakdown inside the Past Questions reader.`,
          explanation: `Sourced directly from your available ${samplePq.schoolCode} archive paper ${samplePq.courseCode} (${samplePq.session}).`,
        });
      }
    }
  } else if (
    params.mode === 'find_archive' ||
    /\b[a-z]{3}\s?\d{3}\b/i.test(rawPrompt)
  ) {
    const mentionedCourse = rawPrompt.match(/\b([a-z]{3})\s?(\d{3})\b/i);
    const label = mentionedCourse
      ? `${mentionedCourse[1].toUpperCase()} ${mentionedCourse[2]}`
      : 'that exact topic';
    blocks.push({
      type: 'paragraph',
      title: 'No Unverified Past Paper Matches Found',
      text: `No published past question paper in the current ${params.context.activeSchoolCode} archive matches ${label}. PQGuide does not invent unavailable exam papers; try searching available courses (${params.context.pastQuestions
        .slice(0, 5)
        .map((p) => p.courseCode)
        .join(', ')}) or upload your material via Scan Docs.`,
    });
  }

  if (matchedDocs.length > 0) {
    for (const d of matchedDocs) {
      if (d.formulas.length > 0) {
        blocks.push({
          type: 'math',
          title: `Formula extracted from ${d.title}`,
          latex: d.formulas[0].latex,
          displayMode: true,
        });
      }
      blocks.push({
        type: 'paragraph',
        title: `From Student Document Library: ${d.title}`,
        text: `${d.summary} (${d.tablesCount} table(s), ${d.diagramsCount} diagram(s) indexed).`,
      });
    }
  }

  if (params.context.performanceSummary && params.context.performanceSummary.totalAttempts > 0) {
    const perf = params.context.performanceSummary;
    blocks.push({
      type: 'paragraph',
      title: 'Study Focus Based on Your Mock Exam Progress',
      text: `You have completed ${perf.totalAttempts} exam attempt(s) with an average score of ${
        perf.averageScore ?? 0
      }%.${
        perf.weakCourses.length > 0
          ? ` Prioritize revision in: ${perf.weakCourses.join(', ')}.`
          : ' Maintain your current accuracy with timed 15-question drills.'
      }`,
    });
    citations.push({
      kind: 'performance',
      id: 'perf-summary',
      label: `Performance History (${perf.totalAttempts} attempts)`,
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      type: 'paragraph',
      title: 'Grounded Archive Overview',
      text:
        params.providerReason ??
        `Found ${params.context.pastQuestions.length} published past question paper(s), ${params.context.materials.length} study guide(s), and ${params.context.studentDocuments.length} verified student library document(s) for ${params.context.activeSchoolCode}. Ask about a specific course code, formula, or uploaded document to inspect detailed breakdowns.`,
    });
  }

  return {
    headline:
      matchedPqs.length > 0 || matchedDocs.length > 0 || matchedMaterials.length > 0
        ? `Study Answer Grounded in ${params.context.activeSchoolCode} Records`
        : 'PQGuide Academic Intelligence Summary',
    summary:
      citations.length > 0
        ? `Matched ${citations.length} verified platform source(s) for "${rawPrompt.slice(0, 80)}".`
        : `Checked ${params.context.pastQuestions.length} past papers and ${params.context.studentDocuments.length} library documents.`,
    groundedInArchive: citations.length > 0,
    providerUsed: 'deterministic_grounded',
    blocks,
    citations,
    suggestedFollowUp:
      matchedPqs[0]
        ? `Generate 3 timed practice questions from ${matchedPqs[0].courseCode}`
        : 'Explain quadratic equations step by step with LaTeX formula',
  };
}

export function createAiEngine(deps?: AiServiceDeps) {
  const env = deps?.env ?? process.env;

  function getStatus(): {
    status: number;
    body: {
      ok: boolean;
      aiConfigured: boolean;
      model: string;
    };
  } {
    const configured = Boolean(env.GEMINI_API_KEY?.trim());
    return {
      status: 200,
      body: {
        ok: true,
        aiConfigured: configured,
        model: GEMINI_MODEL,
      },
    };
  }

  async function runStudyQuery(params: { body: unknown }): Promise<{
    status: number;
    body: { ok: boolean; error?: string; response?: StructuredAiStudyResponse };
  }> {
    if (!params.body || typeof params.body !== 'object') {
      return { status: 400, body: { ok: false, error: 'Request payload is required.' } };
    }

    const rec = params.body as Record<string, unknown>;
    const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim().slice(0, 1500) : '';
    const mode = (typeof rec.mode === 'string' ? rec.mode : 'find_archive') as AcademicAiMode;
    const rawContext = (rec.groundedContext ?? rec.context) as
      | Partial<GroundedAcademicContextPayload>
      | undefined;

    if (!prompt) {
      return { status: 400, body: { ok: false, error: 'Please enter a study question or topic.' } };
    }

    const context: GroundedAcademicContextPayload = {
      activeSchoolCode:
        typeof rawContext?.activeSchoolCode === 'string'
          ? rawContext.activeSchoolCode.slice(0, 20)
          : 'AAUA',
      pastQuestions: Array.isArray(rawContext?.pastQuestions)
        ? rawContext.pastQuestions.slice(0, 25)
        : [],
      materials: Array.isArray(rawContext?.materials) ? rawContext.materials.slice(0, 20) : [],
      studentDocuments: Array.isArray(rawContext?.studentDocuments)
        ? rawContext.studentDocuments.slice(0, 20)
        : [],
      performanceSummary: rawContext?.performanceSummary,
    };

    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return {
        status: 200,
        body: {
          ok: true,
          response: buildDeterministicStudyResponse({ prompt, mode, context }),
        },
      };
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const systemPrompt = [
        'You are PQGuide Academic AI — a structured university study tutor.',
        'CRITICAL GROUNDING RULES:',
        '1. Only cite past questions, study guides, or uploaded student documents explicitly provided in the JSON context below.',
        '2. NEVER invent or fabricate nonexistent past-question papers, fake exam dates, or citations that are not in context. If asked for a course not in the archive, state clearly that no matching archive paper exists.',
        '3. You MAY solve general university mathematics, physics, chemistry, biology, and CS concepts cleanly using valid LaTeX formulas, step-by-step derivations, tables, charts, or schematic diagram presets (free_body_incline | cell_mitosis | ohm_circuit | binary_tree).',
        '4. Output strictly structured JSON matching the schema. Never output HTML or script tags.',
        '',
        `Mode: ${mode}`,
        `Active University: ${context.activeSchoolCode}`,
        `Available Context JSON: ${JSON.stringify(context).slice(0, 28_000)}`,
        `Student Request: ${prompt}`,
      ].join('\n');

      const aiRes = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: systemPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              summary: { type: Type.STRING },
              groundedInArchive: { type: Type.BOOLEAN },
              suggestedFollowUp: { type: Type.STRING },
              blocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: {
                      type: Type.STRING,
                      enum: [
                        'paragraph',
                        'math',
                        'steps',
                        'table',
                        'chart',
                        'diagram',
                        'practice_question',
                      ],
                    },
                    title: { type: Type.STRING },
                    text: { type: Type.STRING },
                    latex: { type: Type.STRING },
                    displayMode: { type: Type.BOOLEAN },
                    steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                    headers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    rows: {
                      type: Type.ARRAY,
                      items: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    chartKind: { type: Type.STRING, enum: ['bar', 'line'] },
                    chartSeries: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          label: { type: Type.STRING },
                          value: { type: Type.NUMBER },
                        },
                        required: ['label', 'value'],
                      },
                    },
                    diagramPreset: {
                      type: Type.STRING,
                      enum: ['free_body_incline', 'cell_mitosis', 'ohm_circuit', 'binary_tree'],
                    },
                    diagramCaption: { type: Type.STRING },
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answer: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                  },
                  required: ['type'],
                },
              },
              citations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    kind: {
                      type: Type.STRING,
                      enum: ['past_question', 'study_material', 'student_document', 'performance'],
                    },
                    id: { type: Type.STRING },
                    label: { type: Type.STRING },
                  },
                  required: ['kind', 'id', 'label'],
                },
              },
            },
            required: ['headline', 'summary', 'groundedInArchive', 'blocks', 'citations'],
          },
        },
      });

      const parsed = JSON.parse(aiRes.text || '{}') as Partial<StructuredAiStudyResponse>;
      if (!parsed.headline || !Array.isArray(parsed.blocks)) {
        return {
          status: 200,
          body: {
            ok: true,
            response: buildDeterministicStudyResponse({ prompt, mode, context }),
          },
        };
      }

      // Filter citations strictly to actual IDs in provided context to block hallucinated IDs
      const validIds = new Set<string>([
        ...context.pastQuestions.map((p) => p.id),
        ...context.materials.map((m) => m.id),
        ...context.studentDocuments.map((d) => d.id),
        'perf-summary',
      ]);
      const verifiedCitations = (parsed.citations ?? []).filter(
        (c) => c && typeof c.id === 'string' && validIds.has(c.id)
      );

      return {
        status: 200,
        body: {
          ok: true,
          response: {
            headline: parsed.headline.slice(0, 160),
            summary: (parsed.summary ?? '').slice(0, 320),
            groundedInArchive: Boolean(parsed.groundedInArchive && verifiedCitations.length > 0),
            providerUsed: 'gemini',
            modelUsed: GEMINI_MODEL,
            blocks: parsed.blocks.slice(0, 12),
            citations: verifiedCitations.slice(0, 8),
            suggestedFollowUp: parsed.suggestedFollowUp?.slice(0, 140),
          },
        },
      };
    } catch {
      return {
        status: 200,
        body: {
          ok: true,
          response: buildDeterministicStudyResponse({ prompt, mode, context }),
        },
      };
    }
  }

  return {
    getStatus,
    runStudyQuery,
  };
}

export const defaultAiEngine = createAiEngine();
