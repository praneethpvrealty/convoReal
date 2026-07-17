// ============================================================
// GET /api/den/dashboard — the owner's activity overview.
//
// Reuses the owner-digest aggregation (enquiries, shortlists, site
// visits, showcase views per property) filtered to the caller's
// linked contacts, across every agency that manages them.
// ?days=7|30 selects the window (default 7).
// ============================================================

import { NextResponse } from "next/server";

import { withDenAuth, denAdmin } from "@/lib/den/auth";
import { gatherOwnerDigests, type DigestPeriod } from "@/lib/owners/owner-digest";

export const GET = withDenAuth(async (ctx, req) => {
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = daysParam === 30 ? 30 : 7;
  const now = new Date();
  const period: DigestPeriod = {
    startIso: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    endIso: now.toISOString(),
    label: days === 30 ? "last 30 days" : "last 7 days",
    digestDate: now.toISOString().slice(0, 10),
  };

  const db = denAdmin();

  // Group the caller's contacts by managing account and gather each
  // account's stats for just those contacts.
  const contactsByAccount = new Map<string, string[]>();
  for (const link of ctx.links) {
    const list = contactsByAccount.get(link.accountId) || [];
    list.push(link.contactId);
    contactsByAccount.set(link.accountId, list);
  }

  const agencyByAccount = new Map(ctx.links.map((l) => [l.accountId, l.agencyName]));

  const perAccount = await Promise.all(
    Array.from(contactsByAccount.entries()).map(async ([accountId, contactIds]) => {
      const digests = await gatherOwnerDigests(db, accountId, period, contactIds);
      return { accountId, digests };
    }),
  );

  // Deal Mode chips + review status come straight from the properties.
  const contactIds = ctx.links.map((l) => l.contactId);
  const { data: propertyRows } = contactIds.length
    ? await db
        .from("properties")
        .select("id, title, status, is_published, deal_mode, account_id, images, listing_type, price, rent_per_month")
        .in("owner_contact_id", contactIds)
    : { data: [] as Record<string, unknown>[] };

  const propertyMeta = new Map(
    (propertyRows || []).map((p) => [p.id as string, p as Record<string, unknown>]),
  );

  const properties = perAccount.flatMap(({ accountId, digests }) =>
    digests.flatMap((digest) =>
      digest.properties.map((stats) => {
        const meta = propertyMeta.get(stats.property_id) || {};
        return {
          ...stats,
          account_id: accountId,
          agency_name: agencyByAccount.get(accountId) ?? null,
          status: (meta.status as string) ?? null,
          is_published: Boolean(meta.is_published),
          deal_mode: (meta.deal_mode as string) ?? "off",
          listing_type: (meta.listing_type as string) ?? null,
          price: (meta.price as number) ?? null,
          rent_per_month: (meta.rent_per_month as number) ?? null,
          cover_image: Array.isArray(meta.images) ? ((meta.images as string[])[0] ?? null) : null,
        };
      }),
    ),
  );

  const totals = properties.reduce(
    (acc, p) => ({
      inquiries: acc.inquiries + p.inquiries,
      shortlisted: acc.shortlisted + p.shortlisted,
      visits: acc.visits + p.visits,
      views: acc.views + p.views,
    }),
    { inquiries: 0, shortlisted: 0, visits: 0, views: 0 },
  );

  return NextResponse.json({
    period: { days, label: period.label },
    totals,
    properties,
  });
});
