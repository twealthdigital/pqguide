import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  X,
} from 'lucide-react';
import { PqGuideAiIcon } from '../components/ui/PqGuideAiIcon';
import type {
  AuthenticatedUser,
  PaymentProvider,
  PaymentTransaction,
} from '../core/types';
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
import { archiveRepository } from '../services/archiveRepository';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { TooltipBubble } from '../components/ui/TooltipBubble';

interface SubscriptionScreenProps {
  currentUser?: AuthenticatedUser | null;
  paywallContext?: PaywallContext | null;
  onBack: () => void;
  onClose: () => void;
}

export const SubscriptionScreen: React.FC<SubscriptionScreenProps> = ({
  currentUser,
  paywallContext,
  onBack,
  onClose,
}) => {
  const { siteCms } = useArchiveStore();
  const subCms = siteCms.subscriptionPage;
  const { activeTier, billingPeriod } = useSubscription();
  const [selectedNoticeTier, setSelectedNoticeTier] = useState<SubscriptionTierId | null>(null);
  const [checkoutTier, setCheckoutTier] = useState<'standard' | null>(null);
  const [provider, setProvider] = useState<PaymentProvider>('paystack');
  const [verifying, setVerifying] = useState(false);
  const [verifiedReceipt, setVerifiedReceipt] = useState<PaymentTransaction | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const tier3Ref = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

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

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handlePeriodChange = (period: BillingPeriod) => {
    subscriptionService.setBillingPeriod(period);
    setSelectedNoticeTier(null);
    setVerifiedReceipt(null);
    setCheckoutError(null);
  };

  const handleTierAction = (tierId: SubscriptionTierId) => {
    if (tierId === 'free') return;
    setCheckoutError(null);
    if (tierId === 'standard') {
      setSelectedNoticeTier(null);
      setVerifiedReceipt(null);
      setCheckoutTier('standard');
      return;
    }
    setCheckoutTier(null);
    setSelectedNoticeTier(tierId);
  };

  const handleVerifyAndActivate = () => {
    if (!checkoutTier || verifying) return;
    const tier = SUBSCRIPTION_TIERS.find((t) => t.id === checkoutTier);
    if (!tier) return;
    const price = tier.pricing[billingPeriod];

    if (!currentUser) {
      setCheckoutError('Please sign in first to verify and activate your subscription.');
      return;
    }

    setVerifying(true);
    setCheckoutError(null);
    const refPrefix = provider === 'paystack' ? 'PSK' : 'FLW';
    const reference = `${refPrefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    timerRef.current = window.setTimeout(() => {
      try {
        const tx = archiveRepository.recordPaymentTransaction(currentUser, {
          reference,
          provider,
          userId: currentUser.id,
          userName: currentUser.fullName,
          userEmail: currentUser.email,
          matricNumber: currentUser.matricNumber,
          level: currentUser.level,
          tierId: 'standard',
          tierName: tier.name,
          billingPeriod,
          amountNaira: price.amountNaira,
        });
        subscriptionService.activateTier('standard');
        setVerifiedReceipt(tx);
        setCheckoutTier(null);
      } catch (err) {
        setCheckoutError(
          err instanceof Error ? err.message : 'Unable to confirm payment automatically.'
        );
      } finally {
        setVerifying(false);
      }
    }, 650);
  };

  const activePeriodMeta =
    BILLING_PERIODS.find((p) => p.id === billingPeriod) ?? BILLING_PERIODS[1];

  return (
    <div className="min-h-[100dvh] bg-[#F6F7F9] text-[#1A1B20] page-enter">
      {/* Top Bar: Back icon (left) and Close icon (right) */}
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-6 lg:px-8">
        <TooltipBubble content="Return to previous page" side="right">
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#1A1B20]/[0.08] bg-white text-[#1A1B20] shadow-[0_2px_8px_-4px_rgba(24,25,30,0.14)] transition-transform duration-150 hover:bg-[#ECEEF3] active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </TooltipBubble>

        <TooltipBubble content="Close subscription plans" side="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close subscription page"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#1A1B20]/[0.08] bg-white text-[#1A1B20] shadow-[0_2px_8px_-4px_rgba(24,25,30,0.14)] transition-transform duration-150 hover:bg-[#ECEEF3] active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </TooltipBubble>
      </div>

      <main className="mx-auto max-w-5xl px-4 pt-3 pb-12 sm:px-6 lg:px-8">
        {/* Direct Title & 1-Line Action Guide */}
        <div className="mx-auto max-w-xl text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#1A1B20] sm:text-3xl">
            {activeTier === 'infinity'
              ? 'Infinity Plan Active'
              : paywallContext?.blockedByPaywall
                ? 'Pick a plan to continue'
                : isAiTrigger
                  ? `Unlock ${subCms.aiTierName}`
                  : subCms.heading}
          </h1>
          <p className="mt-1.5 text-sm text-[#5A5E6B]">
            {activeTier === 'infinity'
              ? 'Every control across Standard Pass and Tier 3 AI Scholar is unlocked for your Super Admin account.'
              : paywallContext?.blockedByPaywall
                ? `Free access has ended. Pick ${subCms.standardTierName} or ${subCms.aiTierName} below.`
                : isAiTrigger
                  ? `${paywallContext?.featureLabel ?? 'This tool'} is part of ${subCms.aiTierName} (coming soon).`
                  : subCms.subtitle}
          </p>
        </div>

        {/* Super Admin Infinity Master Control Banner */}
        {activeTier === 'infinity' && (
          <div
            role="status"
            className="mx-auto mt-5 flex max-w-3xl items-center justify-between gap-4 rounded-3xl border border-[#1D1E23] bg-[#1D1E23] px-5 py-4 text-white shadow-[0_14px_32px_-12px_rgba(18,19,24,0.45)]"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white">
                <PqGuideAiIcon size="sm" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm sm:text-base font-bold">
                  Infinity Plan · Master Access Enabled
                </p>
                <p className="mt-0.5 text-xs text-[#C3C7D2]">
                  Unlimited past questions, offline guides, mock exams, AI breakdowns, and flashcards active at no charge.
                </p>
              </div>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 font-mono-tabular text-xs font-semibold text-[#4ADE80] shrink-0">
              <CheckCircle2 className="h-4 w-4" />
              Unlocked
            </span>
          </div>
        )}

        {/* Compact AI Feature Notice when opened from a locked AI button */}
        {isAiTrigger && activeTier !== 'infinity' && (
          <div
            role="status"
            className="mx-auto mt-5 flex max-w-2xl items-center gap-3 rounded-2xl border border-[#1A1B20]/10 bg-white px-4 py-3 text-xs text-[#3A3D47] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] sm:text-sm"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1D1E23] text-white">
              <PqGuideAiIcon size="xs" />
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
            const displayName =
              tier.id === 'free'
                ? subCms.freeTierName
                : tier.id === 'standard'
                  ? subCms.standardTierName
                  : subCms.aiTierName;

            return (
              <section
                key={tier.id}
                ref={isTier3 ? tier3Ref : undefined}
                aria-label={`${displayName} plan`}
                className={`relative flex flex-col justify-between rounded-3xl p-5 transition-all duration-200 sm:p-6 ${
                  useDarkCard
                    ? 'border-2 border-[#141519] bg-[#16171C] bg-gradient-to-b from-[#23252C] to-[#141519] text-white shadow-[0_22px_44px_-14px_rgba(14,15,20,0.68)]'
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
                  <h2 className="mt-2 font-display text-xl font-bold">{displayName}</h2>

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
                  {activeTier === 'infinity' && !isFree ? (
                    <button
                      type="button"
                      disabled
                      className={`min-h-[46px] w-full rounded-2xl px-4 text-sm font-semibold cursor-default inline-flex items-center justify-center gap-2 ${
                        useDarkCard
                          ? 'bg-white/15 text-white'
                          : 'bg-[#1D1E23] text-white'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4 text-[#4ADE80]" />
                      <span>Unlocked · Infinity Plan</span>
                    </button>
                  ) : isFree ? (
                    <button
                      type="button"
                      disabled
                      className="min-h-[46px] w-full rounded-2xl border border-[#1A1B20]/[0.08] bg-[#F6F7F9] px-4 text-sm font-semibold text-[#5A5E6B] opacity-85 cursor-not-allowed"
                    >
                      {FREE_TIER_ENABLED ? 'Current Plan' : 'Free Tier Closed'}
                    </button>
                  ) : isTier2 && activeTier === 'standard' ? (
                    <button
                      type="button"
                      disabled
                      className="min-h-[46px] w-full rounded-2xl bg-white/15 px-4 text-sm font-semibold text-white cursor-default inline-flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4 text-[#4ADE80]" />
                      <span>Active Plan</span>
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
                        : `Choose ${displayName.split(' ')[0]} · ${subscriptionService.formatNaira(price.amountNaira)}`}
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
                      AI Scholar opens when AI launches. Tap Back or Close to keep studying.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {/* Instant Gateway Verification Panel (Paystack / Flutterwave) */}
        {checkoutTier === 'standard' && (
          <section
            aria-label="Automatic payment confirmation"
            className="mx-auto mt-6 max-w-2xl rounded-3xl border border-[#1A1B20]/12 bg-white p-5 sm:p-6 shadow-[0_14px_34px_-14px_rgba(18,19,24,0.22)] space-y-4 page-enter"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono-tabular text-[11px] font-semibold uppercase tracking-[0.08em] text-[#686C78]">
                  Instant Payment Confirmation
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-[#1A1B20]">
                  Standard Pass ·{' '}
                  {subscriptionService.formatNaira(
                    (
                      SUBSCRIPTION_TIERS.find((t) => t.id === 'standard')?.pricing[
                        billingPeriod
                      ].amountNaira ?? 0
                    )
                  )}{' '}
                  ({activePeriodMeta.label})
                </h2>
              </div>
              <TooltipBubble content="Close payment form" side="left">
                <button
                  type="button"
                  onClick={() => setCheckoutTier(null)}
                  aria-label="Close checkout"
                  className="h-9 w-9 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </TooltipBubble>
            </div>

            {checkoutError && (
              <div
                role="alert"
                className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]"
              >
                {checkoutError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['paystack', 'flutterwave'] as PaymentProvider[]).map((gateway) => {
                const selected = provider === gateway;
                return (
                  <button
                    key={gateway}
                    type="button"
                    disabled={verifying}
                    onClick={() => setProvider(gateway)}
                    className={`rounded-2xl border p-3.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                      selected
                        ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                        : 'border-[#1A1B20]/10 bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-bold capitalize">{gateway}</p>
                      <p className={`text-[11px] ${selected ? 'text-[#C3C7D2]' : 'text-[#686C78]'}`}>
                        Instant automatic verification
                      </p>
                    </div>
                    <CreditCard className="w-4 h-4 shrink-0" />
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-[#686C78]">
                {subCms.checkoutNote}
              </p>
              <button
                type="button"
                disabled={verifying}
                onClick={handleVerifyAndActivate}
                className="min-h-[44px] px-5 rounded-2xl bg-[#1D1E23] text-white text-sm font-semibold hover:bg-[#2B2D35] cursor-pointer inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-60"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying {provider === 'paystack' ? 'Paystack' : 'Flutterwave'}…</span>
                  </>
                ) : (
                  <span>
                    Pay &amp; Verify via {provider === 'paystack' ? 'Paystack' : 'Flutterwave'}
                  </span>
                )}
              </button>
            </div>
          </section>
        )}

        {/* Automatic Verification Receipt */}
        {verifiedReceipt && (
          <div
            role="status"
            className="mx-auto mt-6 max-w-2xl rounded-3xl border border-[#BBF7D0] bg-[#F0FDF4] p-5 flex items-start gap-3.5 text-[#14532D] page-enter"
          >
            <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1 text-xs sm:text-sm">
              <p className="font-display font-bold text-[#14532D]">
                Payment Verified Automatically — {verifiedReceipt.tierName} Active
              </p>
              <p className="font-mono-tabular">
                {verifiedReceipt.provider === 'paystack' ? 'Paystack' : 'Flutterwave'} ·{' '}
                {subscriptionService.formatNaira(verifiedReceipt.amountNaira)} · Ref:{' '}
                {verifiedReceipt.reference}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
