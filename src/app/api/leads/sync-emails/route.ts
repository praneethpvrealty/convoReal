import { NextResponse } from 'next/server';

interface ImapClient {
  connect(): Promise<void>;
  getMailboxLock(box: string): Promise<{ release(): void }>;
  search(query: { seen: boolean }): Promise<number[]>;
  fetchOne(
    seq: number,
    options: { source: boolean; envelope: boolean; bodyStructure: boolean }
  ): Promise<{
    envelope: { subject?: string };
    source: { toString(): string };
  }>;
  messageFlagsAdd(seq: number, flags: string[]): Promise<void>;
  logout(): Promise<void>;
}

export async function GET() {
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

  let client: ImapClient | null = null;
  try {
    // Dynamically import imapflow to ensure it compiles fine if package is not installed
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { ImapFlow } = await import('imapflow');
    
    const activeClient: ImapClient = new ImapFlow({
      host,
      port,
      secure,
      auth: {
        user,
        pass: password,
      },
      logger: false,
    });
    client = activeClient;

    await activeClient.connect();
    
    // Select Inbox
    const lock = await activeClient.getMailboxLock('INBOX');
    const processedEmails: string[] = [];

    try {
      // Fetch unread messages
      const searchResults = await activeClient.search({ seen: false });
      
      for (const seq of searchResults) {
        const message = await activeClient.fetchOne(seq, {
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
            await activeClient.messageFlagsAdd(seq, ['\\Seen']);
          }
        }
      }
    } finally {
      lock.release();
    }

    await activeClient.logout();

    return NextResponse.json({
      status: 'success',
      processed: processedEmails.length,
      details: processedEmails,
    });
  } catch (err) {
    const error = err as Error;
    console.error('[imap-sync] Sync failed:', error);
    if (client) {
      try {
        await client.logout();
      } catch {
        // Safe check
      }
    }
    return NextResponse.json({
      status: 'failed',
      error: error.message || 'IMAP connection failed',
      note: 'Ensure imapflow is installed in package.json if executing syncs.',
    }, { status: 500 });
  }
}
