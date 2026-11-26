import React, { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Search } from 'lucide-react';
import type { PaymentProvider } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import { SectionHeadingBar, SurfaceCard } from '../../../components/ui';

interface PaymentsTabProps {
  store: AppStoreState;
}

export const PaymentsTab: React.FC<PaymentsTabProps> = ({ store }) => {
  const [providerFilter, setProviderFilter] = useState<'all' | PaymentProvider>('all');
  const [query, setQuery] = useState('');

  const summary = useMemo(() => {
    const verified = store.payments.filter((p) => p.status === 'verified_auto');
    const totalNaira = verified.reduce((sum, p) => sum + p.amountNaira, 0);
    const paystack = verified.filter((p) => p.provider === 'paystack');
    const flutterwave = verified.filter((p) => p.provider === 'flutterwave');

    return {
      totalCount: verified.length,
      totalNaira,
      paystackCount: paystack.length,
      paystackNaira: paystack.reduce((sum, p) => sum + p.amountNaira, 0),
      flutterwaveCount: flutterwave.length,
      flutterwaveNaira: flutterwave.reduce((sum, p) => sum + p.amountNaira, 0),
    };
  }, [store.payments]);

  const filteredPayments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.payments.filter((tx) => {
      if (providerFilter !== 'all' && tx.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        tx.reference.toLowerCase().includes(q) ||
        tx.userName.toLowerCase().includes(q) ||
        tx.userEmail.toLowerCase().includes(q) ||
        (tx.matricNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [store.payments, providerFilter, query]);

  return (
    <div className="space-y-6">
      <section
        aria-label="Automatic payment verification summary"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4"
      >
        <SurfaceCard tone="white" className="p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Verified Revenue</span>
            <CreditCard className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            ₦{summary.totalNaira.toLocaleString()}
          </p>
          <p className="text-xs text-[#686C78] mt-1 font-mono-tabular">
            {summary.totalCount} payments
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Paystack</span>
            <CheckCircle2 className="w-4 h-4 text-[#15803D]" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            ₦{summary.paystackNaira.toLocaleString()}
          </p>
          <p className="text-xs text-[#686C78] mt-1 font-mono-tabular">
            {summary.paystackCount} verified
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Flutterwave</span>
            <CheckCircle2 className="w-4 h-4 text-[#15803D]" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            ₦{summary.flutterwaveNaira.toLocaleString()}
          </p>
          <p className="text-xs text-[#686C78] mt-1 font-mono-tabular">
            {summary.flutterwaveCount} verified
          </p>
        </SurfaceCard>
      </section>

      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <SectionHeadingBar
          icon={<CreditCard className="w-4 h-4" />}
          title={`Payment Confirmations (${filteredPayments.length})`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[#686C78] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ref, matric, email..."
              className="w-full min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 pl-8 pr-3 text-xs font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {(['all', 'paystack', 'flutterwave'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setProviderFilter(item)}
                className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold capitalize cursor-pointer transition-colors ${
                  providerFilter === item
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {filteredPayments.length === 0 ? (
          <p className="py-10 text-center text-xs text-[#686C78]">
            No payment confirmations match this filter.
          </p>
        ) : (
          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {filteredPayments.map((tx) => (
              <div
                key={tx.id}
                className="py-3.5 first:pt-1 last:pb-1 flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-[#1A1B20] truncate">
                      {tx.userName}
                    </p>
                    <span className="font-mono-tabular text-xs font-semibold text-[#15803D]">
                      Verified · {tx.provider === 'paystack' ? 'Paystack' : 'Flutterwave'}
                    </span>
                  </div>
                  <p className="text-xs text-[#505460]">
                    {tx.matricNumber ? `${tx.matricNumber} · ` : ''}
                    {tx.level ? `${tx.level} · ` : ''}
                    {tx.userEmail}
                  </p>
                  <p className="text-xs font-mono-tabular text-[#686C78]">
                    Ref: {tx.reference} · {tx.tierName} ({tx.billingPeriod})
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-display font-mono-tabular text-base font-extrabold text-[#1A1B20]">
                    ₦{tx.amountNaira.toLocaleString()}
                  </p>
                  <p className="text-[11px] font-mono-tabular text-[#686C78]">
                    {new Date(tx.verifiedAt ?? tx.createdAt).toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
