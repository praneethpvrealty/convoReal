import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { getSandboxSystemConfig } from '@/lib/system-settings';

export async function POST(request: Request) {
  try {
    const rawSecret = process.env.SUPABASE_SMS_HOOK_SECRET;
    let secretStr = rawSecret?.replace(/^"|"$/g, '') || '';
    secretStr = secretStr.replace(/^(v\d+,)?whsec_/, ''); // Strip version/Svix prefix if present
    const signatureHeader = 
      request.headers.get('x-supabase-signature') || 
      request.headers.get('webhook-signature') || 
      request.headers.get('x-webhook-signature');

    console.log('[SMS Hook] Received webhook request');

    if (!secretStr || !signatureHeader) {
      console.error('[SMS Hook] Missing secret or signature header');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read raw body text for signature calculation
    const bodyText = await request.text();

    // Parse the header
    let timestamp: string | null = null;
    let signature: string | null = null;
    let isSvixFormat = false;
    const webhookId = request.headers.get('webhook-id') || request.headers.get('svix-id') || request.headers.get('x-webhook-id') || '';

    // Check if the header contains v1,SIGNATURE (comma-separated, typical Svix/standardwebhooks)
    // Supports multiple space-separated signatures
    const signatureParts = signatureHeader.split(/\s+/);
    const svixPart = signatureParts.find(p => /^v\d+,/.test(p));
    if (svixPart) {
      isSvixFormat = true;
      signature = svixPart.replace(/^v\d+,/, '');
      timestamp = request.headers.get('webhook-timestamp') || request.headers.get('svix-timestamp') || request.headers.get('x-webhook-timestamp');
    } else {
      // Parse the header (format: t=TIMESTAMP,v1=SIGNATURE)
      const parts = signatureHeader.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const signaturePart = parts.find(p => p.startsWith('v1='));

      if (timestampPart && signaturePart) {
        timestamp = timestampPart.split('=')[1];
        signature = signaturePart.split('=')[1];
      }
    }

    if (!timestamp || !signature) {
      console.error('[SMS Hook] Invalid signature header format or missing timestamp/signature');
      return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
    }

    // Recreate the expected signature
    const message = isSvixFormat && webhookId
      ? `${webhookId}.${timestamp}.${bodyText}`
      : `${timestamp}.${bodyText}`;
    
    // We support verification with both:
    // A) The base64-decoded buffer of the secret (Svix/standardwebhooks specification)
    // B) The raw secret string (UTF-8)
    const secretKeys: Array<string | Buffer> = [secretStr];
    try {
      const decodedBuffer = Buffer.from(secretStr, 'base64');
      if (decodedBuffer.length > 0) {
        secretKeys.push(decodedBuffer);
      }
    } catch {}

    let isMatch = false;

    for (const key of secretKeys) {
      // 1. Calculate HMAC-SHA256 in hex
      const expectedSignatureHex = crypto
        .createHmac('sha256', key)
        .update(message)
        .digest('hex');

      // 2. Calculate HMAC-SHA256 in base64
      const expectedSignatureBase64 = crypto
        .createHmac('sha256', key)
        .update(message)
        .digest('base64');



      // Secure comparison for hex
      try {
        const sigBuf = Buffer.from(signature, 'hex');
        const expHexBuf = Buffer.from(expectedSignatureHex, 'hex');
        if (
          sigBuf.length === expHexBuf.length &&
          crypto.timingSafeEqual(sigBuf, expHexBuf)
        ) {
          isMatch = true;
          break;
        }
      } catch {}

      // Secure comparison for base64
      try {
        const sigBuf = Buffer.from(signature, 'base64');
        const expB64Buf = Buffer.from(expectedSignatureBase64, 'base64');
        if (
          sigBuf.length === expB64Buf.length &&
          crypto.timingSafeEqual(sigBuf, expB64Buf)
        ) {
          isMatch = true;
          break;
        }
      } catch {}
      
      // Fallback plain comparison
      if (signature === expectedSignatureHex || signature === expectedSignatureBase64) {
        isMatch = true;
        break;
      }
    }

    if (!isMatch) {
      console.error('[SMS Hook] Webhook signature mismatch');
      return NextResponse.json({ error: 'Signature mismatch' }, { status: 401 });
    }

    // Parse the JSON payload
    const body = JSON.parse(bodyText);
    const user = body.user;

    // Retrieve phone and message/otp code
    const phone = body.phone || body.sms?.phone;
    const otpMessage = body.message || body.sms?.message;
    const otpCodeFromPayload = body.sms?.otp;

    if (!phone) {
      console.error('[SMS Hook] Missing phone parameter in payload');
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Extract the 6-digit verification code
    let otpCode = otpCodeFromPayload || '';
    if (!otpCode && otpMessage) {
      const codeMatch = otpMessage.match(/\b\d{6}\b/);
      otpCode = codeMatch ? codeMatch[0] : '';
    }

    if (!otpCode) {
      console.error('[SMS Hook] Verification code not found in payload');
      return NextResponse.json({ error: 'Verification code not found' }, { status: 400 });
    }

    // Initialize Supabase Admin client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Resolve tenant account_id
    let accountId: string | null = null;
    if (user?.id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profile?.account_id) {
        accountId = profile.account_id;
      }
    }

    // Fallback to the default system configuration if no account matches
    if (!accountId) {
      // 1. Try to read explicit fallback_whatsapp_account_id from system_settings
      const { data: settings } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'fallback_whatsapp_account_id')
        .maybeSingle();

      if (settings?.value) {
        accountId = settings.value as string;
      }

      // 2. Fall back to the first available config as a legacy fallback
      if (!accountId) {
        const { data: configs } = await supabase
          .from('whatsapp_config')
          .select('account_id')
          .limit(1);
        if (configs && configs.length > 0) {
          accountId = configs[0].account_id;
        }
      }
    }

    if (!accountId) {
      console.error('[SMS Hook] No active WhatsApp config found in database');
      return NextResponse.json({ error: 'WhatsApp config not found' }, { status: 500 });
    }

    // Fetch the account's WhatsApp API keys
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, integration_type')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError) {
      console.error('[SMS Hook] Failed to load WhatsApp config:', configError);
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 });
    }

    let phoneNumberId: string
    let decryptedToken: string

    // Sandbox mode: use system-wide shared credentials
    if (config?.integration_type === 'sandbox') {
      const sandboxSystem = await getSandboxSystemConfig();
      if (!sandboxSystem.enabled || !sandboxSystem.access_token || !sandboxSystem.phone_number_id) {
        console.error('[SMS Hook] Sandbox tenant but system sandbox is not configured');
        return NextResponse.json({ error: 'Sandbox system not configured' }, { status: 500 });
      }
      phoneNumberId = sandboxSystem.phone_number_id;
      decryptedToken = decrypt(sandboxSystem.access_token);
    } else {
      // Official API: use tenant's own credentials
      if (!config?.phone_number_id || !config?.access_token) {
        console.error('[SMS Hook] Failed to load WhatsApp credentials: missing phone_number_id or access_token');
        return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 });
      }
      phoneNumberId = config.phone_number_id;
      decryptedToken = decrypt(config.access_token);
    }

    // Send the OTP via WhatsApp template message, with a free-form text fallback.
    // Production numbers require an approved template (e.g. 'whatsapp_otp') to send messages
    // outside the 24-hour customer window.
    const cleanPhone = phone.replace('+', ''); // WhatsApp API prefers numbers without prefix symbol
    const sendPromise = (async () => {
      try {
        console.log(`[SMS Hook] Attempting to send OTP template 'whatsapp_otp' with copy-code button parameter to: ${cleanPhone}`);
        await sendTemplateMessage({
          phoneNumberId,
          accessToken: decryptedToken,
          to: cleanPhone,
          templateName: 'whatsapp_otp',
          language: 'en',
          messageParams: {
            body: [otpCode],
            buttonParams: {
              0: otpCode,
            },
          },
        });
      } catch (buttonError) {
        console.warn('[SMS Hook] Failed to send template with button parameter, retrying with body-only layout:', buttonError);
        await sendTemplateMessage({
          phoneNumberId,
          accessToken: decryptedToken,
          to: cleanPhone,
          templateName: 'whatsapp_otp',
          language: 'en',
          params: [otpCode],
        });
      }
      console.log(`[SMS Hook] Verification code ${otpCode} successfully sent via template to: ${cleanPhone}`);
    })().catch(async (templateError) => {
      console.warn('[SMS Hook] Template sending failed, falling back to free-form text message:', templateError);
      try {
        await sendTextMessage({
          phoneNumberId,
          accessToken: decryptedToken,
          to: cleanPhone,
          text: `Your convoReal CRM verification code is: *${otpCode}*\n\nIt is valid for 5 minutes.`,
        });
        console.log(`[SMS Hook] Verification code ${otpCode} successfully sent via fallback text message to: ${cleanPhone}`);
      } catch (fallbackError) {
        console.error('[SMS Hook] Fallback text sending failed:', fallbackError);
      }
    });

    // Wait up to 1.8 seconds for the send operation to finish.
    // If it takes longer, return success immediately and let it finish in the background
    // to prevent exceeding Supabase's strict 5-second SMS hook timeout limit.
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1800, 'timeout'));

    const result = await Promise.race([sendPromise, timeoutPromise]);
    if (result === 'timeout') {
      console.warn('[SMS Hook] Request is taking longer than 1.8s. Returning success to Supabase and completing delivery in the background.');
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[SMS Hook] Unexpected error executing webhook handler:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
