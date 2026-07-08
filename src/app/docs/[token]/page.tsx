import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { FileText, Download, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import Link from 'next/link';

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
  const dbDocs: string[] = Array.isArray(property?.documents)
    ? property.documents.filter((d: string) => d?.trim())
    : [];

  const parsedDocuments = dbDocs.map((doc: string) => {
    if (doc.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(doc);
        return { url: parsed.url || '', title: parsed.title || '' };
      } catch {
        // Fall back to plain string
      }
    }
    return { url: doc, title: '' };
  }).filter(d => d.url.length > 0);

  const formattedExpiry = expiresAt
    ? expiresAt.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4 py-16 font-sans">
      {/* Radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/15 border border-primary/25 mb-4">
            <FileText className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-black text-white">Property Documents</h1>
          <p className="text-sm text-slate-400">
            Shared securely for{' '}
            <span className="text-white font-semibold">{docRequest.requester_name}</span>
          </p>
        </div>

        {/* Property Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Property</p>
          <p className="text-base font-bold text-white">{property?.title || 'Property'}</p>
          {property?.property_code && (
            <p className="text-xs text-slate-400 font-mono">{property.property_code}</p>
          )}
        </div>

        {/* Expiry Notice */}
        {formattedExpiry && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-xs text-amber-400 font-medium">
            <Clock className="size-4 shrink-0" />
            This link expires on {formattedExpiry}
          </div>
        )}

        {/* Documents List */}
        {parsedDocuments.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Available Documents ({parsedDocuments.length})
            </h2>
            <div className="space-y-2">
              {parsedDocuments.map((doc, idx) => {
                const docUrl = doc.url;
                const filename =
                  docUrl.split('/').pop()?.split('?')[0] || `document-${idx + 1}`;
                const decodedFilename = decodeURIComponent(filename);
                const cleanName = decodedFilename
                  .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-[a-zA-Z0-9]+-/, '')
                  .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-/, '');

                const displayTitle = doc.title?.trim() || cleanName || `Document ${idx + 1}`;

                return (
                  <a
                    key={idx}
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-primary/40 rounded-xl px-4 py-3.5 transition-all group"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <FileText className="size-4 text-primary" />
                      </div>
                      <div className="truncate">
                        <p className="text-sm font-semibold text-white truncate group-hover:text-primary transition-colors">
                          {displayTitle}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Click to open</p>
                      </div>
                    </div>
                    <Download className="size-4 text-slate-500 group-hover:text-primary shrink-0 transition-colors" />
                  </a>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2">
            <CheckCircle className="size-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold text-white">Request Approved</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              No documents have been uploaded yet. The agent will share them with you shortly via WhatsApp.
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
            className="text-xs text-primary hover:underline font-medium"
          >
            ← Browse Properties
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ reason }: { reason: 'invalid' | 'expired' | 'not_approved' }) {
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className={`max-w-sm w-full border rounded-2xl p-8 text-center space-y-4 ${cfg.bg}`}>
        <Icon className={`size-12 mx-auto ${cfg.color}`} />
        <h1 className="text-lg font-black text-white">{cfg.title}</h1>
        <p className="text-sm text-slate-400 leading-relaxed">{cfg.desc}</p>
        <Link href="/" className="inline-block text-xs text-primary hover:underline font-medium mt-2">
          ← Browse Properties
        </Link>
      </div>
    </div>
  );
}
