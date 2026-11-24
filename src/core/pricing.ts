import type { SubscriptionCadence, SubscriptionPlan, SubscriptionTierId } from './types';

export const CADENCE_LABELS: Record<SubscriptionCadence, string> = {
  monthly: 'Monthly',
  semester: 'Per Semester',
  session: 'Per Session',
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  // Monthly Plans
  {
    id: 'free',
    cadence: 'monthly',
    name: 'Free Starter',
    audience: 'For browsing course codes and sample previews',
    priceNaira: 0,
    periodLabel: 'forever',
    includesFullArchive: false,
    includesAiAccess: false,
    features: [
      'Browse university sessions & semesters',
      'Read marked free sample papers',
      'Instant course code search',
    ],
  },
  {
    id: 'monthly_500',
    cadence: 'monthly',
    name: 'Monthly Pass',
    audience: 'For steady monthly test & exam prep',
    priceNaira: 500,
    periodLabel: 'per month',
    includesFullArchive: true,
    includesAiAccess: false,
    features: [
      'Unlimited past question papers',
      'Scanned PDF & clean typed reader',
      'Full-text search across all courses',
    ],
  },
  {
    id: 'monthly_1000',
    cadence: 'monthly',
    name: 'Monthly Pro + AI',
    audience: 'For students preparing for high-stakes exams',
    priceNaira: 1000,
    periodLabel: 'per month',
    includesFullArchive: true,
    includesAiAccess: true,
    aiNote: 'AI study access unlocked automatically on rollout',
    highlighted: true,
    features: [
      'Everything in Monthly Pass',
      'AI Question Solver access reserved',
      'Priority new-upload notifications',
    ],
  },

  // Per Semester Plans
  {
    id: 'free',
    cadence: 'semester',
    name: 'Free Starter',
    audience: 'For browsing course codes and sample previews',
    priceNaira: 0,
    periodLabel: 'forever',
    includesFullArchive: false,
    includesAiAccess: false,
    features: [
      'Browse university sessions & semesters',
      'Read marked free sample papers',
      'Instant course code search',
    ],
  },
  {
    id: 'semester_2000',
    cadence: 'semester',
    name: 'Semester Pass',
    audience: 'Covers one full Harmattan or Rain semester',
    priceNaira: 2000,
    periodLabel: 'per semester',
    includesFullArchive: true,
    includesAiAccess: false,
    features: [
      'Unlimited access for 1 full semester',
      'All departments & 100L–500L archives',
      'Scan-to-PDF & indexed text views',
    ],
  },
  {
    id: 'semester_3500',
    cadence: 'semester',
    name: 'Semester Pro + AI',
    audience: 'Full semester coverage with AI access ready',
    priceNaira: 3500,
    periodLabel: 'per semester',
    includesFullArchive: true,
    includesAiAccess: true,
    aiNote: 'AI study access unlocked automatically on rollout',
    highlighted: true,
    features: [
      'Everything in Semester Pass',
      'AI Answer Breakdown access reserved',
      'Early access to fresh exam uploads',
    ],
  },

  // Per Session Plans
  {
    id: 'free',
    cadence: 'session',
    name: 'Free Starter',
    audience: 'For browsing course codes and sample previews',
    priceNaira: 0,
    periodLabel: 'forever',
    includesFullArchive: false,
    includesAiAccess: false,
    features: [
      'Browse university sessions & semesters',
      'Read marked free sample papers',
      'Instant course code search',
    ],
  },
  {
    id: 'session_5000',
    cadence: 'session',
    name: 'Session Pass + AI',
    audience: 'Full academic session (both semesters)',
    priceNaira: 5000,
    periodLabel: 'per session',
    includesFullArchive: true,
    includesAiAccess: true,
    aiNote: 'AI study access unlocked automatically on rollout',
    features: [
      'Both Harmattan & Rain semesters',
      'AI Study Companion access reserved',
      'Unlimited archive search & reading',
    ],
  },
  {
    id: 'session_8500',
    cadence: 'session',
    name: 'Session Max + AI',
    audience: 'For power scholars across the full year',
    priceNaira: 8500,
    periodLabel: 'per session',
    includesFullArchive: true,
    includesAiAccess: true,
    aiNote: 'Priority AI compute tier reserved',
    highlighted: true,
    features: [
      'Everything in Session Pass + AI',
      'Priority AI tutor queue when live',
      'Multi-year comparative archive view',
    ],
  },
];

export function formatNaira(amount: number): string {
  if (amount === 0) return '₦0';
  return `₦${amount.toLocaleString('en-NG')}`;
}

export function getPlanById(id: SubscriptionTierId): SubscriptionPlan {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id) ?? SUBSCRIPTION_PLANS[0];
}

export function hasArchiveAccess(tierId: SubscriptionTierId): boolean {
  return tierId !== 'free';
}

export function hasAiAccess(tierId: SubscriptionTierId): boolean {
  return (
    tierId === 'monthly_1000' ||
    tierId === 'semester_3500' ||
    tierId === 'session_5000' ||
    tierId === 'session_8500'
  );
}
