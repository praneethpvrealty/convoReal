import { NextResponse } from 'next/server'
import {
  requireOrgRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  clearedTemplateComplaints,
  normalizeCategory,
  normalizeStatus,
} from '@/lib/whatsapp/template-status-normalize'
import {
  metaTemplateContent,
  normalizeQualityScore,
  type MetaTemplate,
} from '@/lib/whatsapp/meta-template-row'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export async function POST() {
  // Sync writes/overwrites local template rows, so it carries the
  // same org_manager gate as the other template write routes (see
  // migration 146). Resolved outside the main try so a 401/403
  // doesn't collapse into the generic 500.
  let ctx: AccountContext
  try {
    ctx = await requireOrgRole('org_manager')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, userId, accountId } = ctx

  try {
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    const metaTemplates: MetaTemplate[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${config.waba_id}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
          // response wasn't JSON — keep the fallback
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: {
        data?: MetaTemplate[]
        paging?: { next?: string }
      } = await metaRes.json()
      if (metaBody.data) metaTemplates.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    // ── Deduplicate existing rows ──────────────────────────────────────────
    // Before syncing, remove any duplicate rows (same name + account_id)
    // that may have been created by earlier buggy syncs. Keep the oldest row.
    try {
      const { data: allTemplates } = await supabase
        .from('message_templates')
        .select('id, name, language')
        .eq('account_id', accountId);

      if (allTemplates && allTemplates.length > 0) {
        const byName = new Map<string, typeof allTemplates>();
        for (const t of allTemplates) {
          const key = t.name;
          const existing = byName.get(key) || [];
          existing.push(t);
          byName.set(key, existing);
        }

        const idsToDelete: string[] = [];
        for (const [, rows] of byName) {
          if (rows.length > 1) {
            // Keep the first (oldest), delete the rest
            idsToDelete.push(...rows.slice(1).map(r => r.id));
          }
        }

        if (idsToDelete.length > 0) {
          console.log(`[template-sync] Cleaning up ${idsToDelete.length} duplicate template rows`);
          // Best-effort duplicate cleanup, already declared non-fatal by
          // the catch below: a row that does not go is left for the next
          // sync rather than failing this one.
          await supabase
            .from('message_templates')
            // eslint-disable-next-line convoreal/supabase-write-guard
            .delete()
            .in('id', idsToDelete);
        }
      }
    } catch (cleanupErr) {
      console.warn('[template-sync] Duplicate cleanup failed (non-fatal):', cleanupErr);
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const row = {
        // Account tenancy + user audit, same split as the submit
        // route. account_id is NOT NULL on message_templates
        // post-017, so an INSERT without it errors.
        account_id: accountId,
        user_id: userId,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        ...metaTemplateContent(t),
        status: normalizeStatus(t.status),
        meta_template_id: t.id,
        quality_score: normalizeQualityScore(t.quality_score),
        ...clearedTemplateComplaints(normalizeStatus(t.status)),
        updated_at: new Date().toISOString(),
      }

      const { data: existing, error: lookupErr } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', t.name)
        .eq('language', t.language)
        .limit(1)
        .maybeSingle()

      if (lookupErr) {
        errors.push({
          name: t.name,
          language: t.language,
          message: lookupErr.message,
        });
        continue;
      }

      // If duplicates exist (shouldn't, but handle gracefully), clean them up
      if (!existing?.id) {
        const { data: anyExisting } = await supabase
          .from('message_templates')
          .select('id')
          .eq('account_id', accountId)
          .eq('name', t.name)
          .limit(1)
          .maybeSingle();
        
        if (anyExisting?.id) {
          // Found a row with same name but different language — update it
          const { data: updLangRows, error: updLangErr } = await supabase
            .from('message_templates')
            .update(row)
            .eq('id', anyExisting.id)
            .select('id');
          // Only count a row the write actually touched, or the summary
          // reports templates it never synced.
          if (!updLangErr && updLangRows?.length) { updated++; continue; }
        }
      }

      if (existing?.id) {
        const { data: updRows, error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
          .select('id')
        if (!updErr && !updRows?.length) {
          errors.push({
            name: t.name,
            language: t.language,
            message: 'Local row could not be updated.',
          })
          continue
        }
        if (updErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: updErr.message,
          })
        } else {
          updated++
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row)
        if (insErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: insErr.message,
          })
        } else {
          inserted++
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
