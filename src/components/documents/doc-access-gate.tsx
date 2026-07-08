'use client';

import React, { useState } from 'react';
import { FileText, Download, Clock, Lock, KeyRound, AlertCircle, ShieldAlert } from 'lucide-react';
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
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4 py-16 font-sans">
        {/* Radial glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative max-w-lg w-full space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
              <FileText className="size-7 text-emerald-500" />
            </div>
            <h1 className="text-2xl font-black text-white">Access Granted</h1>
            <p className="text-sm text-slate-400">
              Documents unlocked for{' '}
              <span className="text-white font-semibold">{requesterName}</span>
            </p>
          </div>

          {/* Property Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Property</p>
            <p className="text-base font-bold text-white">{propertyTitle}</p>
            {propertyCode && (
              <p className="text-xs text-slate-400 font-mono">{propertyCode}</p>
            )}
          </div>

          {/* Expiry Notice */}
          {formattedExpiry && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-xs text-amber-400 font-medium">
              <Clock className="size-4 shrink-0" />
              This secure session expires on {formattedExpiry}
            </div>
          )}

          {/* Documents List */}
          {documents.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Available Documents ({documents.length})
              </h2>
              <div className="space-y-2">
                {documents.map((doc, idx) => {
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
                      className="flex items-center justify-between gap-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/40 rounded-xl px-4 py-3.5 transition-all group"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                          <FileText className="size-4 text-emerald-500" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-semibold text-white truncate group-hover:text-emerald-500 transition-colors">
                            {displayTitle}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5 font-sans">Click to open & save</p>
                        </div>
                      </div>
                      <Download className="size-4 text-slate-500 group-hover:text-emerald-500 shrink-0 transition-colors" />
                    </a>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2">
              <ShieldAlert className="size-8 text-amber-500 mx-auto" />
              <p className="text-sm font-semibold text-white">No documents available</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                No documents are associated with this request yet. Please check back later.
              </p>
            </div>
          )}

          {/* Footer note */}
          <p className="text-center text-[11px] text-slate-650">
            This secure session is protected. Please do not share document links publicly.
          </p>

          <div className="text-center">
            <Link
              href="/"
              className="text-xs text-emerald-500 hover:underline font-medium"
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4 py-16 font-sans relative">
      {/* Radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative max-w-md w-full space-y-8 bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl">
        {/* Shield Icon Lock */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-inner">
            <Lock className="size-6 animate-pulse" />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight">Enter Passcode</h1>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
            The document folder for <span className="text-white font-bold">{propertyTitle}</span> is password-protected.
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Access Code
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <KeyRound className="size-4" />
              </div>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password (e.g. 4839)"
                className="w-full bg-slate-950 border border-slate-800 focus:border-primary/50 text-white placeholder:text-slate-600 rounded-xl py-3 pl-10 pr-4 text-sm font-semibold tracking-wider outline-none transition-all text-center uppercase"
                disabled={loading}
                autoFocus
                autoComplete="off"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-3 py-2.5 text-xs font-semibold">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full bg-primary hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40 disabled:scale-100 text-white font-bold py-3 px-4 rounded-xl text-sm transition-all shadow-lg hover:shadow-primary/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              'Verify Access Code'
            )}
          </button>
        </form>

        {/* Back Link */}
        <div className="pt-2 text-center border-t border-slate-800/60">
          <Link
            href="/"
            className="text-xs text-primary hover:underline font-semibold"
          >
            ← Back to ConvoReal Home
          </Link>
        </div>
      </div>
    </div>
  );
}
