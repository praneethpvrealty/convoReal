'use client';

import React, { useState } from 'react';
import {
  FileText,
  Download,
  Clock,
  Lock,
  KeyRound,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';

interface DocAccessGateProps {
  token: string;
  requesterName: string;
  propertyTitle: string;
  propertyCode?: string;
  formattedExpiry: string | null;
}

interface DocumentItem {
  url: string;
  title: string;
}

export function DocAccessGate({
  token,
  requesterName,
  propertyTitle,
  propertyCode,
  formattedExpiry,
}: DocAccessGateProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/public/documents/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, password: password.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Incorrect password. Please try again.');
      } else if (data.success) {
        setDocuments(data.documents || []);
      } else {
        setError('Verification failed. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // If password successfully verified, render the documents list
  if (documents !== null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16 font-sans text-slate-100">
        {/* Radial glow */}
        <div className="bg-primary/8 pointer-events-none absolute top-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full blur-[120px]" />

        <div className="relative w-full max-w-lg space-y-6">
          {/* Header */}
          <div className="space-y-2 text-center">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
              <FileText className="size-7 text-emerald-500" />
            </div>
            <h1 className="text-2xl font-black text-white">Access Granted</h1>
            <p className="text-sm text-slate-400">
              Documents unlocked for{' '}
              <span className="font-semibold text-white">{requesterName}</span>
            </p>
          </div>

          {/* Property Card */}
          <div className="space-y-1 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Property
            </p>
            <p className="text-base font-bold text-white">{propertyTitle}</p>
            {propertyCode && (
              <p className="font-mono text-xs text-slate-400">{propertyCode}</p>
            )}
          </div>

          {/* Expiry Notice */}
          {formattedExpiry && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-400">
              <Clock className="size-4 shrink-0" />
              This secure session expires on {formattedExpiry}
            </div>
          )}

          {/* Documents List */}
          {documents.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                Available Documents ({documents.length})
              </h2>
              <div className="space-y-2">
                {documents.map((doc, idx) => {
                  const docUrl = doc.url;
                  const filename =
                    docUrl.split('/').pop()?.split('?')[0] ||
                    `document-${idx + 1}`;
                  const decodedFilename = decodeURIComponent(filename);
                  const cleanName = decodedFilename
                    .replace(
                      /^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-[a-zA-Z0-9]+-/,
                      ''
                    )
                    .replace(/^[a-fA-F0-9-]+\/(img-|doc-|file-)\d+-/, '');

                  const displayTitle =
                    doc.title?.trim() || cleanName || `Document ${idx + 1}`;

                  return (
                    <a
                      key={idx}
                      href={docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:bg-slate-850 group flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3.5 transition-all hover:border-emerald-500/40"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                          <FileText className="size-4 text-emerald-500" />
                        </div>
                        <div className="truncate">
                          <p className="truncate text-sm font-semibold text-white transition-colors group-hover:text-emerald-500">
                            {displayTitle}
                          </p>
                          <p className="mt-0.5 font-sans text-[10px] text-slate-500">
                            Click to open & save
                          </p>
                        </div>
                      </div>
                      <Download className="size-4 shrink-0 text-slate-500 transition-colors group-hover:text-emerald-500" />
                    </a>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
              <ShieldAlert className="mx-auto size-8 text-amber-500" />
              <p className="text-sm font-semibold text-white">
                No documents available
              </p>
              <p className="text-xs leading-relaxed text-slate-400">
                No documents are associated with this request yet. Please check
                back later.
              </p>
            </div>
          )}

          {/* Footer note */}
          <p className="text-slate-650 text-center text-[11px]">
            This secure session is protected. Please do not share document links
            publicly.
          </p>

          <div className="text-center">
            <Link
              href="/"
              className="text-xs font-medium text-emerald-500 hover:underline"
            >
              ← Browse Properties
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Render Password Entry Gate
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16 font-sans text-slate-100">
      {/* Radial glow */}
      <div className="bg-primary/10 pointer-events-none absolute top-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full blur-[120px]" />

      <div className="relative w-full max-w-md space-y-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl">
        {/* Shield Icon Lock */}
        <div className="space-y-3 text-center">
          <div className="bg-primary/10 border-primary/20 text-primary inline-flex h-14 w-14 items-center justify-center rounded-2xl border shadow-inner">
            <Lock className="size-6 animate-pulse" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white">
            Enter Passcode
          </h1>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-400">
            The document folder for{' '}
            <span className="font-bold text-white">{propertyTitle}</span> is
            password-protected.
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              Access Code
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                <KeyRound className="size-4" />
              </div>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password (e.g. 4839)"
                className="focus:border-primary/50 w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pr-4 pl-10 text-center text-sm font-semibold tracking-wider text-white uppercase transition-all outline-none placeholder:text-slate-600"
                disabled={loading}
                autoFocus
                autoComplete="off"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="bg-primary hover:bg-primary-hover hover:shadow-primary/20 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:scale-100 disabled:opacity-40"
          >
            {loading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              'Verify Access Code'
            )}
          </button>
        </form>

        {/* Back Link */}
        <div className="border-t border-slate-800/60 pt-2 text-center">
          <Link
            href="/"
            className="text-primary text-xs font-semibold hover:underline"
          >
            ← Back to ConvoReal Home
          </Link>
        </div>
      </div>
    </div>
  );
}
