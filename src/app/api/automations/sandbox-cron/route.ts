import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  sendTransactionalEmail,
  buildTrialExpiryEmail,
  buildTrialExpiredEmail,
} from '@/lib/email'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/automations/sandbox-cron
 *
 * Cron job to check sandbox trials and send email notifications.
 * Should be called every 24 hours by a scheduler (e.g., Vercel Cron,
 * GitHub Actions, or a simple cron job on your server).
 *
 * Protected by AUTOMATION_CRON_SECRET header.
 */
export async function GET(request: Request) {
  try {
    // Verify cron secret
    const secret = request.headers.get('x-cron-secret')
    if (secret !== process.env.AUTOMATION_CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const results = {
      checked: 0,
      expiringSoon: 0,
      justExpired: 0,
      emailsSent: 0,
      emailErrors: 0,
      errors: [] as string[],
    }

    // 1. Find trials expiring in 1-2 days (send warning email)
    const warningThreshold = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    const { data: expiringSoon } = await supabaseAdmin
      .from('whatsapp_config')
      .select('*, account:accounts(id, name), owner:profiles(user_id, full_name, email)')
      .eq('integration_type', 'sandbox')
      .lte('trial_ends_at', warningThreshold.toISOString())
      .gt('trial_ends_at', now.toISOString())

    results.checked += (expiringSoon?.length || 0)

    for (const config of expiringSoon || []) {
      const account = (config as unknown as Record<string, unknown>).account as Record<string, unknown> | undefined
      const owner = (config as unknown as Record<string, unknown>).owner as Record<string, unknown> | undefined
      const trialEndsAt = (config as unknown as Record<string, unknown>).trial_ends_at as string
      const sandboxCode = (config as unknown as Record<string, unknown>).sandbox_code as string
      const accountId = (account?.id || (config as unknown as Record<string, unknown>).account_id) as string

      if (!owner?.email) {
        results.errors.push(`No owner email for account ${accountId}`)
        continue
      }

      const daysRemaining = Math.ceil(
        (new Date(trialEndsAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      )

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://convoreal.com'
      const { subject, html, text } = buildTrialExpiryEmail({
        tenantName: (owner.full_name as string) || 'there',
        trialEndsAt,
        daysRemaining,
        sandboxCode,
        upgradeUrl: `${siteUrl}/settings?tab=whatsapp`,
      })

      const emailResult = await sendTransactionalEmail({
        to: owner.email as string,
        subject,
        html,
        text,
      })

      if (emailResult.success) {
        results.emailsSent++
        results.expiringSoon++
      } else {
        results.emailErrors++
        results.errors.push(`Failed to email ${owner.email}: ${emailResult.error}`)
      }
    }

    // 2. Find trials that expired in the last 24 hours (send expired email)
    const expiryWindow = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const { data: justExpired } = await supabaseAdmin
      .from('whatsapp_config')
      .select('*, account:accounts(id, name), owner:profiles(user_id, full_name, email)')
      .eq('integration_type', 'sandbox')
      .lte('trial_ends_at', now.toISOString())
      .gt('trial_ends_at', expiryWindow.toISOString())

    for (const config of justExpired || []) {
      const account = (config as unknown as Record<string, unknown>).account as Record<string, unknown> | undefined
      const owner = (config as unknown as Record<string, unknown>).owner as Record<string, unknown> | undefined
      const sandboxCode = (config as unknown as Record<string, unknown>).sandbox_code as string
      const accountId = (account?.id || (config as unknown as Record<string, unknown>).account_id) as string

      if (!owner?.email) {
        results.errors.push(`No owner email for account ${accountId}`)
        continue
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://convoreal.com'
      const { subject, html, text } = buildTrialExpiredEmail({
        tenantName: (owner.full_name as string) || 'there',
        sandboxCode,
        upgradeUrl: `${siteUrl}/settings?tab=whatsapp`,
      })

      const emailResult = await sendTransactionalEmail({
        to: owner.email as string,
        subject,
        html,
        text,
      })

      if (emailResult.success) {
        results.emailsSent++
        results.justExpired++
      } else {
        results.emailErrors++
        results.errors.push(`Failed to email ${owner.email}: ${emailResult.error}`)
      }
    }

    console.log('[sandbox-cron] Results:', results)

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('Error in sandbox-cron:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
