import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import {
  AI_INTEGRATION_ENABLED,
  BILLING_PERIODS,
  FREE_TIER_ENABLED,
  SUBSCRIPTION_TIERS,
  subscriptionService,
  useSubscription,
  type BillingPeriod,
  type PaywallContext,
  type SubscriptionTierId,
} from '../core/subscription';

interface SubscriptionScreenProps {
  paywallContext?: PaywallContext | null;
  onBack: () => void;
  onClose: () => void;
}

export const SubscriptionScreen: React.FC<SubscriptionScreenProps> = ({
  paywallContext,
  onBack,
  onClose,
}) => {
  const { activeTier, billingPeriod } = useSubscription();
  const [selectedNoticeTier, setSelectedNoticeTier] = useState<SubscriptionTierId | null>(null);
  const tier3Ref = useRef<HTMLElement | null>(null);

  const highlightedTier: SubscriptionTierId | null =
    paywallContext?.highlightTier ?? (paywallContext?.blockedByPaywall ? 'standard' : null);
  const isAiTrigger = highlightedTier === 'pro_ai';

  // When opened by tapping a disabled AI control, bring Tier 3 into view on smaller viewports.
  useEffect(() => {
    setSelectedNoticeTier(null);
    if (isAiTrigger && tier3Ref.current) {
      const timer = window.setTimeout(() => {
        tier3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 140);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isAiTrigger, paywallContext]);

  const handlePeriodChange = (period: BillingPeriod) => {
    subscriptionService.setBillingPeriod(period);
    setSelectedNoticeTier(null);
  };

  const handleTierAction = (tierId: SubscriptionTierId) => {
    if (tierId === 'free') return;
    setSelectedNoticeTier(tierId);
  };

  const activePeriodMeta =
    BILLING_PERIODS.find((p) => p.id === billingPeriod) ?? BILLING_PERIODS[1];

  return (
    <div className="min-h-[100dvh] bg-[#F6F7F9] text-[#1A1B20] page-enter">
      {/* Top Bar: Back icon (left) and Close icon (right) */}
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#1A1B20]/[0.08] bg-white text-[#1A1B20] shadow-[0_2px_8px_-4px_rgba(24,25,30,0.14)] transition-transform duration-150 hover:bg-[#ECEEF3] active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close subscription page"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#1A1B20]/[0.08] bg-white text-[#1A1B20] shadow-[0_2px_8px_-4px_rgba(24,25,30,0.14)] transition-transform duration-150 hover:bg-[#ECEEF3] active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <main className="mx-auto max-w-5xl px-4 pt-3 pb-12 sm:px-6 lg:px-8">
        {/* Direct Title & 1-Line Action Guide */}
        <div className="mx-auto max-w-xl text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#1A1B20] sm:text-3xl">
            {paywallContext?.blockedByPaywall
              ? 'Pick a plan to continue'
              : isAiTrigger
                ? 'Unlock AI Scholar'
                : 'Choose your plan'}
          </h1>
          <p className="mt-1.5 text-sm text-[#5A5E6B]">
            {paywallContext?.blockedByPaywall
              ? 'Free access has ended. Pick Standard or AI Scholar below.'
              : isAiTrigger
                ? `${paywallContext?.featureLabel ?? 'This tool'} is part of AI Scholar (coming soon).`
                : 'Select a billing cycle, then tap a plan below.'}
          </p>
        </div>

        {/* Compact AI Feature Notice when opened from a locked AI button */}
        {isAiTrigger && (
          <div
            role="status"
            className="mx-auto mt-5 flex max-w-2xl items-center gap-3 rounded-2xl border border-[#1A1B20]/10 bg-white px-4 py-3 text-xs text-[#3A3D47] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] sm:text-sm"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1D1E23] text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <p className="min-w-0 leading-snug">
              AI tools launch soon in Tier 3. All core study tools remain available in{' '}
              <strong className="font-semibold text-[#1A1B20]">Standard Pass</strong>.
            </p>
          </div>
        )}

        {/* Billing Cycle Switcher (Monthly · Semester · Yearly) */}
        <div className="mt-6 flex flex-col items-center">
          <div
            role="tablist"
            aria-label="Billing cycle"
            className="inline-grid grid-cols-3 rounded-2xl border border-[#1A1B20]/[0.08] bg-white p-1 shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)]"
          >
            {BILLING_PERIODS.map((period) => {
              const active = period.id === billingPeriod;
              return (
                <button
                  key={period.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handlePeriodChange(period.id)}
                  className={`min-h-[42px] cursor-pointer whitespace-nowrap rounded-xl px-4 text-xs font-semibold transition-colors duration-150 sm:px-6 sm:text-sm ${
                    active
                      ? 'tactile-dark text-white'
                      : 'text-[#5A5E6B] hover:bg-[#F6F7F9] hover:text-[#1A1B20]'
                  }`}
                >
                  {period.label}
                </button>
              );
            })}
          </div>
          {activePeriodMeta.savingsNote && (
            <p className="mt-2 font-mono-tabular text-xs font-medium text-[#5A5E6B]">
              {activePeriodMeta.savingsNote}
            </p>
          )}
        </div>

        {/* 3-Tier Cards Grid (Tier 2 is Dark Ash focal card) */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          {SUBSCRIPTION_TIERS.map((tier) => {
            const price = tier.pricing[billingPeriod];
            const isFree = tier.id === 'free';
            const isTier2 = tier.id === 'standard';
            const isTier3 = tier.id === 'pro_ai';
            const isCurrentFree = isFree && FREE_TIER_ENABLED && activeTier === 'free';
            const isFreeDisabled = isFree && !FREE_TIER_ENABLED;
            const useDarkCard = isTier2;
            const isHighlightedOutline = isTier3 && isAiTrigger;
            const showPreviewNotice = selectedNoticeTier === tier.id;

            return (
              <section
                key={tier.id}
                ref={isTier3 ? tier3Ref : undefined}
                aria-label={`${tier.name} plan`}
                className={`relative flex flex-col justify-between rounded-3xl p-5 transition-all duration-200 sm:p-6 ${
                  useDarkCard
                    ? 'border-2 border-[#1D1E23] bg-[#1D1E23] text-white shadow-[0_18px_36px_-14px_rgba(18,19,24,0.45)]'
                    : isHighlightedOutline
                      ? 'border-2 border-[#1D1E23] bg-white text-[#1A1B20] shadow-[0_10px_26px_-12px_rgba(24,25,30,0.2)]'
                      : 'border border-[#1A1B20]/[0.08] bg-white text-[#1A1B20] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)]'
                }`}
              >
                <div>
                  {/* Quiet Metadata Line */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.08em] ${
                        useDarkCard ? 'text-[#A5AAB8]' : 'text-[#686C78]'
                      }`}
                    >
                      Tier {tier.tierNumber}
                      {isTier2 ? ' · Recommended' : ''}
                    </span>

                    {isCurrentFree && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#16A34A]">
                        Active
                      </span>
                    )}
                    {isFreeDisabled && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#DC2626]">
                        Ended
                      </span>
                    )}
                    {isTier3 && !AI_INTEGRATION_ENABLED && (
                      <span className="inline-flex items-center gap-1 font-mono-tabular text-[11px] font-semibold text-[#D97706]">
                        <Lock className="h-3 w-3" />
                        Coming soon
                      </span>
                    )}
                  </div>

                  {/* Plan Name */}
                  <h2 className="mt-2 font-display text-xl font-bold">{tier.name}</h2>

                  {/* Price */}
                  <div
                    className={`mt-4 border-b pb-4 ${
                      useDarkCard ? 'border-white/12' : 'border-[#1A1B20]/[0.07]'
                    }`}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono-tabular text-3xl font-bold tracking-tight">
                        {subscriptionService.formatNaira(price.amountNaira)}
                      </span>
                      <span
                        className={`text-xs ${
                          useDarkCard ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                        }`}
                      >
                        {price.cadenceLabel}
                      </span>
                    </div>
                    {price.equivalentNote && (
                      <p
                        className={`mt-1 font-mono-tabular text-xs ${
                          useDarkCard ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                        }`}
                      >
                        {price.equivalentNote}
                      </p>
                    )}
                  </div>

                  {/* Concise Benefits List */}
                  <ul className="mt-4 space-y-2.5">
                    {tier.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5 text-xs sm:text-sm">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            useDarkCard
                              ? 'bg-white/15 text-white'
                              : 'bg-[#1D1E23]/[0.07] text-[#1A1B20]'
                          }`}
                        >
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                        <span className={useDarkCard ? 'text-[#F0F2F7]' : 'text-[#2D3038]'}>
                          {feat}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Action Button */}
                <div className="mt-6 space-y-2.5">
                  {isFree ? (
                    <button
                      type="button"
                      disabled
                      className="min-h-[46px] w-full rounded-2xl border border-[#1A1B20]/[0.08] bg-[#F6F7F9] px-4 text-sm font-semibold text-[#5A5E6B] opacity-85 cursor-not-allowed"
                    >
                      {FREE_TIER_ENABLED ? 'Current Plan' : 'Free Tier Closed'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleTierAction(tier.id)}
                      className={`min-h-[46px] w-full cursor-pointer rounded-2xl px-4 text-sm font-semibold transition-transform duration-150 active:scale-[0.98] ${
                        useDarkCard
                          ? 'bg-white text-[#1D1E23] hover:bg-[#ECEEF3] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.4)]'
                          : 'tactile-dark text-white'
                      }`}
                    >
                      {isTier3 && !AI_INTEGRATION_ENABLED
                        ? `Preview · ${subscriptionService.formatNaira(price.amountNaira)}`
                        : `Choose ${tier.name.split(' ')[0]} · ${subscriptionService.formatNaira(price.amountNaira)}`}
                    </button>
                  )}

                  {showPreviewNotice && (
                    <p
                      role="status"
                      className={`rounded-xl px-3 py-2 text-xs leading-snug ${
                        useDarkCard
                          ? 'bg-white/10 text-[#E6E8F0]'
                          : 'bg-[#F6F7F9] text-[#505460]'
                      }`}
                    >
                      {isTier3
                        ? 'AI Scholar opens when AI launches. Tap Back or Close to keep studying.'
                        : 'Checkout opens soon. Tap Back or Close to keep studying.'}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
};
