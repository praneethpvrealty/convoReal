import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { getBetaInvitePreview } from '@/lib/beta/invite-preview';

interface InviteLayoutProps {
  children: ReactNode;
  params: Promise<{ token: string }>;
}

export async function generateMetadata({
  params,
}: InviteLayoutProps): Promise<Metadata> {
  const { token } = await params;
  const preview = await getBetaInvitePreview(token);
  const recipient = preview?.ok ? preview.label?.trim() : null;
  const inviter = preview?.inviter_name?.trim() || 'ConvoReal';
  const title = recipient
    ? `${recipient}, your private ConvoReal invitation`
    : 'Your private ConvoReal invitation';
  const description = `${inviter} reserved an invite-only beta seat for you — a WhatsApp-first AI deal engine for property consultants.`;

  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      siteName: 'ConvoReal',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function InviteTokenLayout({ children }: InviteLayoutProps) {
  return children;
}
