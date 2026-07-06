// ============================================================
// WhatsApp notifications for credit/referral events — Org Manager
// only. Reuses sendWhatsAppMessageAndPersist exactly as
// src/app/api/properties/[id]/approve/route.ts does: pass `toPhone`
// with no `contactId` so the dispatcher finds-or-creates a contact
// row for the Manager's own number and messages through it.
//
// Every function here is non-fatal: a failed notification must
// never block the credit mutation that triggered it. Callers on hot
// paths (chatbot soft-burn) should not `await` these.
// ============================================================

import { billingAdmin } from '@/lib/billing/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

interface ManagerProfile {
  user_id: string;
  phone: string | null;
  full_name: string | null;
}

async function getOrgManagerProfile(accountId: string): Promise<ManagerProfile | null> {
  const supabase = billingAdmin();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, phone, full_name')
    .eq('account_id', accountId)
    .eq('org_role', 'org_manager')
    .maybeSingle();

  if (error || !data?.phone) return null;
  return data as ManagerProfile;
}

async function notifyManager(accountId: string, text: string, label: string): Promise<void> {
  try {
    const manager = await getOrgManagerProfile(accountId);
    if (!manager?.phone) return;

    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: manager.user_id,
      toPhone: manager.phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });

    if (!result.success) {
      console.warn(`[credits/notify] ${label} notification failed (non-fatal): ${result.error}`);
    }
  } catch (err) {
    console.error(`[credits/notify] ${label} notification exception (non-fatal):`, err);
  }
}

export async function notifyManagerLowBalance(
  accountId: string,
  balance: number,
  threshold: 'low' | 'critical' | 'zero',
): Promise<void> {
  const copy: Record<typeof threshold, string> = {
    low: `⚠️ Your ConvoReal credit balance is running low: ${balance.toLocaleString()} cr left. Top up or upgrade your plan to keep AI features running smoothly.`,
    critical: `🔶 Critical: only ${balance.toLocaleString()} cr left in your ConvoReal wallet. AI features will lock at 0 credits.`,
    zero: `🔴 You've used all your credits. AI features are now locked until you buy more credits or upgrade your plan.`,
  };
  await notifyManager(accountId, copy[threshold], 'low-balance');
}

export async function notifyManagerCreditsAdded(
  accountId: string,
  credits: number,
  packageName: string,
): Promise<void> {
  await notifyManager(
    accountId,
    `✅ ${credits.toLocaleString()} credits added to your wallet (${packageName}). Ready to use right away.`,
    'credits-added',
  );
}

export async function notifyManagerReferralConverted(
  accountId: string,
  refereeName: string,
  creditsEarned: number,
): Promise<void> {
  await notifyManager(
    accountId,
    `🎉 Your referral ${refereeName} just upgraded to a paid plan — you earned ${creditsEarned.toLocaleString()} credits!`,
    'referral-converted',
  );
}

export async function notifyReferrerPendingVoided(accountId: string, reason: string): Promise<void> {
  await notifyManager(
    accountId,
    `A pending referral reward in your ConvoReal account didn't qualify and has been removed (${reason}). Contact support if you think this is a mistake.`,
    'referral-voided',
  );
}
