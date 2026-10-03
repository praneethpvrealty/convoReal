import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  FileText,
  Download,
  AlertTriangle,
  Clock,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';
import { DocAccessGate } from '@/components/documents/doc-access-gate';
import { trackDocumentView } from '@/lib/documents/track-view';
import {
  documentDisplayName,
  parsePropertyDocuments,
} from '@/lib/inventory/documents';

export const metadata: Metadata = {
  title: 'Property Documents',
  description: 'Securely access the property documents shared with you.',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function DocumentsPage({ params }: PageProps) {
  const { token } = await params;

  if (!token || token.length < 20) {
    return <ErrorState reason="invalid" />;
  }

  const admin = supabaseAdmin();

  // Look up the request by share token
  const { data: docRequest, error } = await admin
    .from('property_document_requests')
    .select('*, property:properties(id, title, property_code, documents)')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !docRequest) {
    return <ErrorState reason="invalid" />;
  }

  if (docRequest.status !== 'approved') {
    return <ErrorState reason="not_approved" />;
  }

  // Check expiry
  const expiresAt = docRequest.share_token_expires_at
    ? new Date(docRequest.share_token_expires_at)
    : null;
  const isExpired = expiresAt ? new Date() > expiresAt : false;

  if (isExpired) {
    return <ErrorState reason="expired" />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const property = docRequest.property as any;

  const formattedExpiry = expiresAt
    ? expiresAt.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  // Render access gate if password protected
  if (
    docRequest.access_password &&
    docRequest.access_password.trim().length > 0
  ) {
    return (
      <DocAccessGate
        token={token}
        requesterName={docRequest.requester_name}
        propertyTitle={property?.title || 'Property'}
        propertyCode={property?.property_code}
        formattedExpiry={formattedExpiry}
      />
    );
  }

  // No password gate on this path — the documents render immediately
  // below, so this render IS the view. (The password-protected path
  // tracks the view in the verify route instead, once they actually
  // get past the gate.)
  await trackDocumentView(admin, {
    id: docRequest.id,
    account_id: docRequest.account_id,
    requester_phone: docRequest.requester_phone,
    viewed_at: docRequest.viewed_at,
    view_count: docRequest.view_count ?? 0,
    last_viewed_at: docRequest.last_viewed_at,
  });

  const parsedDocuments = parsePropertyDocuments(property?.documents);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16 font-sans text-slate-100">
      {/* Radial glow */}
      <div className="bg-primary/8 pointer-events-none absolute top-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full blur-[120px]" />

      <div className="relative w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="bg-primary/15 border-primary/25 mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border">
            <FileText className="text-primary size-7" />
          </div>
          <h1 className="text-2xl font-black text-white">Property Documents</h1>
          <p className="text-sm text-slate-400">
            Shared securely for{' '}
            <span className="font-semibold text-white">
              {docRequest.requester_name}
            </span>
          </p>
        </div>

        {/* Property Card */}
        <div className="space-y-1 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
            Property
          </p>
          <p className="text-base font-bold text-white">
            {property?.title || 'Property'}
          </p>
          {property?.property_code && (
            <p className="font-mono text-xs text-slate-400">
              {property.property_code}
            </p>
          )}
        </div>

        {/* Expiry Notice */}
        {formattedExpiry && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-400">
            <Clock className="size-4 shrink-0" />
            This link expires on {formattedExpiry}
          </div>
        )}

        {/* Documents List */}
        {parsedDocuments.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              Available Documents ({parsedDocuments.length})
            </h2>
            <div className="space-y-2">
              {parsedDocuments.map((doc, idx) => {
                const docUrl = doc.url;
                const displayTitle =
                  doc.title?.trim() || documentDisplayName(docUrl, idx);

                return (
                  <a
                    key={idx}
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-slate-850 hover:border-primary/40 group flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3.5 transition-all"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className="bg-primary/10 border-primary/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border">
                        <FileText className="text-primary size-4" />
                      </div>
                      <div className="truncate">
                        <p className="group-hover:text-primary truncate text-sm font-semibold text-white transition-colors">
                          {displayTitle}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          Click to open
                        </p>
                      </div>
                    </div>
                    <Download className="group-hover:text-primary size-4 shrink-0 text-slate-500 transition-colors" />
                  </a>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
            <CheckCircle className="mx-auto size-8 text-emerald-500" />
            <p className="text-sm font-semibold text-white">Request Approved</p>
            <p className="text-xs leading-relaxed text-slate-400">
              No documents have been uploaded yet. The agent will share them
              with you shortly via WhatsApp.
            </p>
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-[11px] text-slate-600">
          This is a private, secure link. Please do not share it publicly.
        </p>

        <div className="text-center">
          <Link
            href="/"
            className="text-primary text-xs font-medium hover:underline"
          >
            ← Browse Properties
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  reason,
}: {
  reason: 'invalid' | 'expired' | 'not_approved';
}) {
  const messages = {
    invalid: {
      icon: AlertTriangle,
      title: 'Invalid Link',
      desc: 'This document link is invalid or does not exist. Please contact the agent for a new link.',
      color: 'text-red-400',
      bg: 'bg-red-500/10 border-red-500/25',
    },
    expired: {
      icon: Clock,
      title: 'Link Expired',
      desc: 'This document link has expired (valid for 48 hours). Please contact the agent to request a new link.',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10 border-amber-500/25',
    },
    not_approved: {
      icon: AlertTriangle,
      title: 'Not Approved',
      desc: 'This document request is still pending agent approval. You will receive a WhatsApp message once approved.',
      color: 'text-slate-400',
      bg: 'bg-slate-800/50 border-slate-700',
    },
  };

  const cfg = messages[reason];
  const Icon = cfg.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div
        className={`w-full max-w-sm space-y-4 rounded-2xl border p-8 text-center ${cfg.bg}`}
      >
        <Icon className={`mx-auto size-12 ${cfg.color}`} />
        <h1 className="text-lg font-black text-white">{cfg.title}</h1>
        <p className="text-sm leading-relaxed text-slate-400">{cfg.desc}</p>
        <Link
          href="/"
          className="text-primary mt-2 inline-block text-xs font-medium hover:underline"
        >
          ← Browse Properties
        </Link>
      </div>
    </div>
  );
}
