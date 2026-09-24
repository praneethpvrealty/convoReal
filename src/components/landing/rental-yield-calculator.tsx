'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, MessageCircle, Percent, Zap } from 'lucide-react';

import { formatInr } from '@/lib/guidance-value/units';
import { STAMP_DUTY_TOOL_PATH } from '@/lib/marketing/public-tools';
import { formatInrCompact, parseAmount } from '@/lib/tools/format';
import {
  TARGET_YIELDS,
  calculateRentalYield,
  monthlyRentForYield,
} from '@/lib/tools/rental-yield';
import { percentText } from '@/lib/tools/stamp-duty';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none';
const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-300';

export function RentalYieldCalculator() {
  const [price, setPrice] = useState('');
  const [rent, setRent] = useState('');
  const [expenses, setExpenses] = useState('');
  const [vacancy, setVacancy] = useState('1');
  const [purchaseCosts, setPurchaseCosts] = useState('');

  const propertyPrice = useMemo(() => parseAmount(price), [price]);
  const monthlyRent = useMemo(() => parseAmount(rent), [rent]);
  const result = useMemo(
    () =>
      calculateRentalYield({
        price: propertyPrice,
        monthlyRent,
        annualExpenses: parseAmount(expenses),
        vacancyMonths: Number(vacancy) || 0,
        purchaseCosts: parseAmount(purchaseCosts),
      }),
    [propertyPrice, monthlyRent, expenses, vacancy, purchaseCosts]
  );
  const ready = result.price > 0 && monthlyRent > 0;

  const shareText = ready
    ? [
        `Rental yield on a ${formatInrCompact(result.price)} property at ${formatInr(monthlyRent)} per month:`,
        `Gross yield: ${percentText(result.grossYield)}`,
        `Net yield: ${percentText(result.netYield)} after costs and vacancy`,
        `Net income: ${formatInr(result.netAnnualIncome)} a year`,
        result.paybackYears
          ? `Payback: about ${result.paybackYears.toFixed(1)} years`
          : null,
        'Calculated at convoreal.com/tools/rental-yield',
      ]
        .filter(Boolean)
        .join('\n')
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
              <label className={LABEL_CLASS} htmlFor="ry-price">
                Property price
              </label>
              <input
                id="ry-price"
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
              <label className={LABEL_CLASS} htmlFor="ry-rent">
                Monthly rent
              </label>
              <input
                id="ry-rent"
                className={INPUT_CLASS}
                inputMode="decimal"
                placeholder="e.g. 35000"
                value={rent}
                onChange={(e) => setRent(e.target.value)}
              />
              {monthlyRent > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatInr(monthlyRent)} a month
                </p>
              )}
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="ry-expenses">
                Yearly costs (optional)
              </label>
              <input
                id="ry-expenses"
                className={INPUT_CLASS}
                inputMode="decimal"
                placeholder="Property tax, maintenance, repairs"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="ry-vacancy">
                Vacant months a year
              </label>
              <input
                id="ry-vacancy"
                className={INPUT_CLASS}
                inputMode="numeric"
                type="number"
                min={0}
                max={12}
                value={vacancy}
                onChange={(e) => setVacancy(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLASS} htmlFor="ry-costs">
                One-time purchase costs (optional)
              </label>
              <input
                id="ry-costs"
                className={INPUT_CLASS}
                inputMode="decimal"
                placeholder="Stamp duty, registration, brokerage, interiors"
                value={purchaseCosts}
                onChange={(e) => setPurchaseCosts(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                <a
                  href={STAMP_DUTY_TOOL_PATH}
                  className="font-semibold text-indigo-300 hover:text-indigo-200"
                >
                  Estimate stamp duty and registration
                </a>{' '}
                to include here.
              </p>
            </div>
          </div>
        </form>

        <div
          className="h-fit space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-6"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Percent className="size-4 text-emerald-400" />
            Net rental yield
          </p>
          <p className="text-3xl font-black text-emerald-400">
            {ready ? percentText(result.netYield) : '—'}
          </p>
          {ready && (
            <>
              <dl className="space-y-2 border-t border-slate-800 pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Gross yield</dt>
                  <dd className="font-semibold text-slate-100">
                    {percentText(result.grossYield)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Rent a year</dt>
                  <dd className="font-semibold text-slate-100">
                    {formatInr(result.grossAnnualRent)}
                  </dd>
                </div>
                {result.vacancyLoss > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Vacancy loss</dt>
                    <dd className="font-semibold text-slate-100">
                      −{formatInr(result.vacancyLoss)}
                    </dd>
                  </div>
                )}
                {result.annualExpenses > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Yearly costs</dt>
                    <dd className="font-semibold text-slate-100">
                      −{formatInr(result.annualExpenses)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Net income a year</dt>
                  <dd className="font-semibold text-slate-100">
                    {formatInr(result.netAnnualIncome)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Payback on rent alone</dt>
                  <dd className="font-semibold text-slate-100">
                    {result.paybackYears
                      ? `${result.paybackYears.toFixed(1)} years`
                      : '—'}
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
            Yield on rent only. Appreciation, loan interest and income tax are
            not included.
          </p>
        </div>
      </div>

      {propertyPrice > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-sm">
            <caption className="px-5 pt-5 pb-3 text-left text-xs font-black tracking-wider text-slate-500 uppercase">
              Rent needed on {formatInrCompact(propertyPrice)} for a target
              gross yield
            </caption>
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500">
                <th className="px-5 py-2 font-semibold">Gross yield</th>
                <th className="px-5 py-2 text-right font-semibold">
                  Monthly rent
                </th>
                <th className="px-5 py-2 text-right font-semibold">
                  Yearly rent
                </th>
              </tr>
            </thead>
            <tbody>
              {TARGET_YIELDS.map((target) => {
                const monthly = monthlyRentForYield(propertyPrice, target);
                return (
                  <tr
                    key={target}
                    className="border-b border-slate-900 last:border-0"
                  >
                    <td className="px-5 py-2 text-slate-300">
                      {percentText(target)}
                    </td>
                    <td className="px-5 py-2 text-right text-slate-100">
                      {formatInr(monthly)}
                    </td>
                    <td className="px-5 py-2 text-right text-slate-400">
                      {formatInr(monthly * 12)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
            <Zap className="size-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              Investors ask for a yield, not an address.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              ConvoReal matches investor buyers to your listings by the yield
              they want, and sends the ones that clear it on WhatsApp.
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
