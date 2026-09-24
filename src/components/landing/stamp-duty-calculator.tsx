'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Landmark, MessageCircle, Receipt } from 'lucide-react';

import { formatInr } from '@/lib/guidance-value/units';
import { GUIDANCE_TOOL_PATH } from '@/lib/marketing/public-tools';
import { formatInrCompact, parseAmount } from '@/lib/tools/format';
import {
  AREA_TYPES,
  AREA_TYPE_LABELS,
  KARNATAKA_STAMP_DUTY,
  calculateStampDuty,
  percentText,
  type AreaType,
} from '@/lib/tools/stamp-duty';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none';
const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-300';

export function StampDutyCalculator() {
  const [consideration, setConsideration] = useState('');
  const [guidanceValue, setGuidanceValue] = useState('');
  const [areaType, setAreaType] = useState<AreaType>('urban');

  const price = useMemo(() => parseAmount(consideration), [consideration]);
  const guidance = useMemo(() => parseAmount(guidanceValue), [guidanceValue]);
  const result = useMemo(
    () =>
      calculateStampDuty({
        consideration: price,
        guidanceValue: guidance,
        areaType,
      }),
    [price, guidance, areaType]
  );
  const ready = result.chargeableValue > 0;

  const rows = [
    [`Stamp duty (${percentText(result.dutyRate)})`, result.stampDuty],
    [
      `Surcharge (${percentText(result.surchargeRate)} of duty)`,
      result.surcharge,
    ],
    [`Cess (${percentText(result.cessRate)} of duty)`, result.cess],
    [
      `Registration fee (${percentText(result.registrationRate)})`,
      result.registrationFee,
    ],
  ] as const;

  const shareText = ready
    ? [
        `Stamp duty estimate for a ${formatInrCompact(result.chargeableValue)} property in Karnataka (${areaType === 'urban' ? 'city/town' : 'village'} area):`,
        ...rows.map(([label, amount]) => `${label}: ${formatInr(amount)}`),
        `Total: ${formatInr(result.total)} (${percentText(result.effectiveRate)})`,
        'Calculated at convoreal.com/tools/stamp-duty',
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
              <label className={LABEL_CLASS} htmlFor="sd-price">
                Sale price (consideration)
              </label>
              <input
                id="sd-price"
                className={INPUT_CLASS}
                inputMode="decimal"
                placeholder="e.g. 1.2 cr or 85 lakh"
                value={consideration}
                onChange={(e) => setConsideration(e.target.value)}
              />
              {price > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatInr(price)}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="sd-guidance">
                Guidance value (optional)
              </label>
              <input
                id="sd-guidance"
                className={INPUT_CLASS}
                inputMode="decimal"
                placeholder="Government value of the property"
                value={guidanceValue}
                onChange={(e) => setGuidanceValue(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                {guidance > 0 ? (
                  formatInr(guidance)
                ) : (
                  <a
                    href={GUIDANCE_TOOL_PATH}
                    className="font-semibold text-indigo-300 hover:text-indigo-200"
                  >
                    Don&apos;t know it? Find the guidance value
                  </a>
                )}
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLASS} htmlFor="sd-area">
                Where the property is
              </label>
              <select
                id="sd-area"
                className={INPUT_CLASS}
                value={areaType}
                onChange={(e) => setAreaType(e.target.value as AreaType)}
              >
                {AREA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {AREA_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-5 text-xs text-slate-500">
            Duty is charged on the higher of the sale price and the guidance
            value. Slabs: {percentText(KARNATAKA_STAMP_DUTY.slabs[0].rate)} up
            to {formatInrCompact(KARNATAKA_STAMP_DUTY.slabs[0].upTo ?? 0)},{' '}
            {percentText(KARNATAKA_STAMP_DUTY.slabs[1].rate)} up to{' '}
            {formatInrCompact(KARNATAKA_STAMP_DUTY.slabs[1].upTo ?? 0)},{' '}
            {percentText(KARNATAKA_STAMP_DUTY.slabs[2].rate)} above that.
          </p>
        </form>

        <div
          className="h-fit space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-6"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Receipt className="size-4 text-emerald-400" />
            Total payable at registration
          </p>
          <p className="text-3xl font-black text-emerald-400">
            {ready ? formatInr(result.total) : '—'}
          </p>
          {ready && (
            <>
              <p className="text-xs text-slate-400">
                {percentText(result.effectiveRate)} of{' '}
                {formatInr(result.chargeableValue)}, charged on the{' '}
                {result.basis === 'guidance_value'
                  ? 'guidance value'
                  : 'sale price'}
                .
              </p>
              <dl className="space-y-2 border-t border-slate-800 pt-4 text-sm">
                {rows.map(([label, amount]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-slate-400">{label}</dt>
                    <dd className="font-semibold text-slate-100">
                      {formatInr(amount)}
                    </dd>
                  </div>
                ))}
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
            An estimate from the notified rates, not a demand notice. Confirm
            the payable amount on Kaveri Online Services before paying.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
            <Landmark className="size-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              Closing a deal? Keep the numbers with the property.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              ConvoReal reads the guidance value off the sale deed, saves it
              against the deal, and sends the buyer the registration breakdown
              on WhatsApp.
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
