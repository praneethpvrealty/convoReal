'use client';

// Lightweight illustrations for onboarding steps — pure Tailwind/SVG
// mocks (a WhatsApp thread, a listing card, a lead pipeline, the Meta
// console) that stand in until each step's walkthrough video is
// recorded (see src/lib/onboarding/media.ts).

import {
  Bot,
  Building2,
  Check,
  CheckCheck,
  FileSpreadsheet,
  FileText,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
} from 'lucide-react';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full rounded-xl border border-slate-700/60 bg-slate-950/70 p-4">
      {children}
    </div>
  );
}

/** A WhatsApp thread: enquiry arrives, the Engine replies. */
export function ChatIllustration() {
  return (
    <Frame>
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2 self-start">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-700">
            <User className="size-3.5 text-slate-300" />
          </div>
          <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-2">
            <p className="text-xs text-slate-200">
              Hi, is the 2BHK in Jubilee Hills still available?
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2 self-end">
          <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-emerald-900/60 px-3 py-2">
            <p className="text-xs text-emerald-100">
              Yes! Here&apos;s the full listing with photos &amp; price 🏠
            </p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-emerald-300/70">
              Sent by ConvoReal <CheckCheck className="size-3" />
            </p>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5 self-center rounded-full bg-slate-800/80 px-2.5 py-1">
          <Sparkles className="text-primary size-3" />
          <span className="text-[10px] text-slate-400">
            Lead saved automatically — no typing
          </span>
        </div>
      </div>
    </Frame>
  );
}

/** Forward a listing → AI parses → property created. */
export function PropertyParseIllustration() {
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-lg border border-slate-700/60 bg-slate-800/60 p-2.5">
          <p className="text-[10px] leading-relaxed text-slate-400">
            *3BHK Villa, Kokapet* 📍
            <br />
            2400 sft | ₹2.1 Cr
            <br />
            East facing, gated…
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Bot className="size-4 text-violet-400" />
          <svg
            width="28"
            height="8"
            viewBox="0 0 28 8"
            className="text-slate-600"
          >
            <path
              d="M0 4h24m0 0l-4-3m4 3l-4 3"
              stroke="currentColor"
              fill="none"
            />
          </svg>
        </div>
        <div className="flex-1 rounded-lg border border-emerald-700/40 bg-emerald-950/40 p-2.5">
          <div className="mb-1.5 flex items-center gap-1">
            <Building2 className="size-3 text-emerald-400" />
            <span className="text-[10px] font-semibold text-emerald-200">
              3BHK Villa, Kokapet
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-1.5 w-4/5 rounded bg-emerald-800/50" />
            <div className="h-1.5 w-3/5 rounded bg-emerald-800/50" />
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[9px] text-emerald-400">
            <Check className="size-2.5" /> In your inventory
          </p>
        </div>
      </div>
    </Frame>
  );
}

/** Buyer list (phone/Excel) → one import → matches on Radar. */
export function ImportBuyersIllustration() {
  return (
    <Frame>
      <div className="flex items-center justify-between gap-2">
        {[
          {
            icon: <FileSpreadsheet className="size-4 text-emerald-400" />,
            label: 'Your buyer list',
          },
          {
            icon: <Upload className="size-4 text-blue-400" />,
            label: 'One import',
          },
          {
            icon: <Sparkles className="text-primary size-4" />,
            label: 'Matches on Radar',
          },
        ].map((node, i) => (
          <div key={node.label} className="flex flex-1 items-center gap-2">
            <div className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 px-2 py-2.5 text-center">
              {node.icon}
              <span className="text-[9px] leading-tight font-medium text-slate-300">
                {node.label}
              </span>
            </div>
            {i < 2 && (
              <svg
                width="16"
                height="8"
                viewBox="0 0 16 8"
                className="shrink-0 text-slate-600"
              >
                <path
                  d="M0 4h12m0 0l-3-2.5M12 4l-3 2.5"
                  stroke="currentColor"
                  fill="none"
                />
              </svg>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Portal lead email → forwarded → WhatsApp contact. */
export function EmailLeadIllustration() {
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-lg border border-slate-700/60 bg-slate-800/60 p-2.5">
          <div className="mb-1.5 flex items-center gap-1">
            <Mail className="size-3 text-amber-400" />
            <span className="text-[10px] font-semibold text-slate-300">
              99acres enquiry
            </span>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-400">
            Ravi K · 98xxxxxx21
            <br />
            Budget ₹80L · Kokapet
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Bot className="size-4 text-violet-400" />
          <svg
            width="28"
            height="8"
            viewBox="0 0 28 8"
            className="text-slate-600"
          >
            <path
              d="M0 4h24m0 0l-4-3m4 3l-4 3"
              stroke="currentColor"
              fill="none"
            />
          </svg>
        </div>
        <div className="flex-1 rounded-lg border border-emerald-700/40 bg-emerald-950/40 p-2.5">
          <div className="mb-1.5 flex items-center gap-1">
            <MessageCircle className="size-3 text-emerald-400" />
            <span className="text-[10px] font-semibold text-emerald-200">
              Ravi K
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-1.5 w-4/5 rounded bg-emerald-800/50" />
            <div className="h-1.5 w-3/5 rounded bg-emerald-800/50" />
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[9px] text-emerald-400">
            <Check className="size-2.5" /> Contact + auto-reply sent
          </p>
        </div>
      </div>
    </Frame>
  );
}

/** Template lifecycle: draft sitting in your account → Meta → approved. */
export function TemplateApprovalIllustration() {
  return (
    <Frame>
      <div className="flex items-center justify-between gap-2">
        {[
          {
            icon: <FileText className="size-4 text-slate-300" />,
            label: 'Draft in your account',
            tone: 'border-slate-700/60 bg-slate-800/50',
          },
          {
            icon: <ShieldCheck className="size-4 text-amber-400" />,
            label: 'Meta reviews it',
            tone: 'border-amber-700/40 bg-amber-950/30',
          },
          {
            icon: <Check className="size-4 text-emerald-400" />,
            label: 'Sends automatically',
            tone: 'border-emerald-700/40 bg-emerald-950/40',
          },
        ].map((node, i) => (
          <div key={node.label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-center ${node.tone}`}
            >
              {node.icon}
              <span className="text-[9px] leading-tight font-medium text-slate-300">
                {node.label}
              </span>
            </div>
            {i < 2 && (
              <svg
                width="16"
                height="8"
                viewBox="0 0 16 8"
                className="shrink-0 text-slate-600"
              >
                <path
                  d="M0 4h12m0 0l-3-2.5M12 4l-3 2.5"
                  stroke="currentColor"
                  fill="none"
                />
              </svg>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Meta console mock — a browser frame with highlighted field rows. */
export function MetaConsoleIllustration({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; highlight?: boolean }[];
}) {
  return (
    <Frame>
      <div className="overflow-hidden rounded-lg border border-slate-700/60">
        <div className="flex items-center gap-1.5 border-b border-slate-700/60 bg-slate-800/80 px-3 py-1.5">
          <span className="size-2 rounded-full bg-red-500/60" />
          <span className="size-2 rounded-full bg-amber-500/60" />
          <span className="size-2 rounded-full bg-emerald-500/60" />
          <span className="ml-2 truncate font-mono text-[9px] text-slate-400">
            {title}
          </span>
        </div>
        <div className="space-y-1.5 bg-slate-900/60 p-3">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 ${
                row.highlight
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-slate-700/50 bg-slate-800/40'
              }`}
            >
              <span
                className={`text-[10px] font-medium ${
                  row.highlight ? 'text-primary' : 'text-slate-400'
                }`}
              >
                {row.label}
              </span>
              {row.highlight && (
                <span className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wide uppercase">
                  Copy this
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}
