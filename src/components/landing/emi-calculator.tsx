'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Calculator, MessageCircle, Users } from 'lucide-react';

import { formatInr } from '@/lib/guidance-value/units';
import { STAMP_DUTY_TOOL_PATH } from '@/lib/marketing/public-tools';
import { MAX_TENURE_YEARS, calculateEmi, loanAmount } from '@/lib/tools/emi';
import { formatInrCompact, parseAmount } from '@/lib/tools/format';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none';
const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-300';

export function EmiCalculator() {
  const [price, setPrice] = useState('');
  const [downPayment, setDownPayment] = useState('20');
  const [rate, setRate] = useState('8.5');
  const [tenure, setTenure] = useState('20');

  const propertyPrice = useMemo(() => parseAmount(price), [price]);
  const principal = useMemo(
    () => loanAmount(propertyPrice, Number(downPayment) || 0),
    [propertyPrice, downPayment]
  );
  const result = useMemo(
    () =>
      calculateEmi({
        principal,
        annualRatePercent: Number(rate) || 0,
        tenureYears: Number(tenure) || 0,
      }),
    [principal, rate, tenure]
  );
  const ready = result.emi > 0;

  const shareText = ready
    ? [
        `Home loan of ${formatInrCompact(principal)} at ${Number(rate) || 0}% for ${result.months / 12} years:`,
        `EMI: ${formatInr(result.emi)} per month`,
        `Total interest: ${formatInr(result.totalInterest)}`,
        `Total repaid: ${formatInr(result.totalPayment)}`,
        'Calculated at convoreal.com/tools/emi-calculator',
      ].join('\n')
    : '';

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="emi-price">
                Property price
              </label>
              <input
                id="emi-price"
                className={INPUT_CLASS}
                inputMode="decimal"
                placeholder="e.g. 1.2 cr or 85 lakh"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              {propertyPrice > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatInr(propertyPrice)}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="emi-down">
                Down payment (%)
              </label>
              <input
                id="emi-down"
                className={INPUT_CLASS}
                inputMode="decimal"
                min={0}
                max={100}
                type="number"
                value={downPayment}
                onChange={(e) => setDownPayment(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Loan amount: {principal > 0 ? formatInr(principal) : '—'}
              </p>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="emi-rate">
                Interest rate (% per year)
              </label>
              <input
                id="emi-rate"
                className={INPUT_CLASS}
                inputMode="decimal"
                type="number"
                step="0.05"
                min={0}
                max={30}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="emi-tenure">
                Tenure (years)
              </label>
              <input
                id="emi-tenure"
                className={INPUT_CLASS}
                inputMode="numeric"
                type="number"
                min={1}
                max={MAX_TENURE_YEARS}
                value={tenure}
                onChange={(e) => setTenure(e.target.value)}
              />
            </div>
          </div>
          <p className="mt-5 text-xs text-slate-500">
            Stamp duty and registration are not usually financed.{' '}
            <a
              href={STAMP_DUTY_TOOL_PATH}
              className="font-semibold text-indigo-300 hover:text-indigo-200"
            >
              Estimate them separately
            </a>{' '}
            and add them to the down payment.
          </p>
        </form>

        <div
          className="h-fit space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-6"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Calculator className="size-4 text-emerald-400" />
            Monthly EMI
          </p>
          <p className="text-3xl font-black text-emerald-400">
            {ready ? formatInr(result.emi) : '—'}
          </p>
          {ready && (
            <>
              <dl className="space-y-2 border-t border-slate-800 pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Loan amount</dt>
                  <dd className="font-semibold text-slate-100">
                    {formatInr(principal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Total interest</dt>
                  <dd className="font-semibold text-slate-100">
                    {formatInr(result.totalInterest)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Total repaid</dt>
                  <dd className="font-semibold text-slate-100">
                    {formatInr(result.totalPayment)}
                  </dd>
                </div>
              </dl>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
              >
                <MessageCircle className="size-3.5" /> Share on WhatsApp
              </a>
            </>
          )}
          <p className="text-[11px] text-slate-500">
            Reducing-balance EMI at a fixed rate. Your lender&apos;s sanction
            letter states the actual instalment.
          </p>
        </div>
      </div>

      {ready && result.schedule.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <caption className="px-5 pt-5 pb-3 text-left text-xs font-black tracking-wider text-slate-500 uppercase">
              Year by year
            </caption>
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500">
                <th className="px-5 py-2 font-semibold">Year</th>
                <th className="px-5 py-2 text-right font-semibold">
                  Principal paid
                </th>
                <th className="px-5 py-2 text-right font-semibold">
                  Interest paid
                </th>
                <th className="px-5 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {result.schedule.map((year) => (
                <tr
                  key={year.year}
                  className="border-b border-slate-900 last:border-0"
                >
                  <td className="px-5 py-2 text-slate-300">{year.year}</td>
                  <td className="px-5 py-2 text-right text-slate-100">
                    {formatInr(year.principalPaid)}
                  </td>
                  <td className="px-5 py-2 text-right text-slate-400">
                    {formatInr(year.interestPaid)}
                  </td>
                  <td className="px-5 py-2 text-right text-slate-100">
                    {formatInr(year.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
            <Users className="size-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              Match buyers to what they can afford.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              ConvoReal captures a buyer&apos;s budget from their WhatsApp
              message, matches it to your listings and sends the options in the
              same chat.
            </p>
          </div>
        </div>
        <a
          href="/signup"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
        >
          Start free <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
