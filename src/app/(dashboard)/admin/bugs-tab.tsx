'use client';

// ============================================================
// Admin → Bugs — cross-tenant triage for the beta bug channel.
//
// Reads through /api/admin/bug-reports (service role, super-admin
// gated) because bug_reports RLS correctly scopes a tenant to their
// own rows.
//
// The table is the source of truth; "Copy for GitHub" produces a
// ready-to-paste issue body and the resulting URL is stored back on
// the row. That keeps triage state here and the engineering
// workflow on GitHub, without a token or a webhook in between.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bug, Copy, ExternalLink, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import {
  BUG_STATUSES,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type BugSeverity,
  type BugStatus,
} from '@/lib/beta/bug-reports';
import { cn } from '@/lib/utils';

interface AdminBugReport {
  id: string;
  reference: string;
  title: string;
  body: string;
  severity: BugSeverity;
  status: BugStatus;
  page_url: string | null;
  build_id: string | null;
  user_agent: string | null;
  admin_notes: string | null;
  github_issue_url: string | null;
  created_at: string;
  account_id: string;
  accounts: { name: string } | { name: string }[] | null;
}

const SEVERITY_STYLE: Record<BugSeverity, string> = {
  blocker: 'bg-red-500/15 text-red-400 border-red-500/30',
  major: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  minor: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  idea: 'bg-primary/15 text-primary border-primary/30',
};

function accountName(row: AdminBugReport): string {
  const a = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  return a?.name ?? 'Unknown account';
}

export default function BugsTab() {
  const [reports, setReports] = useState<AdminBugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/bug-reports');
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error || 'Could not load bug reports');
        return;
      }
      const data = (await res.json()) as { reports: AdminBugReport[] };
      setReports(data.reports);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch('/api/admin/bug-reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error || 'Update failed');
        return;
      }
      await load();
    },
    [load],
  );

  const visible = useMemo(
    () =>
      filter === 'all'
        ? reports
        : reports.filter(
            (r) => !['fixed', 'wont_fix', 'duplicate'].includes(r.status),
          ),
    [reports, filter],
  );

  const counts = useMemo(() => {
    const open = reports.filter(
      (r) => !['fixed', 'wont_fix', 'duplicate'].includes(r.status),
    );
    return {
      open: open.length,
      blockers: open.filter((r) => r.severity === 'blocker').length,
      accounts: new Set(reports.map((r) => r.account_id)).size,
    };
  }, [reports]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <ConvoRealLoader size={26} label="Loading bug reports" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value={counts.open} />
        <Stat label="Blockers" value={counts.blockers} warn={counts.blockers > 0} />
        <Stat label="Accounts reporting" value={counts.accounts} />
      </div>

      <div className="flex items-center gap-2">
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-slate-700 text-slate-400 hover:text-white',
            )}
          >
            {f === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <Bug className="size-6 text-slate-600" />
          <p className="text-sm text-slate-400">
            {filter === 'open' ? 'Nothing open.' : 'No reports yet.'}
          </p>
          <p className="max-w-sm text-xs text-slate-600">
            A beta producing accounts but no bug reports produced signups, not
            testers — worth chasing rather than celebrating.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((r) => (
            <ReportCard key={r.id} report={r} onPatch={patch} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p
        className={cn(
          'font-mono text-2xl font-bold tabular-nums',
          warn ? 'text-red-400' : 'text-white',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function ReportCard({
  report,
  onPatch,
}: {
  report: AdminBugReport;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [issueUrl, setIssueUrl] = useState(report.github_issue_url ?? '');
  const [busy, setBusy] = useState(false);

  const copyForGithub = useCallback(async () => {
    const md = [
      `**${report.reference}** — reported by ${accountName(report)}`,
      '',
      report.body,
      '',
      '---',
      `- Severity: ${SEVERITY_LABEL[report.severity]}`,
      `- Page: ${report.page_url ?? 'unknown'}`,
      `- Build: ${report.build_id ?? 'unknown'}`,
      `- Reported: ${new Date(report.created_at).toISOString()}`,
      report.user_agent ? `- UA: ${report.user_agent}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n');
    await navigator.clipboard.writeText(md);
    toast.success('Issue body copied');
  }, [report]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">
              {report.reference}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                SEVERITY_STYLE[report.severity],
              )}
            >
              {SEVERITY_LABEL[report.severity]}
            </span>
            <span className="text-xs text-slate-500">
              {accountName(report)}
            </span>
          </div>
          <p className="mt-1.5 font-medium text-white">{report.title}</p>
        </div>

        <select
          value={report.status}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            await onPatch(report.id, { status: e.target.value });
            setBusy(false);
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
        >
          {BUG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {report.body !== report.title && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
          {report.body}
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
        {report.page_url && <span>{report.page_url}</span>}
        {report.build_id && <span>build {report.build_id}</span>}
        <span>{new Date(report.created_at).toLocaleString()}</span>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copyForGithub()}
          className="border-slate-700"
        >
          <Copy className="size-3.5" />
          Copy for GitHub
        </Button>
        <div className="flex flex-1 gap-2">
          <Input
            value={issueUrl}
            onChange={(e) => setIssueUrl(e.target.value)}
            placeholder="Paste the issue URL"
            className="h-9 border-slate-700 bg-slate-950 text-xs text-white placeholder:text-slate-600"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || issueUrl === (report.github_issue_url ?? '')}
            onClick={async () => {
              setBusy(true);
              await onPatch(report.id, { github_issue_url: issueUrl });
              setBusy(false);
            }}
            className="border-slate-700"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Link'}
          </Button>
        </div>
        {report.github_issue_url && (
          <a
            href={report.github_issue_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 self-center text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            Open
          </a>
        )}
      </div>
    </div>
  );
}
