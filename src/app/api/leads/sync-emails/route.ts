import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

// Lazy admin client
let _adminClient: any = null;
function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

export async function GET(request: Request) {
  const host = process.env.IMAP_HOST;
  const port = process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT) : 993;
  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;
  const secure = process.env.IMAP_SECURE !== 'false';

  // Return helper instructions if parameters are not set
  if (!host || !user || !password) {
    return NextResponse.json({
      info: 'IMAP sync is currently unconfigured. Set IMAP_HOST, IMAP_USER, and IMAP_PASSWORD in your environment variables to enable email polling.',
      status: 'disabled',
    });
  }

  let client: any = null;
  try {
    // Dynamically import imapflow to ensure it compiles fine if package is not installed
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { ImapFlow } = await import('imapflow');
    
    client = new ImapFlow({
      host,
      port,
      secure,
      auth: {
        user,
        pass: password,
      },
      logger: false,
    });

    await client.connect();
    
    // Select Inbox
    const lock = await client.getMailboxLock('INBOX');
    const newLeadsCount = 0;
    const processedEmails: string[] = [];

    try {
      // Fetch unread messages
      const searchResults = await client.search({ seen: false });
      
      for (const seq of searchResults) {
        const message = await client.fetchOne(seq, {
          source: true,
          envelope: true,
          bodyStructure: true,
        });

        const subject = message.envelope.subject || '';
        const bodyText = message.source.toString();
        
        // Match subjects for real estate portals
        const isLead = /magicbricks|housing|99acres/i.test(subject) || /magicbricks|housing|99acres/i.test(bodyText);
        if (isLead) {
          // Send to our parser webhook API internally
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          const token = process.env.LEADS_WEBHOOK_TOKEN || '';
          
          const response = await fetch(`${baseUrl}/api/leads/email-webhook?token=${token}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              subject,
              text: bodyText,
            }),
          });

          if (response.ok) {
            const result = await response.json();
            processedEmails.push(`Subject: "${subject}" -> ${result.status} (Contact ID: ${result.contactId})`);
            
            // Mark email as read / seen
            await client.messageFlagsAdd(seq, ['\\Seen']);
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    return NextResponse.json({
      status: 'success',
      processed: processedEmails.length,
      details: processedEmails,
    });
  } catch (err: any) {
    console.error('[imap-sync] Sync failed:', err);
    if (client) {
      try {
        await client.logout();
      } catch (_) {}
    }
    return NextResponse.json({
      status: 'failed',
      error: err.message || 'IMAP connection failed',
      note: 'Ensure imapflow is installed in package.json if executing syncs.',
    }, { status: 500 });
  }
}
