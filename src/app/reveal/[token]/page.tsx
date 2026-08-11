import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { propertySlug } from '@/lib/showcase/property-slug';
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

  // A listing-scope approval sends the SHARE GRANT's token, not a
  // reveal token (see approveRequestAndSendReveal). Resolve that first:
  // it means the recipient was approved for the gated page, never for
  // an address card, so the hop happens before any location lookup.
  const { data: grantRow } = await admin
    .from('property_share_grants')
    .select(
      'token, expires_at, revoked_at, reveal_listing, property:properties(id, title, type, bedrooms, showcase_visibility, sublocality, city, state)'
    )
    .eq('token', token)
    .maybeSingle();

  if (grantRow) {
    const grant = grantRow as unknown as {
      expires_at: string;
      revoked_at: string | null;
      reveal_listing: boolean;
      property: unknown;
    };
    if (
      !grant.reveal_listing ||
      grant.revoked_at ||
      new Date(grant.expires_at) <= new Date()
    ) {
      return <ErrorState reason="expired" />;
    }
    const target = (
      Array.isArray(grant.property) ? grant.property[0] : grant.property
    ) as // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;
    if (!target) return <ErrorState reason="invalid" />;
    redirect(
      `/property/${propertySlug(target)}?g=${encodeURIComponent(token)}`
    );
  }

  const { data: locRequest, error } = await admin
    .from('property_location_requests')
    .select(
      '*, property:properties(id, title, property_code, type, bedrooms, showcase_visibility, location, sublocality, city, state, google_map_link, latitude, longitude, images, private_images)'
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
      ? googleMapsUrlForCoordinates(
          Number(property.latitude),
          Number(property.longitude)
        )
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
    ? expiresAt.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  const fullAddress = [
    property.location,
    property.sublocality,
    property.city,
    property.state,
  ]
    .filter(Boolean)
    .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
    .join(', ');

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-950 px-4 py-16 font-sans text-slate-100">
      <div className="bg-primary/8 pointer-events-none absolute top-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full blur-[120px]" />

      <div className="relative w-full max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <div className="bg-primary/15 border-primary/25 mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border">
            <MapPin className="text-primary size-7" />
          </div>
          <h1 className="text-2xl font-black text-white">
            Exact Property Location
          </h1>
          <p className="text-sm text-slate-400">
            Shared securely for{' '}
            <span className="font-semibold text-white">
              {locRequest.requester_name}
            </span>
          </p>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div>
            <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Property
            </p>
            <p className="text-base font-bold text-white">
              {property.title || 'Property'}
            </p>
            {property.property_code && (
              <p className="font-mono text-xs text-slate-400">
                {property.property_code}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Address
            </p>
            <p className="text-sm leading-relaxed text-slate-200">
              {fullAddress || '—'}
            </p>
          </div>
          {mapLink && (
            <a
              href={mapLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1.5 text-xs break-all underline-offset-2 hover:underline"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              Open in Google Maps
            </a>
          )}
        </div>

        {embedSrc && (
          <div className="h-56 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
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
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-400">
            <Clock className="size-4 shrink-0" />
            This link expires on {formattedExpiry}
          </div>
        )}

        {(publicImages.length > 0 || privateCount > 0) && (
          <div className="space-y-3">
            <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              Photos
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {publicImages.map((src, idx) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={`pub-${idx}`}
                  src={src}
                  alt={`Photo ${idx + 1}`}
                  className="aspect-[4/3] w-full rounded-xl border border-slate-800 object-cover"
                />
              ))}
              {Array.from({ length: privateCount }, (_, idx) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={`priv-${idx}`}
                  src={`/api/public/reveal/${token}/image/${idx}`}
                  alt={`Private photo ${idx + 1}`}
                  className="aspect-[4/3] w-full rounded-xl border border-amber-900/50 object-cover"
                />
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-600">
          This is a private, secure link. Please do not share it publicly.
        </p>

        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
          >
            Browse more properties
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  reason,
}: {
  reason: 'invalid' | 'expired' | 'not_approved';
}) {
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16 font-sans text-slate-100">
      <div className="w-full max-w-sm space-y-3 text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
          <AlertTriangle className="size-7 text-amber-500" />
        </div>
        <h1 className="text-xl font-black text-white">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-slate-400">{copy.body}</p>
      </div>
    </div>
  );
}
