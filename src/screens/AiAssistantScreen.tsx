import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  FileText,
  FolderOpen,
  Lightbulb,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { AcademicAiMode, StructuredAiStudyResponse } from '../../server/aiService';
import type {
  AppScreen,
  AuthenticatedUser,
  PastQuestionDoc,
  StudyMaterial,
} from '../core/types';
import { archiveRepository } from '../services/archiveRepository';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { buildGroundedAcademicContext } from '../services/intelligence/academicContext';
import { AcademicBlocksRenderer } from '../components/academic/AcademicContentRenderer';
import {
  CustomSelect,
  PqGuideAiIcon,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
  type PqGuideAiState,
} from '../components/ui';

interface AiAssistantScreenProps {
  currentUser: AuthenticatedUser;
  initialPrompt?: string | null;
  initialDocLibraryId?: string | null;
  onNavigate: (screen: AppScreen, opts?: { docLibraryId?: string }) => void;
  onOpenDocument: (doc: PastQuestionDoc) => void;
  onOpenMaterial: (material: StudyMaterial) => void;
}

const STUDY_MODES: Array<{ id: AcademicAiMode; label: string }> = [
  { id: 'find_archive', label: 'Find in Archive' },
  { id: 'exam_prep', label: 'Exam Prep' },
  { id: 'generate_practice', label: 'Practice Quiz' },
  { id: 'step_solution', label: 'Step-by-Step Solution' },
  { id: 'math_diagram', label: 'Math & Diagrams' },
  { id: 'explain_answer', label: 'Explain Answer' },
];

const QUICK_PROMPTS = [
  'Find CSC 101 or GNS past questions in my university archive',
  'Derive and solve quadratic equations step by step with LaTeX formula',
  'Show an inclined plane free-body diagram and acceleration equation',
  'Give me a focused exam prep plan using my mock exam performance',
];

export const AiAssistantScreen: React.FC<AiAssistantScreenProps> = ({
  currentUser,
  initialPrompt,
  initialDocLibraryId,
  onNavigate,
  onOpenDocument,
  onOpenMaterial,
}) => {
  const store = useArchiveStore();
  const [mode, setMode] = useState<AcademicAiMode>('find_archive');
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [pinnedDocId, setPinnedDocId] = useState(initialDocLibraryId ?? 'none');
  const [aiState, setAiState] = useState<PqGuideAiState>('idle');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<StructuredAiStudyResponse | null>(null);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (initialDocLibraryId) setPinnedDocId(initialDocLibraryId);
  }, [initialDocLibraryId]);

  useEffect(() => {
    let active = true;
    void fetch('/api/ai/status')
      .then((res) => res.json())
      .then((data: { aiConfigured?: boolean }) => {
        if (active) setAiConfigured(Boolean(data.aiConfigured));
      })
      .catch(() => {
        if (active) setAiConfigured(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const libraryDocs = useMemo(() => {
    const published = archiveRepository.getPublishedLibraryDocuments();
    const mine = archiveRepository.getDocumentsForSubmitter(currentUser.id);
    const merged = new Map<string, (typeof published)[number]>();
    [...published, ...mine].forEach((d) => merged.set(d.id, d));
    return Array.from(merged.values());
  }, [store.academicDocuments, currentUser.id]);

  const handleSubmit = async (customPrompt?: string) => {
    const queryText = (customPrompt ?? prompt).trim();
    if (!queryText) {
      setErrorMsg('Enter an academic question, course code, or topic first.');
      return;
    }

    setErrorMsg(null);
    setAiState('retrieving');

    try {
      const groundedContext = buildGroundedAcademicContext(store, {
        pinnedStudentDocId: pinnedDocId !== 'none' ? pinnedDocId : undefined,
      });

      setAiState('generating');
      const res = await fetch('/api/ai/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: queryText,
          mode,
          groundedContext,
        }),
      });

      const payload = (await res.json()) as {
        ok?: boolean;
        error?: string;
        response?: StructuredAiStudyResponse;
      };

      if (!res.ok || !payload.ok || !payload.response) {
        setAiState('failed');
        setErrorMsg(payload.error ?? 'Could not complete study request.');
        return;
      }

      setResult(payload.response);
      setAiState('completed');
    } catch {
      setAiState('failed');
      setErrorMsg('Network error reaching PQGuide AI service.');
    }
  };

  const handleOpenCitation = (kind: string, id: string) => {
    if (kind === 'past_question') {
      const doc = store.documents.find((d) => d.id === id);
      if (doc) onOpenDocument(doc);
    } else if (kind === 'study_material') {
      const mat = store.materials.find((m) => m.id === id);
      if (mat) onOpenMaterial(mat);
    } else if (kind === 'student_document') {
      onNavigate('document_library', { docLibraryId: id });
    } else if (kind === 'performance') {
      onNavigate('performance');
    }
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Header Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2.5 text-xs font-semibold text-[#C3C7D2]">
              <PqGuideAiIcon size="md" state={aiState} />
              <span>PQGuide Academic AI</span>
              <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] text-white">
                {aiConfigured ? 'Gemini Connected' : 'Grounded Archive Mode'}
              </span>
            </div>
            <h1 className="font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight text-white leading-[1.1]">
              Structured Academic Research &amp; Study Tutor
            </h1>
            <p className="text-sm text-[#B8BCC8] max-w-2xl">
              Grounded strictly in your university archive, study materials, scanned document
              library, and exam performance history — with LaTeX formulas, tables, charts, and diagrams.
            </p>
          </div>

          <TactileButton
            variant="light"
            size="sm"
            icon={<FolderOpen className="w-4 h-4" />}
            onClick={() => onNavigate('document_library')}
          >
            Document Library
          </TactileButton>
        </div>
      </SurfaceCard>

      {/* Query Composer */}
      <SurfaceCard tone="white" className="p-5 space-y-4">
        <SectionHeadingBar
          title="Ask PQGuide AI"
          subtitle="Select a study mode and optionally pin a scanned document for context"
          icon={<PqGuideAiIcon size="sm" state={aiState} />}
        />

        <div className="flex flex-wrap gap-2">
          {STUDY_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                mode === m.id
                  ? 'bg-[#1D1E23] text-white'
                  : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CustomSelect
            id="ai-pin-doc"
            label="Pin Scanned Document (Optional)"
            size="sm"
            value={pinnedDocId}
            options={[
              { value: 'none', label: 'Search Entire University Archive' },
              ...libraryDocs.map((d) => ({
                value: d.id,
                label: `${d.courseCode} — ${d.title}`,
              })),
            ]}
            onChange={setPinnedDocId}
          />
        </div>

        <div>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask about a past question paper, request a step-by-step physics or calculus solution, or study a scanned document..."
            className="w-full rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:border-[#1D1E23] focus:bg-white"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setPrompt(q);
                  void handleSubmit(q);
                }}
                className="rounded-lg bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/[0.07] px-2.5 py-1 text-[11px] font-medium text-[#505460] cursor-pointer text-left"
              >
                {q}
              </button>
            ))}
          </div>

          <TactileButton
            variant="dark"
            size="md"
            loading={aiState === 'retrieving' || aiState === 'generating'}
            icon={<Send className="w-4 h-4" />}
            onClick={() => void handleSubmit()}
          >
            Run Study Query
          </TactileButton>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]"
          >
            {errorMsg}
          </div>
        )}
      </SurfaceCard>

      {/* AI Output */}
      {result && (
        <SurfaceCard tone="white" className="p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#1A1B20]/[0.07]">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#1D1E23] text-white px-2.5 py-0.5 text-[11px] font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {result.groundedInArchive ? 'Verified Archive Citations' : 'Academic Reference'}
                </span>
                <span className="text-[11px] text-[#686C78]">
                  {result.providerUsed === 'gemini'
                    ? `Model: ${result.modelUsed ?? 'gemini-4-hydrogen'}`
                    : 'Deterministic Grounded Engine'}
                </span>
              </div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#1A1B20]">
                {result.headline}
              </h2>
              <p className="text-xs sm:text-sm text-[#505460]">{result.summary}</p>
            </div>
          </div>

          <AcademicBlocksRenderer blocks={result.blocks} />

          {result.citations.length > 0 && (
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-4 space-y-2.5">
              <p className="font-display text-xs font-bold uppercase tracking-wider text-[#686C78]">
                Cited Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {result.citations.map((cit) => (
                  <button
                    key={`${cit.kind}-${cit.id}`}
                    type="button"
                    onClick={() => handleOpenCitation(cit.kind, cit.id)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white border border-[#1A1B20]/10 hover:border-[#1D1E23] px-3 py-2 text-xs font-semibold text-[#1A1B20] cursor-pointer transition-colors"
                  >
                    {cit.kind === 'study_material' ? (
                      <BookOpen className="w-3.5 h-3.5 text-[#505460]" />
                    ) : cit.kind === 'student_document' ? (
                      <FolderOpen className="w-3.5 h-3.5 text-[#505460]" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[#505460]" />
                    )}
                    <span>{cit.label}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#686C78]" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {result.suggestedFollowUp && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#1A1B20]/10 bg-white px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-[#505460]">
                <Lightbulb className="w-4 h-4 text-[#1D1E23] shrink-0" />
                <span>Suggested next step: {result.suggestedFollowUp}</span>
              </div>
              <TactileButton
                variant="light"
                size="sm"
                onClick={() => {
                  setPrompt(result.suggestedFollowUp ?? '');
                  void handleSubmit(result.suggestedFollowUp);
                }}
              >
                Ask Follow-Up
              </TactileButton>
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
};
