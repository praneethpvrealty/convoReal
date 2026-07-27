import { NextResponse } from 'next/server'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { processWebhook } from '@/lib/whatsapp/webhook-handler'
import Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Lazy-initialized Redis client
let _redisClient: Redis | null = null
function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null
  if (!_redisClient) {
    _redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
    })
  }
  return _redisClient
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Skip wrong key
      }
    }

    if (matchedConfig) {
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive and route messages (via Queue or Sync fallback)
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: Parameters<typeof processWebhook>[0]
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const redis = getRedisClient()
    if (redis) {
      // Async Decoupled Flow: push raw JSON payload to Redis list and return 200 OK instantly
      console.log('[webhook] Redis queue active. Enqueueing webhook payload.')
      await redis.rpush('whatsapp-webhooks', JSON.stringify(body))
      return NextResponse.json({ status: 'queued' }, { status: 200 })
    }

    // Sync Fallback Flow: process synchronously (e.g. local dev / no Redis)
    console.log('[webhook] Redis queue offline. Processing webhook synchronously.')
    await processWebhook(body)
    return NextResponse.json({ status: 'received' }, { status: 200 })
  } catch (error) {
    console.error('Error handling webhook in route:', error)
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    )
  }
}
