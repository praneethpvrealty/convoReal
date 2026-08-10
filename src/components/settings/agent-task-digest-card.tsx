'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ListChecks, Loader2, Plus, X } from 'lucide-react';
import { DEFAULT_SEND_TIMES, normalizeSendTimes } from '@/lib/agents/task-digest';

/**
 * Settings card for the Agent Task Digest — the agent's own overdue
 * work, today's tasks and today's calendar, sent to them at the times
 * they pick.
 *
 * Personal, not account-wide: the row is keyed on the signed-in user
 * and RLS only exposes their own. An admin changing this would be
 * changing when somebody else's phone buzzes at 7am.
 *
 * There is no template to submit. Delivery goes through the account's
 * notification preferences (in-app, push, and WhatsApp as free text),
 * so nothing here waits on a Meta review.
 */
const MAX_TIMES = 8;

export function AgentTaskDigestCard() {
  const supabase = createClient();
  const { accountId, user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [times, setTimes] = useState<string[]>(DEFAULT_SEND_TIMES);

  const loadState = useCallback(async () => {
    if (!accountId || !user?.id) return;
    try {
      const { data } = await supabase
        .from('agent_task_digest_settings')
        .select('enabled, send_times')
        .eq('account_id', accountId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) {
        setEnabled(data.enabled !== false);
        setTimes(normalizeSendTimes(data.send_times));
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, user?.id]);

  useEffect(() => {
    if (!authLoading) loadState();
  }, [authLoading, loadState]);

  const save = async (nextEnabled: boolean, nextTimes: string[]) => {
    if (!accountId || !user?.id) return;
    const cleaned = normalizeSendTimes(nextTimes);
    setSaving(true);
    try {
      const { error } = await supabase.from('agent_task_digest_settings').upsert(
        {
          account_id: accountId,
          user_id: user.id,
          enabled: nextEnabled,
          send_times: cleaned,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,user_id' }
      );
      if (error) throw error;
      setTimes(cleaned);
      toast.success(
        nextEnabled
          ? `Digest set for ${cleaned.join(', ')}`
          : 'Task digest turned off'
      );
    } catch (err) {
      console.error('[agent-task-digest] save failed:', err);
      toast.error('Failed to save digest schedule');
      loadState();
    } finally {
      setSaving(false);
    }
  };

  const updateTime = (index: number, value: string) => {
    setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  };

  const removeTime = (index: number) => {
    const next = times.filter((_, i) => i !== index);
    setTimes(next);
    save(enabled, next);
  };

  const addTime = () => {
    if (times.length >= MAX_TIMES) return;
    const next = [...times, '18:00'];
    setTimes(next);
    save(enabled, next);
  };

  return (
    <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          <CardTitle className="text-white">Task Digest</CardTitle>
        </div>
        <CardDescription className="text-slate-400">
          Your overdue tasks, today&apos;s tasks and today&apos;s calendar, sent to you at
          the times you choose. Times are IST. This schedule is yours alone — it does not
          change anyone else&apos;s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="task-digest-enabled" className="text-slate-200">
                Send me the digest
              </Label>
              <Switch
                id="task-digest-enabled"
                checked={enabled}
                disabled={saving}
                onCheckedChange={(v) => {
                  setEnabled(v);
                  save(v, times);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-200">
                Send times ({times.length}
                {times.length === 1 ? ' a day' : ' times a day'})
              </Label>
              <div className="flex flex-wrap gap-2">
                {times.map((t, i) => (
                  <div key={`${t}-${i}`} className="flex items-center gap-1">
                    <Input
                      type="time"
                      value={t}
                      disabled={saving || !enabled}
                      onChange={(e) => updateTime(i, e.target.value)}
                      onBlur={() => save(enabled, times)}
                      className="w-32 bg-slate-800 border-slate-700 text-white"
                    />
                    {times.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={saving || !enabled}
                        onClick={() => removeTime(i)}
                        aria-label={`Remove ${t}`}
                      >
                        <X className="size-4 text-slate-400" />
                      </Button>
                    )}
                  </div>
                ))}
                {times.length < MAX_TIMES && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving || !enabled}
                    onClick={addTime}
                    className="border-slate-700 text-slate-300"
                  >
                    <Plus className="size-4 mr-1" /> Add a time
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Checked every half hour, so a time is delivered on or just after the
                half-hour it falls in. Nothing is sent when you have no open work.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
