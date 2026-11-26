import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
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
      {/* Minimal Top Control Row: Back icon (left) and Close icon (right) only — no header bar */}
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
        {/* Focused Title Block */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#1A1B20] sm:text-3xl">
            {paywallContext?.blockedByPaywall
              ? 'Choose a plan to continue'
              : isAiTrigger
                ? 'Unlock AI Scholar tools'
                : 'Choose your pqguide plan'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#5A5E6B]">
            {paywallContext?.blockedByPaywall
              ? paywallContext.reason ||
                'Free access has ended. Pick Standard Pass for full webapp access or AI Scholar for upcoming AI study tools.'
              : isAiTrigger
                ? 'Standard Pass covers the normal webapp features, while Tier 3 (AI Scholar) adds AI study assistance.'
                : 'Select a billing cycle and compare Free, Standard, and AI Scholar tiers.'}
          </p>
        </div>

        {/* Contextual Callout Banner when triggered from an AI-gated feature */}
        {isAiTrigger && (
          <div
            role="status"
            className="mx-auto mt-6 max-w-3xl rounded-2xl border border-[#1A1B20]/15 bg-[#1D1E23] p-4 text-white sm:p-5"
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold sm:text-base">
                  {paywallContext?.featureLabel
                    ? `${paywallContext.featureLabel} is part of Tier 3 — AI Scholar`
                    : 'This feature is part of Tier 3 — AI Scholar'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#C3C7D2] sm:text-sm">
                  {paywallContext?.reason ||
                    'Your current plan only covers normal webapp study tools. Upgrade to Tier 3 when AI launches to unlock AI explanations, smart focus predictions, and guided theory coaching.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/10 pt-3 text-xs text-[#D5D8E2]">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#A5AAB8]" />
                    AI Scholar integration &amp; checkout are not active yet (preview only)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Billing Cycle Switcher (Monthly · Semester · Yearly) */}
        <div className="mt-7 flex flex-col items-center">
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
                  className={`min-h-[42px] cursor-pointer rounded-xl px-4 text-xs font-semibold transition-colors duration-150 sm:px-6 sm:text-sm ${
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
          <p className="mt-2 min-h-[18px] font-mono-tabular text-xs text-[#686C78]">
            {activePeriodMeta.savingsNote ?? 'Billed every month · Switch cycle anytime'}
          </p>
        </div>

        {/* 3-Tier Cards Grid */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          {SUBSCRIPTION_TIERS.map((tier) => {
            const price = tier.pricing[billingPeriod];
            const isFree = tier.id === 'free';
            const isTier3 = tier.id === 'pro_ai';
            const isCurrentFree = isFree && FREE_TIER_ENABLED && activeTier === 'free';
            const isFreeDisabled = isFree && !FREE_TIER_ENABLED;
            const isHighlighted = highlightedTier === tier.id;
            const useDarkCard = isTier3 && isAiTrigger;
            const showPreviewNotice = selectedNoticeTier === tier.id;

            return (
              <section
                key={tier.id}
                ref={isTier3 ? tier3Ref : undefined}
                aria-label={`${tier.name} plan`}
                className={`relative flex flex-col justify-between rounded-3xl p-5 transition-all duration-200 sm:p-6 ${
                  useDarkCard
                    ? 'border-2 border-[#1D1E23] bg-[#1D1E23] text-white shadow-[0_18px_36px_-14px_rgba(18,19,24,0.45)]'
                    : isHighlighted
                      ? 'border-2 border-[#1D1E23] bg-white text-[#1A1B20] shadow-[0_10px_26px_-12px_rgba(24,25,30,0.2)]'
                      : 'border border-[#1A1B20]/[0.08] bg-white text-[#1A1B20] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)]'
                }`}
              >
                <div>
                  {/* Tier Label & State Line */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.08em] ${
                        useDarkCard ? 'text-[#A5AAB8]' : 'text-[#686C78]'
                      }`}
                    >
                      Tier {tier.tierNumber} · {activePeriodMeta.label}
                    </span>

                    {isCurrentFree && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#16A34A]">
                        Active now
                      </span>
                    )}
                    {isFreeDisabled && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#DC2626]">
                        Ended
                      </span>
                    )}
                    {isTier3 && !AI_INTEGRATION_ENABLED && (
                      <span
                        className={`inline-flex items-center gap-1 font-mono-tabular text-[11px] font-semibold ${
                          useDarkCard ? 'text-[#FBBF24]' : 'text-[#D97706]'
                        }`}
                      >
                        <Lock className="h-3 w-3" />
                        AI Coming Soon
                      </span>
                    )}
                  </div>

                  {/* Plan Title & Audience */}
                  <h2 className="mt-2 font-display text-xl font-bold">{tier.name}</h2>
                  <p
                    className={`mt-0.5 text-xs font-medium ${
                      useDarkCard ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                    }`}
                  >
                    {tier.audience}
                  </p>

                  {/* Price Block */}
                  <div
                    className={`mt-5 border-b pb-5 ${
                      useDarkCard ? 'border-white/10' : 'border-[#1A1B20]/[0.07]'
                    }`}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono-tabular text-3xl font-bold tracking-tight">
                        {subscriptionService.formatNaira(price.amountNaira)}
                      </span>
                      <span
                        className={`text-xs ${
                          useDarkCard ? 'text-[#A5AAB8]' : 'text-[#686C78]'
                        }`}
                      >
                        {price.cadenceLabel}
                      </span>
                    </div>
                    <p
                      className={`mt-1 min-h-[16px] font-mono-tabular text-xs ${
                        useDarkCard ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                      }`}
                    >
                      {price.equivalentNote ??
                        (isFree
                          ? FREE_TIER_ENABLED
                            ? 'Available free right now'
                            : 'Paid plan now required'
                          : `${activePeriodMeta.label} access`)}
                    </p>
                  </div>

                  {/* Summary */}
                  <p
                    className={`mt-4 text-xs leading-relaxed sm:text-sm ${
                      useDarkCard ? 'text-[#D5D8E2]' : 'text-[#505460]'
                    }`}
                  >
                    {tier.summary}
                  </p>

                  {/* Feature List */}
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

                  {tier.excludedNote && (
                    <p
                      className={`mt-4 border-t pt-3 text-xs leading-relaxed ${
                        useDarkCard
                          ? 'border-white/10 text-[#A5AAB8]'
                          : 'border-[#1A1B20]/[0.07] text-[#686C78]'
                      }`}
                    >
                      {tier.excludedNote}
                    </p>
                  )}
                </div>

                {/* Action Button + Frontend-only Payment Status */}
                <div className="mt-6 space-y-2.5">
                  {isFree ? (
                    <button
                      type="button"
                      disabled
                      className="min-h-[46px] w-full rounded-2xl border border-[#1A1B20]/[0.08] bg-[#F6F7F9] px-4 text-sm font-semibold text-[#5A5E6B] opacity-85 cursor-not-allowed"
                    >
                      {FREE_TIER_ENABLED ? 'Current Free Plan' : 'Free Tier Closed'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleTierAction(tier.id)}
                      className={`min-h-[46px] w-full cursor-pointer rounded-2xl px-4 text-sm font-semibold transition-transform duration-150 active:scale-[0.98] ${
                        useDarkCard
                          ? 'bg-white text-[#1A1B20] hover:bg-[#ECEEF3]'
                          : isTier3
                            ? 'bg-[#2B2D35] text-white hover:bg-[#1D1E23]'
                            : 'tactile-dark text-white'
                      }`}
                    >
                      {isTier3
                        ? `Pay ${subscriptionService.formatNaira(price.amountNaira)} · Preview`
                        : `Pay ${subscriptionService.formatNaira(price.amountNaira)}`}
                    </button>
                  )}

                  {showPreviewNotice && (
                    <div
                      role="status"
                      className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
                        useDarkCard
                          ? 'border-white/15 bg-white/10 text-[#E6E8F0]'
                          : 'border-[#1A1B20]/[0.1] bg-[#F6F7F9] text-[#3A3D47]'
                      }`}
                    >
                      {isTier3
                        ? 'AI Scholar & payment checkout are not active yet because AI integration is still being added. Use Back or Close to keep studying.'
                        : 'Online checkout is not enabled yet (frontend preview). Use Back or Close to return to what you were doing.'}
                    </div>
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
