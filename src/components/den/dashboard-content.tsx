"use client";

// Owners Den overview: activity totals + per-property cards.

import { useEffect, useState } from "react";
import Link from "next/link";

import { useDen } from "./den-provider";
import { formatINR, DEAL_MODE_META } from "./format";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Building2,
  CalendarCheck,
  Eye,
  HandCoins,
  MessageCircle,
  Plus,
  Star,
} from "lucide-react";

interface DashboardProperty {
  property_id: string;
  title: string;
  inquiries: number;
  shortlisted: number;
  visits: number;
  views: number;
  agency_name: string | null;
  status: string | null;
  is_published: boolean;
  deal_mode: string;
  listing_type: string | null;
  price: number | null;
  rent_per_month: number | null;
  cover_image: string | null;
}

interface DashboardData {
  period: { days: number; label: string };
  totals: { inquiries: number; shortlisted: number; visits: number; views: number };
  properties: DashboardProperty[];
}

export function DenDashboardContent() {
  const { me } = useDen();
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<DashboardData | null>(null);
  // Which window the loaded `data` belongs to — differing from `days`
  // means a fetch for the new window is still in flight.
  const [loadedDays, setLoadedDays] = useState<number | null>(null);
  const [pendingOffers, setPendingOffers] = useState(0);
  const loading = loadedDays !== days;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/den/bids")
      .then((res) => (res.ok ? res.json() : { bids: [] }))
      .then((body) => {
        if (!cancelled) {
          const live = (body.bids || []).filter(
            (b: { status: string }) => b.status === "pending",
          );
          setPendingOffers(live.length);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/den/dashboard?days=${days}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) {
          setData(body);
          setLoadedDays(days);
        }
      })
      .catch(() => !cancelled && setLoadedDays(days));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const firstName = me?.display_name?.trim().split(/\s+/)[0];

  if (!loading && me && me.links.length === 0 && (data?.properties.length ?? 0) === 0) {
    return <DenWelcomeEmptyState />;
  }

  const stats = [
    { label: "New enquiries", value: data?.totals.inquiries ?? 0, icon: MessageCircle },
    { label: "Buyers shortlisted", value: data?.totals.shortlisted ?? 0, icon: Star },
    { label: "Site visits", value: data?.totals.visits ?? 0, icon: CalendarCheck },
    { label: "Listing views", value: data?.totals.views ?? 0, icon: Eye },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight">
            {firstName ? `Welcome back, ${firstName}` : "Your properties at a glance"}
          </h1>
          <p className="text-sm font-medium text-muted-foreground">
            Buyer activity across your listings, {data?.period.label ?? "last 7 days"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                  days === d ? "bg-background shadow" : "text-muted-foreground"
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
          <Link
            href="/den/properties/new"
            className={cn(buttonVariants({ size: "sm" }), "text-xs font-bold")}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add property
          </Link>
        </div>
      </div>

      {pendingOffers > 0 && (
        <Link
          href="/den/bids"
          className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 transition-colors hover:bg-amber-500/15"
        >
          <HandCoins className="h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
            {pendingOffers} offer{pendingOffers === 1 ? "" : "s"} waiting for your response →
          </p>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <stat.icon className="h-4.5 w-4.5 text-primary" />
              </span>
              <div>
                <p className="text-lg font-black leading-tight">
                  {loading ? "…" : stat.value}
                </p>
                <p className="text-[11px] font-semibold text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-black tracking-tight">Your listings</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        ) : (data?.properties.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-semibold">No listings yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add your first property and your managing agency will review and publish it.
              </p>
              <Link
                href="/den/properties/new"
                className={cn(buttonVariants({ size: "sm" }), "text-xs font-bold")}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add your first property
              </Link>
            </CardContent>
          </Card>
        ) : (
          data!.properties.map((p) => {
            const dealMeta = DEAL_MODE_META[p.deal_mode] ?? DEAL_MODE_META.off;
            return (
              <Link key={p.property_id} href={`/den/properties/${p.property_id}`}>
                <Card className="transition-all hover:border-primary/40 hover:shadow-md">
                  <CardContent className="flex flex-wrap items-center gap-4 p-4">
                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {p.cover_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.cover_image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{p.title}</p>
                      <p className="text-xs font-medium text-muted-foreground">
                        {p.listing_type === "Rent"
                          ? `${formatINR(p.rent_per_month)} / month`
                          : formatINR(p.price)}
                        {p.agency_name ? ` · managed by ${p.agency_name}` : ""}
                        {p.status === "Pending Review" ? " · pending review" : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold text-muted-foreground">
                        <span>{p.inquiries} enquiries</span>
                        <span>{p.shortlisted} shortlisted</span>
                        <span>{p.visits} visits</span>
                        <span>{p.views} views</span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${dealMeta.badgeClass}`}
                    >
                      {dealMeta.label}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

function DenWelcomeEmptyState() {
  const { me } = useDen();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
        <Building2 className="h-7 w-7 text-primary" />
      </span>
      <h1 className="text-xl font-black tracking-tight">Welcome to your Owners Den</h1>
      <p className="text-sm font-medium text-muted-foreground">
        We didn&apos;t find any properties linked to {me?.phone ?? "your number"} yet. If an agency
        manages your property, ask them to add this WhatsApp number to your owner record — your
        listings appear here automatically. Or start by listing a property yourself.
      </p>
      <Link href="/den/properties/new" className={cn(buttonVariants(), "text-xs font-bold")}>
        <Plus className="mr-1 h-3.5 w-3.5" /> List my property
      </Link>
    </div>
  );
}
