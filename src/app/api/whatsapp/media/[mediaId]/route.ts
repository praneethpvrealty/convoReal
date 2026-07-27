import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    // whatsapp_config is one-per-account post-multi-user, so a teammate
    // fetching media for a conversation in the shared inbox needs the
    // account's config, not their personal (non-existent) row. Viewing
    // is not role-gated — anyone who can open the inbox can load its
    // attachments.
    const { supabase, accountId } = await getCurrentAccount()

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    let mediaInfo
    try {
      mediaInfo = await getMediaUrl({ mediaId, accessToken })
    } catch (metaError: unknown) {
      const errorMessage = metaError instanceof Error ? metaError.message : String(metaError)

      // Check if it's a "not found" error (expired/invalid media or forwarded message).
      // meta-api.ts now throws with the real Meta message so this check is reliable.
      if (
        errorMessage.includes('does not exist') ||
        errorMessage.includes('missing permissions') ||
        errorMessage.includes('GraphMethodException')
      ) {
        console.warn(`[media] Media ${mediaId} unavailable (forwarded or expired)`)
        return NextResponse.json(
          {
            error: 'Media unavailable',
            message: 'This media could not be loaded. It may have been sent as a forwarded message or is no longer available.',
            code: 'MEDIA_UNAVAILABLE',
            mediaId,
          },
          { status: 404 }
        )
      }

      // Re-throw unexpected errors — outer catch will log + return 500
      throw metaError
    }

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return toErrorResponse(error)
  }
}
