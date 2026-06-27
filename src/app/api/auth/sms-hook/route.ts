import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';

export async function POST(request: Request) {
  try {
    const rawSecret = process.env.SUPABASE_SMS_HOOK_SECRET;
    let secretStr = rawSecret?.replace(/^"|"$/g, '') || '';
    secretStr = secretStr.replace(/^(v\d+,)?whsec_/, ''); // Strip version/Svix prefix if present
    const signatureHeader = 
      request.headers.get('x-supabase-signature') || 
      request.headers.get('webhook-signature') || 
      request.headers.get('x-webhook-signature');

    const headerKeys = Array.from(request.headers.keys());

    console.log('[SMS Hook Debug]', {
      hasRawSecret: !!rawSecret,
      rawSecretLength: rawSecret?.length,
      hasCleanSecret: !!secretStr,
      cleanSecretLength: secretStr.length,
      hasSignatureHeader: !!signatureHeader,
      signatureHeaderValue: signatureHeader,
      receivedHeaders: headerKeys,
    });

    if (!secretStr || !signatureHeader) {
      console.error('[SMS Hook] Missing secret or signature header');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read raw body text for signature calculation
    const bodyText = await request.text();

    // Parse the header (format: t=TIMESTAMP,v1=SIGNATURE)
    const parts = signatureHeader.split(',');
    const timestampPart = parts.find(p => p.startsWith('t='));
    const signaturePart = parts.find(p => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) {
      console.error('[SMS Hook] Invalid signature header format');
      return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
    }

    const timestamp = timestampPart.split('=')[1];
    const signature = signaturePart.split('=')[1];

    // Recreate the expected signature
    const message = `${timestamp}.${bodyText}`;
    
    // We support verification with both:
    // A) The base64-decoded buffer of the secret (Svix/standardwebhooks specification)
    // B) The raw secret string (UTF-8)
    const secretKeys: Array<string | Buffer> = [secretStr];
    try {
      const decodedBuffer = Buffer.from(secretStr, 'base64');
      if (decodedBuffer.length > 0) {
        secretKeys.push(decodedBuffer);
      }
    } catch (e) {}

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

      console.log('[SMS Hook Debug] Key comparison:', {
        keyType: typeof key,
        keyLength: key.length,
        receivedSignature: signature,
        expectedHex: expectedSignatureHex,
        expectedBase64: expectedSignatureBase64,
      });

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
      } catch (e) {}

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
      } catch (e) {}
      
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
    const { phone, message: otpMessage, user } = body;

    if (!phone || !otpMessage) {
      console.error('[SMS Hook] Missing phone or message parameters in payload');
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Extract the 6-digit verification code
    const codeMatch = otpMessage.match(/\b\d{6}\b/);
    const otpCode = codeMatch ? codeMatch[0] : '';

    if (!otpCode) {
      console.error('[SMS Hook] Verification code not found in message body');
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
      const { data: configs } = await supabase
        .from('whatsapp_config')
        .select('account_id')
        .limit(1);
      if (configs && configs.length > 0) {
        accountId = configs[0].account_id;
      }
    }

    if (!accountId) {
      console.error('[SMS Hook] No active WhatsApp config found in database');
      return NextResponse.json({ error: 'WhatsApp config not found' }, { status: 500 });
    }

    // Fetch the account's WhatsApp API keys
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError || !config?.phone_number_id || !config?.access_token) {
      console.error('[SMS Hook] Failed to load WhatsApp credentials:', configError);
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 });
    }

    // Decrypt the system access token
    const decryptedToken = decrypt(config.access_token);

    // Send the OTP via WhatsApp text message
    const cleanPhone = phone.replace('+', ''); // WhatsApp API prefers numbers without prefix symbol
    await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken: decryptedToken,
      to: cleanPhone,
      text: `Your waCRM verification code is: *${otpCode}*\n\nIt is valid for 5 minutes.`,
    });

    console.log(`[SMS Hook] Verification code ${otpCode} successfully sent to WhatsApp client: ${cleanPhone}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[SMS Hook] Unexpected error executing webhook handler:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
