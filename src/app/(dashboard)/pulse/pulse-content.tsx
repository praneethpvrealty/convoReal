"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  RefreshCw,
  Eye,
  MousePointerClick,
  Image as ImageIcon,
  MapPin,
  Clock,
  Laptop,
  Users,
  Building,
  TrendingUp,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InfoHint } from "@/components/ui/info-hint";
import {
  loadPulseStats,
  loadPulseFeed,
  type PulseStats,
  type HydratedShowcaseEvent,
} from "@/lib/pulse/queries";
import { HeartbeatLoader } from "@/components/ui/heartbeat-loader";

export default function PulsePage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [stats, setStats] = useState<PulseStats | null>(null);
  const [feed, setFeed] = useState<HydratedShowcaseEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatsAndFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const db = createClient();
      const [statsData, feedData] = await Promise.all([
        loadPulseStats(db),
        loadPulseFeed(db),
      ]);
      setStats(statsData);
      setFeed(feedData);
    } catch (err: unknown) {
      console.error("[pulse] fetch failed:", err);
      toast.error("Failed to load Showcase Pulse analytics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) {
      fetchStatsAndFeed();
    }
  }, [accountId, fetchStatsAndFeed]);

  const handleOpenChat = async (contactId: string) => {
    try {
      const db = createClient();
      const { data, error } = await db
        .from("conversations")
        .select("id")
        .eq("contact_id", contactId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      const conversationId = (data as { id: string }[] | null)?.[0]?.id;
      if (conversationId) {
        router.push(`/inbox?c=${conversationId}`);
      } else {
        router.push(`/contacts?q=${contactId}`);
      }
    } catch (err) {
      console.error("[pulse] chat lookup failed:", err);
      toast.error("Failed to open contact conversation thread");
    }
  };

  const formatDwellTime = (ms?: number) => {
    if (!ms || isNaN(ms)) return "";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s dwell`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return remSec > 0 ? `${min}m ${remSec}s dwell` : `${min}m dwell`;
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case "open":
        return <Eye className="size-4 text-sky-400" />;
      case "view_property":
        return <Eye className="size-4 text-emerald-400" />;
      case "gallery":
        return <ImageIcon className="size-4 text-purple-400" />;
      case "map_click":
        return <MapPin className="size-4 text-amber-400" />;
      default:
        return <MousePointerClick className="size-4 text-slate-400" />;
    }
  };

  const getEventDescription = (event: HydratedShowcaseEvent) => {
    const contactName = event.contact
      ? event.contact.name || event.contact.phone
      : "Anonymous Guest";
    const propertyTitle = event.property ? event.property.title : "a property";

    switch (event.event_type) {
      case "open":
        return (
          <span>
            <strong className="text-white">{contactName}</strong> loaded the showcase catalog portal.
          </span>
        );
      case "view_property":
        const dwell = formatDwellTime(event.metadata.duration_ms);
        return (
          <span>
            <strong className="text-white">{contactName}</strong> viewed details of{" "}
            <strong className="text-slate-200">{propertyTitle}</strong>
            {dwell ? <span className="text-emerald-400 font-bold ml-1.5">({dwell})</span> : ""}.
          </span>
        );
      case "gallery":
        return (
          <span>
            <strong className="text-white">{contactName}</strong> opened the photo gallery for{" "}
            <strong className="text-slate-200">{propertyTitle}</strong>.
          </span>
        );
      case "map_click":
        return (
          <span>
            <strong className="text-white">{contactName}</strong> clicked the location map pin for{" "}
            <strong className="text-slate-200">{propertyTitle}</strong>.
          </span>
        );
      default:
        return (
          <span>
            <strong className="text-white">{contactName}</strong> interacted with the showcase link.
          </span>
        );
    }
  };

  const formatPrice = (price?: string | number) => {
    const val = Number(price);
    if (!val || isNaN(val)) return "₹0";
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, "")} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(2).replace(/\.00$/, "")} L`;
    return `₹${val.toLocaleString("en-IN")}`;
  };

  const formatTimeAgo = (isoString: string) => {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(isoString).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Activity className="size-8 text-primary" />
            Showcase Pulse
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Live visitor analytics. Pulse tracks links shared over WhatsApp, capturing opens, property image swipes, map clicks, and dwell times to rank client interest.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchStatsAndFeed(true)}
          disabled={loading || refreshing}
          className="shrink-0 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-900/40 rounded-xl cursor-pointer"
        >
          <RefreshCw className={`size-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh Stats"}
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <HeartbeatLoader size={112} label="Loading pulse activity" className="mb-4" />
          <p className="text-sm">Reading the pulse...</p>
        </div>
      ) : (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center">
                  Total Link Opens
                  <InfoHint text="Every time a client opens a Showcase link you shared over WhatsApp, it counts as one open." />
                </p>
                <h3 className="text-2xl font-black text-white mt-1.5">{stats?.totalViews ?? 0}</h3>
              </div>
              <div className="size-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400 shrink-0">
                <MousePointerClick className="size-5" />
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center">
                  Unique Sessions
                  <InfoHint text="Distinct browsing sessions across all shared links — one session per client per link visit." />
                </p>
                <h3 className="text-2xl font-black text-white mt-1.5">{stats?.uniqueSessions ?? 0}</h3>
              </div>
              <div className="size-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                <Laptop className="size-5" />
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center">
                  Avg Property Dwell
                  <InfoHint text="Average time clients spend viewing a single property listing inside your Showcase." />
                </p>
                <h3 className="text-2xl font-black text-white mt-1.5">
                  {stats?.avgDwellTimeSec ? `${stats.avgDwellTimeSec}s` : "0s"}
                </h3>
              </div>
              <div className="size-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                <Clock className="size-5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left/Middle: Live Engagement timeline */}
            <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  Live Event Timeline
                  <InfoHint text="Real-time feed of clicks, swipes, map taps, and page views from your shared Showcase links." />
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Chronological clickstream of shared link activity.</p>
              </div>

              {!feed || feed.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
                  <Activity className="size-8 mx-auto text-slate-650 mb-3 animate-pulse" />
                  <p className="text-xs font-bold text-slate-500">No clicks or engagement events logged yet</p>
                </div>
              ) : (
                <div className="relative border-l border-slate-800 ml-3 pl-5 space-y-5 py-2">
                  {feed.map((evt) => {
                    const avatarInit = evt.contact
                      ? (evt.contact.name || evt.contact.phone).charAt(0).toUpperCase()
                      : "?";

                    return (
                      <div key={evt.id} className="relative group">
                        {/* Timeline Circle */}
                        <div className="absolute -left-[29px] top-1.5 size-4.5 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center z-10 transition-colors group-hover:border-primary">
                          {getEventIcon(evt.event_type)}
                        </div>

                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <Avatar className="size-8 border border-slate-800 shrink-0 mt-0.5">
                              <AvatarFallback
                                className={`text-[10px] font-black cursor-pointer ${
                                  evt.contact
                                    ? "bg-primary/10 text-primary"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                                onClick={() => evt.contact && handleOpenChat(evt.contact.id)}
                              >
                                {avatarInit}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 text-xs">
                              <p className="text-slate-350 leading-relaxed font-medium">
                                {getEventDescription(evt)}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                <span>{formatTimeAgo(evt.created_at)}</span>
                                <span>•</span>
                                <span className="font-mono text-[9px] bg-slate-950/40 px-1 py-0.2 rounded">
                                  {evt.session_key.slice(0, 8)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Most Viewed Listings */}
            <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Building className="size-4 text-primary" />
                  Top Listings
                  <InfoHint text="Properties that received the most client views across all shared Showcase links." />
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Most viewed properties on client showcases.</p>
              </div>

              {!stats?.topProperties || stats.topProperties.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
                  <Building className="size-8 mx-auto text-slate-650 mb-3 animate-pulse" />
                  <p className="text-xs font-bold text-slate-500">No properties viewed yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.topProperties.map(({ property, viewsCount, uniqueViewsCount }) => (
                    <div
                      key={property.id}
                      className="rounded-lg border border-slate-800 bg-slate-950/20 p-3 space-y-2"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <h4 className="text-xs font-black text-white truncate leading-tight">
                            {property.title}
                          </h4>
                          <span className="text-[9px] font-bold text-slate-500 block mt-0.5">
                            {property.property_code || "No code"}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-slate-300 shrink-0">
                          {formatPrice(property.price)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-[10px] font-extrabold pt-1.5 border-t border-slate-850">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Users className="size-3 text-sky-400" />
                          {uniqueViewsCount} unique buyers
                        </span>
                        <span className="text-slate-400 flex items-center gap-1">
                          <Eye className="size-3 text-emerald-400" />
                          {viewsCount} views
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
