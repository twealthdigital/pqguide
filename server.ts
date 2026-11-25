import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

const MODEL = 'gemini-4-hydrogen';
const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseApiErrorMessage(rawMessage: string): string {
  try {
    const parsed = JSON.parse(rawMessage) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // plain text error
  }
  return rawMessage;
}

function sendAiError(res: Response, err: unknown, context: string) {
  const errObj = err as { status?: number; message?: string };
  const rawMessage = errObj?.message ?? String(err);
  const cleanMessage = parseApiErrorMessage(rawMessage);
  const rawStatus = typeof errObj?.status === 'number' ? errObj.status : 0;
  const status =
    rawStatus === 429 || rawMessage.includes('429') || rawMessage.includes('RESOURCE_EXHAUSTED')
      ? 429
      : rawStatus === 503 || rawMessage.includes('UNAVAILABLE')
        ? 503
        : rawStatus === 403 ||
            rawStatus === 400 ||
            rawMessage.includes('403') ||
            rawMessage.includes('PERMISSION_DENIED') ||
            rawMessage.includes('API_KEY_INVALID')
          ? rawStatus || 403
          : rawStatus || 502;
  console.error(`[server] ${context}:`, err);
  res.status(status).json({
    error:
      status === 429
        ? 'AI rate limit reached. Please wait a moment and try again.'
        : status === 503
          ? 'AI is busy right now. Please try again in a few seconds.'
          : rawMessage.includes('API_KEY_INVALID') || status === 403
            ? 'Gemini API key issue. Check GEMINI_API_KEY in Settings > Secrets.'
            : `Could not complete ${context}: ${cleanMessage.slice(0, 180)}`,
  });
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  attempts = 3
) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastError = err;
      const errObj = err as { status?: number; message?: string };
      const status = typeof errObj?.status === 'number' ? errObj.status : 0;
      const msg = errObj?.message ?? '';
      const isTransient = status === 503 || status === 429 || msg.includes('UNAVAILABLE');
      if (!isTransient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastError;
}

interface SourceQuestionPayload {
  courseCode: string;
  source: string;
  text: string;
  solutionAnswer?: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/exam/suggest-topics', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini AI is not configured. Add GEMINI_API_KEY in Settings > Secrets to get AI topic suggestions.',
      });
      return;
    }

    const {
      courseCode = 'ALL',
      courseTitle = 'General University Courses',
      sampleQuestions = [],
      materialTopics = [],
    } = (req.body ?? {}) as {
      courseCode?: string;
      courseTitle?: string;
      sampleQuestions?: string[];
      materialTopics?: string[];
    };

    try {
      const prompt = [
        `Suggest 6 concise, high-yield exam focus topics for a university student preparing for ${courseCode === 'ALL' ? 'General Studies courses' : `${courseCode} (${courseTitle})`}.`,
        sampleQuestions.length > 0
          ? `Real past questions from the archive:\n${sampleQuestions.slice(0, 12).map((q, i) => `${i + 1}. ${q}`).join('\n')}`
          : '',
        materialTopics.length > 0
          ? `Study guide headings:\n${materialTopics.slice(0, 15).join(', ')}`
          : '',
        'Keep each topic short (2 to 5 words), practical, and directly relevant to exam revision.',
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await generateWithRetry(ai, {
        model: MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are an academic exam coach for Nigerian university students. Return crisp, high-yield study topic phrases.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topics: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '5 to 6 concise exam focus topics (2-5 words each).',
              },
            },
            required: ['topics'],
          },
        },
      });

      const parsed = parseJsonSafe<{ topics?: string[] }>(response.text, {});
      const topics = (parsed.topics ?? [])
        .map((t) => String(t).trim())
        .filter((t) => t.length > 1)
        .slice(0, 6);

      if (topics.length === 0) {
        res.status(502).json({ error: 'AI returned no topics. Please try again.' });
        return;
      }

      res.json({ topics });
    } catch (err) {
      sendAiError(res, err, 'topic suggestion');
    }
  });

  app.post('/api/exam/generate', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini AI is not configured. Add GEMINI_API_KEY in Settings > Secrets to generate this exam type.',
      });
      return;
    }

    const {
      examType = 'obj',
      courseCode = 'ALL',
      courseTitle = 'General Courses',
      questionCount = 5,
      focus = '',
      sourceQuestions = [],
      materialNotes = [],
    } = (req.body ?? {}) as {
      examType?: 'obj' | 'cbt' | 'boolean' | 'theory';
      courseCode?: string;
      courseTitle?: string;
      questionCount?: number;
      focus?: string;
      sourceQuestions?: SourceQuestionPayload[];
      materialNotes?: string[];
    };

    const count = Math.max(1, Math.min(50, Math.round(Number(questionCount) || 5)));

    try {
      const contextLines = [
        `Course: ${courseCode === 'ALL' ? 'All General Studies Courses' : `${courseCode} — ${courseTitle}`}`,
        `Requested number of questions: ${count}`,
        focus.trim() ? `Focus topic requested by student: ${focus.trim()}` : 'Cover key recurring themes evenly.',
        sourceQuestions.length > 0
          ? `Real archive past questions for reference:\n${sourceQuestions
              .slice(0, 14)
              .map((q, i) => `${i + 1}. [${q.source}] ${q.text}${q.solutionAnswer ? ` (Key answer: ${q.solutionAnswer})` : ''}`)
              .join('\n')}`
          : '',
        materialNotes.length > 0
          ? `Course study notes:\n${materialNotes.slice(0, 12).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      if (examType === 'obj' || examType === 'cbt') {
        const response = await generateWithRetry(ai, {
          model: MODEL,
          contents: `${contextLines}\n\nGenerate exactly ${count} university multiple-choice (${examType.toUpperCase()}) exam questions grounded in the course topics and past questions above. Each question must have 4 plausible options (no "A."/"B." letter prefixes inside option strings) and 1 unambiguously correct answer.`,
          config: {
            systemInstruction:
              'You create authentic Nigerian university objective/CBT exam questions with clear distractors, accurate answers, and concise study explanations.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING, description: 'The question stem without a question number prefix.' },
                      options: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Exactly 4 answer choices without A/B/C/D prefix.',
                      },
                      correctIndex: {
                        type: Type.INTEGER,
                        description: 'Zero-based index (0, 1, 2, or 3) of the correct option.',
                      },
                      courseCode: { type: Type.STRING, description: 'Course code such as GNS 101.' },
                      sourceTag: { type: Type.STRING, description: 'Short origin label, e.g. GNS 101 · AI Predicted.' },
                      explanation: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '1 to 3 concise sentences explaining why the answer is correct.',
                      },
                      reasons: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '1 or 2 short tags like "Core theme" or "Matches your topic".',
                      },
                    },
                    required: ['text', 'options', 'correctIndex', 'courseCode', 'explanation'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        });

        const parsed = parseJsonSafe<{
          questions?: Array<{
            text: string;
            options: string[];
            correctIndex: number;
            courseCode: string;
            sourceTag?: string;
            explanation: string[];
            reasons?: string[];
          }>;
        }>(response.text, {});

        const questions = (parsed.questions ?? []).slice(0, count).map((q, i) => {
          const opts = (q.options ?? []).slice(0, 4).map((o) => String(o).replace(/^[A-D][.)]\s*/i, '').trim());
          while (opts.length < 4) opts.push('None of the above');
          const safeIdx = Math.max(0, Math.min(3, Math.round(Number(q.correctIndex) || 0)));
          const letter = ['A', 'B', 'C', 'D'][safeIdx];
          return {
            id: `ai-${examType}-${Date.now()}-${i}`,
            number: i + 1,
            text: String(q.text).replace(/^Q\d+\s*[:.)-]\s*/i, '').trim(),
            options: opts,
            correctIndex: safeIdx,
            courseCode: q.courseCode || (courseCode === 'ALL' ? 'GNS' : courseCode),
            source: q.sourceTag || `${q.courseCode || courseCode} · AI Practice`,
            solution: {
              answer: `${letter}. ${opts[safeIdx]}`,
              explanation: (q.explanation ?? []).map((s) => String(s).trim()).filter(Boolean),
            },
            reasons: (q.reasons ?? []).slice(0, 2),
          };
        });

        if (questions.length === 0) {
          res.status(502).json({ error: 'AI could not generate questions. Please try again.' });
          return;
        }
        res.json({ questions });
        return;
      }

      if (examType === 'boolean') {
        const response = await generateWithRetry(ai, {
          model: MODEL,
          contents: `${contextLines}\n\nGenerate exactly ${count} university True/False exam statements grounded in the course topics and past questions above. Make roughly half True and half False, clear and unambiguous.`,
          config: {
            systemInstruction:
              'You create university-level True/False examination statements that test conceptual accuracy without trick wording.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING, description: 'A clear declarative statement to judge True or False.' },
                      correctBoolean: { type: Type.BOOLEAN, description: 'true if the statement is True, false if False.' },
                      courseCode: { type: Type.STRING },
                      sourceTag: { type: Type.STRING },
                      explanation: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '1 to 3 concise sentences explaining why it is True or False.',
                      },
                      reasons: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ['text', 'correctBoolean', 'courseCode', 'explanation'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        });

        const parsed = parseJsonSafe<{
          questions?: Array<{
            text: string;
            correctBoolean: boolean;
            courseCode: string;
            sourceTag?: string;
            explanation: string[];
            reasons?: string[];
          }>;
        }>(response.text, {});

        const questions = (parsed.questions ?? []).slice(0, count).map((q, i) => {
          const truth = Boolean(q.correctBoolean);
          return {
            id: `ai-boolean-${Date.now()}-${i}`,
            number: i + 1,
            text: String(q.text).replace(/^Q\d+\s*[:.)-]\s*/i, '').trim(),
            correctBoolean: truth,
            courseCode: q.courseCode || (courseCode === 'ALL' ? 'GNS' : courseCode),
            source: q.sourceTag || `${q.courseCode || courseCode} · AI Practice`,
            solution: {
              answer: truth ? 'True' : 'False',
              explanation: (q.explanation ?? []).map((s) => String(s).trim()).filter(Boolean),
            },
            reasons: (q.reasons ?? []).slice(0, 2),
          };
        });

        if (questions.length === 0) {
          res.status(502).json({ error: 'AI could not generate True/False statements. Please try again.' });
          return;
        }
        res.json({ questions });
        return;
      }

      // Theory generation (used when student requests more questions than available in archive)
      const response = await generateWithRetry(ai, {
        model: MODEL,
        contents: `${contextLines}\n\nGenerate exactly ${count} new university essay/theory exam questions (not repeating the listed past questions verbatim) with model answers and step-by-step explanations.`,
        config: {
          systemInstruction:
            'You create realistic university theory/essay exam questions and clear worked model answers.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    courseCode: { type: Type.STRING },
                    sourceTag: { type: Type.STRING },
                    answer: { type: Type.STRING },
                    explanation: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    reasons: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['text', 'courseCode', 'answer', 'explanation'],
                },
              },
            },
            required: ['questions'],
          },
        },
      });

      const parsed = parseJsonSafe<{
        questions?: Array<{
          text: string;
          courseCode: string;
          sourceTag?: string;
          answer: string;
          explanation: string[];
          reasons?: string[];
        }>;
      }>(response.text, {});

      const questions = (parsed.questions ?? []).slice(0, count).map((q, i) => ({
        id: `ai-theory-${Date.now()}-${i}`,
        number: i + 1,
        text: String(q.text).replace(/^Q\d+\s*[:.)-]\s*/i, '').trim(),
        courseCode: q.courseCode || (courseCode === 'ALL' ? 'GNS' : courseCode),
        source: q.sourceTag || `${q.courseCode || courseCode} · AI Predicted`,
        solution: {
          answer: String(q.answer).trim(),
          explanation: (q.explanation ?? []).map((s) => String(s).trim()).filter(Boolean),
        },
        reasons: (q.reasons ?? ['Predicted question']).slice(0, 2),
      }));

      res.json({ questions });
    } catch (err) {
      sendAiError(res, err, 'exam generation');
    }
  });

  app.post('/api/exam/grade-theory', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini AI is not configured. Self-mark using the model answers below.',
      });
      return;
    }

    const { items = [] } = (req.body ?? {}) as {
      items?: Array<{
        id: string;
        question: string;
        modelAnswer: string;
        studentAnswer: string;
      }>;
    };

    const answered = items.filter((item) => item.studentAnswer.trim().length > 0);
    if (answered.length === 0) {
      res.json({ results: [] });
      return;
    }

    try {
      const prompt = answered
        .map(
          (item, i) =>
            `Item ${i + 1} (id: ${item.id}):\nQuestion: ${item.question}\nModel Answer: ${item.modelAnswer || 'Grade on standard university accuracy'}\nStudent Answer: ${item.studentAnswer}`
        )
        .join('\n\n---\n\n');

      const response = await generateWithRetry(ai, {
        model: MODEL,
        contents: `Evaluate each student answer fairly against the question and model answer:\n\n${prompt}`,
        config: {
          systemInstruction:
            'You are a fair, encouraging university examiner. Give each answered question a verdict ("got", "partly", or "missed") and 1 to 2 sentences of specific feedback.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              results: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    verdict: { type: Type.STRING, description: 'One of: got, partly, missed' },
                    feedback: { type: Type.STRING },
                  },
                  required: ['id', 'verdict', 'feedback'],
                },
              },
            },
            required: ['results'],
          },
        },
      });

      const parsed = parseJsonSafe<{
        results?: Array<{ id: string; verdict: string; feedback: string }>;
      }>(response.text, {});

      const results = (parsed.results ?? []).map((r) => ({
        id: r.id,
        verdict: r.verdict === 'got' || r.verdict === 'partly' || r.verdict === 'missed' ? r.verdict : 'partly',
        feedback: String(r.feedback ?? '').trim(),
      }));

      res.json({ results });
    } catch (err) {
      sendAiError(res, err, 'theory grading');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`pqguide server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
