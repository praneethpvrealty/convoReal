import { Resend } from 'resend'

const resendApiKey = process.env.RESEND_API_KEY
const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@convoreal.com'
const appName = process.env.NEXT_PUBLIC_DEFAULT_WEBSITE_NAME || 'ConvoReal'

let _resend: Resend | null = null
function getResend(): Resend | null {
  if (!resendApiKey) return null
  if (!_resend) _resend = new Resend(resendApiKey)
  return _resend
}

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export async function sendTransactionalEmail(args: SendEmailArgs): Promise<{
  success: boolean
  messageId?: string
  error?: string
}> {
  const client = getResend()
  if (!client) {
    console.warn('[Email] RESEND_API_KEY not configured. Email not sent.')
    return { success: false, error: 'Email service not configured' }
  }

  try {
    const { data, error } = await client.emails.send({
      from: `${appName} <${fromEmail}>`,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo,
    })

    if (error) {
      console.error('[Email] Resend error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, messageId: data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Email] Send failed:', message)
    return { success: false, error: message }
  }
}

export function buildTrialExpiryEmail(params: {
  tenantName: string
  trialEndsAt: string
  daysRemaining: number
  sandboxCode: string
  upgradeUrl: string
}): { subject: string; html: string; text: string } {
  const { tenantName, trialEndsAt, daysRemaining, sandboxCode, upgradeUrl } = params

  const subject = daysRemaining <= 0
    ? `Your ${appName} sandbox trial has expired`
    : `Your ${appName} sandbox trial expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="color: #7c3aed; margin-bottom: 16px;">${daysRemaining <= 0 ? 'Trial Expired' : 'Trial Expiring Soon'}</h2>
      <p>Hi ${tenantName},</p>
      <p>
        ${daysRemaining <= 0
          ? `Your sandbox trial for <strong>${appName}</strong> has expired. Your sandbox code <code>#${sandboxCode}</code> is no longer active.`
          : `Your sandbox trial for <strong>${appName}</strong> expires on <strong>${new Date(trialEndsAt).toLocaleDateString()}</strong> (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining).`
        }
      </p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-size: 14px;">
          <strong>What happens next?</strong><br/>
          ${daysRemaining <= 0
            ? 'New lead messages will not be routed to your inbox. Upgrade to Official API to restore full access and keep all your conversations.'
            : 'After expiry, new lead messages will stop routing to your inbox. Upgrade now to keep everything running smoothly.'
          }
        </p>
      </div>
      <a href="${upgradeUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
        Upgrade to Official API
      </a>
      <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">
        Need help? Reply to this email or contact support.
      </p>
    </div>
  `

  const text = daysRemaining <= 0
    ? `Hi ${tenantName},\n\nYour sandbox trial for ${appName} has expired. Your sandbox code #${sandboxCode} is no longer active.\n\nUpgrade to Official API to restore full access: ${upgradeUrl}`
    : `Hi ${tenantName},\n\nYour sandbox trial for ${appName} expires on ${new Date(trialEndsAt).toLocaleDateString()} (${daysRemaining} days remaining).\n\nUpgrade now to keep everything running: ${upgradeUrl}`

  return { subject, html, text }
}

export function buildTrialExpiredEmail(params: {
  tenantName: string
  sandboxCode: string
  upgradeUrl: string
}): { subject: string; html: string; text: string } {
  return buildTrialExpiryEmail({
    ...params,
    trialEndsAt: new Date().toISOString(),
    daysRemaining: 0,
  })
}

export function buildImageCleanupWarningEmail(params: {
  tenantName: string
  properties: { title: string }[]
  archiveDate: string
  inventoryUrl: string
}): { subject: string; html: string; text: string } {
  const { tenantName, properties, archiveDate, inventoryUrl } = params
  const count = properties.length
  const dateStr = new Date(archiveDate).toLocaleDateString()
  const noun = count === 1 ? 'property' : 'properties'

  const subject = `Photos for ${count} old ${noun} will be archived on ${dateStr}`

  const list = properties
    .slice(0, 25)
    .map((p) => `<li style="margin: 4px 0;">${p.title}</li>`)
    .join('')
  const more =
    count > 25
      ? `<p style="font-size: 13px; color: #6b7280;">…and ${count - 25} more.</p>`
      : ''

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="color: #7c3aed; margin-bottom: 16px;">Freeing up storage on old listings</h2>
      <p>Hi ${tenantName},</p>
      <p>
        These ${noun} have been <strong>Sold, Archived, or off the market</strong>
        for a long time. To keep your account tidy, their photos will be archived
        on <strong>${dateStr}</strong>:
      </p>
      <ul style="background: #f3f4f6; border-radius: 8px; padding: 16px 16px 16px 32px; margin: 16px 0;">
        ${list}
      </ul>
      ${more}
      <p style="font-size: 14px;">
        <strong>Want to keep them?</strong> Just re-activate the listing (change its
        status back to Available) before that date, or open it any time afterwards to
        restore the photos — we keep a recoverable copy.
      </p>
      <a href="${inventoryUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
        Open Inventory
      </a>
      <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">
        No action is needed if you no longer need these photos. Reply to this email if you have questions.
      </p>
    </div>
  `

  const titles = properties
    .slice(0, 25)
    .map((p) => `- ${p.title}`)
    .join('\n')
  const text = `Hi ${tenantName},\n\nPhotos for ${count} old ${noun} (Sold / Archived / off-market) will be archived on ${dateStr}:\n\n${titles}${count > 25 ? `\n…and ${count - 25} more.` : ''}\n\nTo keep them, re-activate the listing before that date, or restore the photos afterwards from Inventory: ${inventoryUrl}`

  return { subject, html, text }
}
