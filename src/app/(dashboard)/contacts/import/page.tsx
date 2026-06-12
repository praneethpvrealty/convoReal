'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ContactForm } from '@/components/contacts/contact-form';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { Loader2, Smartphone, AlertCircle } from 'lucide-react';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { Contact } from '@/types';

// Helper parser for shared contact payloads
function parseSharedData(title: string, text: string, url: string) {
  let name = '';
  let phone = '';
  let email = '';

  const fullPayload = [title, text, url].filter(Boolean).join('\n');

  // 1. Check if it's a vCard format
  if (fullPayload.includes('BEGIN:VCARD')) {
    const fnMatch = fullPayload.match(/FN:(.+)/i);
    const nMatch = fullPayload.match(/N:(.+)/i);
    if (fnMatch) {
      name = fnMatch[1].trim();
    } else if (nMatch) {
      name = nMatch[1].replace(/;/g, ' ').trim();
    }

    const telMatch = fullPayload.match(/TEL(?:;[^:]*)?:(.+)/i);
    if (telMatch) {
      phone = telMatch[1].trim();
    }

    const emailMatch = fullPayload.match(/EMAIL(?:;[^:]*)?:(.+)/i);
    if (emailMatch) {
      email = emailMatch[1].trim();
    }
  } else {
    // 2. Plain text parsing (e.g. "John Doe +91 98765 43210")
    // Match email
    const emailMatch = fullPayload.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      email = emailMatch[0];
    }

    // Match phone (e.g. looks like a phone number)
    const phoneMatch = fullPayload.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,6}/);
    if (phoneMatch) {
      phone = phoneMatch[0];
    }

    // Clean up labels to guess the name
    let cleanText = fullPayload
      .replace(email || '', '')
      .replace(phone || '', '')
      .replace(/(?:name|phone|email|tel|mobile|contact|address):/gi, '')
      .trim();

    // Take the first line or first few words as name
    const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      name = lines[0];
    } else {
      name = title || 'Shared Contact';
    }
  }

  return {
    name: name.slice(0, 100),
    phone: normalizePhone(phone) || phone,
    email: email.slice(0, 100),
  };
}

function ImportSharedContactContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [contactData, setContactData] = useState<Contact | null>(null);

  useEffect(() => {
    if (!searchParams) return;

    const title = searchParams.get('title') || '';
    const text = searchParams.get('text') || '';
    const url = searchParams.get('url') || '';

    if (!title && !text && !url) {
      setLoading(false);
      return;
    }

    const parsed = parseSharedData(title, text, url);

    setContactData({
      id: '',
      name: parsed.name,
      phone: parsed.phone,
      email: parsed.email,
      company: '',
      classification: 'Others',
      account_id: accountId || '',
      user_id: user?.id || '',
      created_at: new Date().toISOString(),
    } as any);
    setLoading(false);
  }, [searchParams, accountId, user]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-slate-400 text-sm">Processing shared contact data...</p>
      </div>
    );
  }

  if (!contactData) {
    return (
      <div className="max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-4">
        <AlertCircle className="size-12 text-amber-500 mx-auto" />
        <h2 className="text-lg font-semibold text-white">No Shared Data Found</h2>
        <p className="text-slate-400 text-sm">
          This URL receives contact shares from your Android device. Launch it via your phonebook share menu or go to the Contacts tab instead.
        </p>
        <button
          onClick={() => router.push('/contacts')}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Go to Contacts
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-6">
      <Smartphone className="size-16 text-primary mx-auto animate-pulse" />
      <div>
        <h2 className="text-lg font-semibold text-white">Contact Received!</h2>
        <p className="text-slate-400 text-sm mt-1">
          Review and complete the details for <strong className="text-white">{contactData.name || contactData.phone}</strong> below.
        </p>
      </div>
      <ContactForm
        open={true}
        onOpenChange={(open) => {
          if (!open) router.push('/contacts');
        }}
        contact={contactData}
        onSaved={() => {
          toast.success('Shared contact imported successfully!');
          router.push('/contacts');
        }}
      />
    </div>
  );
}

export default function ImportSharedContactPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-slate-400 text-sm">Loading import page...</p>
        </div>
      }
    >
      <ImportSharedContactContent />
    </Suspense>
  );
}
