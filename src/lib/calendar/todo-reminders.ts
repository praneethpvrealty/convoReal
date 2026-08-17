import { supabaseAdmin } from '@/lib/automations/admin-client';
import { createNotification } from '@/lib/notifications/create';

const MAX_LATE_MS = 24 * 60 * 60 * 1000;

interface ReminderTodo {
  id: string;
  account_id: string;
  user_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  due_date: string;
  priority: string;
  contact: { name: string | null; phone: string | null } | null;
  property: { title: string | null } | null;
}

function istTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function buildTodoReminderContent(todo: ReminderTodo): {
  title: string;
  body: string;
  whatsappText: string;
} {
  const details = [
    `📝 ${todo.title}`,
    todo.contact?.name
      ? `👤 ${todo.contact.name}${todo.contact.phone ? ` — ${todo.contact.phone}` : ''}`
      : null,
    todo.property?.title ? `🏠 ${todo.property.title}` : null,
    todo.description ? `📋 ${todo.description}` : null,
    todo.priority === 'high' ? '🔴 High priority' : null,
  ].filter((line): line is string => line !== null);

  return {
    title: `Task due at ${istTime(todo.due_date)}`,
    body: details.join('\n'),
    whatsappText: [
      `⏰ *Task due now — ${istTime(todo.due_date)}*`,
      ...details,
      '',
      '_Open ConvoReal to complete or reschedule this task._',
    ].join('\n'),
  };
}

export async function sendDueTodoReminders(
  now: Date = new Date()
): Promise<void> {
  const admin = supabaseAdmin();
  const oldest = new Date(now.getTime() - MAX_LATE_MS);

  const { data, error } = await admin
    .from('todos')
    .select(
      'id, account_id, user_id, assigned_to, title, description, due_date, priority, contact:contacts(name, phone), property:properties(title)'
    )
    .eq('completed', false)
    .is('reminder_sent_at', null)
    .not('due_date', 'is', null)
    .gt('due_date', oldest.toISOString())
    .lte('due_date', now.toISOString())
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[Todo Reminder] fetch failed:', error);
    return;
  }

  for (const row of data || []) {
    const todo = row as unknown as ReminderTodo;
    const assigneeId = todo.assigned_to || todo.user_id;
    const { data: claim, error: claimError } = await admin
      .from('todos')
      .update({ reminder_sent_at: now.toISOString() })
      .eq('id', todo.id)
      .eq('account_id', todo.account_id)
      .is('reminder_sent_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error(`[Todo Reminder] claim failed for todo ${todo.id}:`, claimError);
      continue;
    }
    if (!claim || !assigneeId) continue;

    const content = buildTodoReminderContent(todo);
    const result = await createNotification({
      accountId: todo.account_id,
      userId: assigneeId,
      type: 'todo_reminder',
      eventKey: 'todo_reminder',
      title: content.title,
      body: content.body,
      whatsappText: content.whatsappText,
      entityType: 'todo',
      entityId: todo.id,
      link: '/calendar',
    });

    if (!result.inAppId && !result.whatsapp?.success && result.pushCount === 0) {
      const { error: releaseError } = await admin
        .from('todos')
        .update({ reminder_sent_at: null })
        .eq('id', todo.id)
        .eq('account_id', todo.account_id)
        .eq('reminder_sent_at', now.toISOString());
      if (releaseError) {
        console.error(
          `[Todo Reminder] release failed for todo ${todo.id}:`,
          releaseError
        );
      }
    }
  }
}
