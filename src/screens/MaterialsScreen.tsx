import React, { useMemo, useState } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import type { StudyMaterial } from '../core/types';
import { STUDY_MATERIALS } from '../data/materials';
import { SearchField } from '../components/ui/SearchField';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';

interface MaterialsScreenProps {
  onOpenMaterial: (material: StudyMaterial) => void;
}

export const MaterialsScreen: React.FC<MaterialsScreenProps> = ({ onOpenMaterial }) => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return STUDY_MATERIALS;
    return STUDY_MATERIALS.filter((m) =>
      `${m.courseCode} ${m.courseTitle} ${m.title} ${m.summary}`.toLowerCase().includes(needle)
    );
  }, [query]);

  return (
    <div className="space-y-5 page-enter">
      <DarkHeaderCard>
        <h1 className="font-display text-xl sm:text-2xl font-bold leading-snug">Materials</h1>
        <p className="mt-1.5 text-xs text-[#C3C7D2]">Read and prepare for your exams</p>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search a course or topic..."
        />
      </DarkHeaderCard>

      <section aria-label="Reading guides">
        <h2 className="font-display text-lg font-bold text-[#1A1B20]">Reading guides</h2>
        <p className="mt-0.5 text-xs text-[#686C78]">Free study notes for every general course</p>

        {results.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#686C78]">
            No guides match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {results.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenMaterial(m)}
                className="w-full text-left rounded-2xl bg-white p-4 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] hover:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)] transition-all duration-150 flex items-center justify-between gap-4 cursor-pointer active:scale-[0.995]"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className="h-11 w-11 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-sm sm:text-base font-bold text-[#1A1B20] whitespace-nowrap">
                        {m.courseCode}
                      </span>
                      <span className="text-xs font-mono-tabular text-[#686C78]">{m.level}</span>
                    </div>
                    <p className="mt-0.5 text-xs sm:text-sm text-[#3A3D47] line-clamp-2">
                      {m.title}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0 self-stretch justify-between">
                  <span className="min-h-[36px] px-3.5 rounded-xl bg-[#F6F7F9] text-xs font-semibold text-[#1A1B20] flex items-center gap-1.5 whitespace-nowrap">
                    Read
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[11px] font-mono-tabular text-[#686C78]">
                    {m.readMinutes} min read
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
