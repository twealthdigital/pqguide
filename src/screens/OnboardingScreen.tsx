import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BookOpen,
  Calculator,
  FileText,
  FlaskConical,
  Scale,
  ScanLine,
  Search,
} from 'lucide-react';
import { TactileButton } from '../components/ui/TactileButton';
import { BrandLogo } from '../components/ui/BrandLogo';
import { ScanToPdfShowcase } from '../components/onboarding/ScanToPdfShowcase';
import { AiAssistantShowcase } from '../components/onboarding/AiAssistantShowcase';

interface OnboardingScreenProps {
  onComplete?: () => void;
}

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
}

interface CourseTile {
  code: string;
  year: string;
  tone: 'dark' | 'light' | 'soft';
  icon: React.ReactNode;
}

const LEFT_TRACK_COURSES: CourseTile[] = [
  {
    code: 'CSC 201',
    year: '2023/2024',
    tone: 'light',
    icon: <Search className="w-5 h-5" />,
  },
  {
    code: 'PHY 101',
    year: '2024/2025',
    tone: 'dark',
    icon: <Atom className="w-5 h-5" />,
  },
  {
    code: 'CHM 101',
    year: '2024/2025',
    tone: 'soft',
    icon: <FlaskConical className="w-5 h-5" />,
  },
  {
    code: 'ACC 201',
    year: '2023/2024',
    tone: 'dark',
    icon: <Calculator className="w-5 h-5" />,
  },
];

const RIGHT_TRACK_COURSES: CourseTile[] = [
  {
    code: 'GNS 101',
    year: '2023/2024',
    tone: 'dark',
    icon: <FileText className="w-5 h-5" />,
  },
  {
    code: 'LAW 301',
    year: '2024/2025',
    tone: 'soft',
    icon: <Scale className="w-5 h-5" />,
  },
  {
    code: 'MTH 202',
    year: '2023/2024',
    tone: 'light',
    icon: <BookOpen className="w-5 h-5" />,
  },
  {
    code: 'ECO 102',
    year: '2022/2023',
    tone: 'dark',
    icon: <ScanLine className="w-5 h-5" />,
  },
];

// 3x base per half (24 tiles total = 2 exact halves of 12) so -50% loop never runs out of cards
const WIDE_LEFT_OUTER_LOOP = [
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
];

const WIDE_LEFT_INNER_LOOP = [
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
];

const WIDE_RIGHT_INNER_LOOP = [
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
  ...LEFT_TRACK_COURSES,
];

const WIDE_RIGHT_OUTER_LOOP = [
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
  ...RIGHT_TRACK_COURSES,
];

const SLIDES: OnboardingSlide[] = [
  {
    id: 'discover',
    title: 'Welcome to pqguide',
    subtitle:
      'Pick your school, academic session, and semester to pull up verified past questions in seconds.',
    ctaLabel: 'Next',
  },
  {
    id: 'scan',
    title: 'Clear Scans & Typed Papers',
    subtitle:
      'Photo uploads convert into crisp Scan-to-PDF sheets while typed papers are indexed for instant keyword search.',
    ctaLabel: 'Next',
  },
  {
    id: 'ai',
    title: 'Smart AI Study Companion',
    subtitle:
      'Pick any course to predict likely questions, research core topics, or practice full past papers by year.',
    ctaLabel: 'Continue',
  },
];

const CoursePreviewCard: React.FC<{ tile: CourseTile }> = React.memo(({ tile }) => {
  const toneStyle =
    tile.tone === 'dark'
      ? 'bg-[#1D1E23] text-white shadow-[0_12px_24px_-10px_rgba(20,21,26,0.3)]'
      : tile.tone === 'soft'
      ? 'bg-[#ECEEF3] text-[#1A1B20] border border-[#1A1B20]/[0.04]'
      : 'bg-white text-[#1A1B20] shadow-[0_10px_22px_-10px_rgba(24,25,30,0.1)] border border-[#1A1B20]/[0.07]';

  const iconWrapStyle =
    tile.tone === 'dark'
      ? 'bg-white text-[#1D1E23]'
      : tile.tone === 'soft'
      ? 'bg-[#1D1E23] text-white'
      : 'bg-[#F2F4F7] text-[#1D1E23]';

  const yearColor =
    tile.tone === 'dark' ? 'text-[#A5AAB8]' : 'text-[#686C78]';

  return (
    <div
      className={`rounded-[28px] p-5 sm:p-6 flex flex-col justify-between min-h-[168px] sm:min-h-[196px] shrink-0 ${toneStyle}`}
    >
      <div
        className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 ${iconWrapStyle}`}
      >
        {tile.icon}
      </div>

      <div className="mt-6">
        <p className="font-display text-xl sm:text-2xl font-extrabold tracking-tight whitespace-nowrap leading-none">
          {tile.code}
        </p>
        <p
          className={`mt-2 font-mono-tabular text-xs font-medium whitespace-nowrap ${yearColor}`}
        >
          {tile.year}
        </p>
      </div>
    </div>
  );
});

CoursePreviewCard.displayName = 'CoursePreviewCard';

function useViewportTier(): 'mobile' | 'tablet' | 'desktop' {
  const getTier = (): 'mobile' | 'tablet' | 'desktop' => {
    if (typeof window === 'undefined') return 'mobile';
    if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
    if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
    return 'mobile';
  };

  const [tier, setTier] = useState<'mobile' | 'tablet' | 'desktop'>(getTier);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mqDesktop = window.matchMedia('(min-width: 1024px)');
    const mqTablet = window.matchMedia('(min-width: 768px)');
    const sync = () => setTier(getTier());
    sync();
    mqDesktop.addEventListener('change', sync);
    mqTablet.addEventListener('change', sync);
    return () => {
      mqDesktop.removeEventListener('change', sync);
      mqTablet.removeEventListener('change', sync);
    };
  }, []);

  return tier;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  onComplete,
}) => {
  const [step, setStep] = useState(0);
  const viewportTier = useViewportTier();
  const isTablet = viewportTier === 'tablet';
  const isDesktop = viewportTier === 'desktop';
  const current = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  const handleNext = () => {
    if (isLast) {
      if (onComplete) {
        onComplete();
      } else {
        setStep(0);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  return (
    <div className="h-[100dvh] max-h-[100dvh] w-full bg-white text-[#1A1B20] flex flex-col overflow-hidden page-enter">
      {/* Floating Top Brand Mark */}
      <div className="fixed top-3.5 left-4 right-4 md:top-6 md:left-7 md:right-8 z-30 flex items-center justify-between pointer-events-none">
        <div className="h-10 w-10 md:h-11 md:w-11 rounded-2xl tactile-dark text-white flex items-center justify-center pointer-events-auto shadow-md">
          <BrandLogo className="w-5 h-5" />
        </div>
      </div>

      {/* Desktop Slide 1: Endless Double Opposite Tracks on Left & Right | Centered Content */}
      {isDesktop && step === 0 ? (
        <main className="relative flex-1 min-h-0 w-full h-full overflow-hidden flex items-center justify-center bg-white">
          <>
            {/* Desktop Left Side: Full-width Double Tracks positioned beside centered content */}
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-y-0 right-[calc(50%+345px)] xl:right-[calc(50%+390px)] w-[540px] flex items-center justify-center"
            >
              <div className="w-full h-[170%] -rotate-[26deg] grid grid-cols-2 gap-5 items-start">
                <div className="animate-marquee-up-long flex flex-col gap-5 pb-5">
                  {WIDE_LEFT_OUTER_LOOP.map((tile, idx) => (
                    <CoursePreviewCard key={`dl-out-${idx}`} tile={tile} />
                  ))}
                </div>
                <div className="animate-marquee-down-long flex flex-col gap-5 pb-5">
                  {WIDE_LEFT_INNER_LOOP.map((tile, idx) => (
                    <CoursePreviewCard key={`dl-in-${idx}`} tile={tile} />
                  ))}
                </div>
              </div>
            </div>

            {/* Desktop Right Side: Full-width Double Tracks positioned beside centered content */}
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-y-0 left-[calc(50%+345px)] xl:left-[calc(50%+390px)] w-[540px] flex items-center justify-center"
            >
              <div className="w-full h-[170%] -rotate-[26deg] grid grid-cols-2 gap-5 items-start">
                <div className="animate-marquee-up-long flex flex-col gap-5 pb-5">
                  {WIDE_RIGHT_INNER_LOOP.map((tile, idx) => (
                    <CoursePreviewCard key={`dr-in-${idx}`} tile={tile} />
                  ))}
                </div>
                <div className="animate-marquee-down-long flex flex-col gap-5 pb-5">
                  {WIDE_RIGHT_OUTER_LOOP.map((tile, idx) => (
                    <CoursePreviewCard key={`dr-out-${idx}`} tile={tile} />
                  ))}
                </div>
              </div>
            </div>
          </>


          {/* Top darker blurred fade dissolving smoothly */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-28 z-20 backdrop-blur-[4px]"
            style={{
              background:
                'linear-gradient(to bottom, rgba(29,30,35,0.52) 0%, rgba(29,30,35,0.22) 48%, rgba(29,30,35,0) 100%)',
              maskImage:
                'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
            }}
          />

          {/* Centered Copy & Tactile Action Controls in the Middle */}
          <div className="relative z-10 w-full max-w-[390px] lg:max-w-[520px] xl:max-w-[560px] px-6 flex flex-col items-center text-center">
            <h1
              className="font-display text-4xl lg:text-[48px] xl:text-[54px] font-extrabold tracking-tight text-[#1A1B20] leading-[1.08]"
              style={{ textWrap: 'balance' }}
            >
              {current.title}
            </h1>

            <p className="mt-3.5 lg:mt-4 text-base lg:text-lg xl:text-[19px] text-[#5E6370] leading-relaxed max-w-md lg:max-w-lg">
              {current.subtitle}
            </p>

            {/* Interactive Slide Progress Indicators */}
            <div
              className="mt-6 lg:mt-7 flex items-center gap-2 lg:gap-2.5"
              role="tablist"
              aria-label="Onboarding steps"
            >
              {SLIDES.map((slide, idx) => (
                <button
                  key={slide.id}
                  type="button"
                  role="tab"
                  aria-selected={idx === step}
                  aria-label={`Step ${idx + 1}: ${slide.title}`}
                  onClick={() => setStep(idx)}
                  className={`h-2.5 rounded-full transition-all duration-200 cursor-pointer ${
                    idx === step
                      ? 'w-8 lg:w-9 bg-[#1D1E23]'
                      : 'w-2.5 bg-[#D3D6DF] hover:bg-[#A5AAB8]'
                  }`}
                />
              ))}
            </div>

            {/* Tactile Navigation Controls */}
            <div className="mt-7 lg:mt-9 w-full max-w-sm lg:max-w-md flex items-center gap-3 lg:gap-4">
              <TactileButton
                variant="dark"
                size="lg"
                fullWidth
                className="rounded-full min-h-[54px] lg:min-h-[58px] text-base px-8"
                onClick={handleNext}
                icon={<ArrowRight className="w-5 h-5" />}
              >
                {current.ctaLabel}
              </TactileButton>
            </div>
          </div>
        </main>
      ) : (
        /* Mobile & Tablet (Vertical mobile-style stage on top; Tablet centers main content in middle) + Desktop Slides 2 & 3 */
        <main className="flex-1 min-h-0 w-full relative flex flex-col md:items-center md:justify-center lg:grid lg:grid-cols-12 lg:items-stretch">
          {/* Visual Stage */}
          <div className="flex-1 min-h-0 md:flex-none md:absolute md:inset-x-0 md:top-0 md:h-[48dvh] lg:static lg:col-span-5 relative w-full lg:h-full overflow-hidden flex items-center justify-center">
            {step === 0 && (
              <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                {/* Mobile & Tablet 2 large solid diagonal tracks tilted top-left to bottom-right */}
                <div className="w-[126%] md:w-[116%] h-[155%] md:h-[175%] -rotate-[26deg] grid grid-cols-2 gap-4 sm:gap-5 px-4 items-start">
                  <div
                    className={`${
                      isTablet ? 'animate-marquee-up-long' : 'animate-marquee-up'
                    } flex flex-col gap-4 sm:gap-5 pb-4 sm:pb-5`}
                  >
                    {(isTablet
                      ? WIDE_LEFT_OUTER_LOOP
                      : [...LEFT_TRACK_COURSES, ...LEFT_TRACK_COURSES]
                    ).map((tile, idx) => (
                      <CoursePreviewCard key={`left-${idx}`} tile={tile} />
                    ))}
                  </div>

                  <div
                    className={`${
                      isTablet ? 'animate-marquee-down-long' : 'animate-marquee-down'
                    } flex flex-col gap-4 sm:gap-5 pb-4 sm:pb-5`}
                  >
                    {(isTablet
                      ? WIDE_RIGHT_OUTER_LOOP
                      : [...RIGHT_TRACK_COURSES, ...RIGHT_TRACK_COURSES]
                    ).map((tile, idx) => (
                      <CoursePreviewCard key={`right-${idx}`} tile={tile} />
                    ))}
                  </div>
                </div>

                {/* Top darker blurred fade */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-32 backdrop-blur-[4px]"
                  style={{
                    background:
                      'linear-gradient(to bottom, rgba(29,30,35,0.52) 0%, rgba(29,30,35,0.22) 48%, rgba(29,30,35,0) 100%)',
                    maskImage:
                      'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
                    WebkitMaskImage:
                      'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
                  }}
                />

                {/* Seamless multi-stop white bottom fade dissolving cleanly into pure white */}
                <div
                  aria-hidden="true"
                  className="md:hidden pointer-events-none absolute inset-x-0 bottom-0 h-44 sm:h-48"
                  style={{
                    background:
                      'linear-gradient(to top, #FFFFFF 0%, #FFFFFF 22%, rgba(255,255,255,0.9) 48%, rgba(255,255,255,0.45) 75%, rgba(255,255,255,0) 100%)',
                  }}
                />
                <div
                  aria-hidden="true"
                  className="hidden md:block lg:hidden pointer-events-none absolute inset-x-0 bottom-0 h-28"
                  style={{
                    background:
                      'linear-gradient(to top, #FFFFFF 0%, #FFFFFF 18%, rgba(255,255,255,0.86) 48%, rgba(255,255,255,0.38) 78%, rgba(255,255,255,0) 100%)',
                  }}
                />
              </div>
            )}

            {/* Slide 2: Interactive Photo Upload -> Scan -> Verify -> PDF -> Dark Card Reveal */}
            {step === 1 && <ScanToPdfShowcase />}

            {/* Slide 3: Interactive AI Study Companion Showcase */}
            {step === 2 && <AiAssistantShowcase />}
          </div>

          {/* Desktop full-width top darker blurred fade spanning both columns seamlessly */}
          <div
            aria-hidden="true"
            className="hidden lg:block pointer-events-none absolute inset-x-0 top-0 h-28 z-20 backdrop-blur-[4px]"
            style={{
              background:
                'linear-gradient(to bottom, rgba(29,30,35,0.52) 0%, rgba(29,30,35,0.22) 48%, rgba(29,30,35,0) 100%)',
              maskImage:
                'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
            }}
          />

          {/* Copy & Tactile Action Column */}
          <div className="shrink-0 lg:col-span-7 relative z-10 -mt-8 md:mt-[18dvh] lg:mt-0 px-5 sm:px-8 md:px-12 pb-8 sm:pb-10 md:py-6 pt-2 lg:px-14 xl:px-20 lg:py-0 lg:h-full lg:justify-center flex flex-col items-center lg:items-start text-center lg:text-left w-full bg-white md:bg-transparent md:bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.92)_38%,rgba(255,255,255,0)_76%)] lg:bg-white lg:bg-none">
            <div className="w-full max-w-md md:max-w-xl mx-auto lg:mx-0 flex flex-col items-center lg:items-start">
              <h1
                className="font-display text-2xl sm:text-4xl md:text-[48px] lg:text-[48px] xl:text-[54px] font-extrabold tracking-tight text-[#1A1B20] leading-[1.15] md:leading-[1.08]"
                style={{ textWrap: 'balance' }}
              >
                {current.title}
              </h1>

              <p className="mt-2.5 md:mt-4 text-xs sm:text-base md:text-[19px] lg:text-lg xl:text-[19px] text-[#5E6370] leading-relaxed md:max-w-lg">
                {current.subtitle}
              </p>

              {/* Interactive Slide Progress Indicators */}
              <div
                className="mt-5 md:mt-7 flex items-center gap-2 md:gap-2.5"
                role="tablist"
                aria-label="Onboarding steps"
              >
                {SLIDES.map((slide, idx) => (
                  <button
                    key={slide.id}
                    type="button"
                    role="tab"
                    aria-selected={idx === step}
                    aria-label={`Step ${idx + 1}: ${slide.title}`}
                    onClick={() => setStep(idx)}
                    className={`h-2 md:h-2.5 rounded-full transition-all duration-200 cursor-pointer ${
                      idx === step
                        ? 'w-7 md:w-9 bg-[#1D1E23]'
                        : 'w-2 md:w-2.5 bg-[#D3D6DF] hover:bg-[#A5AAB8]'
                    }`}
                  />
                ))}
              </div>

              {/* Tactile Navigation Controls */}
              <div className="mt-6 md:mt-8 lg:mt-9 w-full md:max-w-md lg:max-w-full flex items-center gap-3 md:gap-4">
                {step > 0 && (
                  <TactileButton
                    variant="light"
                    size="lg"
                    className="rounded-full md:min-h-[58px] md:px-5"
                    icon={<ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    aria-label="Previous onboarding step"
                  />
                )}
                <TactileButton
                  variant="dark"
                  size="lg"
                  fullWidth
                  className="rounded-full md:min-h-[58px] md:text-base md:px-8"
                  onClick={handleNext}
                  icon={<ArrowRight className="w-4 h-4 md:w-5 md:h-5" />}
                >
                  {current.ctaLabel}
                </TactileButton>
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
};
