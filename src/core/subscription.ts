import { useEffect, useState } from 'react';

/**
 * MASTER FREE-TIER SWITCH
 * -----------------------
 * Set `FREE_TIER_ENABLED` to `false` when ready to require a paid plan.
 * When `false`, unsubscribed users are routed to the Subscription Paywall
 * on any protected action until they complete a plan subscription.
 */
export const FREE_TIER_ENABLED = true;

/**
 * Master AI-feature flag (kept `false` until backend AI integration is installed).
 * Tier 3 UI entries stay visible in a locked/disabled state and route to the
 * Subscription Paywall highlighting Tier 3 AI benefits.
 */
export const AI_INTEGRATION_ENABLED = false;

export type BillingPeriod = 'monthly' | 'semester' | 'yearly';

export type SubscriptionTierId = 'free' | 'standard' | 'pro_ai';

export interface BillingPeriodMeta {
  id: BillingPeriod;
  label: string;
  shortUnit: string;
  savingsNote?: string;
}

export interface TierPlanPrice {
  amountNaira: number;
  cadenceLabel: string;
  equivalentNote?: string;
}

export interface SubscriptionTierSpec {
  id: SubscriptionTierId;
  tierNumber: 1 | 2 | 3;
  name: string;
  audience: string;
  summary: string;
  aiIncluded: boolean;
  comingSoon?: boolean;
  pricing: Record<BillingPeriod, TierPlanPrice>;
  features: string[];
  excludedNote?: string;
}

export interface PaywallContext {
  highlightTier?: SubscriptionTierId;
  featureLabel?: string;
  reason?: string;
  blockedByPaywall?: boolean;
}

export interface SubscriptionState {
  activeTier: SubscriptionTierId | null;
  billingPeriod: BillingPeriod;
}

export const BILLING_PERIODS: BillingPeriodMeta[] = [
  { id: 'monthly', label: 'Monthly', shortUnit: '/ month' },
  { id: 'semester', label: 'Semester', shortUnit: '/ semester', savingsNote: '4 months · Save 20%' },
  { id: 'yearly', label: 'Yearly', shortUnit: '/ year', savingsNote: '12 months · Best value' },
];

export const SUBSCRIPTION_TIERS: SubscriptionTierSpec[] = [
  {
    id: 'free',
    tierNumber: 1,
    name: 'Free Starter',
    audience: '',
    summary: '',
    aiIncluded: false,
    pricing: {
      monthly: { amountNaira: 0, cadenceLabel: '/ month' },
      semester: { amountNaira: 0, cadenceLabel: '/ semester' },
      yearly: { amountNaira: 0, cadenceLabel: '/ year' },
    },
    features: [
      'Search & read past questions',
      'Worked step-by-step answers',
      'Course reading guides',
      'Practice Exam & score tracker',
    ],
  },
  {
    id: 'standard',
    tierNumber: 2,
    name: 'Standard Pass',
    audience: '',
    summary: '',
    aiIncluded: false,
    pricing: {
      monthly: { amountNaira: 1000, cadenceLabel: '/ month' },
      semester: {
        amountNaira: 3200,
        cadenceLabel: '/ semester',
        equivalentNote: '₦800 / mo · 4 months',
      },
      yearly: {
        amountNaira: 5500,
        cadenceLabel: '/ year',
        equivalentNote: '₦458 / mo · Full year',
      },
    },
    features: [
      'Unlimited past questions & worked answers',
      'All 4 Practice Exam modes (OBJ, Theory, T/F, CBT)',
      'Offline study guide downloads',
      'Full score breakdown & alerts',
    ],
  },
  {
    id: 'pro_ai',
    tierNumber: 3,
    name: 'AI Scholar',
    audience: '',
    summary: '',
    aiIncluded: true,
    comingSoon: !AI_INTEGRATION_ENABLED,
    pricing: {
      monthly: { amountNaira: 2500, cadenceLabel: '/ month' },
      semester: {
        amountNaira: 7500,
        cadenceLabel: '/ semester',
        equivalentNote: '₦1,875 / mo · Save 25%',
      },
      yearly: {
        amountNaira: 13000,
        cadenceLabel: '/ year',
        equivalentNote: '₦1,083 / mo · Save 57%',
      },
    },
    features: [
      'Everything in Standard Pass',
      'AI step-by-step question tutor',
      'AI topic & exam predictions',
      'AI guide summaries & theory coach',
    ],
  },
];

const STORAGE_KEY = 'pqguide:subscription:v1';

const defaultState = (): SubscriptionState => ({
  activeTier: FREE_TIER_ENABLED ? 'free' : null,
  billingPeriod: 'semester',
});

let currentState: SubscriptionState = (() => {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<SubscriptionState>;
    const validPeriod: BillingPeriod =
      parsed.billingPeriod === 'monthly' ||
      parsed.billingPeriod === 'semester' ||
      parsed.billingPeriod === 'yearly'
        ? parsed.billingPeriod
        : 'semester';
    const validTier: SubscriptionTierId | null =
      parsed.activeTier === 'standard' || parsed.activeTier === 'pro_ai'
        ? parsed.activeTier
        : FREE_TIER_ENABLED
          ? 'free'
          : null;
    return { activeTier: validTier, billingPeriod: validPeriod };
  } catch {
    return defaultState();
  }
})();

const listeners = new Set<() => void>();

function notify() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
  } catch {
    /* ignore storage errors */
  }
  listeners.forEach((fn) => fn());
}

export const subscriptionService = {
  getState(): SubscriptionState {
    return currentState;
  },

  setBillingPeriod(billingPeriod: BillingPeriod) {
    currentState = { ...currentState, billingPeriod };
    notify();
  },

  activateTier(activeTier: SubscriptionTierId) {
    currentState = { ...currentState, activeTier };
    notify();
  },

  hasStandardAccess(): boolean {
    if (FREE_TIER_ENABLED) return true;
    return currentState.activeTier === 'standard' || currentState.activeTier === 'pro_ai';
  },

  hasAiAccess(): boolean {
    return AI_INTEGRATION_ENABLED && currentState.activeTier === 'pro_ai';
  },

  formatNaira(amount: number): string {
    return `₦${amount.toLocaleString('en-NG')}`;
  },
};

export function useSubscription(): SubscriptionState {
  const [state, setState] = useState<SubscriptionState>(() => subscriptionService.getState());
  useEffect(() => {
    const update = () => setState(subscriptionService.getState());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}
