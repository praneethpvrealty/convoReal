import type { Metadata } from 'next';
import Link from 'next/link';
import { ReceiptText, ArrowLeft } from 'lucide-react';
import { BRANDING } from '@/config/branding';
import { REFUND_POLICY } from '@/config/refund-policy';

export const metadata: Metadata = {
  // Root layout applies a `%s — ConvoReal` title template, so no brand suffix here.
  title: 'Refund & Cancellation Policy',
  description: `How refunds, cancellations, and credits work on ${BRANDING.name}. Cancel anytime, no lock-in.`,
};

const G = REFUND_POLICY.firstPurchaseGuaranteeDays;
const T = REFUND_POLICY.creditTopupRefundDays;
const P = REFUND_POLICY.prepaidProrataDays;

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-6 mb-8">
          <div className="flex items-center gap-3">
            <ReceiptText className="size-8 text-primary" />
            <h1 className="text-2xl font-black tracking-tight text-white">{BRANDING.name}</h1>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg"
          >
            <ArrowLeft className="size-3.5" />
            Back to Showcase
          </Link>
        </div>

        {/* Card Block */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
          <div className="space-y-2 border-b border-slate-800/50 pb-4">
            <h2 className="text-xl font-bold text-white">Refund &amp; Cancellation Policy</h2>
            <p className="text-xs text-slate-400">Last updated: July 9, 2026</p>
          </div>

          {/* Plain-English summary box */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm text-slate-200 leading-relaxed">
            <p className="font-bold text-white mb-1">In short</p>
            <p>
              Our Free plan lets you try {BRANDING.name}{' '}before you pay. If you upgrade and it isn&apos;t
              for you, your first paid upgrade is covered by a <strong>{G}-day money-back guarantee</strong>.
              You can <strong>cancel anytime with no lock-in</strong> — you keep access until the end of the
              period you&apos;ve paid for. Credits and per-message WhatsApp charges you&apos;ve already used
              can&apos;t be refunded, because we&apos;ve already paid our providers for them.
            </p>
          </div>

          <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">1. Try before you pay</h3>
              <p>
                {BRANDING.name} offers a free plan so you can use the core product — WhatsApp inbox, contacts,
                listings, and a showcase page — at no cost before deciding to pay. We encourage you to use it
                first; it is the best way to know the product fits your business.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">2. {G}-day money-back guarantee (first upgrade)</h3>
              <p>
                The first time you upgrade to a paid plan, you may request a full refund of that
                subscription charge within <strong>{G} days</strong> of the payment, for any reason. This
                guarantee applies <strong>once per account</strong> (to your first paid upgrade only).
              </p>
              <p className="text-slate-400">
                The refund is of the subscription fee, less any AI credits or WhatsApp message charges already
                consumed during that period (see sections 5 and 6).
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">3. Monthly plans — cancel anytime</h3>
              <p>
                You can cancel a monthly subscription at any time from{' '}
                <span className="text-slate-100 font-medium">Settings → Billing</span>. Cancellation stops all
                future billing immediately and you keep full access until the end of your current paid month.
              </p>
              <p className="text-slate-400">
                We do not charge cancellation fees and there is no lock-in. Monthly fees for the current period
                are not pro-rated after the {G}-day guarantee window.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">4. Quarterly &amp; annual plans</h3>
              <p>
                If you prepaid for a quarterly or annual term and wish to stop within <strong>{P} days</strong>
                {' '}of that payment, we will refund the unused whole months. Months already used are charged at
                our standard monthly rate for your plan (so the prepay discount applies only to the term you
                actually keep), less any consumed credits or WhatsApp charges.
              </p>
              <p className="text-slate-400">
                After {P} days, prepaid terms are non-refundable, but you may still cancel to prevent the next
                renewal and retain access until your term ends.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">5. AI credits</h3>
              <p>
                Paid plans include a monthly allowance of AI credits, and you may also buy one-time credit
                top-up packs. Because each AI action (parsing a listing, generating a description, an AI reply,
                etc.) costs us a real fee the moment it runs:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-300">
                <li><strong>Consumed credits are non-refundable.</strong></li>
                <li>Monthly plan credits do not carry over and have no cash value.</li>
                <li>
                  A one-time top-up pack can be refunded only if it is <strong>100% unused</strong> and the
                  request is made within <strong>{T} days</strong> of purchase.
                </li>
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">6. WhatsApp / Meta message charges</h3>
              <p>
                Messages sent through the WhatsApp Business Platform (broadcasts, templates, and conversations)
                incur per-message fees that we pay to Meta as they are sent. These charges are{' '}
                <strong>non-refundable</strong>, as they are already spent with the provider on your behalf.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">7. Always refunded</h3>
              <p>
                Duplicate charges, failed transactions that were still debited, and any charge made in error
                are refunded in full. If you spot one, contact us and we&apos;ll correct it promptly.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">8. How to request a refund</h3>
              <p>
                Email{' '}
                <a href={`mailto:${REFUND_POLICY.supportEmail}`} className="text-primary hover:underline font-medium">
                  {REFUND_POLICY.supportEmail}
                </a>{' '}
                from your registered email with your account name and the charge in question. Approved refunds
                are issued to your original payment method within{' '}
                <strong>{REFUND_POLICY.processingBusinessDays} business days</strong>. Applicable GST is adjusted
                per Indian tax rules via a credit note.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-base font-bold text-white">9. Questions</h3>
              <p>
                For anything about billing, cancellations, or this policy, reach us at{' '}
                <a href={`mailto:${REFUND_POLICY.supportEmail}`} className="text-primary hover:underline font-medium">
                  {REFUND_POLICY.supportEmail}
                </a>
                . This policy works alongside our{' '}
                <Link href="/terms" className="text-primary hover:underline font-medium">Terms of Service</Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-primary hover:underline font-medium">Privacy Policy</Link>.
              </p>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-500 mt-8">
          &copy; {new Date().getFullYear()} {BRANDING.name}. All rights reserved.
        </div>

      </div>
    </div>
  );
}
