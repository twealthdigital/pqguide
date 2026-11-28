import { useEffect, useState } from 'react';
import type { UserRole } from './types';

/**
 * MASTER FREE-TIER SWITCH
 * -----------------------
 * Set `FREE_TIER_ENABLED` to `false` when ready to require a paid plan.
 * When `false`, unsubscribed users are routed to the Subscription Paywall
 * on any protected action until they complete a plan subscription.
 */
export const FREE_TIER_ENABLED = true;

export type BillingPeriod = 'monthly' | 'semester' | 'yearly';

export type SubscriptionTierId = 'free' | 'standard' | 'infinity';

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
  tierNumber: 1 | 2;
  name: string;
  audience: string;
  summary: string;
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
      parsed.activeTier === 'standard' || parsed.activeTier === 'infinity'
        ? parsed.activeTier
        : (parsed.activeTier as string) === 'pro_ai'
          ? 'standard'
        : FREE_TIER_ENABLED
          ? 'free'
          : null;
    return { activeTier: validTier, billingPeriod: validPeriod };
  } catch {
    return defaultState();
  }
})();

let roleOverride: UserRole | null = null;

const listeners = new Set<() => void>();

function notify(persist = true) {
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
    } catch {
      /* ignore storage errors */
    }
  }
  listeners.forEach((fn) => fn());
}

export const subscriptionService = {
  setRoleOverride(role: UserRole | null) {
    if (roleOverride === role) return;
    roleOverride = role;
    notify(false);
  },

  isInfinityActive(): boolean {
    return roleOverride === 'super_admin' || currentState.activeTier === 'infinity';
  },

  getState(): SubscriptionState {
    if (roleOverride === 'super_admin') {
      return {
        activeTier: 'infinity',
        billingPeriod: currentState.billingPeriod,
      };
    }
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
    if (roleOverride === 'super_admin') return true;
    if (FREE_TIER_ENABLED) return true;
    return currentState.activeTier === 'standard' || currentState.activeTier === 'infinity';
  },

  formatNaira(amount: number): string {
    return `₦${amount.toLocaleString('en-NG')}`;
  },
};

export function useSubscription(): SubscriptionState {
  const [state, setState] = useState<SubscriptionState>(() => subscriptionService.getState());
  useEffect(() => {
    const update = () => setState(subscriptionService.getState());
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}
