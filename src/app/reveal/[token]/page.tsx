import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { storagePublicUrl } from '@/lib/storage/url';
import { googleMapsUrlForCoordinates } from '@/lib/maps/map-links';
import { AlertTriangle, Clock, MapPin, ExternalLink } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Property Location',
  description: 'Securely access the exact property location shared with you.',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RevealPage({ params }: PageProps) {
  const { token } = await params;

  if (!token || token.length < 20) {
    return <ErrorState reason="invalid" />;
  }

  const admin = supabaseAdmin();

  const { data: locRequest, error } = await admin
    .from('property_location_requests')
    .select(
      '*, property:properties(id, title, property_code, location, sublocality, city, state, google_map_link, latitude, longitude, images, private_images)'
    )
    .eq('share_token', token)
    .maybeSingle();

  if (error || !locRequest) {
    return <ErrorState reason="invalid" />;
  }
  if (locRequest.status !== 'approved') {
    return <ErrorState reason="not_approved" />;
  }

  const expiresAt = locRequest.share_token_expires_at
    ? new Date(locRequest.share_token_expires_at)
    : null;
  if (expiresAt && new Date() > expiresAt) {
    return <ErrorState reason="expired" />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const property = locRequest.property as any;
  if (!property) {
    return <ErrorState reason="invalid" />;
  }

  await admin
    .from('property_location_requests')
    .update({
      view_count: (locRequest.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', locRequest.id);

  const mapLink =
    property.google_map_link ||
    (property.latitude != null && property.longitude != null
      ? googleMapsUrlForCoordinates(Number(property.latitude), Number(property.longitude))
      : null);
  const embedSrc = mapLink
    ? mapLink.includes('q=')
      ? mapLink.replace(/\/+$/, '') + '&output=embed'
      : `https://maps.google.com/maps?q=${encodeURIComponent(property.location || '')}&output=embed`
    : property.location
      ? `https://maps.google.com/maps?q=${encodeURIComponent(property.location)}&output=embed`
      : null;

  const publicImages: string[] = Array.isArray(property.images)
    ? property.images.filter((v: string) => v?.trim()).map(storagePublicUrl)
    : [];
  const privateCount: number = Array.isArray(property.private_images)
    ? property.private_images.filter((v: string) => v?.trim()).length
    : 0;

  const formattedExpiry = expiresAt
    ? expiresAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const fullAddress = [property.location, property.sublocality, property.city, property.state]
    .filter(Boolean)
    .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
    .join(', ');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-16 font-sans">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative max-w-lg w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/15 border border-primary/25 mb-4">
            <MapPin className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-black text-white">Exact Property Location</h1>
          <p className="text-sm text-slate-400">
            Shared securely for{' '}
            <span className="text-white font-semibold">{locRequest.requester_name}</span>
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Property</p>
            <p className="text-base font-bold text-white">{property.title || 'Property'}</p>
            {property.property_code && (
              <p className="text-xs text-slate-400 font-mono">{property.property_code}</p>
            )}
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Address</p>
            <p className="text-sm text-slate-200 leading-relaxed">{fullAddress || '—'}</p>
          </div>
          {mapLink && (
            <a
              href={mapLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2 break-all"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              Open in Google Maps
            </a>
          )}
        </div>

        {embedSrc && (
          <div className="rounded-2xl overflow-hidden border border-slate-800 h-56 bg-slate-900">
            <iframe
              title="Property Location"
              src={embedSrc}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        )}

        {formattedExpiry && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-xs text-amber-400 font-medium">
            <Clock className="size-4 shrink-0" />
            This link expires on {formattedExpiry}
          </div>
        )}

        {(publicImages.length > 0 || privateCount > 0) && (
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Photos</h2>
            <div className="grid grid-cols-2 gap-3">
              {publicImages.map((src, idx) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={`pub-${idx}`}
                  src={src}
                  alt={`Photo ${idx + 1}`}
                  className="aspect-[4/3] w-full object-cover rounded-xl border border-slate-800"
                />
              ))}
              {Array.from({ length: privateCount }, (_, idx) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={`priv-${idx}`}
                  src={`/api/public/reveal/${token}/image/${idx}`}
                  alt={`Private photo ${idx + 1}`}
                  className="aspect-[4/3] w-full object-cover rounded-xl border border-amber-900/50"
                />
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-600">
          This is a private, secure link. Please do not share it publicly.
        </p>

        <div className="text-center">
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2">
            Browse more properties
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ reason }: { reason: 'invalid' | 'expired' | 'not_approved' }) {
  const copy =
    reason === 'expired'
      ? {
          title: 'Link Expired',
          body: 'This location link has expired. Please contact the person who shared the property with you for a fresh link.',
        }
      : reason === 'not_approved'
        ? {
            title: 'Not Available Yet',
            body: 'This request has not been approved yet. You will receive the location on WhatsApp once it is.',
          }
        : {
            title: 'Invalid Link',
            body: 'This location link is invalid. Please check the link or contact the person who shared the property with you.',
          };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4 py-16 font-sans">
      <div className="max-w-sm w-full text-center space-y-3">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/25">
          <AlertTriangle className="size-7 text-amber-500" />
        </div>
        <h1 className="text-xl font-black text-white">{copy.title}</h1>
        <p className="text-sm text-slate-400 leading-relaxed">{copy.body}</p>
      </div>
    </div>
  );
}
