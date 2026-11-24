import React, { useMemo, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { SubscriptionCadence, SubscriptionPlan } from '../core/types';
import {
  CADENCE_LABELS,
  SUBSCRIPTION_PLANS,
  formatNaira,
  getPlanById,
} from '../core/pricing';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';

export const SubscriptionScreen: React.FC = () => {
  const store = useArchiveStore();
  const [cadence, setCadence] = useState<SubscriptionCadence>('semester');
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null);

  const plans = useMemo(
    () => SUBSCRIPTION_PLANS.filter((plan) => plan.cadence === cadence),
    [cadence]
  );

  const currentPlan = getPlanById(store.activeTierId);

  const handleConfirmPlan = (plan: SubscriptionPlan) => {
    archiveRepository.setActiveTier(plan.id);
    setCheckoutPlan(null);
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Dark Ash Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6 sm:p-8">
        <p className="text-xs font-medium text-[#A5AAB8]">
          Flexible Student Passes
        </p>
        <h1
          className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5 max-w-xl"
          style={{ textWrap: 'balance' }}
        >
          Pay only for the semester, month, or session you need
        </h1>
        <p className="text-sm text-[#B8BCC8] mt-2 max-w-2xl">
          Every billing cycle includes a Free Starter preview tier. Tiers from{' '}
          <strong className="text-white font-mono-tabular">₦1,000/mo</strong>,{' '}
          <strong className="text-white font-mono-tabular">₦3,500/semester</strong>, and{' '}
          <strong className="text-white font-mono-tabular">₦5,000/session</strong> include
          reserved AI study access.
        </p>

        <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-[#C6C9D4]">
          <span>
            Active Tier:{' '}
            <strong className="text-white">{currentPlan.name}</strong> (
            {formatNaira(currentPlan.priceNaira)} {currentPlan.periodLabel})
          </span>
          {currentPlan.includesAiAccess && (
            <span className="inline-flex items-center gap-1.5 text-white font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              AI Tier Reserved
            </span>
          )}
        </div>
      </SurfaceCard>

      {/* Cadence Segmented Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div
          className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-[#EAECEF] self-start"
          role="tablist"
          aria-label="Billing cadence"
        >
          {(['monthly', 'semester', 'session'] as SubscriptionCadence[]).map(
            (item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={cadence === item}
                onClick={() => setCadence(item)}
                className={`min-h-[40px] px-4 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  cadence === item
                    ? 'bg-white text-[#1A1B20] shadow-sm'
                    : 'text-[#686C78] hover:text-[#1A1B20]'
                }`}
              >
                {CADENCE_LABELS[item]}
              </button>
            )
          )}
        </div>

        <p className="text-xs text-[#686C78]">
          All prices in Nigerian Naira (₦) · Instant archive unlock
        </p>
      </div>

      {/* Pricing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {plans.map((plan, idx) => {
          const isCurrent = store.activeTierId === plan.id && (plan.id !== 'free' || store.activeTierId === 'free');
          const isDarkHighlight = Boolean(plan.highlighted);

          return (
            <SurfaceCard
              key={`${plan.cadence}-${plan.id}-${idx}`}
              tone={isDarkHighlight ? 'ash' : 'white'}
              withWaves={isDarkHighlight}
              className="flex flex-col justify-between p-6"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2
                      className={`font-display text-lg font-bold ${
                        isDarkHighlight ? 'text-white' : 'text-[#1A1B20]'
                      }`}
                    >
                      {plan.name}
                    </h2>
                    <p
                      className={`text-xs mt-1 ${
                        isDarkHighlight ? 'text-[#B2B6C4]' : 'text-[#686C78]'
                      }`}
                    >
                      {plan.audience}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-baseline gap-2">
                  <span
                    className={`font-display font-mono-tabular text-3xl font-extrabold ${
                      isDarkHighlight ? 'text-white' : 'text-[#1A1B20]'
                    }`}
                  >
                    {formatNaira(plan.priceNaira)}
                  </span>
                  <span
                    className={`text-xs ${
                      isDarkHighlight ? 'text-[#A5AAB8]' : 'text-[#686C78]'
                    }`}
                  >
                    {plan.periodLabel}
                  </span>
                </div>

                {plan.includesAiAccess && (
                  <div
                    className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${
                      isDarkHighlight ? 'text-white' : 'text-[#1D1E23]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>{plan.aiNote}</span>
                  </div>
                )}

                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feat) => (
                    <li
                      key={feat}
                      className={`flex items-start gap-2.5 text-xs sm:text-sm ${
                        isDarkHighlight ? 'text-[#D8DCE6]' : 'text-[#434753]'
                      }`}
                    >
                      <Check
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          isDarkHighlight ? 'text-white' : 'text-[#1D1E23]'
                        }`}
                      />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-current/10">
                <TactileButton
                  variant={isDarkHighlight ? 'light' : 'dark'}
                  fullWidth
                  disabled={isCurrent}
                  onClick={() =>
                    plan.priceNaira === 0
                      ? handleConfirmPlan(plan)
                      : setCheckoutPlan(plan)
                  }
                >
                  {isCurrent
                    ? 'Current Plan'
                    : plan.priceNaira === 0
                    ? 'Use Free Starter'
                    : `Activate ${formatNaira(plan.priceNaira)}`}
                </TactileButton>
              </div>
            </SurfaceCard>
          );
        })}
      </div>

      {/* Checkout Confirmation Modal */}
      {checkoutPlan && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-title"
        >
          <SurfaceCard tone="white" className="w-full max-w-md p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[#686C78]">
                  Student Pass Activation
                </p>
                <h2
                  id="checkout-title"
                  className="font-display text-xl font-bold text-[#1A1B20] mt-0.5"
                >
                  {checkoutPlan.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutPlan(null)}
                aria-label="Close payment sheet"
                className="min-h-[40px] min-w-[40px] rounded-xl bg-[#F6F7F9] flex items-center justify-center text-[#1A1B20] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-[#F6F7F9] p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#686C78]">Billing Cycle</span>
                <span className="font-semibold text-[#1A1B20]">
                  {CADENCE_LABELS[checkoutPlan.cadence]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#686C78]">Amount</span>
                <span className="font-mono-tabular font-bold text-[#1A1B20]">
                  {formatNaira(checkoutPlan.priceNaira)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#686C78]">AI Study Access</span>
                <span className="font-semibold text-[#1A1B20]">
                  {checkoutPlan.includesAiAccess ? 'Included (Reserved)' : 'Not included'}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#686C78] mt-4 leading-relaxed">
              Payment gateway hook ready (Paystack / Bank Transfer). Confirm below to activate this tier in your workspace and unlock all past questions.
            </p>

            <div className="mt-5 flex items-center gap-3">
              <TactileButton
                variant="light"
                fullWidth
                onClick={() => setCheckoutPlan(null)}
              >
                Cancel
              </TactileButton>
              <TactileButton
                variant="dark"
                fullWidth
                onClick={() => handleConfirmPlan(checkoutPlan)}
              >
                Confirm {formatNaira(checkoutPlan.priceNaira)}
              </TactileButton>
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
};
