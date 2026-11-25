import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { StudyMaterial } from '../core/types';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { SearchField } from '../components/ui/SearchField';
import { TactileButton } from '../components/ui/TactileButton';

interface MaterialReaderScreenProps {
  material: StudyMaterial | null;
  onBack: () => void;
}

export const MaterialReaderScreen: React.FC<MaterialReaderScreenProps> = ({
  material,
  onBack,
}) => {
  const [query, setQuery] = useState('');

  // Keep each section's original number even while filtering.
  const sections = useMemo(() => {
    if (!material) return [];
    const needle = query.trim().toLowerCase();
    return material.sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) =>
        needle
          ? [section.heading, ...(section.paragraphs ?? []), ...(section.points ?? [])]
              .join(' ')
              .toLowerCase()
              .includes(needle)
          : true
      );
  }, [material, query]);

  if (!material) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center border border-[#1A1B20]/[0.06]">
        <p className="text-sm text-[#686C78]">This guide could not be found.</p>
        <div className="mt-4 flex justify-center">
          <TactileButton variant="dark" size="md" onClick={onBack}>
            Back
          </TactileButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <DarkHeaderCard>
        <TactileButton
          variant="light"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={onBack}
        >
          Back
        </TactileButton>

        <h1 className="mt-3.5 font-display text-xl sm:text-2xl font-bold leading-snug">
          {material.title}
        </h1>
        <p className="mt-1.5 text-xs text-[#C3C7D2] font-mono-tabular">
          {material.courseCode} · {material.level} · {material.readMinutes} min read
        </p>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search inside this guide..."
        />
      </DarkHeaderCard>

      <article className="rounded-3xl border border-[#1A1B20]/[0.08] bg-white px-5 py-6 shadow-[0_2px_12px_-6px_rgba(24,25,30,0.1)] sm:px-8 sm:py-8">
        <p className="text-[15px] leading-7 text-[#3A3D47]">{material.summary}</p>

        {sections.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#686C78]">
            Nothing in this guide matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {sections.map(({ section, index }) => (
              <section key={index}>
                <h2 className="flex items-center gap-3 font-display text-base font-bold text-[#1A1B20]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1D1E23] font-mono-tabular text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  {section.heading}
                </h2>

                {section.paragraphs?.map((p, i) => (
                  <p key={i} className="mt-3 text-[15px] leading-7 text-[#3A3D47]">
                    {p}
                  </p>
                ))}

                {section.points && (
                  <ul className="mt-3 space-y-2.5">
                    {section.points.map((point, i) => (
                      <li key={i} className="flex gap-3 text-[15px] leading-7 text-[#3A3D47]">
                        <span
                          aria-hidden="true"
                          className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#1D1E23]"
                        />
                        <span className="min-w-0 flex-1">{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </article>
    </div>
  );
};
