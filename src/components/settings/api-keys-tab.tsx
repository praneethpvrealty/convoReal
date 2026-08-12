'use client';

// ============================================================
// ApiKeysTab — Settings → API keys
//
// Issue, list and revoke the per-account keys that authenticate
// /api/v1 (src/lib/auth/api-keys.ts) — the MCP server, automation
// platforms, partner scripts.
//
// Three things this screen has to get right, because the cost of
// getting them wrong is a leaked credential:
//
//   1. The secret is shown ONCE. Only its SHA-256 hash is stored, so
//      neither this screen nor any route can resurface it. The create
//      dialog says so before the key exists, not after, and the
//      "done" button carries the warning rather than sitting next to
//      it.
//   2. Read-only is the default. Write access is a deliberate extra
//      tick, described by what it actually permits.
//   3. Revocation is immediate and irreversible. It is a soft delete
//      server-side — the row survives so an admin can still see what
//      the key was and when it was last used — but the key is dead on
//      the next request.
//
// Admin+ only, and Agency-plan only. Both are enforced server-side
// too; this screen exists so the answer arrives before someone wires
// up a client, not after.
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { usePlan } from '@/hooks/usePlan';
import { cn } from '@/lib/utils';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const QUERY_KEY = ['account', 'api-keys'] as const;

async function fetchKeys(): Promise<ApiKeyRow[]> {
  const res = await fetch('/api/account/api-keys');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Failed to load API keys');
  return json.keys ?? [];
}

function formatWhen(value: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** A key is live only if it is neither revoked nor past its expiry —
 *  the same two conditions resolveApiKey() applies server-side. */
function isLive(key: ApiKeyRow): boolean {
  if (key.revoked_at) return false;
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return false;
  return true;
}

function statusOf(key: ApiKeyRow): { label: string; tone: string } {
  if (key.revoked_at) return { label: 'Revoked', tone: 'bg-slate-800 text-slate-400' };
  if (!isLive(key)) return { label: 'Expired', tone: 'bg-amber-950 text-amber-300' };
  return { label: 'Active', tone: 'bg-emerald-950 text-emerald-300' };
}

export function ApiKeysTab() {
  const { canManageMembers: canManage } = useAuth();
  const { isAllowed, isLoading: planLoading, upgradeUrl } = usePlan();
  const hasApiAccess = isAllowed('api_access');

  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const {
    data: keys = [],
    isLoading,
    error,
  } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchKeys, enabled: canManage });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/account/api-keys/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to revoke key');
    },
    onSuccess: () => {
      toast.success('Key revoked. It stops working on the next request.');
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setRevoking(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!canManage) {
    return (
      <Card className="bg-slate-900/50 border-slate-800">
        <CardContent className="py-10 text-center text-sm text-slate-400">
          API keys are managed by workspace admins and owners.
        </CardContent>
      </Card>
    );
  }

  const liveCount = keys.filter(isLive).length;

  return (
    <div className="space-y-5">
      <Card className="bg-slate-900/50 border-slate-800">
        <CardContent className="p-5 space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <KeyRound className="size-4 text-violet-400" />
                API keys
              </h3>
              <p className="text-sm text-slate-400 max-w-xl">
                Let a tool outside ConvoReal read this workspace — the MCP server for
                Claude and other AI clients, an automation platform, or your own
                scripts. Each key belongs to this workspace alone and can be revoked
                at any time.
              </p>
            </div>
            <RequireRole min="admin">
              <Button
                onClick={() => setCreateOpen(true)}
                disabled={!hasApiAccess && !planLoading}
                className="shrink-0 gap-2"
              >
                <Plus className="size-4" />
                New key
              </Button>
            </RequireRole>
          </div>
        </CardContent>
      </Card>

      {!hasApiAccess && !planLoading && (
        <Card className="bg-amber-950/20 border-amber-900/40">
          <CardContent className="p-5 flex items-start gap-3">
            <Sparkles className="size-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-2 text-sm">
              <p className="text-amber-200 font-medium">
                API access is on the Agency plan
              </p>
              <p className="text-slate-400">
                Existing keys stay listed here, but they stop working while the
                workspace is on a plan without API access.{' '}
                <a href={upgradeUrl} className="underline font-medium text-amber-200">
                  See plans
                </a>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-900/50 border-slate-800">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="size-5 animate-spin text-slate-500" />
            </div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-rose-400">
              {(error as Error).message}
            </div>
          ) : keys.length === 0 ? (
            <div className="py-12 text-center space-y-1">
              <p className="text-sm text-slate-300">No API keys yet</p>
              <p className="text-xs text-slate-500">
                Create one to connect an AI client or automation tool.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {keys.map((key) => {
                const status = statusOf(key);
                return (
                  <li key={key.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-100 truncate">
                          {key.name}
                        </span>
                        <Badge className={cn('text-[10px] border-0', status.tone)}>
                          {status.label}
                        </Badge>
                        {key.scopes.includes('write') && (
                          <Badge className="text-[10px] border-0 bg-violet-950 text-violet-300">
                            write
                          </Badge>
                        )}
                      </div>
                      <code className="block text-xs text-slate-500 font-mono">
                        {key.key_prefix}…
                      </code>
                      <p className="text-xs text-slate-500">
                        Created {formatWhen(key.created_at)} · Last used{' '}
                        {formatWhen(key.last_used_at)}
                        {key.expires_at ? ` · Expires ${formatWhen(key.expires_at)}` : ''}
                      </p>
                    </div>
                    {!key.revoked_at && (
                      <RequireRole min="admin">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-slate-400 hover:text-rose-400 gap-1.5"
                          onClick={() => setRevoking(key)}
                        >
                          <Ban className="size-3.5" />
                          Revoke
                        </Button>
                      </RequireRole>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {liveCount > 0 && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" />
          {liveCount} active {liveCount === 1 ? 'key' : 'keys'}. Anyone holding one can
          read this workspace&apos;s inventory and contacts — treat them like passwords.
        </p>
      )}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
      />

      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>
              Any tool using this key stops working on its next request. This cannot be
              undone — if you need access again, create a new key.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking.id)}
              className="gap-2"
            >
              {revoke.isPending && <Loader2 className="size-4 animate-spin" />}
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------
// Create dialog. Two states: the form, then the secret — which is the
// only time it will ever be visible.
// ------------------------------------------------------------

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [allowWrite, setAllowWrite] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName('');
    setAllowWrite(false);
    setSecret(null);
    setCopied(false);
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/account/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scopes: allowWrite ? ['read', 'write'] : ['read'],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to create key');
      return json.secret as string;
    },
    onSuccess: (created) => {
      setSecret(created);
      onCreated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success('Key copied');
    } catch {
      // Clipboard is blocked in some embedded browsers; the field is
      // selectable so it can still be copied by hand.
      toast.error('Clipboard blocked — select the key and copy it manually');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your key now</DialogTitle>
              <DialogDescription>
                This is the only time it will be shown. ConvoReal stores only a hash of
                it, so it cannot be recovered later — if you lose it, revoke this key and
                create another.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 select-all break-all rounded-lg bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs font-mono text-violet-300">
                  {secret}
                </code>
                <Button onClick={copy} variant="outline" size="sm" className="shrink-0 gap-1.5">
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-slate-500 flex items-start gap-1.5">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-amber-500" />
                Anyone with this key can read this workspace. Keep it out of shared
                documents, screenshots and version control.
              </p>
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>
                {copied ? 'Done' : "I've copied it"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Give each tool its own key, so you can revoke one without disturbing the
                others.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-name">What is it for?</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Claude Desktop"
                  maxLength={80}
                  autoFocus
                />
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-slate-800 p-3 cursor-pointer">
                <Switch
                  checked={allowWrite}
                  onCheckedChange={(v) => setAllowWrite(v === true)}
                  className="mt-0.5"
                  aria-label="Allow writes"
                />
                <span className="space-y-1">
                  <span className="block text-sm text-slate-200">Allow writes</span>
                  <span className="block text-xs text-slate-500">
                    Lets the tool add contacts, append notes and create tasks. It can
                    never send WhatsApp messages, run broadcasts, or delete anything.
                    Leave this off unless you need it.
                  </span>
                </span>
              </label>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => create.mutate()}
                disabled={!name.trim() || create.isPending}
                className="gap-2"
              >
                {create.isPending && <Loader2 className="size-4 animate-spin" />}
                Create key
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
