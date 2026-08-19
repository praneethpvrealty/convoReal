'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
  UserCheck,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { InfoHint } from '@/components/ui/info-hint';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import {
  loadPulseStats,
  loadPulseFeed,
  type PulseStats,
  type HydratedShowcaseEvent,
} from '@/lib/pulse/queries';
import {
  dedupeConsecutiveEvents,
  groupEventsByVisitor,
  type DedupedShowcaseEvent,
} from '@/lib/pulse/dedupe-feed';
import { HeartbeatLoader } from '@/components/ui/heartbeat-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { PropertyViewersDialog } from '@/components/pulse/property-viewers-dialog';

type FeedFilter = 'all' | 'property_views' | 'identified';

const FEED_FILTERS: Array<{ key: FeedFilter; label: string }> = [
  { key: 'all', label: 'All Activity' },
  { key: 'property_views', label: 'Property Views' },
  { key: 'identified', label: 'Identified Only' },
];

// Below this share of anonymous events (and this minimum feed size), the
// timeline nudges the agent toward per-contact tracked links instead.
const ANONYMOUS_NUDGE_THRESHOLD = 0.6;
const ANONYMOUS_NUDGE_MIN_EVENTS = 5;

export default function PulsePage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [stats, setStats] = useState<PulseStats | null>(null);
  const [feed, setFeed] = useState<HydratedShowcaseEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [expandedVisitors, setExpandedVisitors] = useState<Set<string>>(
    new Set()
  );
  const [viewersFor, setViewersFor] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const fetchStatsAndFeed = useCallback(
    async (accId: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const db = createClient();
        const [statsData, feedData] = await Promise.all([
          loadPulseStats(db, accId),
          loadPulseFeed(db),
        ]);
        setStats(statsData);
        setFeed(feedData);
      } catch (err: unknown) {
        console.error('[pulse] fetch failed:', err);
        toast.error('Failed to load Showcase Pulse analytics');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (accountId) {
      fetchStatsAndFeed(accountId);
    }
  }, [accountId, fetchStatsAndFeed]);

  const handleOpenChat = async (contactId: string) => {
    try {
      const db = createClient();
      const { data, error } = await db
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      const conversationId = (data as { id: string }[] | null)?.[0]?.id;
      if (conversationId) {
        router.push(`/inbox?c=${conversationId}`);
      } else {
        router.push(`/contacts?contactId=${contactId}`);
      }
    } catch (err) {
      console.error('[pulse] chat lookup failed:', err);
      toast.error('Failed to open contact conversation thread');
    }
  };

  const formatDwellTime = (ms?: number) => {
    if (!ms || isNaN(ms)) return '';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s dwell`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return remSec > 0 ? `${min}m ${remSec}s dwell` : `${min}m dwell`;
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'open':
        return <Eye className="size-4 text-sky-400" />;
      case 'view_property':
        return <Eye className="size-4 text-emerald-400" />;
      case 'gallery':
        return <ImageIcon className="size-4 text-purple-400" />;
      case 'map_click':
        return <MapPin className="size-4 text-amber-400" />;
      default:
        return <MousePointerClick className="size-4 text-slate-400" />;
    }
  };

  const getEventDescription = (event: HydratedShowcaseEvent) => {
    const propertyTitle = event.property ? event.property.title : 'a property';

    switch (event.event_type) {
      case 'open':
        return <span>Opened the showcase catalog.</span>;
      case 'view_property':
        const dwell = formatDwellTime(event.metadata.duration_ms);
        return (
          <span>
            Viewed details of{' '}
            <strong className="text-slate-200">{propertyTitle}</strong>
            {dwell ? (
              <span className="ml-1.5 font-bold text-emerald-400">
                ({dwell})
              </span>
            ) : (
              ''
            )}
            .
          </span>
        );
      case 'gallery':
        return (
          <span>
            Opened the photo gallery for{' '}
            <strong className="text-slate-200">{propertyTitle}</strong>.
          </span>
        );
      case 'map_click':
        return (
          <span>
            Clicked the location map pin for{' '}
            <strong className="text-slate-200">{propertyTitle}</strong>.
          </span>
        );
      default:
        return <span>Interacted with the showcase link.</span>;
    }
  };

  const getVisitorName = (event: HydratedShowcaseEvent) =>
    event.contact
      ? event.contact.name || event.contact.phone
      : event.share
        ? `Guest via link shared ${formatTimeAgo(event.share.created_at)} · ${event.session_key.slice(0, 8)}`
        : `Anonymous Guest · ${event.session_key.slice(0, 8)}`;

  const toggleVisitor = (visitorId: string) => {
    setExpandedVisitors((current) => {
      const next = new Set(current);
      if (next.has(visitorId)) next.delete(visitorId);
      else next.add(visitorId);
      return next;
    });
  };

  const formatPrice = (price?: string | number) => {
    const val = Number(price);
    if (!val || isNaN(val)) return '₹0';
    if (val >= 10000000)
      return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
    if (val >= 100000)
      return `₹${(val / 100000).toFixed(2).replace(/\.00$/, '')} L`;
    return `₹${val.toLocaleString('en-IN')}`;
  };

  const formatTimeAgo = (isoString: string) => {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(isoString).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  };

  const filteredFeed = (feed ?? []).filter((evt) => {
    if (feedFilter === 'identified') return !!evt.contact;
    if (feedFilter === 'property_views') return evt.event_type !== 'open';
    return true;
  });
  const dedupedFeed = dedupeConsecutiveEvents(filteredFeed);
  const visitorGroups = groupEventsByVisitor(dedupedFeed);

  const anonymousCount = (feed ?? []).filter((evt) => !evt.contact).length;
  const showAnonymousNudge =
    (feed?.length ?? 0) >= ANONYMOUS_NUDGE_MIN_EVENTS &&
    anonymousCount / (feed?.length ?? 1) >= ANONYMOUS_NUDGE_THRESHOLD;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-white">
            <Activity className="text-primary size-8" />
            Showcase Pulse
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Live visitor analytics. Pulse tracks links shared over WhatsApp,
            capturing opens, property image swipes, map clicks, and dwell times
            to rank client interest.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => accountId && fetchStatsAndFeed(accountId, true)}
          disabled={!accountId || loading || refreshing}
          className="shrink-0 cursor-pointer rounded-xl text-xs font-bold text-slate-400 hover:bg-slate-900/40 hover:text-white"
        >
          <RefreshCw
            className={`mr-1.5 size-3.5 ${refreshing ? 'animate-spin' : ''}`}
          />
          {refreshing ? 'Refreshing...' : 'Refresh Stats'}
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <HeartbeatLoader
            size={104}
            label="Loading pulse activity"
            className="mb-3"
          />
          <ConvoRealLoader size={20} className="mb-2" />
          <p className="text-sm">Reading the pulse...</p>
        </div>
      ) : (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div>
                <p className="flex items-center text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Total Link Opens
                  <InfoHint text="Every time a client opens a Showcase link you shared over WhatsApp, it counts as one open." />
                </p>
                <h3 className="mt-1.5 text-2xl font-black text-white">
                  {stats?.totalViews ?? 0}
                </h3>
              </div>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                <MousePointerClick className="size-5" />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div>
                <p className="flex items-center text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Unique Sessions
                  <InfoHint text="Distinct devices/browsers seen across all shared links — a returning visitor on the same device counts once. Your own link previews count too." />
                </p>
                <h3 className="mt-1.5 text-2xl font-black text-white">
                  {stats?.uniqueSessions ?? 0}
                </h3>
              </div>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                <Laptop className="size-5" />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div>
                <p className="flex items-center text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Avg Property Dwell
                  <InfoHint text="Average time clients spend viewing a single property listing inside your Showcase." />
                </p>
                <h3 className="mt-1.5 text-2xl font-black text-white">
                  {stats?.avgDwellTimeSec ? `${stats.avgDwellTimeSec}s` : '0s'}
                </h3>
              </div>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <Clock className="size-5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left/Middle: visitor activity */}
            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-black tracking-wider text-white uppercase">
                    <TrendingUp className="text-primary size-4" />
                    Visitor Activity
                    <InfoHint text="One card per visitor, with their latest action and expandable activity history." />
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Latest visitors first. Expand a visitor to see their full
                    journey.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {FEED_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFeedFilter(f.key)}
                      className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all ${
                        feedFilter === f.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {showAnonymousNudge && (
                <button
                  type="button"
                  onClick={() => router.push('/inventory')}
                  className="border-primary/25 bg-primary/5 hover:bg-primary/10 group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-all"
                >
                  <UserCheck className="text-primary size-4 shrink-0" />
                  <span className="text-[11px] leading-relaxed text-slate-300">
                    Most of this activity is{' '}
                    <strong className="text-white">Anonymous</strong>. Send
                    links personally from{' '}
                    <strong className="text-primary">
                      Inventory → Share Showcase
                    </strong>{' '}
                    or a property&apos;s{' '}
                    <strong className="text-primary">
                      Share → Send personally (tracked)
                    </strong>{' '}
                    to see visitors by name here.
                  </span>
                  <ArrowRight className="text-primary ml-auto size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
              )}

              {!feed || feed.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
                  <Activity className="text-slate-650 mx-auto mb-3 size-8 animate-pulse" />
                  <p className="text-xs font-bold text-slate-500">
                    No clicks or engagement events logged yet
                  </p>
                </div>
              ) : visitorGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
                  <Activity className="text-slate-650 mx-auto mb-3 size-8" />
                  <p className="text-xs font-bold text-slate-500">
                    No events match this filter
                  </p>
                </div>
              ) : (
                <div className="max-h-[600px] space-y-3 overflow-y-auto pr-2">
                  {visitorGroups.map((visitor) => {
                    const evt = visitor.latestEvent;
                    const avatarInit = evt.contact
                      ? (evt.contact.name || evt.contact.phone || '?')
                          .charAt(0)
                          .toUpperCase()
                      : '?';
                    const isExpanded = expandedVisitors.has(visitor.id);
                    const hasEarlierActivity = visitor.events.length > 1;

                    return (
                      <div
                        key={visitor.id}
                        className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/20"
                      >
                        <div className="flex items-start gap-3 p-3.5">
                          <Avatar className="size-9 shrink-0 border border-slate-800">
                            <AvatarFallback
                              className={`cursor-pointer text-[10px] font-black ${
                                evt.contact
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                              onClick={() =>
                                evt.contact && handleOpenChat(evt.contact.id)
                              }
                            >
                              {avatarInit}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black text-white">
                                  {getVisitorName(evt)}
                                  <NameTagBadge tag={evt.contact?.name_tag} />
                                </p>
                                <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed font-medium text-slate-400">
                                  <span className="mt-0.5 shrink-0">
                                    {getEventIcon(evt.event_type)}
                                  </span>
                                  <span>{getEventDescription(evt)}</span>
                                </div>
                                <p className="mt-1 text-[10px] font-bold text-slate-500">
                                  Last seen {formatTimeAgo(evt.created_at)}
                                  {evt.repeatCount > 1
                                    ? ` · ×${evt.repeatCount}`
                                    : ''}
                                </p>
                              </div>
                              <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-1 text-[10px] font-black">
                                {visitor.activityCount} activit
                                {visitor.activityCount === 1 ? 'y' : 'ies'}
                              </span>
                            </div>
                            {hasEarlierActivity && (
                              <button
                                type="button"
                                onClick={() => toggleVisitor(visitor.id)}
                                aria-expanded={isExpanded}
                                className="text-primary hover:text-primary/80 mt-2 flex items-center gap-1 text-[10px] font-black"
                              >
                                {isExpanded
                                  ? 'Hide earlier activity'
                                  : `View all ${visitor.activityCount} activities`}
                                <ChevronDown
                                  className={`size-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && hasEarlierActivity && (
                          <div className="space-y-3 border-t border-slate-800 bg-slate-950/30 px-3.5 py-3">
                            {visitor.events
                              .slice(1)
                              .map((earlierEvent: DedupedShowcaseEvent) => (
                                <div
                                  key={earlierEvent.id}
                                  className="flex items-start gap-2.5 pl-12"
                                >
                                  <span className="mt-0.5 shrink-0">
                                    {getEventIcon(earlierEvent.event_type)}
                                  </span>
                                  <div className="min-w-0 text-[11px]">
                                    <p className="leading-relaxed font-medium text-slate-400">
                                      {getEventDescription(earlierEvent)}
                                    </p>
                                    <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                                      {formatTimeAgo(earlierEvent.created_at)} ·{' '}
                                      {earlierEvent.session_key.slice(0, 8)}
                                      {earlierEvent.repeatCount > 1
                                        ? ` · ×${earlierEvent.repeatCount}`
                                        : ''}
                                    </p>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Most Viewed Listings */}
            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-black tracking-wider text-white uppercase">
                  <Building className="text-primary size-4" />
                  Top Listings
                  <InfoHint text="Properties that received the most client views across all shared Showcase links." />
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Most viewed properties on client showcases.
                </p>
              </div>

              {!stats?.topProperties || stats.topProperties.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
                  <Building className="text-slate-650 mx-auto mb-3 size-8 animate-pulse" />
                  <p className="text-xs font-bold text-slate-500">
                    No properties viewed yet
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.topProperties.map(
                    ({ property, viewsCount, uniqueViewsCount }) => (
                      <button
                        type="button"
                        key={property.id}
                        onClick={() =>
                          setViewersFor({
                            id: property.id,
                            title: property.title,
                          })
                        }
                        className="focus-visible:ring-primary w-full space-y-2 rounded-lg border border-slate-800 bg-slate-950/20 p-3 text-left transition-colors hover:border-slate-700 hover:bg-slate-950/40 focus:outline-none focus-visible:ring-1"
                        title="See who viewed this listing"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="truncate text-xs leading-tight font-black text-white">
                              {property.title}
                            </h4>
                            <span className="mt-0.5 block text-[9px] font-bold text-slate-500">
                              {property.property_code || 'No code'}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs font-bold text-slate-300">
                            {formatPrice(property.price)}
                          </span>
                        </div>

                        <div className="border-slate-850 flex items-center justify-between border-t pt-1.5 text-[10px] font-extrabold">
                          <span className="flex items-center gap-1 text-slate-400">
                            <Users className="size-3 text-sky-400" />
                            {uniqueViewsCount} unique visitor
                            {uniqueViewsCount === 1 ? '' : 's'}
                          </span>
                          <span className="flex items-center gap-1 text-slate-400">
                            <Eye className="size-3 text-emerald-400" />
                            {viewsCount} views
                          </span>
                        </div>
                        <span className="text-primary/80 flex items-center justify-end gap-1 text-[10px] font-bold">
                          See viewers
                          <ArrowRight className="size-3" />
                        </span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <PropertyViewersDialog
        propertyId={viewersFor?.id ?? null}
        propertyTitle={viewersFor?.title ?? ''}
        open={!!viewersFor}
        onOpenChange={(o) => {
          if (!o) setViewersFor(null);
        }}
      />
    </div>
  );
}
